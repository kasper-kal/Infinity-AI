/**
 * Cursor Cmd+K Inline Edit — Quick targeted edits at cursor
 *
 * Features:
 * - Floating command palette at cursor
 * - Natural language instruction
 * - Selected code context
 * - Streaming diff preview
 * - Accept/Reject with keyboard
 * - Multi-cursor support
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Check, Loader2, Zap, Code, Copy, ChevronLeft, ChevronRight, RotateCcw, Settings, Minimize, Maximize } from "lucide-react";
import { Button, Input, Textarea, Flex, Box, Text, Badge, Tooltip, IconButton, Separator, ScrollArea, Switch, Label } from "@radix-ui/themes";

interface CmdKEditProps {
  projectId: string;
  projectRoot: string;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  language: string;
  filePath: string;
  isOpen: boolean;
  onClose: () => void;
  onAccept: (newCode: string) => void;
}

interface EditResult {
  replacement: string;
  original: string;
}

export function CmdKEdit({
  projectId,
  projectRoot,
  editorRef,
  language,
  filePath,
  isOpen,
  onClose,
  onAccept,
}: CmdKEditProps) {
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<EditResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const [diffView, setDiffView] = useState<"side-by-side" | "unified">("side-by-side");
  const [history, setHistory] = useState<EditResult[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSelectionRef = useRef<{ start: number; end: number; text: string } | null>(null);

  // Get selected code from editor
  const getSelectedCode = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return "";

    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    if (start === end) {
      // No selection - get current line
      const value = editor.value;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = value.indexOf("\n", start);
      const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      return line;
    }

    return editor.value.slice(start, end);
  }, [editorRef]);

  // Get cursor position for positioning
  const getCursorPosition = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !containerRef.current) return { top: 0, left: 0 };

    const container = containerRef.current;
    const selectionStart = editor.selectionStart;

    // Create mirror to measure
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
    mirror.textContent = editor.value.slice(0, selectionStart);
    document.body.appendChild(mirror);

    const rect = mirror.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    document.body.removeChild(mirror);

    return {
      top: rect.bottom - containerRect.top + 8,
      left: Math.min(rect.right - containerRect.left, container.clientWidth - 400),
    };
  }, [editorRef]);

  // Request edit from API
  const handleGenerate = useCallback(async () => {
    const selectedCode = getSelectedCode();
    if (!instruction.trim() || isGenerating) return;

    setIsGenerating(true);
    setResult(null);

    try {
      const response = await fetch("/api/infinity/cursor/cmd-k", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          instruction,
          filePath,
          selectedCode,
          language,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Edit failed");

      const editResult: EditResult = {
        replacement: data.replacement,
        original: selectedCode,
      };

      setResult(editResult);
      setHistory(prev => [...prev.slice(0, historyIndex + 1), editResult]);
      setHistoryIndex(prev => prev + 1);
    } catch (error) {
      console.error("Cmd+K error:", error);
      // Show error in result
      setResult({ replacement: `Error: ${error}`, original: selectedCode });
    } finally {
      setIsGenerating(false);
    }
  }, [instruction, projectId, projectRoot, filePath, language, isGenerating, getSelectedCode, historyIndex]);

  // Accept the edit
  const handleAccept = useCallback(() => {
    if (!result) return;
    onAccept(result.replacement);
    onClose();
  }, [result, onAccept, onClose]);

  // Reject and try again
  const handleReject = useCallback(() => {
    setResult(null);
    setInstruction("");
    inputRef.current?.focus();
  }, []);

  // Navigate history
  const handleHistoryNav = useCallback((direction: "prev" | "next") => {
    if (history.length === 0) return;
    const newIndex = direction === "prev"
      ? Math.max(0, historyIndex - 1)
      : Math.min(history.length - 1, historyIndex + 1);
    setHistoryIndex(newIndex);
    setResult(history[newIndex]);
  }, [history, historyIndex]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        if (result) {
          handleReject();
        } else {
          onClose();
        }
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isGenerating) {
        e.preventDefault();
        handleGenerate();
      } else if (e.key === "Enter" && result && !isGenerating) {
        e.preventDefault();
        handleAccept();
      } else if (e.key === "ArrowUp" && result && historyIndex > 0) {
        e.preventDefault();
        handleHistoryNav("prev");
      } else if (e.key === "ArrowDown" && result && historyIndex < history.length - 1) {
        e.preventDefault();
        handleHistoryNav("next");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, result, isGenerating, history, historyIndex, onClose, handleGenerate, handleAccept, handleReject, handleHistoryNav]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      // Store current selection
      const editor = editorRef.current;
      if (editor) {
        lastSelectionRef.current = {
          start: editor.selectionStart,
          end: editor.selectionEnd,
          text: editor.value.slice(editor.selectionStart, editor.selectionEnd),
        };
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, editorRef]);

  // Position the floating panel
  const position = useMemo(() => getCursorPosition(), [getCursorPosition]);

  if (!isOpen) return null;

  const selectedCode = getSelectedCode();

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: `${position.top}px`,
        left: `${Math.max(0, position.left)}px`,
        zIndex: 1000,
        pointerEvents: "auto",
      }}
    >
      <Box
        style={{
          width: "420px",
          maxWidth: "calc(100vw - 20px)",
          background: "var(--gray-1)",
          border: "1px solid var(--gray-5)",
          borderRadius: "12px",
          boxShadow: "var(--shadow-xl)",
          overflow: "hidden",
          animation: "popIn 0.15s ease-out",
        }}
      >
        <style jsx>{`
          @keyframes popIn {
            from { opacity: 0; transform: scale(0.95) translateY(-8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

        {/* Header */}
        <Flex
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--gray-5)",
            background: "var(--gray-2)",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Flex align="center" gap="8">
            <Badge color="violet" variant="solid" size="2" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Zap size={12} />
              <Text weight="bold" size="1">Cmd+K</Text>
            </Badge>
            <Text size="1" color="var(--gray-10)">{filePath}</Text>
          </Flex>
          <Flex align="center" gap="4">
            <Tooltip content="Settings">
              <IconButton size="1" variant="ghost" aria-label="Settings"><Settings size={14} /></IconButton>
            </Tooltip>
            <Tooltip content="Minimize">
              <IconButton size="1" variant="ghost" aria-label="Minimize"><Minimize size={14} /></IconButton>
            </Tooltip>
            <Tooltip content="Close (Esc)">
              <IconButton size="1" variant="ghost" onClick={onClose} aria-label="Close"><X size={14} /></IconButton>
            </Tooltip>
          </Flex>
        </Flex>

        {/* Instruction Input */}
        <Box style={{ padding: "12px", borderBottom: "1px solid var(--gray-5)" }}>
          <Flex direction="column" gap="8">
            <Flex align="center" justify="space-between" gap="8">
              <Input
                ref={inputRef}
                type="text"
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder="Describe the change... (e.g., 'Add error handling', 'Convert to async/await')"
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button
                onClick={handleGenerate}
                disabled={!instruction.trim() || isGenerating}
                size="2"
              >
                {isGenerating ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
              </Button>
            </Flex>

            <Flex align="center" gap="12" style={{ fontSize: "11px", color: "var(--gray-10)" }}>
              <Label><Switch checked={showDiff} onChange={setShowDiff} /> Show diff</Label>
              <Label><Switch checked={diffView === "side-by-side"} onChange={v => setDiffView(v ? "side-by-side" : "unified")} /> Side-by-side</Label>
              {history.length > 1 && (
                <Flex align="center" gap="4">
                  <IconButton size="1" variant="ghost" onClick={() => handleHistoryNav("prev")} disabled={historyIndex === 0} aria-label="Previous"><ChevronLeft size={12} /></IconButton>
                  <Text>{historyIndex + 1}/{history.length}</Text>
                  <IconButton size="1" variant="ghost" onClick={() => handleHistoryNav("next")} disabled={historyIndex === history.length - 1} aria-label="Next"><ChevronRight size={12} /></IconButton>
                </Flex>
              )}
            </Flex>
          </Flex>
        </Box>

        {/* Selected Code Context */}
        {selectedCode && (
          <Box style={{ padding: "8px 12px", borderBottom: "1px solid var(--gray-5)", background: "var(--gray-2)", maxHeight: "150px", overflow: "auto" }}>
            <Flex align="center" justify="space-between" style={{ marginBottom: "6px" }}>
              <Text size="1" weight="medium" color="var(--gray-11)">Selected Code</Text>
              <Badge color="gray" variant="soft" size="1">{selectedCode.split("\n").length} lines</Badge>
            </Flex>
            <pre style={{ margin: 0, padding: "8px", background: "var(--gray-3)", borderRadius: "6px", maxHeight: "100px", overflow: "auto" }}>
              <code style={{ fontFamily: "monospace", fontSize: "11px", lineHeight: "1.5", color: "var(--gray-12)", whiteSpace: "pre-wrap" }}>
                {selectedCode}
              </code>
            </pre>
          </Box>
        )}

        {/* Result / Diff Preview */}
        {result && (
          <Box style={{ padding: "12px", maxHeight: "400px", overflow: "auto" }}>
            {showDiff && result.replacement !== result.original ? (
              <DiffPreview
                original={result.original}
                replacement={result.replacement}
                language={language}
                view={diffView}
              />
            ) : (
              <Box>
                <Flex align="center" justify="space-between" style={{ marginBottom: "8px" }}>
                  <Text size="1" weight="medium" color="var(--gray-11)">Replacement</Text>
                  <Tooltip content="Copy">
                    <IconButton size="1" variant="ghost" onClick={() => navigator.clipboard.writeText(result.replacement)} aria-label="Copy"><Copy size={12} /></IconButton>
                  </Tooltip>
                </Flex>
                <pre style={{ margin: 0, padding: "12px", background: "var(--gray-2)", borderRadius: "8px", maxHeight: "300px", overflow: "auto" }}>
                  <code style={{ fontFamily: "monospace", fontSize: "12px", lineHeight: "1.5", color: "var(--gray-12)", whiteSpace: "pre-wrap" }}>
                    {result.replacement}
                  </code>
                </pre>
              </Box>
            )}

            {/* Accept/Reject Buttons */}
            <Flex style={{ marginTop: "12px", gap: "8px", justifyContent: "flex-end" }}>
              <Button variant="soft" color="red" onClick={handleReject} size="2">
                <X size={14} /> <Text>Reject</Text>
              </Button>
              <Button onClick={handleAccept} size="2" style={{ minWidth: "120px" }}>
                <Check size={14} /> <Text weight="medium">Accept & Apply</Text>
              </Button>
            </Flex>
          </Box>
        )}

        {/* Empty State */}
        {!result && !isGenerating && (
          <Box style={{ padding: "24px", textAlign: "center", color: "var(--gray-10)" }}>
            <Code size={32} style={{ opacity: 0.3, marginBottom: "8px" }} />
            <Text weight="medium" size="2" style={{ marginBottom: "4px", color: "var(--gray-11)" }}>What would you like to change?</Text>
            <Text size="2">Describe your edit in natural language.</Text>
            <Flex justify="center" gap="8" style={{ marginTop: "16px", flexWrap: "wrap" }}>
              <Button variant="outline" size="1" onClick={() => { setInstruction("Add error handling"); handleGenerate(); }}><Shield size={12} /> Error handling</Button>
              <Button variant="outline" size="1" onClick={() => { setInstruction("Convert to async/await"); handleGenerate(); }}><RotateCcw size={12} /> Async/await</Button>
              <Button variant="outline" size="1" onClick={() => { setInstruction("Add TypeScript types"); handleGenerate(); }}><Code size={12} /> Add types</Button>
              <Button variant="outline" size="1" onClick={() => { setInstruction("Optimize performance"); handleGenerate(); }}><Zap size={12} /> Optimize</Button>
            </Flex>
          </Box>
        )}

        {/* Generating State */}
        {isGenerating && !result && (
          <Box style={{ padding: "24px", textAlign: "center" }}>
            <Loader2 size={32} className="spin" style={{ color: "var(--violet-9)", marginBottom: "12px" }} />
            <Text weight="medium" size="2" color="var(--gray-11)">Generating edit...</Text>
            <Text size="2" color="var(--gray-10)">{instruction}</Text>
          </Box>
        )}
      </Box>
    </div>
  );
}

