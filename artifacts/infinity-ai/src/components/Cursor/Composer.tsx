/**
 * Cursor Composer — Multi-file edit preview & apply
 *
 * Features:
 * - Natural language → multi-file plan generation
 * - Side-by-side diff preview
 * - Selective file apply (checkbox per file)
 * - Bulk apply all
 * - Iterative refinement
 * - Risk level warnings
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Button, Input, Textarea, Flex, Box, Text, Badge, Checkbox, Separator, ScrollArea, Tabs, TabList, TabTrigger, TabContent, Alert, IconButton, Tooltip, Switch, RadioGroup, Radio, Card, Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@radix-ui/themes";
import { Send, Loader2, Check, X, FileText, Code, Diff, ChevronLeft, ChevronRight, Plus, Minus, Eye, EyeOff, Copy, Download, Upload, Zap, AlertTriangle, Shield, RefreshCw, RotateCcw, Trash2, Save, Search, Sparkles, GitBranch } from "lucide-react";

interface FileChange {
  path: string;
  originalContent: string;
  newContent: string;
  changeType: "create" | "edit" | "delete";
  language: string;
  diff: string;
  description: string;
  dependencies: string[];
  confidence: number;
}

interface ComposerPlan {
  id: string;
  instruction: string;
  mode: "edit" | "create" | "refactor" | "fix" | "test" | "document";
  changes: FileChange[];
  estimatedTokens: number;
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
  requiredApprovals: string[];
}

interface DiffPreview {
  filePath: string;
  originalContent: string;
  newContent: string;
  diff: string;
  changeType: "create" | "edit" | "delete";
}

interface ComposerProps {
  projectId: string;
  projectRoot: string;
  isOpen: boolean;
  onClose: () => void;
  initialInstruction?: string;
}

export function Composer({ projectId, projectRoot, isOpen, onClose, initialInstruction }: ComposerProps) {
  const [instruction, setInstruction] = useState(initialInstruction || "");
  const [plan, setPlan] = useState<ComposerPlan | null>(null);
  const [previews, setPreviews] = useState<DiffPreview[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ success: boolean; message: string; applied: number; failed: number } | null>(null);
  const [showDiff, setShowDiff] = useState(true);
  const [viewMode, setViewMode] = useState<"side-by-side" | "unified">("side-by-side");
  const [refinement, setRefinement] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [mode, setMode] = useState<ComposerPlan["mode"]>("edit");
  const [includeTests, setIncludeTests] = useState(true);
  const [includeTypes, setIncludeTypes] = useState(true);
  const fileRefs = useRef<Map<string, { original: HTMLPreElement | null; new: HTMLPreElement | null }>>(new Map());

  const modes = [
    { value: "edit", label: "Edit", desc: "Modify existing files", icon: <Code size={14} /> },
    { value: "create", label: "Create", desc: "Create new files", icon: <Plus size={14} /> },
    { value: "refactor", label: "Refactor", desc: "Restructure without behavior change", icon: <RotateCcw size={14} /> },
    { value: "fix", label: "Fix", desc: "Fix bugs with minimal changes", icon: <Shield size={14} /> },
    { value: "test", label: "Test", desc: "Add tests for existing code", icon: <Check size={14} /> },
    { value: "document", label: "Document", desc: "Add docs & comments", icon: <FileText size={14} /> },
  ];

  const riskColors = { low: "green", medium: "amber", high: "red" } as const;

  const handleGenerate = useCallback(async () => {
    if (!instruction.trim() || isGenerating) return;

    setIsGenerating(true);
    setPlan(null);
    setPreviews([]);
    setApplyResult(null);
    setSelectedFiles(new Set());

    try {
      const response = await fetch("/api/infinity/cursor/composer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          instruction,
          mode,
          includeTests,
          includeTypes,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to generate plan");

      setPlan(data.plan);
      setPreviews(data.previews || []);
      // Auto-select all files by default
      setSelectedFiles(new Set(data.plan.changes.map((c: FileChange) => c.path)));
    } catch (error) {
      console.error("Composer generate error:", error);
      setApplyResult({ success: false, message: String(error), applied: 0, failed: 0 });
    } finally {
      setIsGenerating(false);
    }
  }, [instruction, projectId, projectRoot, mode, includeTests, includeTypes]);

  const handleApply = useCallback(async () => {
    if (!plan || selectedFiles.size === 0 || isApplying) return;

    setIsApplying(true);
    setApplyResult(null);

    try {
      const response = await fetch("/api/infinity/cursor/composer/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          plan,
          filePaths: Array.from(selectedFiles),
          dryRun: false,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to apply plan");

      setApplyResult({
        success: true,
        message: data.result.summary,
        applied: data.result.appliedChanges.length,
        failed: data.result.failedChanges.length,
      });

      // Clear selection after successful apply
      if (data.result.failedChanges.length === 0) {
        setSelectedFiles(new Set());
      }
    } catch (error) {
      console.error("Composer apply error:", error);
      setApplyResult({ success: false, message: String(error), applied: 0, failed: 1 });
    } finally {
      setIsApplying(false);
    }
  }, [plan, projectId, projectRoot, selectedFiles, isApplying]);

  const handleRefine = useCallback(async () => {
    if (!plan || !refinement.trim() || isRefining) return;

    setIsRefining(true);

    try {
      const response = await fetch("/api/infinity/cursor/composer/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          planId: plan.id,
          refinement,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to refine plan");

      setPlan(data.plan);
      setPreviews(data.previews || []);
      setSelectedFiles(new Set(data.plan.changes.map((c: FileChange) => c.path)));
      setRefinement("");
    } catch (error) {
      console.error("Composer refine error:", error);
      setApplyResult({ success: false, message: String(error), applied: 0, failed: 0 });
    } finally {
      setIsRefining(false);
    }
  }, [plan, projectId, projectRoot, refinement, isRefining]);

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAllFiles = () => {
    if (!plan) return;
    if (selectedFiles.size === plan.changes.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(plan.changes.map(c => c.path)));
    }
  };

  const getLanguageColor = (lang: string) => {
    const colors: Record<string, string> = {
      typescript: "var(--blue-9)",
      javascript: "var(--yellow-9)",
      python: "var(--blue-9)",
      rust: "var(--orange-9)",
      go: "var(--cyan-9)",
      java: "var(--red-9)",
      cpp: "var(--violet-9)",
      cs: "var(--purple-9)",
    };
    return colors[lang.toLowerCase()] || "var(--gray-9)";
  };

  if (!isOpen) return null;

  return (
    <Box
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: "600px",
        maxWidth: "100vw",
        background: "var(--gray-1)",
        borderLeft: "1px solid var(--gray-5)",
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
        boxShadow: "var(--shadow-xl)",
      }}
    >
      {/* Header */}
      <Flex
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--gray-5)",
          background: "var(--gray-2)",
        }}
        align="center"
        justify="space-between"
      >
        <Flex align="center" gap="2">
          <Badge color="violet" variant="solid" size="2" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Sparkles size={16} />
            <Text weight="bold">Composer</Text>
          </Badge>
          <Text size="1" color="var(--gray-10)">Multi-file edits</Text>
        </Flex>
        <Flex align="center" gap="1">
          <Tooltip content="New plan">
            <IconButton onClick={() => { setPlan(null); setInstruction(""); setPreviews([]); setApplyResult(null); }} aria-label="New plan" size="2">
              <Plus size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip content="Close">
            <IconButton onClick={onClose} aria-label="Close" size="2">
              <X size={16} />
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>

      {/* Input Section */}
      {!plan && (
        <Box style={{ padding: "16px", borderBottom: "1px solid var(--gray-5)" }}>
          <Flex direction="column" gap="12">
            <Textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder="Describe what you want to build or change... (e.g., 'Add authentication middleware with JWT tokens and refresh token rotation')"
              style={{ minHeight: "100px", resize: "vertical" }}
            />

            <Flex align="center" justify="space-between" wrap gap="12">
              <Flex align="center" gap="12" wrap>
                {modes.map(m => (
                  <label key={m.value} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", padding: "6px 10px", borderRadius: "6px", border: `1px solid ${mode === m.value ? "var(--violet-7)" : "var(--gray-5)"}`, background: mode === m.value ? "var(--violet-2)" : "transparent" }}>
                    <Radio value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} />
                    <Flex align="center" gap="6">
                      <Box style={{ color: "var(--violet-9)" }}>{m.icon}</Box>
                      <Flex direction="column">
                        <Text size="1" weight="medium">{m.label}</Text>
                        <Text size="1" color="var(--gray-10)">{m.desc}</Text>
                      </Flex>
                    </Flex>
                  </label>
                ))}
              </Flex>

              <Flex align="center" gap="16">
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <Checkbox checked={includeTests} onChange={e => setIncludeTests(e.target.checked)} />
                  <Text size="1">Include tests</Text>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <Checkbox checked={includeTypes} onChange={e => setIncludeTypes(e.target.checked)} />
                  <Text size="1">Include types</Text>
                </label>
              </Flex>
            </Flex>

            <Button
              onClick={handleGenerate}
              disabled={!instruction.trim() || isGenerating}
              size="3"
              style={{ width: "100%" }}
            >
              {isGenerating ? (
                <Flex align="center" justify="center" gap="8">
                  <Loader2 size={18} className="spin" />
                  <Text>Generating plan...</Text>
                </Flex>
              ) : (
                <Flex align="center" justify="center" gap="8">
                  <Sparkles size={18} />
                  <Text>Generate Plan</Text>
                </Flex>
              )}
            </Button>
          </Flex>
        </Box>
      )}

      {/* Plan Preview Section */}
      {plan && (
        <Flex direction="column" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Plan Summary Bar */}
          <Flex
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--gray-5)",
              background: "var(--gray-2)",
              gap: "12px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <Flex align="center" gap="8" style={{ flex: 1, minWidth: 0 }}>
              <Text weight="bold" size="2" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {plan.instruction}
              </Text>
              <Badge color={riskColors[plan.riskLevel]} variant="solid" size="2">
                {plan.riskLevel.toUpperCase()} RISK
              </Badge>
              <Badge color="violet" variant="soft" size="2">
                {plan.changes.length} file{plan.changes.length !== 1 ? "s" : ""}
              </Badge>
              <Badge color="gray" variant="soft" size="2">
                ~{Math.round(plan.estimatedTokens / 1000)}k tokens
              </Badge>
            </Flex>
            <Flex align="center" gap="8">
              <Button variant="soft" size="2" onClick={handleApply} disabled={selectedFiles.size === 0 || isApplying}>
                {isApplying ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                <Text>Apply {selectedFiles.size} file{selectedFiles.size !== 1 ? "s" : ""}</Text>
              </Button>
              <Button variant="outline" size="2" onClick={() => setPlan(null)}>
                <X size={16} /> Discard
              </Button>
            </Flex>
          </Flex>

          {/* Warnings */}
          {plan.warnings.length > 0 && (
            <Alert status="warning" style={{ margin: "12px 16px", padding: "8px 12px" }}>
              <AlertTriangle size={16} />
              <Flex direction="column" gap="4">
                {plan.warnings.map((w, i) => <Text key={i} size="1">{w}</Text>)}
              </Flex>
            </Alert>
          )}

          {/* Required Approvals */}
          {plan.requiredApprovals.length > 0 && (
            <Alert status="info" style={{ margin: "12px 16px", padding: "8px 12px" }}>
              <Shield size={16} />
              <Flex direction="column" gap="2">
                <Text weight="medium" size="1">Requires approval:</Text>
                {plan.requiredApprovals.map((f, i) => (
                  <Text key={i} size="1" style={{ fontFamily: "monospace", color: "var(--gray-10)" }}>{f}</Text>
                ))}
              </Flex>
            </Alert>
          )}

          {/* File List with Diffs */}
          <ScrollArea style={{ flex: 1, overflow: "auto" }}>
            <Flex direction="column" style={{ padding: "16px", gap: "12px" }}>
              {/* Select All Toggle */}
              <Flex align="center" justify="space-between" style={{ padding: "0 4px" }}>
                <Flex align="center" gap="8">
                  <Checkbox
                    checked={selectedFiles.size === plan.changes.length && plan.changes.length > 0}
                    indeterminate={selectedFiles.size > 0 && selectedFiles.size < plan.changes.length}
                    onChange={toggleAllFiles}
                  />
                  <Text size="1" weight="medium">Select all {plan.changes.length} files</Text>
                </Flex>
                <Flex align="center" gap="8">
                  <Tooltip content={showDiff ? "Hide diffs" : "Show diffs"}>
                    <IconButton variant="ghost" size="2" onClick={() => setShowDiff(!showDiff)} aria-label="Toggle diffs">
                      {showDiff ? <EyeOff size={16} /> : <Eye size={16} />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip content={viewMode === "side-by-side" ? "Unified view" : "Side-by-side view"}>
                    <IconButton variant="ghost" size="2" onClick={() => setViewMode(viewMode === "side-by-side" ? "unified" : "side-by-side")} aria-label="Toggle view mode">
                      {viewMode === "side-by-side" ? <GitBranch size={16} /> : <Code size={16} />}
                    </IconButton>
                  </Tooltip>
                </Flex>
              </Flex>

              <Separator />

              {plan.changes.map((change, idx) => (
                <FileChangeCard
                  key={change.path}
                  change={change}
                  index={idx}
                  isSelected={selectedFiles.has(change.path)}
                  onToggle={toggleFile}
                  showDiff={showDiff}
                  viewMode={viewMode}
                  fileRefs={fileRefs}
                />
              ))}

              {plan.changes.length === 0 && (
                <Flex direction="column" align="center" justify="center" style={{ padding: "60px 20px", color: "var(--gray-10)", gap: "12px" }}>
                  <Code size={48} style={{ opacity: 0.3 }} />
                  <Text weight="medium" size="2">No changes in plan</Text>
                  <Text size="2" style={{ textAlign: "center" }}>The AI didn't generate any file changes for this request.</Text>
                </Flex>
              )}
            </Flex>
          </ScrollArea>

          {/* Apply Result */}
          {applyResult && (
            <Box style={{ padding: "12px 16px", borderTop: "1px solid var(--gray-5)", background: "var(--gray-2)" }}>
              <Alert status={applyResult.success ? "success" : "error"} style={{ margin: 0 }}>
                {applyResult.success ? <Check size={16} /> : <X size={16} />}
                <Flex direction="column" gap="2">
                  <Text weight="medium" size="1">{applyResult.message}</Text>
                  <Text size="1" color="var(--gray-10)">
                    Applied: {applyResult.applied} | Failed: {applyResult.failed}
                  </Text>
                </Flex>
              </Alert>
            </Box>
          )}

          {/* Refinement Section */}
          <Box style={{ padding: "16px", borderTop: "1px solid var(--gray-5)", background: "var(--gray-2)" }}>
            <Text weight="medium" size="2" style={{ marginBottom: "8px" }}>Refine Plan</Text>
            <Flex direction="column" gap="8">
              <Textarea
                value={refinement}
                onChange={e => setRefinement(e.target.value)}
                placeholder="Add refinements... (e.g., 'Also update the tests', 'Use TypeScript strict mode', 'Add error handling')"
                style={{ minHeight: "60px", resize: "vertical" }}
              />
              <Button
                onClick={handleRefine}
                disabled={!refinement.trim() || isRefining}
                size="2"
                style={{ width: "100%" }}
              >
                {isRefining ? (
                  <Flex align="center" justify="center" gap="8"><Loader2 size={16} className="spin" /><Text>Refining...</Text></Flex>
                ) : (
                  <Flex align="center" justify="center" gap="8"><RotateCcw size={16} /><Text>Refine Plan</Text></Flex>
                )}
              </Button>
            </Flex>
          </Box>
        </Flex>
      )}
    </Box>
  );
}

