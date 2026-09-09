/**
 * Skills Settings Panel — Phase 15: Skills System UI
 *
 * Manages agent skills: discover (built-in/project/user/imported), create/edit/delete,
 * marketplace browse/install, project bindings to agent roles.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  IconButton,
  Input,
  Textarea,
  Select,
  Dialog,
  AlertDialog,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  ScrollArea,
  Label,
  Separator,
} from "@/components/ui";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";
import {
  Plus,
  Trash2,
  Edit,
  Package,
  Download,
  Upload,
  Search,
  ChevronDown,
  ChevronUp,
  Link2,
  ExternalLink,
  Settings,
  Brain,
  Zap,
  BookOpen,
  Copy,
  Check,
  X,
  Filter,
} from "lucide-react";

export interface SkillsSettingsPanelProps {
  /** Project ID for project-scoped skills/bindings */
  projectId?: string;
}

interface SkillToolPreference {
  name: string;
  priority: "required" | "preferred" | "discouraged" | "forbidden";
  reason?: string;
}

interface SkillVerificationRule {
  name: string;
  description: string;
  check: "always" | "on-completion" | "on-error" | "manual";
  autoFix: boolean;
  fixPrompt?: string;
}

interface SkillConvention {
  name: string;
  description: string;
  pattern?: string;
  severity: "error" | "warning" | "info";
}

interface SkillEnvironment {
  requiredTools: string[];
  requiredPackages: string[];
  setupCommands: string[];
}

type SkillSource = "builtin" | "project" | "user" | "imported";
type AgentRole = "planner" | "coder" | "reviewer" | "fixer" | "diagnostic" | "human";

interface Skill {
  metadata: {
    id: string;
    name: string;
    version: string;
    description: string;
    category: string;
    author?: string;
    license: string;
    tags: string[];
    minInfinityVersion?: string;
    dependencies: string[];
  };
  instructions: string;
  toolPreferences: SkillToolPreference[];
  verificationRules: SkillVerificationRule[];
  conventions: SkillConvention[];
  environment: SkillEnvironment;
  roleBindings: AgentRole[];
  extends?: string;
  source?: SkillSource;
  projectId?: string;
  loadedAt?: string;
  filePath?: string;
}

interface SkillStats {
  total: number;
  builtin: number;
  project: number;
  user: number;
  imported: number;
}

interface SkillBinding {
  projectId: string;
  agentRole: AgentRole;
  skillIds: string[];
}

const CATEGORIES = [
  "frontend",
  "backend",
  "database",
  "devops",
  "security",
  "performance",
  "debugging",
  "testing",
  "documentation",
  "architecture",
] as const;

const PRIORITIES = ["required", "preferred", "discouraged", "forbidden"] as const;
const CHECKS = ["always", "on-completion", "on-error", "manual"] as const;
const SEVERITIES = ["error", "warning", "info"] as const;
const ROLES: AgentRole[] = ["planner", "coder", "reviewer", "fixer", "diagnostic", "human"];

const SOURCE_LABELS: Record<SkillSource, string> = {
  builtin: "Built-in",
  project: "Project",
  user: "User",
  imported: "Imported",
};

const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "Planner",
  coder: "Coder",
  reviewer: "Reviewer",
  fixer: "Fixer",
  diagnostic: "Diagnostic",
  human: "Human",
};

const CATEGORY_LABELS: Record<string, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  devops: "DevOps",
  security: "Security",
  performance: "Performance",
  debugging: "Debugging",
  testing: "Testing",
  documentation: "Documentation",
  architecture: "Architecture",
};

const PRIORITY_LABELS: Record<string, string> = {
  required: "Required",
  preferred: "Preferred",
  discouraged: "Discouraged",
  forbidden: "Forbidden",
};

const CHECK_LABELS: Record<string, string> = {
  always: "Always",
  "on-completion": "On Completion",
  "on-error": "On Error",
  manual: "Manual",
};

const SEVERITY_LABELS: Record<string, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

const SOURCE_BADGE: Record<SkillSource, "default" | "secondary" | "outline" | "destructive"> = {
  builtin: "default",
  project: "secondary",
  user: "outline",
  imported: "destructive",
};

