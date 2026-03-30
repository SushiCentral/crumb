import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { Annotation, EditorState } from "@codemirror/state";
import { oneDarkTheme } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { zedSyntaxHighlighting } from "../lib/highlight"; // add this

interface EditorProps {
    doc: string;
    onChange?: (value: string) => void;
}

const externalDocUpdate = Annotation.define<boolean>();

const zedStyleOverrides = EditorView.theme({
    "&": {
        backgroundColor: "#1c1c1c",
        color: "#d4d4d4",
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: "13.5px",
        lineHeight: "1.6",
    },
    ".cm-scroller": {
        overflow: "auto",
        fontFamily: "inherit",
    },
    ".cm-gutters": {
        backgroundColor: "#1c1c1c",
        borderRight: "none",
        paddingRight: "12px",
        color: "#4a4a4a",
    },
    ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "#a0a0a0",
    },
    ".cm-activeLine": {
        backgroundColor: "#252525",
    },
    ".cm-selectionBackground, ::selection": {
        backgroundColor: "#2a3f5f !important",
    },
    ".cm-cursor": {
        borderLeftColor: "#528bff",
        borderLeftWidth: "2px",
    },
    "&.cm-focused": {
        outline: "none",
    },
    ".cm-matchingBracket": {
        backgroundColor: "#3a3a3a",
        outline: "none",
    },
    ".cm-scroller::-webkit-scrollbar": {
        width: "6px",
        height: "6px",
    },
    ".cm-scroller::-webkit-scrollbar-track": {
        background: "transparent",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
        background: "#3a3a3a",
        borderRadius: "3px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
        background: "#4a4a4a",
    },
});

export default function Editor({ doc, onChange }: EditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef<EditorProps["onChange"]>(onChange);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (!containerRef.current) return;

        const state = EditorState.create({
            doc,
            extensions: [
                zedSyntaxHighlighting, // Move to top for highest precedence
                zedStyleOverrides,
                basicSetup,
                EditorView.updateListener.of((update) => {
                    if (!update.docChanged) return;

                    const isExternalUpdate = update.transactions.some((transaction) =>
                        transaction.annotation(externalDocUpdate)
                    );

                    if (!isExternalUpdate) {
                        onChangeRef.current?.(update.state.doc.toString());
                    }
                }),
                javascript(),
                oneDarkTheme,
            ],
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

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;

        const current = view.state.doc.toString();
        if (current === doc) return;

        view.dispatch({
            annotations: externalDocUpdate.of(true),
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: doc,
            },
        });
    }, [doc]);

    return (
        <div
            ref={containerRef}
            style={{ height: "100%", width: "100%" }}
        />
    );
}
