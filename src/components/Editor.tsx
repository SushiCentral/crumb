import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';

interface EditorProps {
  content: string;
  filePath: string | null;
  saved: boolean;
  onChange: (value: string) => void;
}

export function Editor({ content, filePath, saved, onChange }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isApplyingExternalChange = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          oneDark,
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto' },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isApplyingExternalChange.current) {
              onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => view.destroy();
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent === content) return;

    isApplyingExternalChange.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
    });
    isApplyingExternalChange.current = false;
  }, [content]);

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'untitled';

  return (
    <div className="editor-root">
      <div className="editor-header">
        <div className="editor-tab editor-tab--active">
          <span className="editor-tab__name">{fileName}</span>
          {!saved && <span className="editor-tab__dot" aria-hidden="true" />}
        </div>
      </div>
      <div ref={containerRef} className="editor-container" />
    </div>
  );
}
