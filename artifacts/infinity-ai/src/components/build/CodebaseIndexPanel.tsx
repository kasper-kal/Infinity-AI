/**
 * Codebase Index Panel — BuildView component for codebase indexing & semantic search
 *
 * Features:
 * - Index status (idle/indexing/error) with progress bar
 * - Full re-index + incremental re-index buttons
 * - Index statistics (files, chunks, embeddings, size)
 * - Exclude/include patterns configuration
 * - Semantic search test interface
 * - Supported languages display
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  Flex,
  Box,
  Text,
  Badge,
  Separator,
  Progress,
  Switch,
  Checkbox,
  Tooltip,
  Callout,
  IconButton,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@radix-ui/themes";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Database,
  RefreshCw,
  Search,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Settings,
  FileText,
  Code,
  Zap,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  Filter,
  Plus,
  Minus,
  Info,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface CodebaseIndexPanelProps {
  projectId: string;
  projectRoot?: string;
  onClose?: () => void;
}

interface IndexStatus {
  projectId: string;
  status: "idle" | "indexing" | "error";
  progress: number;
  message: string;
  error?: string;
  stats?: {
    totalFiles: number;
    totalChunks: number;
    totalEmbeddings: number;
    indexSize: number;
    languages: Record<string, number>;
    lastIndexed: string | null;
  };
}

interface SearchResult {
  file: string;
  filePath: string;
  language: string;
  type: string;
  name: string;
  signature: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
  matchType: string;
}

interface LanguageInfo {
  id: string;
  name: string;
  extensions: string[];
  aliases: string[];
  mimeTypes: string[];
}

interface EmbeddingModel {
  id: string;
  name: string;
  dimensions: number;
  maxTokens: number;
  local: boolean;
  description: string;
}

export function CodebaseIndexPanel({ projectId, projectRoot, onClose }: CodebaseIndexPanelProps) {
  const { t } = useI18n();
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const [models, setModels] = useState<EmbeddingModel[]>([]);
  const [config, setConfig] = useState({
    excludePatterns: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/target/**",
      "**/*.min.js",
      "**/*.map",
      "**/coverage/**",
      "**/.turbo/**",
    ] as string[],
    includePatterns: [] as string[],
    maxFileSize: 100000,
    chunkSize: 1000,
    overlap: 100,
    embeddingModel: "all-MiniLM-L6-v2",
    enableIncremental: true,
    useRemoteEmbeddings: false,
  });
  const [showConfig, setShowConfig] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [activeResult, setActiveResult] = useState<SearchResult | null>(null);
  const [lastAction, setLastAction] = useState<"full" | "incremental" | "clear" | null>(null);

  // Fetch index status on mount and when projectId changes
  const fetchStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await fetch(`/api/infinity/codebase/index/status?projectId=${encodeURIComponent(projectId)}`);
      if (response.ok) {
        const data = await response.json();
        setIndexStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch index status:", error);
    }
  }, [projectId]);

  // Fetch supported languages
  const fetchLanguages = useCallback(async () => {
    try {
      const response = await fetch("/api/infinity/codebase/languages");
      if (response.ok) {
        const data = await response.json();
        setLanguages(data.languages || []);
      }
    } catch (error) {
      console.error("Failed to fetch languages:", error);
    }
  }, []);

  // Fetch embedding models
  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch("/api/infinity/codebase/embedding-models");
      if (response.ok) {
        const data = await response.json();
        setModels(data.models || []);
      }
    } catch (error) {
      console.error("Failed to fetch embedding models:", error);
    }
  }, []);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await fetch(`/api/infinity/codebase/stats?projectId=${encodeURIComponent(projectId)}`);
      if (response.ok) {
        const data = await response.json();
        setIndexStatus(prev => prev ? { ...prev, stats: data } : null);
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  }, [projectId]);

  useEffect(() => {
    fetchStatus();
    fetchLanguages();
    fetchModels();
  }, [fetchStatus, fetchLanguages, fetchModels]);

  // Poll status when indexing
  useEffect(() => {
    if (indexStatus?.status === "indexing") {
      const interval = setInterval(() => {
        fetchStatus();
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [indexStatus?.status, fetchStatus]);

  // Full index
  const handleFullIndex = async () => {
    if (!projectId || !projectRoot) return;
    setIsLoading(true);
    setLastAction("full");
    try {
      const response = await fetch("/api/infinity/codebase/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectRoot,
          ...config,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        await fetchStatus();
        await fetchStats();
      } else {
        alert(data.error || "Failed to start indexing");
      }
    } catch (error) {
      console.error("Full index error:", error);
      alert("Failed to start indexing");
    } finally {
      setIsLoading(false);
    }
  };

  // Incremental index
  const handleIncrementalIndex = async () => {
    if (!projectId) return;
    setIsLoading(true);
    setLastAction("incremental");
    try {
      const response = await fetch("/api/infinity/codebase/index/incremental", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await response.json();
      if (response.ok) {
        await fetchStatus();
        await fetchStats();
      } else {
        alert(data.error || "Failed to start incremental indexing");
      }
    } catch (error) {
      console.error("Incremental index error:", error);
      alert("Failed to start incremental indexing");
    } finally {
      setIsLoading(false);
    }
  };

  // Clear index
  const handleClearIndex = async () => {
    if (!projectId) return;
    if (!confirm("Are you sure you want to clear the entire codebase index? This cannot be undone.")) return;
    setIsLoading(true);
    setLastAction("clear");
    try {
      const response = await fetch(`/api/infinity/codebase/index?projectId=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (response.ok) {
        await fetchStatus();
      } else {
        alert(data.error || "Failed to clear index");
      }
    } catch (error) {
      console.error("Clear index error:", error);
      alert("Failed to clear index");
    } finally {
      setIsLoading(false);
    }
  };

  // Index single file
  const handleIndexFile = async (filePath: string) => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/infinity/codebase/index/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filePath }),
      });
      const data = await response.json();
      if (response.ok) {
        await fetchStatus();
        await fetchStats();
      } else {
        alert(data.error || "Failed to index file");
      }
    } catch (error) {
      console.error("File index error:", error);
      alert("Failed to index file");
    } finally {
      setIsLoading(false);
    }
  };

  // Remove file from index
  const handleRemoveFile = async (filePath: string) => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/infinity/codebase/index/file", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filePath }),
      });
      const data = await response.json();
      if (response.ok) {
        await fetchStatus();
        await fetchStats();
      } else {
        alert(data.error || "Failed to remove file from index");
      }
    } catch (error) {
      console.error("File remove error:", error);
      alert("Failed to remove file from index");
    } finally {
      setIsLoading(false);
    }
  };

  // Semantic search
  const handleSearch = async () => {
    if (!projectId || !searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const response = await fetch("/api/infinity/codebase/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          query: searchQuery,
          limit: 20,
          hybrid: true,
          expandQuery: true,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setSearchResults(data.results || []);
        setSearchExpanded(true);
      } else {
        alert(data.error || "Search failed");
      }
    } catch (error) {
      console.error("Search error:", error);
      alert("Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  // Symbol search
  const handleSymbolSearch = async (symbol: string) => {
    if (!projectId) return;
    setIsSearching(true);
    try {
      const response = await fetch("/api/infinity/codebase/search/symbol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, symbol, limit: 20 }),
      });
      const data = await response.json();
      if (response.ok) {
        setSearchResults(data.results || []);
        setSearchExpanded(true);
      } else {
        alert(data.error || "Symbol search failed");
      }
    } catch (error) {
      console.error("Symbol search error:", error);
      alert("Symbol search failed");
    } finally {
      setIsSearching(false);
    }
  };

  // Format bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "indexing": return "blue";
      case "error": return "red";
      default: return "green";
    }
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "indexing": return <Loader2 size={16} className="spin" />;
      case "error": return <AlertCircle size={16} />;
      default: return <CheckCircle size={16} />;
    }
  };

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%", gap: "16px", padding: "16px" }}>
      {/* Header */}
      <Flex align="center" justify="space-between" style={{ gap: "12px" }}>
        <Flex align="center" gap="10">
          <Box style={{ background: "var(--violet-7)", color: "var(--violet-12)", borderRadius: "8px", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Database size={20} />
          </Box>
          <Flex direction="column" gap="1">
            <Text weight="bold" size="3">Codebase Index</Text>
            <Text size="1" color="var(--gray-10)">{projectId}</Text>
          </Flex>
        </Flex>
        <Flex align="center" gap="2">
          <Tooltip content="Refresh status">
            <IconButton onClick={fetchStatus} disabled={isLoading} aria-label="Refresh" size="2" variant="ghost">
              <RefreshCw size={16} className={isLoading ? "spin" : ""} />
            </IconButton>
          </Tooltip>
          {onClose && (
            <Tooltip content="Close">
              <IconButton onClick={onClose} aria-label="Close" size="2" variant="ghost">
                <X size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Flex>
      </Flex>

      {/* Status Card */}
      <Box style={{ background: "var(--gray-2)", border: "1px solid var(--gray-5)", borderRadius: "12px", padding: "16px" }}>
        <Flex align="center" justify="space-between" style={{ gap: "12px", flexWrap: "wrap" }}>
          <Flex align="center" gap="10">
            <Box style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "8px", background: `var(--${getStatusColor(indexStatus?.status || "idle")}-3)` }}>
              {getStatusIcon(indexStatus?.status || "idle")}
            </Box>
            <Flex direction="column" gap="2">
              <Flex align="center" gap="8">
                <Text weight="bold" size="2" capitalize>{indexStatus?.status || "idle"}</Text>
                <Badge variant="soft" color={getStatusColor(indexStatus?.status || "idle")} size="1">
                  {(indexStatus?.progress || 0)}%
                </Badge>
              </Flex>
              <Text size="1" color="var(--gray-10)">{indexStatus?.message || "Ready to index"}</Text>
            </Flex>
          </Flex>

          {indexStatus?.status === "error" && indexStatus.error && (
            <Callout variant="soft" color="red" style={{ maxWidth: "300px" }}>
              <AlertCircle size={14} />
              <Text size="1">{indexStatus.error}</Text>
            </Callout>
          )}
        </Flex>

        {/* Progress bar */}
        {(indexStatus?.status === "indexing" || (indexStatus?.progress && indexStatus.progress > 0 && indexStatus.progress < 100)) && (
          <Flex direction="column" gap="6" style={{ marginTop: "12px" }}>
            <Progress value={indexStatus?.progress || 0} max={100} style={{ height: "8px", borderRadius: "4px" }} />
            <Text size="1" color="var(--gray-10)" style={{ textAlign: "right" }}>
              {indexStatus?.progress || 0}% complete
            </Text>
          </Flex>
        )}
      </Box>

      {/* Stats Grid */}
      {indexStatus?.stats && (
        <Box style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
          <StatCard
            icon={<FileText size={20} />}
            label="Files"
            value={indexStatus.stats.totalFiles.toLocaleString()}
            color="blue"
          />
          <StatCard
            icon={<Code size={20} />}
            label="Chunks"
            value={indexStatus.stats.totalChunks.toLocaleString()}
            color="violet"
          />
          <StatCard
            icon={<Zap size={20} />}
            label="Embeddings"
            value={indexStatus.stats.totalEmbeddings.toLocaleString()}
            color="green"
          />
          <StatCard
            icon={<Database size={20} />}
            label="Index Size"
            value={formatBytes(indexStatus.stats.indexSize)}
            color="amber"
          />
        </Box>
      )}

      {/* Last indexed */}
      {indexStatus?.stats?.lastIndexed && (
        <Text size="1" color="var(--gray-10)" style={{ textAlign: "right" }}>
          Last indexed: {formatDate(indexStatus.stats.lastIndexed)}
        </Text>
      )}

      {/* Actions */}
      <Box style={{ background: "var(--gray-2)", border: "1px solid var(--gray-5)", borderRadius: "12px", padding: "16px" }}>
        <Text weight="bold" size="2" style={{ marginBottom: "12px" }}>Actions</Text>
        <Flex gap="8" wrap style={{ marginBottom: "12px" }}>
          <Button
            onClick={handleFullIndex}
            disabled={isLoading || indexStatus?.status === "indexing"}
            style={{ flex: 1, minWidth: "140px" }}
          >
            <RefreshCw size={16} /> Full Re-index
          </Button>
          <Button
            variant="soft"
            onClick={handleIncrementalIndex}
            disabled={isLoading || indexStatus?.status === "indexing" || !indexStatus?.stats}
            style={{ flex: 1, minWidth: "140px" }}
          >
            <Zap size={16} /> Incremental
          </Button>
          <Button
            variant="soft"
            color="red"
            onClick={handleClearIndex}
            disabled={isLoading || indexStatus?.status === "indexing" || !indexStatus?.stats}
            style={{ minWidth: "100px" }}
          >
            <Trash2 size={16} /> Clear
          </Button>
        </Flex>

        {projectRoot && (
          <Text size="1" color="var(--gray-10)">
            Project root: <code style={{ fontSize: "11px", background: "var(--gray-3)", padding: "2px 6px", borderRadius: "4px" }}>{projectRoot}</code>
          </Text>
        )}
      </Box>

      {/* Configuration Accordion */}
      <Accordion type="single" collapsible value={showConfig ? "config" : ""} onValueChange={v => setShowConfig(v === "config")}>
        <AccordionTrigger style={{ background: "var(--gray-2)", border: "1px solid var(--gray-5)", borderRadius: "8px" }}>
          <Flex align="center" justify="space-between" style={{ padding: "12px 16px", width: "100%" }}>
            <Flex align="center" gap="10">
              <Settings size={18} />
              <Text weight="medium">Configuration</Text>
            </Flex>
            <ChevronDown size={18} style={{ transition: "transform 0.2s" }} />
          </Flex>
        </AccordionTrigger>
        <AccordionContent style={{ overflow: "hidden" }}>
          <Box style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Exclude patterns */}
            <div>
              <Flex align="center" justify="space-between" style={{ marginBottom: "8px" }}>
                <Text weight="medium">Exclude Patterns</Text>
                <Badge variant="outline" size="1">{config.excludePatterns.length}</Badge>
              </Flex>
              <TextArea
                value={config.excludePatterns.join("\n")}
                onChange={e => setConfig(prev => ({ ...prev, excludePatterns: e.target.value.split("\n").filter(p => p.trim()) }))}
                placeholder="**/node_modules/**\n**/.git/**\n**/dist/**"
                style={{ minHeight: "100px", fontFamily: "monospace", fontSize: "12px" }}
              />
              <Text size="1" color="var(--gray-10)" style={{ marginTop: "4px" }}>
                One glob pattern per line. Files matching these patterns will be skipped during indexing.
              </Text>
            </div>

            <Separator />

            {/* Include patterns */}
            <div>
              <Flex align="center" justify="space-between" style={{ marginBottom: "8px" }}>
                <Text weight="medium">Include Patterns (optional)</Text>
                <Badge variant="outline" size="1">{config.includePatterns.length}</Badge>
              </Flex>
              <TextArea
                value={config.includePatterns.join("\n")}
                onChange={e => setConfig(prev => ({ ...prev, includePatterns: e.target.value.split("\n").filter(p => p.trim()) }))}
                placeholder="src/**/*.ts\nsrc/**/*.tsx"
                style={{ minHeight: "60px", fontFamily: "monospace", fontSize: "12px" }}
              />
              <Text size="1" color="var(--gray-10)" style={{ marginTop: "4px" }}>
                If specified, only files matching these patterns will be indexed.
              </Text>
            </div>

            <Separator />

            {/* Chunking settings */}
            <Flex gap="16" wrap style={{ marginTop: "8px" }}>
              <div style={{ flex: 1, minWidth: "150px" }}>
                <Label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>Chunk Size</Label>
                <Input
                  type="number"
                  value={config.chunkSize}
                  onChange={e => setConfig(prev => ({ ...prev, chunkSize: parseInt(e.target.value) || 1000 }))}
                  min={100}
                  max={5000}
                  step={100}
                />
              </div>
              <div style={{ flex: 1, minWidth: "150px" }}>
                <Label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>Overlap</Label>
                <Input
                  type="number"
                  value={config.overlap}
                  onChange={e => setConfig(prev => ({ ...prev, overlap: parseInt(e.target.value) || 100 }))}
                  min={0}
                  max={500}
                  step={50}
                />
              </div>
              <div style={{ flex: 1, minWidth: "150px" }}>
                <Label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>Max File Size (bytes)</Label>
                <Input
                  type="number"
                  value={config.maxFileSize}
                  onChange={e => setConfig(prev => ({ ...prev, maxFileSize: parseInt(e.target.value) || 100000 }))}
                  min={10000}
                  max={1000000}
                  step={10000}
                />
              </div>
            </Flex>

            <Separator />

            {/* Embedding settings */}
            <Flex direction="column" gap="12" style={{ marginTop: "8px" }}>
              <div>
                <Label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <Checkbox
                    checked={config.enableIncremental}
                    onChange={e => setConfig(prev => ({ ...prev, enableIncremental: e.target.checked }))}
                  />
                  <Text size="2">Enable Incremental Indexing</Text>
                </Label>
                <Text size="1" color="var(--gray-10)" style={{ marginLeft: "24px" }}>
                  Only re-index changed files. Much faster for large codebases.
                </Text>
              </div>

              <div>
                <Label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <Checkbox
                    checked={config.useRemoteEmbeddings}
                    onChange={e => setConfig(prev => ({ ...prev, useRemoteEmbeddings: e.target.checked }))}
                  />
                  <Text size="2">Use Remote Embeddings</Text>
                </Label>
                <Text size="1" color="var(--gray-10)" style={{ marginLeft: "24px" }}>
                  Use remote embedding API instead of local WASM model. Requires API key.
                </Text>
              </div>

              <div>
                <Label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>Embedding Model</Label>
                <Select value={config.embeddingModel} onValueChange={v => setConfig(prev => ({ ...prev, embeddingModel: v }))}>
                  <SelectTrigger style={{ width: "100%", maxWidth: "300px" }}>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        <Flex align="center" gap="8" style={{ minWidth: "250px" }}>
                          <Text size="1" weight="medium">{model.name}</Text>
                          <Badge variant="outline" size="1">{model.dimensions}d</Badge>
                          <Badge variant={model.local ? "soft" : "outline"} size="1" color={model.local ? "green" : "blue"}>
                            {model.local ? "Local" : "Remote"}
                          </Badge>
                        </Flex>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Flex>
          </Box>
        </AccordionContent>
      </Accordion>

      {/* Supported Languages Accordion */}
      <Accordion type="single" collapsible value={languages.length > 0 ? "languages" : ""} onValueChange={v => {}}>
        <AccordionTrigger style={{ background: "var(--gray-2)", border: "1px solid var(--gray-5)", borderRadius: "8px" }}>
          <Flex align="center" justify="space-between" style={{ padding: "12px 16px", width: "100%" }}>
            <Flex align="center" gap="10">
              <Code size={18} />
              <Text weight="medium">Supported Languages ({languages.length})</Text>
            </Flex>
            <ChevronDown size={18} />
          </Flex>
        </AccordionTrigger>
        <AccordionContent style={{ overflow: "hidden" }}>
          <Box style={{ padding: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
              {languages.map(lang => (
                <Box key={lang.id} style={{ background: "var(--gray-3)", borderRadius: "8px", padding: "10px 12px", border: "1px solid var(--gray-5)" }}>
                  <Flex align="center" justify="space-between" style={{ marginBottom: "4px" }}>
                    <Text weight="medium" size="2">{lang.name}</Text>
                    <Badge variant="outline" size="1">{lang.extensions.join(", ")}</Badge>
                  </Flex>
                  <Text size="1" color="var(--gray-10)">Aliases: {lang.aliases.join(", ")}</Text>
                </Box>
              ))}
            </div>
          </Box>
        </AccordionContent>
      </Accordion>

      {/* Semantic Search Test */}
      <Box style={{ background: "var(--gray-2)", border: "1px solid var(--gray-5)", borderRadius: "12px", padding: "16px", marginTop: "8px" }}>
        <Flex align="center" justify="space-between" style={{ marginBottom: "12px" }}>
          <Flex align="center" gap="8">
            <Search size={18} />
            <Text weight="bold" size="2">Semantic Search Test</Text>
          </Flex>
          <Button variant="ghost" size="1" onClick={() => setSearchExpanded(!searchExpanded)}>
            {searchExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </Flex>

        {searchExpanded && (
          <Flex direction="column" gap="12" style={{ animation: "slideDown 0.2s ease-out" }}>
            <style jsx>{`
              @keyframes slideDown {
                from { opacity: 0; transform: translateY(-8px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>

            <Flex gap="8">
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Ask about your codebase... (e.g., 'how does auth work?', 'find payment logic')"
                style={{ flex: 1 }}
              />
              <Button onClick={handleSearch} disabled={isSearching || !searchQuery.trim()}>
                {isSearching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              </Button>
            </Flex>

            <Flex gap="8" wrap>
              <Label style={{ display: "flex", alignItems: "center", gap: "6", cursor: "pointer", fontSize: "13px" }}>
                <Checkbox
                  checked={true}
                  onChange={() => {}}
                />
                <Text>Hybrid (vector + keyword)</Text>
              </Label>
              <Label style={{ display: "flex", alignItems: "center", gap: "6", cursor: "pointer", fontSize: "13px" }}>
                <Checkbox
                  checked={true}
                  onChange={() => {}}
                />
                <Text>Query Expansion</Text>
              </Label>
            </Flex>

            {searchResults.length > 0 && (
              <Box style={{ maxHeight: "400px", overflow: "auto", border: "1px solid var(--gray-5)", borderRadius: "8px" }}>
                {searchResults.map((result, idx) => (
                  <SearchResultCard
                    key={`${result.file}-${result.startLine}-${idx}`}
                    result={result}
                    index={idx + 1}
                    isActive={activeResult === result}
                    onClick={() => setActiveResult(activeResult === result ? null : result)}
                  />
                ))}
              </Box>
            )}

            {activeResult && (
              <Box style={{ background: "var(--gray-3)", border: "1px solid var(--gray-5)", borderRadius: "8px", padding: "12px", marginTop: "8px" }}>
                <Flex align="center" justify="space-between" style={{ marginBottom: "8px" }}>
                  <Text weight="medium" size="2">{activeResult.name || "Anonymous"}</Text>
                  <IconButton size="1" variant="ghost" onClick={() => setActiveResult(null)} aria-label="Close">
                    <X size={14} />
                  </IconButton>
                </Flex>
                <Flex gap="8" wrap style={{ marginBottom: "8px", fontSize: "12px", color: "var(--gray-10)" }}>
                  <Badge variant="outline" size="1">{activeResult.language}</Badge>
                  <Badge variant="outline" size="1">{activeResult.type}</Badge>
                  <Badge variant="outline" size="1">Score: {activeResult.score.toFixed(3)}</Badge>
                  <Badge variant="outline" size="1">{activeResult.matchType}</Badge>
                </Flex>
                <Text size="1" color="var(--gray-10)" style={{ marginBottom: "8px" }}>{activeResult.file}:{activeResult.startLine}-{activeResult.endLine}</Text>
                <pre style={{ background: "var(--gray-1)", borderRadius: "6px", padding: "12px", overflow: "auto", maxHeight: "200px", fontSize: "11px", lineHeight: "1.5" }}>
                  <code>{activeResult.content}</code>
                </pre>
              </Box>
            )}

            {searchExpanded && searchResults.length === 0 && !isSearching && searchQuery && (
              <Callout variant="soft" color="amber">
                <Info size={14} />
                <Text size="1">No results found. Try a different query or re-index the codebase.</Text>
              </Callout>
            )}
          </Flex>
        )}
      </Box>
    </Box>
  );
}

// Stat Card Component
function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <Box style={{ background: "var(--gray-2)", border: "1px solid var(--gray-5)", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <Flex align="center" justify="space-between">
        <Box style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "8px", background: `var(--${color}-3)` }}>
          {icon}
        </Box>
      </Flex>
      <Flex direction="column" gap="2">
        <Text weight="bold" size="3" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</Text>
        <Text size="1" color="var(--gray-10)">{label}</Text>
      </Flex>
    </Box>
  );
}

// Search Result Card Component
interface SearchResultCardProps {
  result: SearchResult;
  index: number;
  isActive: boolean;
  onClick: () => void;
}

function SearchResultCard({ result, index, isActive, onClick }: SearchResultCardProps) {
  const typeIcons: Record<string, React.ReactNode> = {
    function: <Code size={12} />,
    class: <Box style={{ width: "12px", height: "12px", borderRadius: "2px", background: "currentColor" }} />,
    interface: <Box style={{ width: "12px", height: "12px", border: "1px solid currentColor", borderRadius: "2px" }} />,
    type: <Box style={{ width: "12px", height: "12px", borderRadius: "50%", border: "1px solid currentColor" }} />,
    import: <Code size={12} />,
    export: <Code size={12} />,
    comment: <Code size={12} />,
    block: <Code size={12} />,
  };

  const typeColors: Record<string, string> = {
    function: "blue",
    class: "violet",
    interface: "cyan",
    type: "green",
    import: "amber",
    export: "amber",
    comment: "gray",
    block: "gray",
  };

  return (
    <Box
      onClick={onClick}
      style={{
        padding: "12px",
        borderBottom: `1px solid var(--gray-5)`,
        background: isActive ? "var(--violet-3)" : "transparent",
        borderLeft: isActive ? "3px solid var(--violet-9)" : "none",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      <Flex align="center" gap="8" style={{ marginBottom: "6px" }}>
        <Badge variant="soft" color={typeColors[result.type] || "gray"} size="1" style={{ minWidth: "24px" }}>
          {index}
        </Badge>
        <Box style={{ display: "flex", alignItems: "center", color: `var(--${typeColors[result.type] || "gray"}-9)` }}>
          {typeIcons[result.type] || <Code size={12} />}
        </Box>
        <Text weight="medium" size="2" style={{ flex: 1, minWidth: 0, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
          {result.name || "(anonymous)"}
        </Text>
        <Badge variant="outline" size="1">{result.language}</Badge>
        <Badge variant="outline" size="1" style={{ fontVariantNumeric: "tabular-nums" }}>
          {(result.score * 100).toFixed(1)}%
        </Badge>
      </Flex>
      <Flex gap="8" style={{ fontSize: "11px", color: "var(--gray-10)" }}>
        <Text style={{ fontFamily: "monospace" }}>{result.file}</Text>
        <Text>{result.startLine}:{result.endLine}</Text>
        <Text>{result.matchType}</Text>
      </Flex>
      {result.signature && (
        <Text size="1" color="var(--gray-10)" style={{ marginTop: "4px", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {result.signature}
        </Text>
      )}
    </Box>
  );
}

export default CodebaseIndexPanel;