// Diff Preview Component
function DiffPreview({ original, replacement, language, view }: { original: string; replacement: string; language: string; view: "side-by-side" | "unified" }) {
  const originalLines = original.split("\n");
  const newLines = replacement.split("\n");

  if (view === "side-by-side") {
    return (
      <Flex style={{ gap: 0, border: "1px solid var(--gray-5)", borderRadius: "8px", overflow: "hidden" }}>
        <Box style={{ flex: 1, background: "var(--red-1)", borderRight: "1px solid var(--gray-5)", minWidth: 0 }}>
          <Flex align="center" style={{ padding: "6px 10px", background: "var(--red-2)", borderBottom: "1px solid var(--gray-5)" }}>
            <Text size="1" weight="medium" color="var(--red-11)">Original</Text>
            <Badge color="red" variant="soft" size="1" style={{ marginLeft: "auto" }}>{originalLines.length} lines</Badge>
          </Flex>
          <pre style={{ margin: 0, padding: "10px", maxHeight: "300px", overflow: "auto", fontSize: "11px", lineHeight: "1.6" }}>
            <code style={{ color: "var(--red-12)", fontFamily: "monospace" }}>
              {originalLines.map((line, i) => (
                <div key={i} style={{ display: "flex", gap: "6px" }}>
                  <span style={{ color: "var(--gray-9)", userSelect: "none", minWidth: "24px", textAlign: "right", fontSize: "10px" }}>{i + 1}</span>
                  <span>{line || " "}</span>
                </div>
              ))}
            </code>
          </pre>
        </Box>
        <Box style={{ flex: 1, background: "var(--green-1)", minWidth: 0 }}>
          <Flex align="center" style={{ padding: "6px 10px", background: "var(--green-2)", borderBottom: "1px solid var(--gray-5)" }}>
            <Text size="1" weight="medium" color="var(--green-11)">New</Text>
            <Badge color="green" variant="soft" size="1" style={{ marginLeft: "auto" }}>{newLines.length} lines</Badge>
          </Flex>
          <pre style={{ margin: 0, padding: "10px", maxHeight: "300px", overflow: "auto", fontSize: "11px", lineHeight: "1.6" }}>
            <code style={{ color: "var(--green-12)", fontFamily: "monospace" }}>
              {newLines.map((line, i) => (
                <div key={i} style={{ display: "flex", gap: "6px" }}>
                  <span style={{ color: "var(--gray-9)", userSelect: "none", minWidth: "24px", textAlign: "right", fontSize: "10px" }}>{i + 1}</span>
                  <span>{line || " "}</span>
                </div>
              ))}
            </code>
          </pre>
        </Box>
      </Flex>
    );
  }

  // Unified diff
  const diffLines = computeUnifiedDiff(originalLines, newLines);
  return (
    <Box style={{ border: "1px solid var(--gray-5)", borderRadius: "8px", overflow: "hidden" }}>
      <Flex align="center" style={{ padding: "6px 10px", background: "var(--gray-2)", borderBottom: "1px solid var(--gray-5)" }}>
        <Text size="1" weight="medium" color="var(--gray-11)">Unified Diff</Text>
        <Badge color="gray" variant="soft" size="1" style={{ marginLeft: "auto" }}>{diffLines.length} lines</Badge>
      </Flex>
      <pre style={{ margin: 0, padding: "10px", maxHeight: "300px", overflow: "auto", fontSize: "11px", lineHeight: "1.6", background: "var(--gray-1)" }}>
        <code style={{ fontFamily: "monospace" }}>
          {diffLines.map((line, i) => (
            <div key={i} style={{
              display: "flex",
              gap: "6px",
              background: line.startsWith("+") ? "var(--green-1)" : line.startsWith("-") ? "var(--red-1)" : line.startsWith("@@") ? "var(--blue-1)" : "transparent",
              color: line.startsWith("+") ? "var(--green-11)" : line.startsWith("-") ? "var(--red-11)" : line.startsWith("@@") ? "var(--blue-11)" : "var(--gray-12)",
            }}>
              <span style={{ userSelect: "none", minWidth: "24px", textAlign: "right", color: "var(--gray-9)", fontSize: "10px" }}>{i + 1}</span>
              <span>{line || " "}</span>
            </div>
          ))}
        </code>
      </pre>
    </Box>
  );
}

