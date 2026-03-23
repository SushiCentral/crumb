import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";

export default function Editor() {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const state = EditorState.create({
            doc: `// Welcome to Horizon\n\nfunction hello() {\n  console.log("Hello, world!");\n}\n`,
            extensions: [basicSetup],
        });

        const view = new EditorView({
            state,
            parent: containerRef.current,
        });

        viewRef.current = view;

        return () => {
            view.destroy();
        };
    }, []);

    return (
        <div
            ref={containerRef}
            style={{ height: "100%", width: "100%" }}
        />
    );
}