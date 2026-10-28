import { Prec } from '@codemirror/state';
import type { Extension, Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Vim, getCM, type CodeMirrorV, type MotionFn } from '@replit/codemirror-vim';
import type { VimMapping } from './config.ts';
import {
  VIM_FLASH_LABELS,
  VIM_JUMP_LABELS,
  chooseFlashTarget,
  findFlashMatches,
  labelFlashMatches,
  rememberFlashLabels,
  type FlashMatch,
} from './jump-model.ts';
import {
  captureVimGoal,
  getVimPublicState,
  recordVimJump,
  registerVimCapturePreflight,
  restoreVimGoal,
  setVimGoalColumn,
  type VimGoalSnapshot,
  type VimJumpPoint,
} from './lifecycle.ts';

export { VIM_FLASH_LABELS, VIM_JUMP_LABELS };

/**
 * Flash-inspired, viewport-local jump mode for Crumb.
 *
 * The pure policy lives in jump-model.ts. This module owns one view-local
 * session, native Vim motion intents, transient decorations, and the label
 * projection. Labels/highlights follow live query updates; there is no Enter
 * gate. Visual character/line/block previews drive the real Vim head so the
 * engine keeps anchors, marks, and block geometry.
 */

export const VIM_JUMP_LABEL_CLASS = 'crumb-jump-label';

/** Shared UI-lane contract for the live query prompt. */
export interface VimFlashState {
  readonly query: string;
  readonly matchCount: number;
}

export interface VimJumpExtensionOptions {
  readonly onFlashStateChange?: (state: VimFlashState | null) => void;
}

function clampOffset(doc: Text, offset: number): number {
  return Math.min(Math.max(0, Math.trunc(offset)), doc.length);
}

function pointAtOffset(doc: Text, offset: number): VimJumpPoint {
  const clamped = clampOffset(doc, offset);
  const line = doc.lineAt(clamped);
  return { line: line.number - 1, ch: clamped - line.from };
}

function offsetAtPoint(doc: Text, point: VimJumpPoint): number {
  const lineNumber = Math.min(
    Math.max(0, Math.trunc(point.line)),
    Math.max(0, doc.lines - 1),
  ) + 1;
  const line = doc.line(lineNumber);
  return line.from + Math.min(Math.max(0, Math.trunc(point.ch)), line.length);
}

type MotionIntent = 'preview' | 'commit' | 'restore';

const FLASH_KEYS: Readonly<Record<MotionIntent, { key: string; motion: string }>> = Object.freeze({
  preview: { key: '<Plug>CrumbFlashPreview', motion: 'crumbFlashPreview' },
  commit: { key: '<Plug>CrumbFlashCommit', motion: 'crumbFlashCommit' },
  restore: { key: '<Plug>CrumbFlashRestore', motion: 'crumbFlashRestore' },
});

const pendingTargets = new WeakMap<object, VimJumpPoint>();
let flashMotionsInstalled = false;

function installVimFlashMotions(): void {
  if (flashMotionsInstalled) return;
  flashMotionsInstalled = true;

  const motion: MotionFn = cm => {
    const target = pendingTargets.get(cm);
    return target ? { line: target.line, ch: target.ch } : null;
  };
  for (const intent of ['preview', 'commit', 'restore'] as const) {
    Vim.defineMotion(FLASH_KEYS[intent].motion, motion);
    Vim.mapCommand(
      FLASH_KEYS[intent].key,
      'motion',
      FLASH_KEYS[intent].motion,
      {},
      { context: 'normal' },
    );
    Vim.mapCommand(
      FLASH_KEYS[intent].key,
      'motion',
      FLASH_KEYS[intent].motion,
      {},
      { context: 'visual' },
    );
  }
}

/** True while any view owns the transient jump prompt. */
const activeJumpViews = new WeakSet<EditorView>();

export function isVimJumpActive(view: EditorView): boolean {
  return activeJumpViews.has(view);
}

export function isVimJumpMode(mode: string): mode is 'normal' | 'visual' | 'visual-line' | 'visual-block' {
  return mode === 'normal'
    || mode === 'visual'
    || mode === 'visual-line'
    || mode === 'visual-block';
}

