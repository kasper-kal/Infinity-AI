/**
 * CodeMirror Wrapper — Liquid Glass Design System
 */

import React, { forwardRef, useEffect, useRef, useState, useMemo } from "react";
import { EditorView, keymap, ViewUpdate } from "@codemirror/view";
import { EditorState, Extension, Compartment, Prec, EditorState as StateEditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { php } from "@codemirror/lang-php";
import { vue } from "@codemirror/lang-vue";
import { oneDark } from "@codemirror/theme-one-dark";
import { createCursorExtensions } from "@/components/Cursor/CodeMirrorIntegration";
import "./CodeEditor.css";

export type Language =
  | "javascript"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "cpp"
  | "html"
  | "css"
  | "json"
  | "markdown"
  | "sql"
  | "yaml"
  | "xml"
  | "php"
  | "vue"
  | "plaintext";

export interface CursorAIConfig {
  projectId: string;
  projectRoot: string;
  filePath: string;
  tabAutocompleteEnabled?: boolean;
  onCmdKAccept?: (newCode: string) => void;
  onCmdKClose?: () => void;
  /** Callback when user navigates to a definition/reference (filePath, line, column) */
  onNavigate?: (filePath: string, line: number, column?: number) => void;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: Language;
  theme?: "light" | "dark" | "auto";
  readOnly?: boolean;
  placeholder?: string;
  showLineNumbers?: boolean;
  highlightActiveLine?: boolean;
  tabSize?: number;
  wordWrap?: boolean;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
  extensions?: Extension[];
  onMount?: (view: EditorView) => void;
  /** Cursor AI features: Tab autocomplete (ghost text) and Cmd+K inline edit */
  cursorConfig?: CursorAIConfig;
}

const LANGUAGE_MAP: Record<Language, Extension> = {
  javascript: javascript(),
  typescript: javascript({ jsx: true, typescript: true }),
  python: python(),
  rust: rust(),
  go: go(),
  java: java(),
  cpp: cpp(),
  html: html(),
  css: css(),
  json: json(),
  markdown: markdown(),
  sql: sql(),
  yaml: yaml(),
  xml: xml(),
  php: php(),
  vue: vue(),
  plaintext: [],
};

export const CodeEditor = forwardRef<HTMLDivElement, CodeEditorProps>(
  (
    {
      value,
      onChange,
      language = "plaintext",
      theme = "auto",
      readOnly = false,
      placeholder,
      showLineNumbers = true,
      highlightActiveLine = true,
      tabSize = 2,
      wordWrap = true,
      fontSize = 14,
      fontFamily = "var(--font-mono)",
      lineHeight = 1.6,
      minHeight = 200,
      maxHeight,
      autoFocus = false,
      className = "",
      style,
      extensions = [],
      onMount,
      cursorConfig,
    },
    ref
  ) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [mounted, setMounted] = useState(false);
    const languageCompartment = useRef(new Compartment());
    const themeCompartment = useRef(new Compartment());
    const readOnlyCompartment = useRef(new Compartment());
    const cursorCompartment = useRef(new Compartment());

    const languageExt = useMemo(() => LANGUAGE_MAP[language] || [], [language]);

    const themeExt = useMemo(() => {
      if (theme === "dark" || (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
        return oneDark;
      }
      return [];
    }, [theme]);

    const readOnlyExt = useMemo(() => (readOnly ? EditorState.readOnly.of(true) : []), [readOnly]);

    const cursorExt = useMemo(() => {
      if (!cursorConfig) return [];
      return createCursorExtensions({
        projectId: cursorConfig.projectId,
        projectRoot: cursorConfig.projectRoot,
        language,
        filePath: cursorConfig.filePath,
        tabAutocompleteEnabled: cursorConfig.tabAutocompleteEnabled,
        onCmdKAccept: cursorConfig.onCmdKAccept,
        onCmdKClose: cursorConfig.onCmdKClose,
        onNavigate: cursorConfig.onNavigate,
      });
    }, [cursorConfig, language]);

    useEffect(() => {
      setMounted(true);
      return () => setMounted(false);
    }, []);

    useEffect(() => {
      if (!mounted || !editorRef.current) return;

      const initialState = EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageCompartment.current.of(languageExt),
          themeCompartment.current.of(themeExt),
          readOnlyCompartment.current.of(readOnlyExt),
          cursorCompartment.current.of(cursorExt),
          wordWrap ? EditorView.lineWrapping : [],
          StateEditorState.tabSize.of(tabSize),
          EditorView.theme({
            "&": {
              fontSize: `${fontSize}px`,
              fontFamily,
              lineHeight: String(lineHeight),
              minHeight: `${minHeight}px`,
              maxHeight: maxHeight ? `${maxHeight}px` : "none",
              height: "auto",
            },
            "&.cm-focused": { outline: "none" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-lineNumbers": {
              minWidth: "3.5rem",
              paddingRight: "1rem",
              borderRight: "1px solid var(--border-primary)",
            },
            ".cm-activeLine": { backgroundColor: "rgba(99, 102, 241, 0.08)" },
            ".cm-selectionMatch": { backgroundColor: "rgba(99, 102, 241, 0.1)" },
            ".cm-searchMatch": { backgroundColor: "rgba(245, 158, 11, 0.3)" },
            ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(245, 158, 11, 0.5)" },
            ".cm-matchingBracket": { textDecoration: "underline", textUnderlinePosition: "under" },
            ".cm-nonmatchingBracket": { color: "var(--color-error-500)" },
            ".cm-tooltip": { background: "var(--glass-bg-strong)", border: "1px solid var(--glass-border-strong)" },
            ".cm-completionList": { background: "var(--glass-bg-strong)", border: "1px solid var(--glass-border-strong)" },
            ".cm-completionItem-selected": { background: "var(--color-brand-500)", color: "white" },
            ".cm-panel.cm-search": { background: "var(--glass-bg)", borderTop: "1px solid var(--glass-border)" },
          }),
          ...extensions,
        ],
      });

      const view = new EditorView({
        state: initialState,
        parent: editorRef.current,
        dispatch: (tr) => {
          viewRef.current?.dispatch(tr);
          if (tr.docChanged) {
            onChange(viewRef.current!.state.doc.toString());
          }
        },
      });

      viewRef.current = view;

      if (autoFocus) {
        view.focus();
      }

      onMount?.(view);

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, [mounted, value, languageExt, themeExt, readOnlyExt, wordWrap, tabSize, fontSize, fontFamily, lineHeight, minHeight, maxHeight, extensions, autoFocus, onChange, onMount, cursorExt]);

    // Sync external value changes
    useEffect(() => {
      if (viewRef.current && viewRef.current.state.doc.toString() !== value) {
        viewRef.current.dispatch({
          changes: { from: 0, to: viewRef.current.state.doc.length, insert: value },
        });
      }
    }, [value]);

    // Update language
    useEffect(() => {
      if (viewRef.current) {
        viewRef.current.dispatch({
          effects: languageCompartment.current.reconfigure(languageExt),
        });
      }
    }, [languageExt]);

    // Update theme
    useEffect(() => {
      if (viewRef.current) {
        viewRef.current.dispatch({
          effects: themeCompartment.current.reconfigure(themeExt),
        });
      }
    }, [themeExt]);

    // Update readOnly
    useEffect(() => {
      if (viewRef.current) {
        viewRef.current.dispatch({
          effects: readOnlyCompartment.current.reconfigure(readOnlyExt),
        });
      }
    }, [readOnlyExt]);

    // Update cursor config
    useEffect(() => {
      if (viewRef.current && cursorConfig) {
        const newCursorExt = createCursorExtensions({
          projectId: cursorConfig.projectId,
          projectRoot: cursorConfig.projectRoot,
          language,
          filePath: cursorConfig.filePath,
          tabAutocompleteEnabled: cursorConfig.tabAutocompleteEnabled,
          onCmdKAccept: cursorConfig.onCmdKAccept,
          onCmdKClose: cursorConfig.onCmdKClose,
          onNavigate: cursorConfig.onNavigate,
        });
        viewRef.current.dispatch({
          effects: cursorCompartment.current.reconfigure(newCursorExt),
        });
      }
    }, [cursorConfig, language]);

    const classNames = ["code-editor", `code-editor--${language}`, readOnly && "code-editor--readonly", className]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        ref={(el) => {
          editorRef.current = el;
          if (ref) {
            if (typeof ref === "function") ref(el);
            else ref.current = el;
          }
        }}
        className={classNames}
        style={style}
        data-language={language}
      />
    );
  }
);

