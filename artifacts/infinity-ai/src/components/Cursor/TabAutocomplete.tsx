/**
 * Cursor Tab Autocomplete — Multi-line, context-aware code completion
 *
 * Features:
 * - Ghost text inline suggestions
 * - Multi-line completions
 * - Context-aware (uses codebase index)
 * - Accept with Tab, reject with Esc
 * - Language-aware
 * - Debounced requests
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";

interface TabAutocompleteProps {
  projectId: string;
  projectRoot: string;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  language: string;
  filePath: string;
  enabled?: boolean;
}

interface CompletionSuggestion {
  text: string;
  prefixLength: number;
  suffixLength: number;
}

export function TabAutocomplete({
  projectId,
  projectRoot,
  editorRef,
  language,
  filePath,
  enabled = true,
}: TabAutocompleteProps) {
  const [suggestion, setSuggestion] = useState<CompletionSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastRequestRef = useRef<string>("");
  const ghostRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Get editor state
  const getEditorState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return { prefix: "", suffix: "", cursorPosition: 0 };

    const value = editor.value;
    const cursorPosition = editor.selectionStart;
    const prefix = value.slice(0, cursorPosition);
    const suffix = value.slice(cursorPosition);

    return { prefix, suffix, cursorPosition };
  }, [editorRef]);

  // Calculate ghost text position
  const getGhostPosition = useCallback(() => {
    const editor = editorRef.current;
    const container = editorContainerRef.current;
    if (!editor || !container) return { top: 0, left: 0, width: 0 };

    const { prefix, cursorPosition } = getEditorState();

    // Create a hidden mirror to measure text position
    const mirror = document.createElement("div");
    mirror.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      font: inherit;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      letter-spacing: inherit;
      padding: inherit;
      border: inherit;
      width: ${editor.clientWidth}px;
    `;
    mirror.textContent = editor.value.slice(0, cursorPosition);
    document.body.appendChild(mirror);

    const rect = mirror.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    document.body.removeChild(mirror);

    return {
      top: rect.bottom - containerRect.top,
      left: rect.right - containerRect.left,
      width: editor.clientWidth - (rect.right - containerRect.left),
    };
  }, [editorRef, getEditorState]);

  // Request completion
  const requestCompletion = useCallback(async () => {
    if (!enabled) return;

    const { prefix, suffix } = getEditorState();

    // Don't request if nothing changed
    const requestKey = `${prefix.slice(-200)}|${suffix.slice(0, 100)}|${language}|${filePath}`;
    if (requestKey === lastRequestRef.current) return;
    lastRequestRef.current = requestKey;

    // Minimum trigger: at least some context
    if (prefix.trim().length < 3 && suffix.trim().length < 3) {
      setSuggestion(null);
      setShowGhost(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/infinity/cursor/tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          prefix: prefix.slice(-1000),
          suffix: suffix.slice(0, 1000),
          filePath,
          language,
          maxTokens: 200,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Completion failed");

      if (data.completion && data.completion.trim().length > 0) {
        setSuggestion({
          text: data.completion,
          prefixLength: 0,
          suffixLength: 0,
        });
        setShowGhost(true);
      } else {
        setSuggestion(null);
        setShowGhost(false);
      }
    } catch (error) {
      console.error("Tab autocomplete error:", error);
      setSuggestion(null);
      setShowGhost(false);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, projectId, projectRoot, language, filePath, getEditorState]);

  // Debounced request on editor change
  const handleEditorChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(requestCompletion, 150);
  }, [requestCompletion]);

  // Handle Tab key to accept suggestion
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && suggestion && showGhost && !e.shiftKey) {
      e.preventDefault();
      acceptSuggestion();
    } else if (e.key === "Escape" && showGhost) {
      rejectSuggestion();
    }
  }, [suggestion, showGhost]);

  // Accept the current suggestion
  const acceptSuggestion = useCallback(() => {
    if (!suggestion || !editorRef.current) return;

    const editor = editorRef.current;
    const cursorPosition = editor.selectionStart;
    const newValue = editor.value.slice(0, cursorPosition) + suggestion.text + editor.value.slice(cursorPosition);

    // Set value and restore cursor position
    editor.value = newValue;
    editor.selectionStart = editor.selectionEnd = cursorPosition + suggestion.text.length;

    // Trigger input event for any listeners
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    // Clear suggestion
    setSuggestion(null);
    setShowGhost(false);
    lastRequestRef.current = "";
  }, [suggestion, editorRef]);

  // Reject the current suggestion
  const rejectSuggestion = useCallback(() => {
    setSuggestion(null);
    setShowGhost(false);
    lastRequestRef.current = "";
  }, []);

  // Set up editor event listeners
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.addEventListener("input", handleEditorChange);
    editor.addEventListener("keyup", handleEditorChange);
    editor.addEventListener("keydown", handleKeyDown);
    editor.addEventListener("click", handleEditorChange);
    editor.addEventListener("focus", handleEditorChange);

    return () => {
      editor.removeEventListener("input", handleEditorChange);
      editor.removeEventListener("keyup", handleEditorChange);
      editor.removeEventListener("keydown", handleKeyDown);
      editor.removeEventListener("click", handleEditorChange);
      editor.removeEventListener("focus", handleEditorChange);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editorRef, handleEditorChange, handleKeyDown]);

  // Initial request on mount
  useEffect(() => {
    if (enabled) {
      requestCompletion();
    }
  }, [enabled, requestCompletion]);

  // Render ghost text overlay
  const ghostText = useMemo(() => {
    if (!suggestion || !showGhost || !editorRef.current) return null;

    const { prefix, cursorPosition } = getEditorState();
    const editor = editorRef.current;
    const container = editorContainerRef.current;

    if (!container) return null;

    // Calculate position
    const mirror = document.createElement("div");
    const computedStyle = window.getComputedStyle(editor);
    mirror.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      font: ${computedStyle.font};
      font-family: ${computedStyle.fontFamily};
      font-size: ${computedStyle.fontSize};
      line-height: ${computedStyle.lineHeight};
      letter-spacing: ${computedStyle.letterSpacing};
      padding: ${computedStyle.padding};
      border: ${computedStyle.border};
      width: ${editor.clientWidth}px;
    `;
    mirror.textContent = prefix;
    document.body.appendChild(mirror);

    const rect = mirror.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    document.body.removeChild(mirror);

    const top = rect.bottom - containerRect.top;
    const left = rect.right - containerRect.left;

    return (
      <div
        ref={ghostRef}
        style={{
          position: "absolute",
          top: `${top}px`,
          left: `${left}px`,
          pointerEvents: "none",
          zIndex: 10,
          color: "var(--gray-9)",
          opacity: 0.6,
          fontFamily: computedStyle.fontFamily,
          fontSize: computedStyle.fontSize,
          lineHeight: computedStyle.lineHeight,
          letterSpacing: computedStyle.letterSpacing,
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
          maxWidth: `${editor.clientWidth - left - 20}px`,
          maxHeight: "200px",
          overflow: "hidden",
          textShadow: "0 0 2px var(--gray-1)",
        }}
      >
        {suggestion.text}
      </div>
    );
  }, [suggestion, showGhost, editorRef, getEditorState]);

  if (!enabled) return null;

  return (
    <>
      {ghostText}
      {/* Status indicator */}
      {isLoading && (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 8px",
            background: "var(--gray-2)",
            borderRadius: "4px",
            fontSize: "11px",
            color: "var(--gray-10)",
            zIndex: 5,
          }}
        >
          <div className="spin" style={{ width: "12px", height: "12px", border: "2px solid var(--violet-7)", borderTopColor: "transparent", borderRadius: "50%" }} />
          <span>Completing...</span>
        </div>
      )}
      {suggestion && showGhost && !isLoading && (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 8px",
            background: "var(--green-2)",
            borderRadius: "4px",
            fontSize: "11px",
            color: "var(--green-11)",
            zIndex: 5,
          }}
        >
          <span>✓ Tab to accept</span>
          <kbd style={{ padding: "1px 4px", background: "var(--green-3)", borderRadius: "3px", fontSize: "10px" }}>Tab</kbd>
          <kbd style={{ padding: "1px 4px", background: "var(--green-3)", borderRadius: "3px", fontSize: "10px" }}>Esc</kbd>
        </div>
      )}
    </>
  );
}