function computeUnifiedDiff(original: string[], updated: string[]): string[] {
  const diffLines: string[] = [];
  diffLines.push(`--- original`);
  diffLines.push(`+++ updated`);

  let i = 0, j = 0;
  while (i < original.length || j < updated.length) {
    if (i < original.length && j < updated.length && original[i] === updated[j]) {
      diffLines.push(` ${original[i]}`);
      i++; j++;
    } else if (j < updated.length && (i >= original.length || original[i] !== updated[j])) {
      diffLines.push(`+${updated[j]}`);
      j++;
    } else if (i < original.length) {
      diffLines.push(`-${original[i]}`);
      i++;
    }
  }
  return diffLines;
}

// Hook for easy integration
export function useCmdKEdit(
  projectId: string,
  projectRoot: string,
  language: string,
  filePath: string
) {
  const [isOpen, setIsOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleAccept = useCallback((newCode: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const newValue = editor.value.slice(0, start) + newCode + editor.value.slice(end);

    editor.value = newValue;
    editor.selectionStart = editor.selectionEnd = start + newCode.length;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  return {
    editorRef,
    isOpen,
    open,
    close,
    handleAccept,
    CmdKEdit: () => (
      <CmdKEdit
        projectId={projectId}
        projectRoot={projectRoot}
        editorRef={editorRef}
        language={language}
        filePath={filePath}
        isOpen={isOpen}
        onClose={close}
        onAccept={handleAccept}
      />
    ),
  };
}

export default CmdKEdit;