// File Change Card Component
function FileChangeCard({
  change,
  index,
  isSelected,
  onToggle,
  showDiff,
  viewMode,
  fileRefs,
}: {
  change: FileChange;
  index: number;
  isSelected: boolean;
  onToggle: (path: string) => void;
  showDiff: boolean;
  viewMode: "side-by-side" | "unified";
  fileRefs: React.MutableRefObject<Map<string, { original: HTMLPreElement | null; new: HTMLPreElement | null }>>;
}) {
  const [expanded, setExpanded] = useState(true);
  const changeTypeColors = { create: "green", edit: "blue", delete: "red" } as const;
  const changeTypeIcons = { create: <Plus size={12} />, edit: <Code size={12} />, delete: <Minus size={12} /> };

  const getDiffLines = (diff: string) => {
    return diff.split("\n").slice(2); // Skip --- and +++
  };

  const renderSideBySide = () => {
    const originalLines = change.originalContent.split("\n");
    const newLines = change.newContent.split("\n");
    const maxLines = Math.max(originalLines.length, newLines.length);

    return (
      <Flex style={{ gap: 0, border: "1px solid var(--gray-5)", borderRadius: "8px", overflow: "hidden" }}>
        {/* Original */}
        <Box style={{ flex: 1, background: "var(--red-1)", borderRight: "1px solid var(--gray-5)", minWidth: 0 }}>
          <Flex align="center" style={{ padding: "8px 12px", background: "var(--red-2)", borderBottom: "1px solid var(--gray-5)" }}>
            <Text size="1" weight="medium" color="var(--red-11)">Original</Text>
            <Badge color="red" variant="soft" size="1" style={{ marginLeft: "auto" }}>{originalLines.length} lines</Badge>
          </Flex>
          <pre ref={el => { const refs = fileRefs.current.get(change.path) || { original: null, new: null }; refs.original = el; fileRefs.current.set(change.path, refs); }} style={{ margin: 0, padding: "12px", maxHeight: "400px", overflow: "auto", fontSize: "12px", lineHeight: "1.6" }}>
            <code style={{ color: "var(--red-12)", fontFamily: "monospace" }}>
              {originalLines.map((line, i) => (
                <div key={i} style={{ display: "flex", gap: "8px" }}>
                  <span style={{ color: "var(--gray-9)", userSelect: "none", minWidth: "30px", textAlign: "right" }}>{i + 1}</span>
                  <span>{line || " "}</span>
                </div>
              ))}
            </code>
          </pre>
        </Box>

        {/* New */}
        <Box style={{ flex: 1, background: "var(--green-1)", minWidth: 0 }}>
          <Flex align="center" style={{ padding: "8px 12px", background: "var(--green-2)", borderBottom: "1px solid var(--gray-5)" }}>
            <Text size="1" weight="medium" color="var(--green-11)">New</Text>
            <Badge color="green" variant="soft" size="1" style={{ marginLeft: "auto" }}>{newLines.length} lines</Badge>
          </Flex>
          <pre ref={el => { const refs = fileRefs.current.get(change.path) || { original: null, new: null }; refs.new = el; fileRefs.current.set(change.path, refs); }} style={{ margin: 0, padding: "12px", maxHeight: "400px", overflow: "auto", fontSize: "12px", lineHeight: "1.6" }}>
            <code style={{ color: "var(--green-12)", fontFamily: "monospace" }}>
              {newLines.map((line, i) => (
                <div key={i} style={{ display: "flex", gap: "8px" }}>
                  <span style={{ color: "var(--gray-9)", userSelect: "none", minWidth: "30px", textAlign: "right" }}>{i + 1}</span>
                  <span>{line || " "}</span>
                </div>
              ))}
            </code>
          </pre>
        </Box>
      </Flex>
    );
  };

  const renderUnified = () => {
    const diffLines = getDiffLines(change.diff);
    return (
      <Box style={{ border: "1px solid var(--gray-5)", borderRadius: "8px", overflow: "hidden" }}>
        <Flex align="center" style={{ padding: "8px 12px", background: "var(--gray-2)", borderBottom: "1px solid var(--gray-5)" }}>
          <Text size="1" weight="medium" color="var(--gray-11)">Unified Diff</Text>
          <Badge color="gray" variant="soft" size="1" style={{ marginLeft: "auto" }}>{diffLines.length} lines</Badge>
        </Flex>
        <pre style={{ margin: 0, padding: "12px", maxHeight: "400px", overflow: "auto", fontSize: "12px", lineHeight: "1.6", background: "var(--gray-1)" }}>
          <code style={{ fontFamily: "monospace" }}>
            {diffLines.map((line, i) => (
              <div key={i} style={{
                display: "flex",
                gap: "8px",
                background: line.startsWith("+") ? "var(--green-1)" : line.startsWith("-") ? "var(--red-1)" : line.startsWith("@@") ? "var(--blue-1)" : "transparent",
                color: line.startsWith("+") ? "var(--green-11)" : line.startsWith("-") ? "var(--red-11)" : line.startsWith("@@") ? "var(--blue-11)" : "var(--gray-12)",
              }}>
                <span style={{ userSelect: "none", minWidth: "30px", textAlign: "right", color: "var(--gray-9)" }}>{i + 1}</span>
                <span>{line || " "}</span>
              </div>
            ))}
          </code>
        </pre>
      </Box>
    );
  };

  return (
    <Card style={{ border: "1px solid var(--gray-5)", overflow: "hidden" }}>
      <Accordion type="single" collapsible value={expanded ? [change.path] : []} onValueChange={v => setExpanded(v.includes(change.path))}>
        <AccordionItem value={change.path}>
          <AccordionTrigger style={{ padding: "12px 16px", background: "var(--gray-2)" }}>
            <Flex align="center" gap="10" style={{ width: "100%" }}>
              <Checkbox checked={isSelected} onChange={() => onToggle(change.path)} />
              <Box style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                <Badge color={changeTypeColors[change.changeType]} variant="solid" size="2">
                  {changeTypeIcons[change.changeType]}
                </Badge>
                <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                  <Text weight="medium" size="2" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{change.path}</Text>
                  <Text size="1" color="var(--gray-10)">{change.description}</Text>
                </Flex>
                <Flex align="center" gap="8">
                  <Badge color={changeTypeColors[change.changeType]} variant="soft" size="1">{change.changeType}</Badge>
                  <Badge color="gray" variant="soft" size="1" style={{ background: getLanguageColor(change.language), color: "white" }}>{change.language}</Badge>
                  <Badge color="violet" variant="soft" size="1">Confidence: {Math.round(change.confidence * 100)}%</Badge>
                  {change.dependencies.length > 0 && (
                    <Badge color="amber" variant="soft" size="1">{change.dependencies.length} deps</Badge>
                  )}
                </Flex>
              </Box>
            </Flex>
          </AccordionTrigger>

          <AccordionContent style={{ padding: "12px 16px", background: "var(--gray-1)" }}>
            {showDiff && (viewMode === "side-by-side" ? renderSideBySide() : renderUnified())}
            {!showDiff && (
              <Flex align="center" justify="center" style={{ padding: "40px", color: "var(--gray-10)" }}>
                <Text>Diff hidden. Click <Code style={{ background: "var(--gray-4)", padding: "2px 6px", borderRadius: "4px" }}>Show Diff</Code> to view.</Text>
              </Flex>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

// Helper for language colors
function getLanguageColor(lang: string) {
  const colors: Record<string, string> = {
    typescript: "var(--blue-9)",
    javascript: "var(--yellow-9)",
    python: "var(--blue-9)",
    rust: "var(--orange-9)",
    go: "var(--cyan-9)",
    java: "var(--red-9)",
    cpp: "var(--violet-9)",
    cs: "var(--purple-9)",
  };
  return colors[lang.toLowerCase()] || "var(--gray-9)";
}

export default Composer;