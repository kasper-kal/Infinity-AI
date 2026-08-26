import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Star, GitBranch, Clock, Download, Palette } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/badge";
import { Tabs, type Tab } from "@/components/ui/Tabs";

export interface ArtifactTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: TemplateCategory;
  platform: TemplatePlatform;
  artifactType: ArtifactTypeId;
  framework: string;
  figmaUrl?: string;
  figmaFileId?: string;
  figmaFileName?: string;
  installCommands: string[];
  devCommands: string[];
  preview: string;
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  setupTime: string;
  author?: string;
  isFigmaTemplate: boolean;
  colors: string[];
}

export type TemplateCategory =
  | "figma-design-kit"
  | "starter"
  | "dashboard"
  | "landing-page"
  | "saas"
  | "portfolio"
  | "blog"
  | "ecommerce"
  | "mobile"
  | "presentation"
  | "api"
  | "cli"
  | "extension";

export type TemplatePlatform =
  | "web"
  | "ios"
  | "ipados"
  | "macos"
  | "watchos"
  | "android"
  | "cross-platform";

export type ArtifactTypeId =
  | "slide-deck"
  | "website"
  | "web-app"
  | "mobile-app"
  | "api"
  | "cli-tool"
  | "chrome-extension";

export interface ArtifactTemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (templateId: string, artifactType: ArtifactTypeId) => void;
  templates: ArtifactTemplate[];
  selectedArtifactType?: ArtifactTypeId;
}