CodeEditor.displayName = "CodeEditor";

/** Diff Editor — side-by-side diff view */
export interface DiffEditorProps {
  original: string;
  modified: string;
  language?: Language;
  theme?: "light" | "dark" | "auto";
  readOnly?: boolean;
  showLineNumbers?: boolean;
  minHeight?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const DiffEditor: React.FC<DiffEditorProps> = ({
  original,
  modified,
  language = "plaintext",
  theme = "auto",
  readOnly = true,
  showLineNumbers = true,
  minHeight = 300,
  className = "",
  style,
}) => {
  // This would use @codemirror/merge or a custom diff implementation
  // For now, render two editors side by side
  return (
    <div className={`diff-editor ${className}`} style={{ ...style, minHeight }}>
      <div className="diff-editor__pane diff-editor__pane--original">
        <div className="diff-editor__header">Original</div>
        <CodeEditor
          value={original}
          onChange={() => {}}
          language={language}
          theme={theme}
          readOnly={readOnly}
          showLineNumbers={showLineNumbers}
          minHeight={minHeight}
        />
      </div>
      <div className="diff-editor__pane diff-editor__pane--modified">
        <div className="diff-editor__header">Modified</div>
        <CodeEditor
          value={modified}
          onChange={() => {}}
          language={language}
          theme={theme}
          readOnly={readOnly}
          showLineNumbers={showLineNumbers}
          minHeight={minHeight}
        />
      </div>
    </div>
  );
};

/** Inline Editor — for quick edits */
export interface InlineEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: (value: string) => void;
  onCancel: () => void;
  language?: Language;
  placeholder?: string;
  autoFocus?: boolean;
}

export const InlineEditor: React.FC<InlineEditorProps> = ({
  value,
  onChange,
  onSave,
  onCancel,
  language = "plaintext",
  placeholder,
  autoFocus = true,
}) => {
  const [editValue, setEditValue] = useState(value);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSave(editValue);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="inline-editor" ref={editorRef}>
      <CodeEditor
        value={editValue}
        onChange={setEditValue}
        language={language}
        placeholder={placeholder}
        autoFocus={autoFocus}
        minHeight={60}
        maxHeight={300}
        showLineNumbers={false}
      />
      <div className="inline-editor__actions">
        <kbd className="inline-editor__hint">⌘+Enter to save</kbd>
        <kbd className="inline-editor__hint">Esc to cancel</kbd>
      </div>
    </div>
  );
};