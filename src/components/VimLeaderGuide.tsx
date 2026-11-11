import './VimLeaderGuide.css';
import { VIM_LEADER_BINDINGS, type VimLeaderAction } from '../lib/vim/leader.ts';

export interface VimLeaderGuideProps {
  /** The active leader prefix, or null when the guide should be hidden. */
  prefix: readonly string[] | null;
}

const ACTION_LABELS: Record<VimLeaderAction, string> = {
  'command-palette': 'Command palette',
  'toggle-file-tree': 'File tree',
  search: 'Search',
  'quick-open': 'Quick Open',
  'save-file': 'Save file',
  'save-all': 'Save all',
  'close-tab': 'Close tab',
  'force-close-tab': 'Force close tab',
  'search-word': 'Search word',
  'clear-search-highlight': 'Clear search highlight',
  'toggle-word-wrap': 'Word wrap',
  'toggle-line-numbers': 'Line numbers',
};

const GROUP_LABELS: Record<string, string> = {
  f: 'Files',
  b: 'Buffers',
  s: 'Search',
  u: 'UI',
};

interface Continuation {
  readonly action: VimLeaderAction;
  readonly key: readonly string[];
  readonly hasMore: boolean;
}

function samePrefix(prefix: readonly string[], keys: readonly string[]): boolean {
  return prefix.length < keys.length && prefix.every((key, index) => key === keys[index]);
}

function getContinuations(prefix: readonly string[]): Continuation[] {
  const unique = new Map<string, { action: VimLeaderAction; key: string[]; hasMore: boolean }>();
  for (const binding of VIM_LEADER_BINDINGS) {
    if (!samePrefix(prefix, binding.keys)) continue;
    const key = binding.keys[prefix.length];
    const hasMore = binding.keys.length > prefix.length + 1;
    // At the root, one row represents an entire group. Inside a group, rows
    // represent immediate next keys; action identity must not split a branch.
    const identity = prefix.length === 1
      ? `group:${key.toLowerCase()}`
      : `${key}:${hasMore}`;
    const existing = unique.get(identity);
    if (!existing) {
      unique.set(identity, { action: binding.action, key: [key], hasMore });
      continue;
    }

    if (!existing.key.includes(key)) existing.key.push(key);
  }
  return [...unique.values()].map(({ action, key, hasMore }) => ({ action, key, hasMore }));
}

function displayKey(key: string): string {
  if (key === 'Space') return 'Space';
  return key;
}

export default function VimLeaderGuide({ prefix }: VimLeaderGuideProps) {
  if (prefix === null) return null;

  const continuations = getContinuations(prefix);
  if (continuations.length === 0) return null;
  const groupName = prefix.length === 2 && prefix[0] === 'Space'
    ? GROUP_LABELS[prefix[1].toLowerCase()]
    : undefined;

  return (
    <aside
      key={prefix.join('-')}
      className="vim-leader-guide"
      aria-label="Vim shortcut continuations"
    >
      <div className="vim-leader-guide-context" aria-hidden="true">
        {prefix.map((key, index) => (
          <span className="vim-leader-guide-context-part" key={`${key}-${index}`}>
            {index > 0 && <span className="vim-leader-guide-context-divider">/</span>}
            <kbd>{displayKey(key)}</kbd>
          </span>
        ))}
        <span className="vim-leader-guide-next">NEXT</span>
      </div>
      {groupName && <div className="vim-leader-guide-group-heading">{groupName}</div>}
      <ul className="vim-leader-guide-list">
        {continuations.map(({ action, key, hasMore }) => (
          <li className={`vim-leader-guide-row${hasMore ? ' has-more' : ''}`} key={`${action}:${key.join('/')}`}>
            <kbd className="vim-leader-guide-key">{key.map(displayKey).join(' / ')}</kbd>
            {prefix.length === 1 && GROUP_LABELS[key[0].toLowerCase()] ? (
              <span className="vim-leader-guide-group-label">
                {GROUP_LABELS[key[0].toLowerCase()]}
                <span className="vim-leader-guide-group-badge">GROUP</span>
              </span>
            ) : (
              <span className="vim-leader-guide-action">{ACTION_LABELS[action] ?? action}</span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