/** Respect an explicit Normal/Visual `s` mapping instead of shadowing it. */
export function vimJumpSuppressedByMappings(mappings: readonly VimMapping[]): boolean {
  return mappings.some(mapping =>
    mapping.lhs === 's'
    && (mapping.modes.includes('normal') || mapping.modes.includes('visual')),
  );
}

interface LabelEntry {
  readonly element: HTMLSpanElement;
  readonly match: FlashMatch;
}

interface LabelPosition {
  readonly element: HTMLSpanElement;
  readonly left: number;
  readonly top: number;
  readonly visible: boolean;
}

class VimJumpViewPlugin {
  private readonly view: EditorView;
  private readonly onFlashStateChange: ((state: VimFlashState | null) => void) | undefined;
  private readonly removeCapturePreflight: () => void;
  private readonly resizeObserver: ResizeObserver;
  private readonly handleScroll = (): void => {
    if (this.active && !this.applyingMotion) this.scheduleRecompute();
  };

  private active = false;
  private query = '';
  private matches: FlashMatch[] = [];
  private target: FlashMatch | null = null;
  private previousLabels = new Map<number, string>();
  private activationCursor = 0;
  private activationVisual = false;
  private activationScrollTop = 0;
  private activationScrollLeft = 0;
  private activationGoal: VimGoalSnapshot | null = null;
  private live: HTMLDivElement | null = null;
  private labelLayer: HTMLDivElement | null = null;
  private labelEntries: LabelEntry[] = [];
  private positionMeasurePending = false;
  private refreshFrame = 0;
  private scheduledPreview = false;
  private applyingMotion = false;
  private transientDecorations: DecorationSet = Decoration.none;

  constructor(view: EditorView, options: VimJumpExtensionOptions) {
    this.view = view;
    this.onFlashStateChange = options.onFlashStateChange;
    this.removeCapturePreflight = registerVimCapturePreflight(view, () => {
      this.restorePreviewBeforeCapture();
    });
    this.view.scrollDOM.addEventListener('scroll', this.handleScroll, { passive: true });
    this.resizeObserver = new ResizeObserver(() => {
      if (this.active) this.scheduleRecompute();
    });
    this.resizeObserver.observe(this.view.scrollDOM);
    // A newly created plugin has no live session. Publish null so cached-state
    // restoration cannot leave a stale status-bar entry.
    this.onFlashStateChange?.(null);
  }

  get decorations(): DecorationSet {
    return this.transientDecorations;
  }

  handleKey(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    if (!this.active) return this.handleStartKey(event);
    return this.handlePromptKey(event);
  }

  update(update: ViewUpdate): void {
    if (!this.active) return;
    if (update.docChanged) {
      // External edits invalidate offsets. Never restore the preview over the
      // user's edit; decorations clear when this update commits.
      this.resetState({ refresh: false, notify: true });
      return;
    }
    if (update.viewportChanged || update.geometryChanged) {
      this.scheduleRecompute();
    } else if (update.selectionSet) {
      this.schedulePositionLabels();
    }
  }

  cancel(): void {
    this.restorePreviewBeforeCapture();
  }

  handleBlur(): void {
    this.restoreTransientPreview({ exitVisual: false, includeScroll: true });
  }

  handleMouseDown(): void {
    // Let the mouse selection proceed. Cancel Flash without restoring the old
    // preview or stealing the selection the user is making.
    this.resetState({ refresh: true, notify: true });
  }

  destroy(): void {
    this.cancelRefresh();
    this.view.scrollDOM.removeEventListener('scroll', this.handleScroll);
    this.resizeObserver.disconnect();
    this.removeCapturePreflight();
    // Never dispatch from teardown; the plugin and its decorations go away
    // together, so cached EditorState cannot retain stale offsets.
    this.resetState({ refresh: false, notify: true });
  }

  private handleStartKey(event: KeyboardEvent): boolean {
    if (event.repeat) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key !== 's') return false;