export const SkillsSettingsPanel: React.FC<SkillsSettingsPanelProps> = ({ projectId }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<
    "discover" | "my-skills" | "marketplace" | "templates" | "bindings"
  >("discover");
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [stats, setStats] = useState<SkillStats>({
    total: 0,
    builtin: 0,
    project: 0,
    user: 0,
    imported: 0,
  });
  const [bindings, setBindings] = useState<SkillBinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState({ category: "", source: "", query: "" });

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editSkillId, setEditSkillId] = useState<string | null>(null);
  const [deleteSkillId, setDeleteSkillId] = useState<string | null>(null);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<Skill | null>(null);

  // Form state
  const [form, setForm] = useState<Partial<Skill>>({
    metadata: {
      id: "",
      name: "",
      version: "1.0.0",
      description: "",
      category: "frontend",
      author: "",
      license: "MIT",
      tags: [],
      dependencies: [],
    },
    instructions: "",
    toolPreferences: [],
    verificationRules: [],
    conventions: [],
    environment: {
      requiredTools: [],
      requiredPackages: [],
      setupCommands: [],
    },
    roleBindings: [],
    extends: "",
  });

  // Derived state
  const isEditing = editSkillId !== null;
  const currentSkill = skills.find((s) => s.metadata.id === editSkillId);

  // API base
  const apiBase = `/api/infinity/skills`;

  // Fetch skills + stats + bindings
  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [skillsRes, bindingsRes] = await Promise.all([
        fetch(`${apiBase}?projectId=${projectId || "all"}`),
        projectId ? fetch(`${apiBase}/bindings/${projectId}`) : Promise.resolve({ json: () => ({ bindings: [] }) }),
      ]);

      if (!skillsRes.ok) throw new Error(await skillsRes.text());
      if (!bindingsRes.ok) throw new Error(await bindingsRes.text());

      const skillsData = await skillsRes.json();
      const bindingsData = await bindingsRes.json();

      setSkills(skillsData.skills || []);
      setStats(skillsData.stats || { total: 0, builtin: 0, project: 0, user: 0, imported: 0 });
      setBindings(bindingsData.bindings || []);
    } catch (err) {
      console.error("[Skills Panel] Fetch failed:", err);
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, [projectId, apiBase]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Filter skills
  const filteredSkills = skills.filter((skill) => {
    if (filter.category && skill.metadata.category !== filter.category) return false;
    if (filter.source && skill.source !== filter.source) return false;
    if (filter.query) {
      const q = filter.query.toLowerCase();
      if (
        !skill.metadata.id.toLowerCase().includes(q) &&
        !skill.metadata.name.toLowerCase().includes(q) &&
        !skill.metadata.description.toLowerCase().includes(q) &&
        !skill.metadata.tags.some((t) => t.toLowerCase().includes(q))
      )
        return false;
    }
    return true;
  });

  // Handlers
  const handleInputChange = (field: string, value: any) => {
    setForm((prev) => {
      if (field.includes(".")) {
        const [parent, child] = field.split(".");
        return {
          ...prev,
          [parent]: { ...(prev[parent as keyof typeof prev] as object), [child]: value },
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const addArrayItem = (field: keyof Skill, item: any) => {
    setForm((prev) => ({
      ...prev,
      [field]: [...((prev[field] as any[]) || []), item],
    }));
  };

  const removeArrayItem = (field: keyof Skill, index: number) => {
    setForm((prev) => ({
      ...prev,
      [field]: ((prev[field] as any[]) || []).filter((_, i) => i !== index),
    }));
  };

  const openCreate = () => {
    setForm({
      metadata: {
        id: "",
        name: "",
        version: "1.0.0",
        description: "",
        category: "frontend",
        author: "",
        license: "MIT",
        tags: [],
        dependencies: [],
      },
      instructions: "",
      toolPreferences: [],
      verificationRules: [],
      conventions: [],
      environment: {
        requiredTools: [],
        requiredPackages: [],
        setupCommands: [],
      },
      roleBindings: [],
      extends: "",
    });
    setEditSkillId(null);
    setCreateDialogOpen(true);
  };

  const openEdit = (skill: Skill) => {
    setForm({
      metadata: { ...skill.metadata },
      instructions: skill.instructions,
      toolPreferences: [...skill.toolPreferences],
      verificationRules: [...skill.verificationRules],
      conventions: [...skill.conventions],
      environment: { ...skill.environment },
      roleBindings: [...skill.roleBindings],
      extends: skill.extends || "",
    });
    setEditSkillId(skill.metadata.id);
    setCreateDialogOpen(true);
  };

  const openDelete = (id: string) => {
    setDeleteSkillId(id);
  };

  const openBind = () => {
    setBindDialogOpen(true);
  };

  const openInstall = (skill: Skill) => {
    setSelectedMarketplaceSkill(skill);
    setInstallDialogOpen(true);
  };

  // Submit create/update
  const handleSubmit = async () => {
    if (!form.metadata?.id || !form.metadata?.name) {
      alert(t("settings.skills.name") + " required");
      return;
    }
    try {
      const url = isEditing ? `${apiBase}/${editSkillId}` : apiBase;
      const method = isEditing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          metadata: { ...form.metadata, id: isEditing ? editSkillId : undefined },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptics.success();
      setCreateDialogOpen(false);
      setEditSkillId(null);
      fetchAll();
    } catch (err) {
      console.error("[Skills Panel] Save failed:", err);
      alert(err instanceof Error ? err.message : isEditing ? t("settings.skills.updateError") : t("settings.skills.createError"));
    }
  };

  // Delete skill
  const handleDelete = async () => {
    if (!deleteSkillId) return;
    try {
      const res = await fetch(`${apiBase}/${deleteSkillId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      haptics.success();
      fetchAll();
    } catch (err) {
      console.error("[Skills Panel] Delete failed:", err);
      alert(err instanceof Error ? err.message : t("settings.skills.deleteError"));
    } finally {
      setDeleteSkillId(null);
    }
  };

  // Bind skill to agent
  const handleBind = async (skillId: string, agentRole: AgentRole) => {
    try {
      const res = await fetch(`${apiBase}/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, agentRole, skillId }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptics.success();
      setBindDialogOpen(false);
      fetchAll();
    } catch (err) {
      console.error("[Skills Panel] Bind failed:", err);
      alert(err instanceof Error ? err.message : t("settings.skills.bindError"));
    }
  };

  // Unbind skill
  const handleUnbind = async (agentRole: AgentRole, skillId: string) => {
    try {
      const res = await fetch(`${apiBase}/bind/${projectId}/${agentRole}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptics.success();
      fetchAll();
    } catch (err) {
      console.error("[Skills Panel] Unbind failed:", err);
      alert(err instanceof Error ? err.message : t("settings.skills.unbindError"));
    }
  };

  // Initialize skills system
  const handleInitialize = async () => {
    try {
      const res = await fetch(`${apiBase}/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptics.success();
      alert(t("settings.skills.initialized"));
      fetchAll();
    } catch (err) {
      console.error("[Skills Panel] Init failed:", err);
      alert(err instanceof Error ? err.message : t("settings.skills.loadError"));
    }
  };

  // Install from marketplace
  const handleInstall = async () => {
    if (!selectedMarketplaceSkill) return;
    try {
      const res = await fetch(`${apiBase}/marketplace/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, skillId: selectedMarketplaceSkill.metadata.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      haptics.success();
      setInstallDialogOpen(false);
      setSelectedMarketplaceSkill(null);
      fetchAll();
    } catch (err) {
      console.error("[Skills Panel] Install failed:", err);
      alert(err instanceof Error ? err.message : "Failed to install skill");
    }
  };

  // Export skill as JSON
  const exportSkill = (skill: Skill) => {
    const blob = new Blob([JSON.stringify(skill, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${skill.metadata.id}.skill.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import skill from file
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const skill = JSON.parse(event.target?.result as string);
        const res = await fetch(apiBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(skill),
        });
        if (!res.ok) throw new Error(await res.text());
        haptics.success();
        fetchAll();
      } catch (err) {
        console.error("[Skills Panel] Import failed:", err);
        alert(err instanceof Error ? err.message : t("settings.skills.createError"));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const tabs = [
    { id: "discover", label: t("settings.skills.discover"), icon: <Search className="w-4 h-4" /> },
    { id: "my-skills", label: t("settings.skills.mySkills"), icon: <Package className="w-4 h-4" /> },
    { id: "marketplace", label: t("settings.skills.marketplace"), icon: <ExternalLink className="w-4 h-4" /> },
    { id: "templates", label: t("settings.skills.templates"), icon: <BookOpen className="w-4 h-4" /> },
    { id: "bindings", label: t("settings.skills.bindings"), icon: <Link2 className="w-4 h-4" /> },
  ] as const;

  if (loading) {
    return (
      <Card className="w-full h-[600px] flex items-center justify-center">
        <div className="text-muted-foreground">{t("settings.skills.title")}…</div>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-full h-[calc(100vh-200px)] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            {t("settings.skills.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={SOURCE_BADGE.builtin}>{t("settings.skills.stats.builtin")}: {stats.builtin}</Badge>
            <Badge variant={SOURCE_BADGE.project}>{t("settings.skills.stats.project")}: {stats.project}</Badge>
            <Badge variant={SOURCE_BADGE.user}>{t("settings.skills.stats.user")}: {stats.user}</Badge>
            <Badge variant={SOURCE_BADGE.imported}>{t("settings.skills.stats.imported")}: {stats.imported}</Badge>
            <Button variant="outline" size="sm" onClick={handleInitialize} className="gap-1">
              <Zap className="w-3.5 h-3.5" />
              {t("settings.skills.newSkill")}
            </Button>
            <Button size="sm" onClick={openCreate} className="gap-1">
              <Plus className="w-3.5 h-3.5" />
              {t("settings.skills.newSkill")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="grid grid-cols-5 mb-4">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                  {tab.icon} {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <Separator />

          {/* DISCOVER TAB */}
          <TabsContent value="discover" className="flex-1 flex flex-col overflow-hidden">
            <div className="flex gap-2 mb-4">
              <Input
                placeholder={t("settings.skills.discover") + "..."}
                value={filter.query}
                onChange={(e) => setFilter((p) => ({ ...p, query: e.target.value }))}
                className="flex-1"
                iconLeft={<Search className="w-4 h-4 text-muted-foreground" />}
              />
              <Select value={filter.category} onValueChange={(v) => setFilter((p) => ({ ...p, category: v }))}>
                <Select.Trigger className="w-36"><Select.Value placeholder="All Categories" /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="">All Categories</Select.Item>
                  {CATEGORIES.map((c) => (
                    <Select.Item key={c} value={c}>{CATEGORY_LABELS[c]}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Select value={filter.source} onValueChange={(v) => setFilter((p) => ({ ...p, source: v }))}>
                <Select.Trigger className="w-32"><Select.Value placeholder="All Sources" /></Select.Trigger>
                <Select.Content>
                  <Select.Item value="">All Sources</Select.Item>
                  <Select.Item value="builtin">Built-in</Select.Item>
                  <Select.Item value="project">Project</Select.Item>
                  <Select.Item value="user">User</Select.Item>
                  <Select.Item value="imported">Imported</Select.Item>
                </Select.Content>
              </Select>
            </div>

            <ScrollArea className="flex-1">
              {filteredSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Package className="w-12 h-12 mb-4 opacity-50" />
                  <p>{filteredSkills.length === 0 && filter.query ? "No skills match your search" : "No skills found"}</p>
                </div>
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                  {filteredSkills.map((skill) => (
                    <Card key={skill.metadata.id} className="hover:shadow-lg transition-shadow">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate">{skill.metadata.name}</CardTitle>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                              <Badge variant={SOURCE_BADGE[skill.source || "builtin"]}>{SOURCE_LABELS[skill.source || "builtin"]}</Badge>
                              <Badge variant="outline">{CATEGORY_LABELS[skill.metadata.category] || skill.metadata.category}</Badge>
                              <span>v{skill.metadata.version}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <IconButton variant="ghost" size="sm" onClick={() => exportSkill(skill)} title="Export">
                              <Download className="w-3.5 h-3.5" />
                            </IconButton>
                            {skill.source !== "builtin" && (
                              <IconButton variant="ghost" size="sm" onClick={() => openEdit(skill)} title="Edit">
                                <Edit className="w-3.5 h-3.5" />
                              </IconButton>
                            )}
                            {skill.source !== "builtin" && (
                              <IconButton variant="ghost" size="sm" onClick={() => openDelete(skill.metadata.id)} title="Delete">
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                              </IconButton>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2 pb-2">
                        <p className="text-sm text-muted-foreground line-clamp-2">{skill.metadata.description}</p>
                        {skill.metadata.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {skill.metadata.tags.slice(0, 4).map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                            ))}
                            {skill.metadata.tags.length > 4 && (
                              <Badge variant="outline" className="text-xs">+{skill.metadata.tags.length - 4}</Badge>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                          {skill.roleBindings.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              {skill.roleBindings.map((r) => ROLE_LABELS[r]).join(", ")}
                            </span>
                          )}
                          {skill.toolPreferences.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Settings className="w-3 h-3" />
                              {skill.toolPreferences.length} tools
                            </span>
                          )}
                          {skill.verificationRules.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              {skill.verificationRules.length} rules
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* MY SKILLS TAB */}
          <TabsContent value="my-skills" className="flex-1 flex flex-col overflow-hidden">
            <div className="mb-4">
              <Input
                placeholder="Search my skills..."
                value={filter.query}
                onChange={(e) => setFilter((p) => ({ ...p, query: e.target.value }))}
                className="max-w-xs"
                iconLeft={<Search className="w-4 h-4 text-muted-foreground" />}
              />
            </div>
            <ScrollArea className="flex-1">
              {skills.filter((s) => s.source !== "builtin").length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Package className="w-12 h-12 mb-4 opacity-50" />
                  <p>No custom skills yet. Create one or install from marketplace.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {skills
                    .filter((s) => s.source !== "builtin")
                    .map((skill) => (
                      <Card key={skill.metadata.id}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium truncate">{skill.metadata.name}</h4>
                                <Badge variant={SOURCE_BADGE[skill.source || "project"]}>
                                  {SOURCE_LABELS[skill.source || "project"]}
                                </Badge>
                                <Badge variant="outline">{CATEGORY_LABELS[skill.metadata.category]}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{skill.metadata.description}</p>
                              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                <span>v{skill.metadata.version}</span>
                                <span>{skill.roleBindings.map((r) => ROLE_LABELS[r]).join(", ") || "No roles"}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <IconButton variant="ghost" size="sm" onClick={() => exportSkill(skill)} title="Export">
                                <Download className="w-3.5 h-3.5" />
                              </IconButton>
                              <IconButton variant="ghost" size="sm" onClick={() => openEdit(skill)} title="Edit">
                                <Edit className="w-3.5 h-3.5" />
                              </IconButton>
                              <IconButton variant="ghost" size="sm" onClick={() => openDelete(skill.metadata.id)} title="Delete">
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                              </IconButton>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* MARKETPLACE TAB */}
          <TabsContent value="marketplace" className="flex-1 flex flex-col overflow-hidden">
            <div className="mb-4">
              <Input
                placeholder="Search marketplace..."
                value={filter.query}
                onChange={(e) => setFilter((p) => ({ ...p, query: e.target.value }))}
                className="max-w-xs"
                iconLeft={<Search className="w-4 h-4 text-muted-foreground" />}
              />
            </div>
            <ScrollArea className="flex-1">
              <div className="text-center text-muted-foreground py-12">
                <ExternalLink className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Marketplace coming soon</p>
                <p className="text-sm">Browse and install community skills</p>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* TEMPLATES TAB */}
          <TabsContent value="templates" className="flex-1 flex flex-col overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="text-center text-muted-foreground py-12">
                <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Skill Templates</p>
                <p className="text-sm">Start from a template to create new skills faster</p>
                <Button variant="outline" className="mt-4" onClick={openCreate}>
                  <Plus className="w-3.5 h-3.5 mr-2" />
                  Create from Scratch
                </Button>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* BINDINGS TAB */}
          <TabsContent value="bindings" className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t("settings.skills.bindings.title")}</h3>
              <Button size="sm" onClick={openBind} className="gap-1">
                <Plus className="w-3.5 h-3.5" />
                {t("settings.skills.bindings.bind")}
              </Button>
            </div>
            <ScrollArea className="flex-1">
              {bindings.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Link2 className="w-12 h-12 mb-4 opacity-50" />
                  <p>No skill bindings yet. Bind skills to agent roles per project.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {bindings.map((binding) => (
                    <Card key={`${binding.projectId}-${binding.agentRole}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base capitalize">{ROLE_LABELS[binding.agentRole]}</CardTitle>
                            <p className="text-sm text-muted-foreground">{binding.projectId}</p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {binding.skillIds.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No skills bound to this role</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {binding.skillIds.map((skillId) => {
                              const skill = skills.find((s) => s.metadata.id === skillId);
                              return (
                                <Badge key={skillId} variant="outline" className="gap-1">
                                  {skill?.metadata.name || skillId}
                                  <IconButton
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 w-5 p-0"
                                    onClick={() => handleUnbind(binding.agentRole, skillId)}
                                  >
                                    <X className="w-3 h-3" />
                                  </IconButton>
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>

    {/* CREATE/EDIT DIALOG */}
    <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
      <Dialog.Content className="max-w-3xl max-h-[90vh] overflow-auto">
        <Dialog.Header>
          <Dialog.Title>{isEditing ? "Edit Skill" : "Create Skill"}</Dialog.Title>
          <Dialog.Description>
            {isEditing
              ? "Modify the skill definition. Changes apply to all bound agents."
              : "Define a new skill for AI agents with instructions, tool preferences, and conventions."}
          </Dialog.Description>
        </Dialog.Header>
        <ScrollArea className="mt-4 space-y-6 pr-2">
          {/* Metadata */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Package className="w-4 h-4" /> Metadata</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>{t("settings.skills.name")}</Label>
                  <Input value={form.metadata?.name || ""} onChange={(e) => handleInputChange("metadata.name", e.target.value)} placeholder="my-skill" />
                </div>
                <div>
                  <Label>{t("settings.skills.category")}</Label>
                  <Select value={form.metadata?.category || "frontend"} onValueChange={(v) => handleInputChange("metadata.category", v)}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      {CATEGORIES.map((c) => (
                        <Select.Item key={c} value={c}>{CATEGORY_LABELS[c]}</Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
                <div>
                  <Label>Version</Label>
                  <Input value={form.metadata?.version || "1.0.0"} onChange={(e) => handleInputChange("metadata.version", e.target.value)} />
                </div>
                <div>
                  <Label>{t("settings.skills.source")}</Label>
                  <Select value={form.source || "project"} onValueChange={(v) => handleInputChange("source", v)}>
                    <Select.Trigger><Select.Value /></Select.Trigger>
                    <Select.Content>
                      <Select.Item value="project">Project</Select.Item>
                      <Select.Item value="user">User</Select.Item>
                      <Select.Item value="imported">Imported</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>{t("settings.skills.description")}</Label>
                  <Textarea value={form.metadata?.description || ""} onChange={(e) => handleInputChange("metadata.description", e.target.value)} rows={2} />
                </div>
                <div>
                  <Label>{t("settings.skills.extends")}</Label>
                  <Input value={form.extends || ""} onChange={(e) => handleInputChange("extends", e.target.value)} placeholder="parent-skill-id" />
                </div>
                <div>
                  <Label>Tags (comma-separated)</Label>
                  <Input
                    value={form.metadata?.tags?.join(", ") || ""}
                    onChange={(e) => handleInputChange("metadata.tags", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                    placeholder="react, typescript, testing"
                  />
                </div>
                <div>
                  <Label>Dependencies (comma-separated skill IDs)</Label>
                  <Input
                    value={form.metadata?.dependencies?.join(", ") || ""}
                    onChange={(e) => handleInputChange("metadata.dependencies", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                    placeholder="other-skill-id, another-skill"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Instructions */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> Instructions</CardTitle></CardHeader>
            <CardContent>
              <Label className="block mb-2">{t("settings.skills.instructions")}</Label>
              <Textarea
                value={form.instructions || ""}
                onChange={(e) => handleInputChange("instructions", e.target.value)}
                rows={6}
                placeholder={t("settings.skills.instructionsPlaceholder")}
                className="font-mono text-sm"
              />
            </CardContent>
          </Card>

          {/* Tool Preferences */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Settings className="w-4 h-4" /> Tool Preferences</CardTitle>
              <Button variant="outline" size="sm" onClick={() => addArrayItem("toolPreferences", { name: "", priority: "preferred", reason: "" })} className="gap-1">
                <Plus className="w-3.5 h-3.5" />
                {t("settings.skills.toolPreferences.add")}
              </Button>
            </CardHeader>
            <CardContent>
              {(form.toolPreferences || []).map((tp, idx) => (
                <div key={idx} className="flex items-center gap-2 p-3 border rounded-lg mb-2">
                  <Input
                    placeholder={t("settings.skills.toolPreferences.name")}
                    value={tp.name}
                    onChange={(e) => {
                      const arr = [...(form.toolPreferences || [])];
                      arr[idx] = { ...arr[idx], name: e.target.value };
                      setForm({ ...form, toolPreferences: arr });
                    }}
                    className="flex-1"
                  />
                  <Select value={tp.priority} onValueChange={(v) => {
                    const arr = [...(form.toolPreferences || [])];
                    arr[idx] = { ...arr[idx], priority: v };
                    setForm({ ...form, toolPreferences: arr });
                  }}>
                    <Select.Trigger className="w-32"><Select.Value /></Select.Trigger>
                    <Select.Content>
                      {PRIORITIES.map((p) => (
                        <Select.Item key={p} value={p}>{PRIORITY_LABELS[p]}</Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                  <Input
                    placeholder={t("settings.skills.toolPreferences.reason")}
                    value={tp.reason || ""}
                    onChange={(e) => {
                      const arr = [...(form.toolPreferences || [])];
                      arr[idx] = { ...arr[idx], reason: e.target.value };
                      setForm({ ...form, toolPreferences: arr });
                    }}
                    className="flex-1"
                  />
                  <IconButton variant="ghost" size="sm" onClick={() => removeArrayItem("toolPreferences", idx)}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </IconButton>
                </div>
              ))}
              {(form.toolPreferences || []).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No tool preferences defined</p>
              )}
            </CardContent>
          </Card>

          {/* Verification Rules */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Check className="w-4 h-4" /> Verification Rules</CardTitle>
              <Button variant="outline" size="sm" onClick={() => addArrayItem("verificationRules", { name: "", description: "", check: "always", autoFix: false, fixPrompt: "" })} className="gap-1">
                <Plus className="w-3.5 h-3.5" />
                {t("settings.skills.verificationRules.add")}
              </Button>
            </CardHeader>
            <CardContent>
              {(form.verificationRules || []).map((vr, idx) => (
                <div key={idx} className="space-y-2 p-3 border rounded-lg mb-2">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={t("settings.skills.verificationRules.name")}
                      value={vr.name}
                      onChange={(e) => {
                        const arr = [...(form.verificationRules || [])];
                        arr[idx] = { ...arr[idx], name: e.target.value };
                        setForm({ ...form, verificationRules: arr });
                      }}
                      className="flex-1"
                    />
                    <IconButton variant="ghost" size="sm" onClick={() => removeArrayItem("verificationRules", idx)}>
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </IconButton>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Textarea
                      placeholder={t("settings.skills.verificationRules.description")}
                      value={vr.description}
                      onChange={(e) => {
                        const arr = [...(form.verificationRules || [])];
                        arr[idx] = { ...arr[idx], description: e.target.value };
                        setForm({ ...form, verificationRules: arr });
                      }}
                      rows={2}
                      className="md:col-span-2"
                    />
                    <Select value={vr.check} onValueChange={(v) => {
                      const arr = [...(form.verificationRules || [])];
                      arr[idx] = { ...arr[idx], check: v };
                      setForm({ ...form, verificationRules: arr });
                    }}>
                      <Select.Trigger><Select.Value /></Select.Trigger>
                      <Select.Content>
                        {CHECKS.map((c) => (
                          <Select.Item key={c} value={c}>{CHECK_LABELS[c]}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4">
                    <Label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={vr.autoFix}
                        onChange={(e) => {
                          const arr = [...(form.verificationRules || [])];
                          arr[idx] = { ...arr[idx], autoFix: e.target.checked };
                          setForm({ ...form, verificationRules: arr });
                        }}
                      />
                      {t("settings.skills.verificationRules.autoFix")}
                    </Label>
                    {vr.autoFix && (
                      <Input
                        placeholder={t("settings.skills.verificationRules.fixPrompt")}
                        value={vr.fixPrompt || ""}
                        onChange={(e) => {
                          const arr = [...(form.verificationRules || [])];
                          arr[idx] = { ...arr[idx], fixPrompt: e.target.value };
                          setForm({ ...form, verificationRules: arr });
                        }}
                        className="flex-1"
                      />
                    )}
                  </div>
                </div>
              ))}
              {(form.verificationRules || []).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No verification rules defined</p>
              )}
            </CardContent>
          </Card>

          {/* Conventions */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> Conventions</CardTitle>
              <Button variant="outline" size="sm" onClick={() => addArrayItem("conventions", { name: "", description: "", pattern: "", severity: "warning" })} className="gap-1">
                <Plus className="w-3.5 h-3.5" />
                {t("settings.skills.conventions.add")}
              </Button>
            </CardHeader>
            <CardContent>
              {(form.conventions || []).map((cv, idx) => (
                <div key={idx} className="space-y-2 p-3 border rounded-lg mb-2">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={t("settings.skills.conventions.name")}
                      value={cv.name}
                      onChange={(e) => {
                        const arr = [...(form.conventions || [])];
                        arr[idx] = { ...arr[idx], name: e.target.value };
                        setForm({ ...form, conventions: arr });
                      }}
                      className="flex-1"
                    />
                    <IconButton variant="ghost" size="sm" onClick={() => removeArrayItem("conventions", idx)}>
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </IconButton>
                  </div>
                  <Textarea
                    placeholder={t("settings.skills.conventions.description")}
                    value={cv.description}
                    onChange={(e) => {
                      const arr = [...(form.conventions || [])];
                      arr[idx] = { ...arr[idx], description: e.target.value };
                      setForm({ ...form, conventions: arr });
                    }}
                    rows={2}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input
                      placeholder={t("settings.skills.conventions.pattern")}
                      value={cv.pattern || ""}
                      onChange={(e) => {
                        const arr = [...(form.conventions || [])];
                        arr[idx] = { ...arr[idx], pattern: e.target.value };
                        setForm({ ...form, conventions: arr });
                      }}
                      className="md:col-span-2"
                    />
                    <Select value={cv.severity} onValueChange={(v) => {
                      const arr = [...(form.conventions || [])];
                      arr[idx] = { ...arr[idx], severity: v };
                      setForm({ ...form, conventions: arr });
                    }}>
                      <Select.Trigger><Select.Value /></Select.Trigger>
                      <Select.Content>
                        {SEVERITIES.map((s) => (
                          <Select.Item key={s} value={s}>{SEVERITY_LABELS[s]}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>
                </div>
              ))}
              {(form.conventions || []).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No conventions defined</p>
              )}
            </CardContent>
          </Card>

          {/* Environment */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="w-4 h-4" /> Environment</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t("settings.skills.environment.requiredTools")} (comma-separated)</Label>
                <Input
                  value={form.environment?.requiredTools?.join(", ") || ""}
                  onChange={(e) => handleInputChange("environment.requiredTools", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                  placeholder="eslint, prettier, tsc"
                />
              </div>
              <div>
                <Label>{t("settings.skills.environment.requiredPackages")} (comma-separated)</Label>
                <Input
                  value={form.environment?.requiredPackages?.join(", ") || ""}
                  onChange={(e) => handleInputChange("environment.requiredPackages", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                  placeholder="@types/node, zod"
                />
              </div>
              <div>
                <Label>{t("settings.skills.environment.setupCommands")} (one per line)</Label>
                <Textarea
                  value={form.environment?.setupCommands?.join("\n") || ""}
                  onChange={(e) => handleInputChange("environment.setupCommands", e.target.value.split("\n").filter(Boolean))}
                  rows={3}
                  placeholder="npm install\nnpx prisma generate"
                />
              </div>
            </CardContent>
          </Card>

          {/* Role Bindings */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-4 h-4" /> Agent Role Bindings</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((role) => (
                  <Label key={role} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(form.roleBindings || []).includes(role)}
                      onChange={(e) => {
                        const arr = form.roleBindings || [];
                        if (e.target.checked) setForm({ ...form, roleBindings: [...arr, role] });
                        else setForm({ ...form, roleBindings: arr.filter((r) => r !== role) });
                      }}
                    />
                    {ROLE_LABELS[role]}
                  </Label>
                ))}
              </div>
            </CardContent>
          </Card>
        </ScrollArea>
        <Dialog.Footer className="flex justify-between">
          <Button variant="outline" onClick={() => { setCreateDialogOpen(false); setEditSkillId(null); }}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="gap-1">
            <Plus className="w-3.5 h-3.5" />
            {isEditing ? "Save Changes" : "Create Skill"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>

    {/* DELETE CONFIRM */}
    <AlertDialog open={!!deleteSkillId} onOpenChange={() => setDeleteSkillId(null)}>
      <AlertDialog.Content>
        <AlertDialog.Title>Delete Skill?</AlertDialog.Title>
        <AlertDialog.Description>
          {t("settings.skills.confirmDelete").replace("{name}", skills.find((s) => s.metadata.id === deleteSkillId)?.metadata.name || "this skill")}
        </AlertDialog.Description>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action onClick={handleDelete}>Delete</AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog>

    {/* BIND DIALOG */}
    <Dialog open={bindDialogOpen} onOpenChange={setBindDialogOpen}>
      <Dialog.Content className="max-w-md">
        <Dialog.Header>
          <Dialog.Title>{t("settings.skills.bindings.bind")}</Dialog.Title>
        </Dialog.Header>
        <div className="space-y-4 py-4">
          <div>
            <Label>{t("settings.skills.bindings.agentRole")}</Label>
            <Select value={form.roleBindings?.[0] || "coder"} onValueChange={(v) => setForm({ ...form, roleBindings: [v] })}>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Content>
                {ROLES.map((r) => (
                  <Select.Item key={r} value={r}>{ROLE_LABELS[r]}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div>
            <Label>{t("settings.skills.bindings.skillId")}</Label>
            <Select value={form.metadata?.id || ""} onValueChange={(v) => setForm({ ...form, metadata: { ...form.metadata, id: v } })}>
              <Select.Trigger><Select.Value placeholder="Select skill" /></Select.Trigger>
              <Select.Content>
                {skills.filter((s) => s.source !== "builtin").map((s) => (
                  <Select.Item key={s.metadata.id} value={s.metadata.id}>{s.metadata.name}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        </div>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => setBindDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => handleBind(form.metadata?.id || "", form.roleBindings?.[0] || "coder")} className="gap-1">
            <Link2 className="w-3.5 h-3.5" />
            Bind
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>

    {/* INSTALL DIALOG */}
    <Dialog open={installDialogOpen} onOpenChange={() => { setInstallDialogOpen(false); setSelectedMarketplaceSkill(null); }}>
      <Dialog.Content className="max-w-md">
        <Dialog.Header>
          <Dialog.Title>Install Skill</Dialog.Title>
          <Dialog.Description>Install "{selectedMarketplaceSkill?.metadata.name}" to your project?</Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => { setInstallDialogOpen(false); setSelectedMarketplaceSkill(null); }}>Cancel</Button>
          <Button onClick={handleInstall} className="gap-1">
            <Download className="w-3.5 h-3.5" />
            Install
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>

    {/* IMPORT FILE INPUT (hidden) */}
    <input
      type="file"
      accept=".json"
      style={{ display: "none" }}
      id="skill-import-file"
      onChange={handleImport}
    />
    </>
  );
};

export default SkillsSettingsPanel;