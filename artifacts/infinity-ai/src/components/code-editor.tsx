import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { languages } from '@codemirror/language-data';
import { LanguageDescription } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { createCursorExtensions } from '@/components/CodeAI/CodeMirrorIntegration';

interface CursorConfig {
  projectId: string;
  projectRoot: string;
  filePath: string;
  tabAutocompleteEnabled?: boolean;
  onCmdKAccept?: (newCode: string) => void;
  onCmdKClose?: () => void;
}

interface CodeEditorProps {
  value: string;
  path: string | null;
  onChange: (value: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  onSave?: () => void;
  cursorConfig?: CursorConfig;
}

/**
 * Pick a bundled language extension synchronously from the file path.
 * Returns null for unknown extensions so the async language-data fallback can take over.
 */
const syncLanguage = (path: string): (() => Extension) | null => {
  const lower = path.toLowerCase();
  const base = lower.split('/').pop() ?? '';
  if (base.startsWith('.')) return null;
  if (/\.(html?|vue|svelte)$/.test(lower)) return () => html();
  if (/\.tsx?$/.test(lower)) return () => javascript({ typescript: true, jsx: true });
  if (/\.jsx?$/.test(lower)) return () => javascript({ jsx: true });
  if (/\.(css|scss|less)$/.test(lower)) return () => css();
  if (/\.json$/.test(lower)) return () => json();
  if (/\.(md|markdown)$/.test(lower)) return () => markdown();
  if (/\.py$/.test(lower)) return () => python();
  if (/\.go$/.test(lower)) return () => go();
  if (/\.rs$/.test(lower)) return () => rust();
  if (/\.java$/.test(lower)) return () => java();
  if (/\.(c|h|cpp|hpp|cc|cxx)$/.test(lower)) return () => cpp();
  if (/\.php$/.test(lower)) return () => php();
  if (/\.sql$/.test(lower)) return () => sql();
  if (/\.(xml|svg|plist)$/.test(lower)) return () => xml();
  return null;
};

export default function CodeEditor({ value, path, onChange, onCursorChange, onSave }: CodeEditorProps) {
  const [extraLanguage, setExtraLanguage] = useState<Extension | null>(null);

  // Fallback: load any other language (shell, yaml, toml, dockerfile, …) from @codemirror/language-data.
  useEffect(() => {
    setExtraLanguage(null);
    if (!path) return;
    if (syncLanguage(path)) return;
    let cancelled = false;
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    const description =
      LanguageDescription.matchFilename(languages, path) ??
      (extension ? (languages.find((candidate) => candidate.extensions.some((item) => item.toLowerCase() === extension)) ?? null) : null);
    if (!description) return;
    description
      .load()
      .then((support) => {
        if (!cancelled) setExtraLanguage(support);
      })
      .catch(() => {
        /* language not available */
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const extensions = useMemo(() => {
    const list: Extension[] = [];
    const sync = path ? syncLanguage(path) : null;
    if (sync) list.push(sync());
    if (extraLanguage) list.push(extraLanguage);
    list.push(keymap.of([{ key: 'Mod-s', run: () => { onSave?.(); return true; } }]));

    // Add Cursor AI extensions if configured
    if (cursorConfig && path) {
      const language = path.split('.').pop()?.toLowerCase() || 'plaintext';
      list.push(...createCursorExtensions({
        projectId: cursorConfig.projectId,
        projectRoot: cursorConfig.projectRoot,
        language,
        filePath: path,
        tabAutocompleteEnabled: cursorConfig.tabAutocompleteEnabled,
        onCmdKAccept: cursorConfig.onCmdKAccept,
        onCmdKClose: cursorConfig.onCmdKClose,
      }));
    }

    return list;
  }, [extraLanguage, onSave, path, cursorConfig]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onUpdate={(update) => {
        if (!onCursorChange) return;
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        onCursorChange(line.number, head - line.from + 1);
      }}
      theme={vscodeDark}
      extensions={extensions}
      height="100%"
      style={{ height: '100%' }}
      className="h-full w-full overflow-hidden text-xs"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        autocompletion: true,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        highlightSelectionMatches: true,
      }}
    />
  );
}