    const state = getVimPublicState(this.view);
    if (!isVimJumpMode(state.mode)) return false;
    if (state.pending.length > 0) return false;

    const cm = getCM(this.view);
    const vim = cm?.state.vim;
    if (!cm || !vim) return false;

    const visual = state.mode !== 'normal';
    const doc = this.view.state.doc;
    this.activationVisual = visual;
    this.activationCursor = visual
      ? offsetAtPoint(doc, vim.sel.head)
      : this.view.state.selection.main.head;
    this.activationScrollTop = this.view.scrollDOM.scrollTop;
    this.activationScrollLeft = this.view.scrollDOM.scrollLeft;
    this.activationGoal = captureVimGoal(this.view);
    this.query = '';
    this.matches = [];
    this.target = null;
    this.previousLabels.clear();
    this.transientDecorations = Decoration.none;
    this.active = true;
    activeJumpViews.add(this.view);
    this.view.dom.classList.add('cm-flash-active');
    this.ensureLive();
    this.ensureLabelLayer();
    this.renderLive();
    this.emitState();
    return true;
  }

  private handlePromptKey(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;

    if (event.key === 'Escape') {
      this.restoreTransientPreview({ exitVisual: true, includeScroll: true });
      return true;
    }
    if (event.key === 'Enter') {
      this.commitTarget();
      return true;
    }
    if (event.key === 'Backspace') {
      this.query = this.query.slice(0, -1);
      this.recompute(true);
      return true;
    }
    if (event.key.length === 1) {
      const visibleEntry = this.labelEntries.find(entry =>
        entry.match.label === event.key && entry.element.style.display !== 'none',
      );
      if (visibleEntry) {
        this.commitMatch(visibleEntry.match);
        return true;
      }
      this.query += event.key;
      this.recompute(true);
      return true;
    }
    return true;
  }

  private scheduleRecompute(applyPreview = false): void {
    if (!this.active) return;
    this.scheduledPreview = this.scheduledPreview || applyPreview;
    if (this.refreshFrame !== 0) return;
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = 0;
      const preview = this.scheduledPreview;
      this.scheduledPreview = false;
      if (this.active) this.recompute(preview);
    });
  }

  private cancelRefresh(): void {
    this.scheduledPreview = false;
    if (this.refreshFrame === 0) return;
    cancelAnimationFrame(this.refreshFrame);
    this.refreshFrame = 0;
  }

  private recompute(applyPreview = true): void {
    if (!this.active) return;
    if (this.refreshFrame !== 0) this.cancelRefresh();
    const text = this.view.state.doc.toString();
    const coarse = findFlashMatches(text, this.query, this.view.visibleRanges);
    const eligible = this.onscreenMatches(coarse);

    if (this.query.length > 0 && eligible.length === 0) {
      this.finishNoResults();
      return;
    }

    const result = labelFlashMatches(text, this.query, eligible, this.activationCursor, {
      previousLabels: this.previousLabels,
    });
    rememberFlashLabels(this.previousLabels, result.matches);
    this.matches = result.matches;
    this.target = result.target;
    this.transientDecorations = this.query.length === 0
      ? Decoration.none
      : this.buildDecorations(result.matches, result.target, this.view.visibleRanges);

    this.renderLabels();
    this.renderLive();
    this.emitState();
    // Force the view plugin's transient decoration set to be re-read.
    this.view.dispatch({});
    if (applyPreview && this.activationVisual) this.previewTarget();
    this.schedulePositionLabels();
  }

  private usableTextRect(): { left: number; top: number; right: number; bottom: number } {
    const scroller = this.view.scrollDOM.getBoundingClientRect();
    const gutter = this.view.dom.querySelector<HTMLElement>('.cm-gutters');
    const gutterRect = gutter?.getBoundingClientRect();
    const left = gutterRect
      ? Math.min(Math.max(scroller.left, gutterRect.right), scroller.right)
      : scroller.left;
    return { left, top: scroller.top, right: scroller.right, bottom: scroller.bottom };
  }

  private onscreenMatches(matches: readonly FlashMatch[]): FlashMatch[] {
    if (matches.length === 0) return [];
    const rect = this.usableTextRect();
    return matches.filter(match => {
      const coords = this.view.coordsForChar?.(match.from) ?? this.view.coordsAtPos(match.from);
      if (!coords) return false;
      return coords.bottom > rect.top
        && coords.top < rect.bottom
        && coords.left >= rect.left
        && coords.right <= rect.right;
    });
  }

  private buildDecorations(
    matches: readonly FlashMatch[],
    target: FlashMatch | null,
    visibleRanges: readonly { from: number; to: number }[],
  ): DecorationSet {
    if (matches.length === 0) return Decoration.none;
    const ranges = matches.map(match => {
      const classes = match.from === target?.from
        ? 'crumb-jump-match crumb-jump-current'
        : 'crumb-jump-match';
      return Decoration.mark({ class: classes }).range(match.from, match.to);
    });

    const ordered = [...matches].sort((a, b) => a.from - b.from);
    for (const range of visibleRanges) {
      let cursor = range.from;
      for (const match of ordered) {
        if (match.to <= cursor) continue;
        if (match.from >= range.to) break;
        if (match.from > cursor) {
          ranges.push(Decoration.mark({ class: 'crumb-flash-dim' }).range(cursor, match.from));
        }
        cursor = Math.max(cursor, match.to);
      }
      if (cursor < range.to) {
        ranges.push(Decoration.mark({ class: 'crumb-flash-dim' }).range(cursor, range.to));
      }
    }

    return Decoration.set(ranges, true);
  }

  private previewTarget(): void {
    if (!this.activationVisual || !this.active) return;
    const offset = this.target ? this.target.from : this.activationCursor;
    this.applyNativeMotion(pointAtOffset(this.view.state.doc, offset), 'preview');
    // Preview is transient: never let it rewrite the user's goal column.
    restoreVimGoal(this.view, this.activationGoal);
  }

  private commitTarget(): void {
    const target = chooseFlashTarget(this.matches, this.activationCursor);
    if (target) {
      this.commitMatch(target);
      return;
    }
    this.resetState({ refresh: true, notify: true });
  }

  private commitMatch(match: FlashMatch): void {
    const doc = this.view.state.doc;
    const activation = pointAtOffset(doc, this.activationCursor);
    const target = pointAtOffset(doc, match.from);
    this.resetState({ refresh: false, notify: true });
    const moved = this.applyNativeMotion(target, 'commit');
    if (!moved) this.view.dispatch({});
    setVimGoalColumn(this.view, target.ch);
    recordVimJump(this.view, activation, target);
  }

  private finishNoResults(): void {
    this.matches = [];
    this.target = null;
    this.transientDecorations = Decoration.none;
    if (this.activationVisual) {
      this.applyNativeMotion(
        pointAtOffset(this.view.state.doc, this.activationCursor),
        'restore',
      );
      restoreVimGoal(this.view, this.activationGoal);
    }
    this.resetState({ refresh: true, notify: true });
  }

  private restoreTransientPreview(options: { exitVisual: boolean; includeScroll: boolean }): void {
    if (!this.active) return;
    const activation = pointAtOffset(this.view.state.doc, this.activationCursor);
    const visual = this.activationVisual;
    const scrollTop = this.activationScrollTop;
    const scrollLeft = this.activationScrollLeft;
    if (visual) {
      this.applyNativeMotion(activation, 'restore');
      restoreVimGoal(this.view, this.activationGoal);
    }
    this.resetState({ refresh: true, notify: true });

    if (options.exitVisual && visual) {
      const cm = getCM(this.view);
      if (cm?.state.vim?.visualMode) Vim.exitVisualMode(cm as CodeMirrorV);
    }
    if (options.includeScroll) {
      this.view.scrollDOM.scrollTop = scrollTop;
      this.view.scrollDOM.scrollLeft = scrollLeft;
    }
  }

  private restorePreviewBeforeCapture(): void {
    if (!this.active) return;
    this.restoreTransientPreview({ exitVisual: false, includeScroll: true });
  }

  private applyNativeMotion(point: VimJumpPoint, intent: MotionIntent): boolean {
    const cm = getCM(this.view);
    if (!cm || !cm.state.vim) return false;
    pendingTargets.set(cm, point);
    this.applyingMotion = true;
    const adapter = cm as unknown as {
      scrollIntoView?: (...args: unknown[]) => void;
    };
    const hadOwnScroll = Object.prototype.hasOwnProperty.call(adapter, 'scrollIntoView');
    const originalScroll = adapter.scrollIntoView;
    // Flash owns the scroll view: previews and restores must not enqueue a
    // native scroll that overrides a manual scroll or an activation restore.
    adapter.scrollIntoView = () => {};
    try {
      const handled = Vim.handleKey(cm as CodeMirrorV, FLASH_KEYS[intent].key, 'user');
      return handled === true;
    } finally {
      if (hadOwnScroll) adapter.scrollIntoView = originalScroll;
      else delete adapter.scrollIntoView;
      this.applyingMotion = false;
      pendingTargets.delete(cm);
    }
  }

  private resetState(options: { refresh: boolean; notify: boolean }): void {
    const wasActive = this.active;
    this.active = false;
    activeJumpViews.delete(this.view);
    this.cancelRefresh();
    this.query = '';
    this.matches = [];
    this.target = null;
    this.previousLabels.clear();
    this.activationGoal = null;
    this.transientDecorations = Decoration.none;
    this.clearLabels();
    this.labelLayer?.remove();
    this.labelLayer = null;
    this.live?.remove();
    this.live = null;
    this.view.dom.classList.remove('cm-flash-active');
    if (wasActive && options.notify) this.onFlashStateChange?.(null);
    if (wasActive && options.refresh) this.view.dispatch({});
  }

  private emitState(): void {
    this.onFlashStateChange?.({
      query: this.query,
      matchCount: this.matches.length,
    });
  }

  private ensureLive(): void {
    if (this.live) return;
    const live = this.view.dom.ownerDocument.createElement('div');
    live.className = 'crumb-jump-live';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    live.style.cssText = [
      'position:absolute',
      'width:1px',
      'height:1px',
      'margin:-1px',
      'padding:0',
      'border:0',
      'overflow:hidden',
      'clip:rect(0 0 0 0)',
      'clip-path:inset(50%)',
      'white-space:nowrap',
    ].join(';');
    this.live = live;
    this.view.dom.appendChild(live);
  }

  private ensureLabelLayer(): void {
    if (this.labelLayer) return;
    const layer = this.view.dom.ownerDocument.createElement('div');
    layer.className = 'crumb-flash-label-layer';
    this.labelLayer = layer;
    this.view.dom.appendChild(layer);
  }

  private renderLive(): void {
    if (!this.live) return;
    const count = `${this.matches.length} match${this.matches.length === 1 ? '' : 'es'}`;
    this.live.textContent = this.query.length === 0
      ? 'Jump mode. Type a query.'
      : `${count} for ${this.query}`;
  }

  private renderLabels(): void {
    this.clearLabels();
    this.ensureLabelLayer();
    const layer = this.labelLayer;
    if (!layer) return;
    const document = this.view.dom.ownerDocument;
    for (const match of this.matches) {
      if (!match.label) continue;
      const element = document.createElement('span');
      element.className = match.from === this.target?.from
        ? `${VIM_JUMP_LABEL_CLASS} is-current`
        : VIM_JUMP_LABEL_CLASS;
      element.dataset.label = match.label;
      element.dataset.offset = String(match.from);
      element.textContent = match.label;
      element.setAttribute('aria-hidden', 'true');
      element.style.position = 'absolute';
      this.labelEntries.push({ element, match });
      layer.appendChild(element);
    }
    this.schedulePositionLabels();
  }

  private schedulePositionLabels(): void {
    if (!this.active || this.positionMeasurePending || this.labelEntries.length === 0) return;
    const layer = this.labelLayer;
    if (!layer) return;
    this.positionMeasurePending = true;
    this.view.requestMeasure({
      key: this,
      read: () => {
        this.positionMeasurePending = false;
        if (!this.active || !this.labelLayer) return [];
        const layerRect = this.labelLayer.getBoundingClientRect();
        const localWidth = this.labelLayer.offsetWidth || layerRect.width;
        const localHeight = this.labelLayer.offsetHeight || layerRect.height;
        if (localWidth <= 0 || localHeight <= 0) return [];
        const scaleX = layerRect.width > 0 ? layerRect.width / localWidth : 1;
        const scaleY = layerRect.height > 0 ? layerRect.height / localHeight : 1;
        const usable = this.usableTextRect();
        const areaLeft = Math.max(0, Math.min(localWidth, (usable.left - layerRect.left) / scaleX));
        const areaRight = Math.max(areaLeft, Math.min(localWidth, (usable.right - layerRect.left) / scaleX));
        const areaTop = Math.max(0, Math.min(localHeight, (usable.top - layerRect.top) / scaleY));
        const areaBottom = Math.max(areaTop, Math.min(localHeight, (usable.bottom - layerRect.top) / scaleY));

        const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];
        const positions: LabelPosition[] = [];
        const currentFrom = this.target?.from;
        const ordered = [...this.labelEntries].sort((a, b) => {
          const aCurrent = a.match.from === currentFrom ? 0 : 1;
          const bCurrent = b.match.from === currentFrom ? 0 : 1;
          return aCurrent - bCurrent;
        });

        for (const { element, match } of ordered) {
          const lastOffset = Math.max(match.from, match.to - 1);
          const coords = this.view.coordsForChar?.(lastOffset)
            ?? this.view.coordsAtPos(lastOffset);
          if (!coords) {
            positions.push({ element, left: 0, top: 0, visible: false });
            continue;
          }
          const width = element.offsetWidth || element.getBoundingClientRect().width;
          const height = element.offsetHeight || element.getBoundingClientRect().height;
          // Overlay the next character cell on the same visual line. Never
          // relocate the badge to fit the viewport; hide it instead.
          const left = (coords.right - layerRect.left) / scaleX;
          const top = (coords.top - layerRect.top) / scaleY;
          const right = left + width;
          const bottom = top + height;
          const inBounds = left >= areaLeft - 0.5
            && right <= areaRight + 0.5
            && top >= areaTop - 0.5
            && bottom <= areaBottom + 0.5;
          const overlaps = placed.some(rect =>
            left < rect.right + 1
            && right > rect.left - 1
            && top < rect.bottom + 1
            && bottom > rect.top - 1
          );

          if (inBounds && !overlaps) {
            placed.push({ left, top, right, bottom });
            positions.push({ element, left, top, visible: true });
          } else {
            positions.push({ element, left: 0, top: 0, visible: false });
          }
        }
        return positions;
      },
      write: positions => {
        if (!this.active) return;
        for (const position of positions) {
          position.element.style.display = position.visible ? '' : 'none';
          position.element.style.left = `${position.left}px`;
          position.element.style.top = `${position.top}px`;
        }
      },
    });
  }

  private clearLabels(): void {
    for (const { element } of this.labelEntries) element.remove();
    this.labelEntries = [];
  }
}

/**
 * Place before the Vim adapter in the same compartment so Normal/Visual `s`
 * is owned by the jump prompt rather than the engine's substitute command.
 */
export function createVimJumpExtension(options: VimJumpExtensionOptions = {}): Extension {
  installVimFlashMotions();
  return [
    Prec.highest(ViewPlugin.fromClass(
      class extends VimJumpViewPlugin {
        constructor(view: EditorView) {
          super(view, options);
        }
      },
      {
        decorations: plugin => plugin.decorations,
        eventHandlers: {
          keydown(this: VimJumpViewPlugin, event: KeyboardEvent): boolean {
            return this.handleKey(event);
          },
          blur(this: VimJumpViewPlugin): void {
            this.handleBlur();
          },
          mousedown(this: VimJumpViewPlugin): boolean {
            this.handleMouseDown();
            return false;
          },
        },
      },
    )),
  ];
}