export function ArtifactTemplateSelector({
  open,
  onClose,
  onSelect,
  templates,
  selectedArtifactType,
}: ArtifactTemplateSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [filterArtifactType, setFilterArtifactType] = useState<ArtifactTypeId | "all">(
    selectedArtifactType ?? "all"
  );
  const [showFigmaOnly, setShowFigmaOnly] = useState(false);

  // Reset filters when modal opens
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setFilterCategory("all");
      setFilterPlatform("all");
      setFilterArtifactType(selectedArtifactType ?? "all");
      setShowFigmaOnly(false);
    }
  }, [open, selectedArtifactType]);

  // Compute filtered templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.tags.some((tag) => tag.includes(query));
        if (!matchesSearch) return false;
      }

      // Category filter
      if (filterCategory !== "all" && t.category !== filterCategory) return false;

      // Platform filter
      if (filterPlatform !== "all" && t.platform !== filterPlatform) return false;

      // Artifact type filter
      if (filterArtifactType !== "all" && t.artifactType !== filterArtifactType) return false;

      // Figma only filter
      if (showFigmaOnly && !t.isFigmaTemplate) return false;

      return true;
    });
  }, [templates, searchQuery, filterCategory, filterPlatform, filterArtifactType, showFigmaOnly]);

  // Get unique categories and platforms
  const categories = useMemo(
    () => ["all", ...Array.from(new Set(templates.map((t) => t.category)))],
    [templates]
  );
  const platforms = useMemo(
    () => ["all", ...Array.from(new Set(templates.map((t) => t.platform)))],
    [templates]
  );
  const artifactTypes = useMemo(
    () => ["all", ...Array.from(new Set(templates.map((t) => t.artifactType)))],
    [templates]
  );

  const difficultyColors: Record<string, string> = {
    beginner: "bg-green-500/20 text-green-600 dark:text-green-400",
    intermediate: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
    advanced: "bg-red-500/20 text-red-600 dark:text-red-400",
  };

  const artifactTypeLabels: Record<ArtifactTypeId, string> = {
    "slide-deck": "Slides",
    website: "Website",
    "web-app": "Web App",
    "mobile-app": "Mobile App",
    api: "API",
    "cli-tool": "CLI Tool",
    "chrome-extension": "Extension",
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 w-full max-w-6xl max-h-[90vh] bg-background border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Choose a Template</h2>
            <p className="text-sm text-muted-foreground">
              Start your artifact from a professional template
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Search + Filters */}
        <div className="p-4 border-b border-border space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="pl-9"
            />
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Artifact type filter */}
            <div className="flex gap-1 flex-wrap">
              {artifactTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setFilterArtifactType(type as ArtifactTypeId | "all")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filterArtifactType === type
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {type === "all" ? "All Types" : artifactTypeLabels[type as ArtifactTypeId]}
                </button>
              ))}
            </div>

            {/* Figma only toggle */}
            <button
              onClick={() => setShowFigmaOnly(!showFigmaOnly)}
              className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showFigmaOnly
                  ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              Figma Only
            </button>
          </div>

          {/* Platform + Category filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Platform:</span>
            {platforms.map((p) => (
              <button
                key={p}
                onClick={() => setFilterPlatform(p)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  filterPlatform === p
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {p === "all" ? "All" : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Category:</span>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setFilterCategory(c)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  filterCategory === c
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {c === "all"
                  ? "All"
                  : c
                      .split("-")
                      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                      .join(" ")}
              </button>
            ))}
          </div>
        </div>

        {/* Template grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-4">🔍</div>
              <p className="text-muted-foreground">No templates found matching your filters</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setFilterCategory("all");
                  setFilterPlatform("all");
                  setFilterArtifactType("all");
                  setShowFigmaOnly(false);
                }}
                className="mt-2"
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  artifactTypeLabel={artifactTypeLabels[template.artifactType]}
                  difficultyColor={difficultyColors[template.difficulty]}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filteredTemplates.length} template
            {filteredTemplates.length !== 1 ? "s" : ""} available
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function TemplateCard({
  template,
  artifactTypeLabel,
  difficultyColor,
  onSelect,
}: {
  template: ArtifactTemplate;
  artifactTypeLabel: string;
  difficultyColor: string;
  onSelect: (templateId: string, artifactType: ArtifactTypeId) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative flex flex-col bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-lg transition-all cursor-pointer"
      onClick={() => onSelect(template.id, template.artifactType)}
    >
      {/* Preview / Icon */}
      <div className="relative h-32 flex items-center justify-center bg-gradient-to-br from-muted/30 to-muted/10">
        <span className="text-5xl">{template.preview}</span>
        {template.isFigmaTemplate && (
          <Badge
            variant="secondary"
            className="absolute top-2 left-2 bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px]"
          >
            <Palette className="w-3 h-3 mr-1" />
            Figma
          </Badge>
        )}
        {template.figmaUrl && (
          <a
            href={template.figmaUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 backdrop-blur hover:bg-background"
            title="Open in Figma"
          >
            <GitBranch className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-medium text-sm leading-tight">{template.name}</h3>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {template.description}
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-1 mb-2">
          <Badge variant="outline" className="text-[10px]">
            {artifactTypeLabel}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {template.framework}
          </Badge>
          <Badge className={`text-[10px] ${difficultyColor}`}>{template.difficulty}</Badge>
        </div>

        {/* Colors */}
        <div className="flex items-center gap-1 mb-2">
          {template.colors.slice(0, 5).map((color, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full border border-border"
              style={{ backgroundColor: color }}
            />
          ))}
          {template.colors.length > 5 && (
            <span className="text-[10px] text-muted-foreground">
              +{template.colors.length - 5}
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-auto">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {template.setupTime}
          </span>
          {template.author && (
            <span className="truncate">by {template.author}</span>
          )}
        </div>

        {/* Actions */}
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            className="flex-1 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(template.id, template.artifactType);
            }}
          >
            Use Template
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Less" : "Details"}
          </Button>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-2 pt-2 border-t border-border space-y-2 text-xs">
            <div>
              <span className="text-muted-foreground">Platform:</span>{" "}
              <span className="capitalize">{template.platform}</span>
            </div>
            {template.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 rounded bg-muted/50 text-[10px] text-muted-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {template.installCommands.length > 0 && (
              <div>
                <span className="text-muted-foreground">Install:</span>
                <code className="block mt-1 p-1.5 bg-muted/30 rounded text-[10px] font-mono overflow-x-auto">
                  {template.installCommands.join("\n")}
                </code>
              </div>
            )}
            {template.devCommands.length > 0 && (
              <div>
                <span className="text-muted-foreground">Dev:</span>
                <code className="block mt-1 p-1.5 bg-muted/30 rounded text-[10px] font-mono overflow-x-auto">
                  {template.devCommands.join("\n")}
                </code>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