// Higher-order component to wrap an editor with autocomplete
export function withTabAutocomplete<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  autocompleteProps: Omit<TabAutocompleteProps, "editorRef">
) {
  return function WithAutocomplete(props: P) {
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    return (
      <div ref={containerRef} style={{ position: "relative", display: "inline-block", width: "100%" }}>
        <WrappedComponent {...props} ref={editorRef as any} />
        <TabAutocomplete
          editorRef={editorRef}
          {...autocompleteProps}
        />
      </div>
    );
  };
}

// Hook for use in custom editors
export function useTabAutocomplete(
  projectId: string,
  projectRoot: string,
  language: string,
  filePath: string,
  enabled: boolean = true
) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [suggestion, setSuggestion] = useState<CompletionSuggestion | null>(null);
  const [showGhost, setShowGhost] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const requestCompletion = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !enabled) return;

    const value = editor.value;
    const cursorPosition = editor.selectionStart;
    const prefix = value.slice(0, cursorPosition);
    const suffix = value.slice(cursorPosition);

    setIsLoading(true);
    try {
      const response = await fetch("/api/infinity/cursor/tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          prefix: prefix.slice(-1000),
          suffix: suffix.slice(0, 1000),
          filePath,
          language,
          maxTokens: 200,
        }),
      });

      const data = await response.json();
      if (data.completion) {
        setSuggestion({ text: data.completion, prefixLength: 0, suffixLength: 0 });
        setShowGhost(true);
      }
    } catch (error) {
      console.error("Tab autocomplete error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, projectRoot, language, filePath, enabled]);

  const accept = useCallback(() => {
    if (!suggestion || !editorRef.current) return;
    const editor = editorRef.current;
    const pos = editor.selectionStart;
    editor.value = editor.value.slice(0, pos) + suggestion.text + editor.value.slice(pos);
    editor.selectionStart = editor.selectionEnd = pos + suggestion.text.length;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    setSuggestion(null);
    setShowGhost(false);
  }, [suggestion]);

  const reject = useCallback(() => {
    setSuggestion(null);
    setShowGhost(false);
  }, []);

  return { editorRef, suggestion, showGhost, isLoading, requestCompletion, accept, reject };
}

export default TabAutocomplete;