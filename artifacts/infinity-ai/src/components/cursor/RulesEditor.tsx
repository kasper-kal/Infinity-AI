import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Textarea,
  Select,
  Switch,
  Tabs,
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  Badge,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ScrollArea,
  Separator,
  Label,
  Checkbox,
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  ToastDescription,
  ToastAction,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton
} from "@/components/ui";
import {
  PlusIcon,
  EditIcon,
  TrashIcon,
  CopyIcon,
  FileTextIcon,
  TagIcon,
  GlobeIcon,
  FolderIcon,
  StarIcon,
  SearchIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  Loader2Icon
} from "lucide-react";
import { api } from "@/lib/api";

interface Rule {
  path: string;
  relativePath: string;
  frontmatter: {
    name: string;
    description?: string;
    kind: "always" | "auto-attached" | "agent-requested";
    scope: "user" | "project" | "task";
    globs: string[];
    tags: string[];
    priority: number;
    enabled: boolean;
    content: string;
  };
  body: string;
  valid: boolean;
  errors: string[];
}

interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  frontmatter: {
    kind: "always" | "auto-attached" | "agent-requested";
    globs: string[];
    tags: string[];
  };
}

interface RulesEditorProps {
  projectRoot: string;
  onRulesChange?: () => void;
}

export function RulesEditor({ projectRoot, onRulesChange }: RulesEditorProps) {
  const { t } = useTranslation();
  const [userRules, setUserRules] = useState<Rule[]>([]);
  const [projectRules, setProjectRules] = useState<Rule[]>([]);
  const [autoAttachedRules, setAutoAttachedRules] = useState<Rule[]>([]);
  const [alwaysRules, setAlwaysRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"user" | "project" | "templates">("project");
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createFromTemplate, setCreateFromTemplate] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    kind: "always" as "always" | "auto-attached" | "agent-requested",
    globs: "" as string,
    tags: "" as string,
    priority: 0,
    enabled: true,
    content: ""
  });
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/customization/rules", { params: { projectRoot } });
      setUserRules(response.data.userRules || []);
      setProjectRules(response.data.projectRules || []);
      setAutoAttachedRules(response.data.autoAttachedRules || []);
      setAlwaysRules(response.data.alwaysRules || []);
    } catch (error) {
      console.error("Failed to load rules:", error);
      setToast({ message: t("settings.rules.loadError"), type: "error" });
    } finally {
      setLoading(false);
    }
  }, [projectRoot, t]);

  const fetchTemplates = useCallback(async () => {
    try {
      const response = await api.get("/customization/rules/templates");
      setTemplates(response.data.templates || []);
    } catch (error) {
      console.error("Failed to load templates:", error);
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchTemplates();
  }, [fetchRules, fetchTemplates]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingRule) {
        await api.patch(`/customization/rules/${editingRule.relativePath}`, {
          projectRoot,
          ...formData,
          globs: formData.globs.split("\n").filter(g => g.trim()),
          tags: formData.tags.split(",").map(t => t.trim()).filter(t => t),
          content: formData.content
        });
        setToast({ message: t("settings.rules.updated"), type: "success" });
      } else {
        await api.post("/customization/rules", {
          projectRoot,
          ...formData,
          globs: formData.globs.split("\n").filter(g => g.trim()),
          tags: formData.tags.split(",").map(t => t.trim()).filter(t => t)
        });
        setToast({ message: t("settings.rules.created"), type: "success" });
      }
      setEditingRule(null);
      setShowCreateDialog(false);
      setCreateFromTemplate(null);
      resetForm();
      fetchRules();
      onRulesChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.rules.saveError"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    setSaving(true);
    try {
      await api.post("/customization/rules/from-template", {
        projectRoot,
        templateId
      });
      setToast({ message: t("settings.rules.createdFromTemplate"), type: "success" });
      fetchRules();
      onRulesChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.rules.templateError"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (rule: Rule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.frontmatter.name,
      description: rule.frontmatter.description || "",
      kind: rule.frontmatter.kind,
      globs: rule.frontmatter.globs.join("\n"),
      tags: rule.frontmatter.tags.join(", "),
      priority: rule.frontmatter.priority,
      enabled: rule.frontmatter.enabled,
      content: rule.body
    });
    setShowCreateDialog(true);
  };

  const handleDelete = async (rule: Rule) => {
    if (!confirm(t("settings.rules.confirmDelete", { name: rule.frontmatter.name }))) return;
    try {
      await api.delete(`/customization/rules/${rule.relativePath}`, {
        params: { projectRoot, scope: rule.frontmatter.scope }
      });
      setToast({ message: t("settings.rules.deleted"), type: "success" });
      fetchRules();
      onRulesChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.rules.deleteError"), type: "error" });
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      kind: "always",
      globs: "",
      tags: "",
      priority: 0,
      enabled: true,
      content: ""
    });
  };

  const handleNewRule = () => {
    resetForm();
    setEditingRule(null);
    setShowCreateDialog(true);
  };

  const getRulesForTab = () => {
    switch (activeTab) {
      case "user": return userRules;
      case "project": return projectRules;
      default: return [];
    }
  };

  const getKindBadge = (kind: string) => {
    const variants = {
      "always": "default",
      "auto-attached": "secondary",
      "agent-requested": "outline"
    } as const;
    return (
      <Badge variant={variants[kind as keyof typeof variants] || "outline"}>
        {t(`settings.rules.kinds.${kind}`)}
      </Badge>
    );
  };

  const getScopeBadge = (scope: string) => {
    const icons = { user: GlobeIcon, project: FolderIcon, task: FileTextIcon };
    const Icon = icons[scope as keyof typeof icons] || FolderIcon;
    return (
      <Badge variant="outline" className="gap-1">
        <Icon className="h-3 w-3" />
        {t(`settings.rules.scopes.${scope}`)}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="h-full flex items-center justify-center">
          <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <ToastProvider>
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">{t("settings.rules.title")}</CardTitle>
            <CardDescription>{t("settings.rules.description")}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleNewRule}>
              <PlusIcon className="h-4 w-4 mr-1" />
              {t("settings.rules.newRule")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("templates")}>
              <FileTextIcon className="h-4 w-4 mr-1" />
              {t("settings.rules.templates")}
            </Button>
          </div>
        </CardHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab as any} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-3 border-b">
            <TabsTrigger value="user">
              <GlobeIcon className="h-4 w-4 mr-1" />
              {t("settings.rules.tabs.user")} <Badge variant="outline">{userRules.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="project">
              <FolderIcon className="h-4 w-4 mr-1" />
              {t("settings.rules.tabs.project")} <Badge variant="outline">{projectRules.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="templates">
              <FileTextIcon className="h-4 w-4 mr-1" />
              {t("settings.rules.tabs.templates")} <Badge variant="outline">{templates.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1">
            <TabsContent value="user" className="p-4 space-y-3">
              {userRules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <GlobeIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>{t("settings.rules.empty.user")}</p>
                  <Button variant="link" size="sm" onClick={handleNewRule}>
                    {t("settings.rules.createFirst")}
                  </Button>
                </div>
              ) : (
                userRules.map(rule => (
                  <RuleCard
                    key={rule.path}
                    rule={rule}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    getKindBadge={getKindBadge}
                    getScopeBadge={getScopeBadge}
                    t={t}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="project" className="p-4 space-y-3">
              {projectRules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FolderIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>{t("settings.rules.empty.project")}</p>
                  <Button variant="link" size="sm" onClick={handleNewRule}>
                    {t("settings.rules.createFirst")}
                  </Button>
                </div>
              ) : (
                projectRules.map(rule => (
                  <RuleCard
                    key={rule.path}
                    rule={rule}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    getKindBadge={getKindBadge}
                    getScopeBadge={getScopeBadge}
                    t={t}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="templates" className="p-4 space-y-3">
              {templates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onCreate={handleCreateFromTemplate}
                  t={t}
                />
              ))}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        {/* Auto-attached & Always Rules Summary */}
        {(autoAttachedRules.length > 0 || alwaysRules.length > 0) && (
          <CardFooter className="border-t pt-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-medium mb-2">{t("settings.rules.alwaysActive")} ({alwaysRules.length})</h4>
                <div className="flex flex-wrap gap-1">
                  {alwaysRules.map(r => (
                    <Badge key={r.path} variant="default">{r.frontmatter.name}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="font-medium mb-2">{t("settings.rules.autoAttached")} ({autoAttachedRules.length})</h4>
                <div className="flex flex-wrap gap-1">
                  {autoAttachedRules.map(r => (
                    <Badge key={r.path} variant="secondary">{r.frontmatter.name}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardFooter>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>{editingRule ? t("settings.rules.editRule") : t("settings.rules.newRule")}</DialogTitle>
              <DialogDescription>{t("settings.rules.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("settings.rules.name")} *</Label>
                  <Input
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="my-coding-style"
                  />
                </div>
                <div>
                  <Label>{t("settings.rules.kind")} *</Label>
                  <Select value={formData.kind} onValueChange={v => setFormData({ ...formData, kind: v as any })}>
                    <Select.Option value="always">{t("settings.rules.kinds.always")}</Select.Option>
                    <Select.Option value="auto-attached">{t("settings.rules.kinds.autoAttached")}</Select.Option>
                    <Select.Option value="agent-requested">{t("settings.rules.kinds.agentRequested")}</Select.Option>
                  </Select>
                </div>
              </div>
              <div>
                <Label>{t("settings.rules.description")}</Label>
                <Input
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of this rule"
                />
              </div>
              <div>
                <Label>{t("settings.rules.globs")}</Label>
                <Textarea
                  value={formData.globs}
                  onChange={e => setFormData({ ...formData, globs: e.target.value })}
                  placeholder="src/**/*.ts&#10;**/*.test.ts&#10;package.json"
                  rows={3}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">{t("settings.rules.globsHint")}</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>{t("settings.rules.tags")}</Label>
                  <Input
                    value={formData.tags}
                    onChange={e => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="react, typescript, style"
                  />
                </div>
                <div>
                  <Label>{t("settings.rules.priority")}</Label>
                  <Input
                    type="number"
                    value={formData.priority}
                    onChange={e => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                    min={-100}
                    max={100}
                  />
                </div>
                <div className="flex items-end">
                  <Label className="flex items-center gap-2 w-full">
                    <Checkbox
                      checked={formData.enabled}
                      onCheckedChange={c => setFormData({ ...formData, enabled: c })}
                    />
                    {t("settings.rules.enabled")}
                  </Label>
                </div>
              </div>
              <div>
                <Label>{t("settings.rules.content")} *</Label>
                <Textarea
                  value={formData.content}
                  onChange={e => setFormData({ ...formData, content: e.target.value })}
                  placeholder="# Rule Content&#10;&#10;Write your rule in markdown..."
                  rows={15}
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving || !formData.name || !formData.content}>
                {saving ? <Loader2Icon className="h-4 w-4 animate-spin mr-2" /> : null}
                {editingRule ? t("common.save") : t("common.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ToastViewport className="bottom-4 right-4">
          {toast && (
            <Toast>
              <div className="grid gap-1">
                <ToastTitle className={toast.type === "error" ? "text-destructive" : ""}>
                  {toast.type === "success" ? "✓" : "✕"} {toast.message}
                </ToastTitle>
              </div>
            </Toast>
          )}
        </ToastViewport>
      </Card>
    </ToastProvider>
  );
}

function RuleCard({
  rule,
  onEdit,
  onDelete,
  getKindBadge,
  getScopeBadge,
  t
}: {
  rule: Rule;
  onEdit: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  getKindBadge: (kind: string) => React.ReactNode;
  getScopeBadge: (scope: string) => React.ReactNode;
  t: any;
}) {
  return (
    <Card className={rule.valid ? "" : "border-destructive/50"}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h4 className="font-medium truncate">{rule.frontmatter.name}</h4>
              {getKindBadge(rule.frontmatter.kind)}
              {getScopeBadge(rule.frontmatter.scope)}
              {rule.frontmatter.pinned && (
                <Tooltip content={t("settings.rules.pinned")}>
                  <StarIcon className="h-3 w-3 text-yellow-500 fill-current" />
                </Tooltip>
              )}
              {!rule.valid && (
                <Badge variant="destructive" className="text-xs">{t("settings.rules.invalid")}</Badge>
              )}
            </div>
            {rule.frontmatter.description && (
              <p className="text-sm text-muted-foreground truncate">{rule.frontmatter.description}</p>
            )}
            {rule.frontmatter.globs.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {rule.frontmatter.globs.map((g, i) => (
                  <Badge key={i} variant="outline" className="text-xs font-mono">{g}</Badge>
                ))}
              </div>
            )}
            {rule.frontmatter.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {rule.frontmatter.tags.map((tag, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    <TagIcon className="h-2.5 w-2.5 mr-1" />
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ChevronDownIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(rule)}>
                <EditIcon className="h-4 w-4 mr-2" />
                {t("common.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigator.clipboard.writeText(rule.body)}>
                <CopyIcon className="h-4 w-4 mr-2" />
                {t("common.copyContent")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onDelete(rule)} className="text-destructive focus:text-destructive">
                <TrashIcon className="h-4 w-4 mr-2" />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="pb-0">
        <div className="bg-muted/50 rounded p-3 max-h-40 overflow-auto font-mono text-sm">
          {rule.body || "<empty>"}
        </div>
        {rule.errors.length > 0 && (
          <div className="mt-2 p-2 bg-destructive/10 rounded text-destructive text-xs">
            {rule.errors.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateCard({
  template,
  onCreate,
  t
}: {
  template: RuleTemplate;
  onCreate: (id: string) => void;
  t: any;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-medium">{template.name}</h4>
            <p className="text-sm text-muted-foreground">{template.description}</p>
            <div className="mt-1 flex gap-1">
              <Badge variant="outline" className="text-xs">{template.category}</Badge>
              {template.frontmatter.tags.map((tag, i) => (
                <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
              ))}
            </div>
          </div>
          <Button size="sm" onClick={() => onCreate(template.id)}>
            <PlusIcon className="h-4 w-4 mr-1" />
            {t("settings.rules.useTemplate")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="bg-muted/50 rounded p-3 max-h-40 overflow-auto font-mono text-sm text-muted-foreground">
          {template.content.slice(0, 500)}...
        </div>
      </CardContent>
    </Card>
  );
}