import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Textarea,
  Select,
  Tabs,
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ScrollArea,
  Separator,
  Label,
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  Popover,
  PopoverTrigger,
  PopoverContent
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
  PinIcon,
  PinOffIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  Link2Icon
} from "lucide-react";
import { api } from "@/lib/api";

interface Notepad {
  name: string;
  path: string;
  scope: "user" | "project";
  frontmatter: {
    title: string;
    description?: string;
    tags: string[];
    pinned: boolean;
    category?: string;
  };
  content: string;
  size: number;
  modified: string;
  modifiedRelative: string;
}

interface NotepadTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  frontmatter: {
    tags: string[];
    category?: string;
  };
}

interface NotepadManagerProps {
  projectRoot: string;
  onNotepadsChange?: () => void;
}

export function NotepadManager({ projectRoot, onNotepadsChange }: NotepadManagerProps) {
  const { t } = useTranslation();
  const [userNotepads, setUserNotepads] = useState<Notepad[]>([]);
  const [projectNotepads, setProjectNotepads] = useState<Notepad[]>([]);
  const [templates, setTemplates] = useState<NotepadTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"user" | "project" | "templates">("project");
  const [editingNotepad, setEditingNotepad] = useState<Notepad | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    title: "",
    description: "",
    tags: "" as string,
    category: "",
    pinned: false,
    content: ""
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [previewNotepad, setPreviewNotepad] = useState<Notepad | null>(null);

  const fetchNotepads = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/customization/notepads", { params: { projectRoot } });
      setUserNotepads(response.data.userNotepads || []);
      setProjectNotepads(response.data.projectNotepads || []);
    } catch (error) {
      console.error("Failed to load notepads:", error);
      setToast({ message: t("settings.notepads.loadError"), type: "error" });
    } finally {
      setLoading(false);
    }
  }, [projectRoot, t]);

  const fetchTemplates = useCallback(async () => {
    try {
      const response = await api.get("/customization/notepads/templates");
      setTemplates(response.data.templates || []);
    } catch (error) {
      console.error("Failed to load templates:", error);
    }
  }, []);

  useEffect(() => {
    fetchNotepads();
    fetchTemplates();
  }, [fetchNotepads, fetchTemplates]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingNotepad) {
        await api.patch(`/customization/notepads/${editingNotepad.name}`, {
          projectRoot,
          scope: editingNotepad.scope,
          title: formData.title,
          description: formData.description,
          tags: formData.tags.split(",").map(t => t.trim()).filter(t => t),
          category: formData.category || undefined,
          pinned: formData.pinned,
          content: formData.content
        });
        setToast({ message: t("settings.notepads.updated"), type: "success" });
      } else {
        await api.post("/customization/notepads", {
          projectRoot,
          name: formData.name,
          title: formData.title,
          description: formData.description,
          tags: formData.tags.split(",").map(t => t.trim()).filter(t => t),
          category: formData.category || undefined,
          pinned: formData.pinned,
          content: formData.content
        });
        setToast({ message: t("settings.notepads.created"), type: "success" });
      }
      setEditingNotepad(null);
      setShowCreateDialog(false);
      resetForm();
      fetchNotepads();
      onNotepadsChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.notepads.saveError"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    setSaving(true);
    try {
      await api.post("/customization/notepads/from-template", {
        projectRoot,
        templateId
      });
      setToast({ message: t("settings.notepads.createdFromTemplate"), type: "success" });
      fetchNotepads();
      onNotepadsChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.notepads.templateError"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (notepad: Notepad) => {
    setEditingNotepad(notepad);
    setFormData({
      name: notepad.name,
      title: notepad.frontmatter.title,
      description: notepad.frontmatter.description || "",
      tags: notepad.frontmatter.tags.join(", "),
      category: notepad.frontmatter.category || "",
      pinned: notepad.frontmatter.pinned,
      content: notepad.content
    });
    setShowCreateDialog(true);
  };

  const handleDelete = async (notepad: Notepad) => {
    if (!confirm(t("settings.notepads.confirmDelete", { name: notepad.frontmatter.title }))) return;
    try {
      await api.delete(`/customization/notepads/${notepad.name}`, {
        params: { projectRoot, scope: notepad.scope }
      });
      setToast({ message: t("settings.notepads.deleted"), type: "success" });
      fetchNotepads();
      onNotepadsChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.notepads.deleteError"), type: "error" });
    }
  };

  const handleTogglePin = async (notepad: Notepad) => {
    try {
      await api.patch(`/customization/notepads/${notepad.name}`, {
        projectRoot,
        scope: notepad.scope,
        pinned: !notepad.frontmatter.pinned
      });
      setToast({ message: notepad.frontmatter.pinned ? t("settings.notepads.unpinned") : t("settings.notepads.pinned"), type: "success" });
      fetchNotepads();
      onNotepadsChange?.();
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || t("settings.notepads.pinError"), type: "error" });
    }
  };

  const handleCopyReference = (notepad: Notepad) => {
    const ref = `@notepad:${notepad.name}`;
    navigator.clipboard.writeText(ref);
    setToast({ message: t("settings.notepads.copiedRef", { ref }), type: "success" });
  };

  const resetForm = () => {
    setFormData({
      name: "",
      title: "",
      description: "",
      tags: "",
      category: "",
      pinned: false,
      content: ""
    });
  };

  const handleNewNotepad = () => {
    resetForm();
    setEditingNotepad(null);
    setShowCreateDialog(true);
  };

  const getNotepadsForTab = () => {
    const notepads = activeTab === "user" ? userNotepads : projectNotepads;
    if (!searchQuery) return notepads;
    const query = searchQuery.toLowerCase();
    return notepads.filter(n =>
      n.frontmatter.title.toLowerCase().includes(query) ||
      n.frontmatter.description?.toLowerCase().includes(query) ||
      n.frontmatter.tags.some(t => t.toLowerCase().includes(query)) ||
      n.content.toLowerCase().includes(query)
    );
  };

  const getFilteredTemplates = () => {
    if (!searchQuery) return templates;
    const query = searchQuery.toLowerCase();
    return templates.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query) ||
      t.category.toLowerCase().includes(query) ||
      t.frontmatter.tags.some(tag => tag.toLowerCase().includes(query))
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
            <CardTitle className="text-lg">{t("settings.notepads.title")}</CardTitle>
            <CardDescription>{t("settings.notepads.description")}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleNewNotepad}>
              <PlusIcon className="h-4 w-4 mr-1" />
              {t("settings.notepads.newNotepad")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("templates")}>
              <FileTextIcon className="h-4 w-4 mr-1" />
              {t("settings.notepads.templates")}
            </Button>
          </div>
        </CardHeader>

        <div className="flex-1 flex flex-col">
          {/* Search */}
          <div className="p-4 border-b">
            <div className="relative max-w-md">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("settings.notepads.searchPlaceholder")}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab as any} className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-3 border-b">
              <TabsTrigger value="user">
                <GlobeIcon className="h-4 w-4 mr-1" />
                {t("settings.notepads.tabs.user")} <Badge variant="outline">{userNotepads.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="project">
                <FolderIcon className="h-4 w-4 mr-1" />
                {t("settings.notepads.tabs.project")} <Badge variant="outline">{projectNotepads.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="templates">
                <FileTextIcon className="h-4 w-4 mr-1" />
                {t("settings.notepads.tabs.templates")} <Badge variant="outline">{templates.length}</Badge>
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1">
              <TabsContent value="user" className="p-4 space-y-3">
                {getNotepadsForTab().length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <GlobeIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{userNotepads.length === 0 ? t("settings.notepads.empty.user") : t("settings.notepads.noResults")}</p>
                    {userNotepads.length === 0 && (
                      <Button variant="link" size="sm" onClick={handleNewNotepad} className="mt-2">
                        {t("settings.notepads.createFirst")}
                      </Button>
                    )}
                  </div>
                ) : (
                  getNotepadsForTab().map(notepad => (
                    <NotepadCard
                      key={notepad.path}
                      notepad={notepad}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onTogglePin={handleTogglePin}
                      onCopyReference={handleCopyReference}
                      onPreview={setPreviewNotepad}
                      t={t}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="project" className="p-4 space-y-3">
                {getNotepadsForTab().length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FolderIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{projectNotepads.length === 0 ? t("settings.notepads.empty.project") : t("settings.notepads.noResults")}</p>
                    {projectNotepads.length === 0 && (
                      <Button variant="link" size="sm" onClick={handleNewNotepad} className="mt-2">
                        {t("settings.notepads.createFirst")}
                      </Button>
                    )}
                  </div>
                ) : (
                  getNotepadsForTab().map(notepad => (
                    <NotepadCard
                      key={notepad.path}
                      notepad={notepad}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onTogglePin={handleTogglePin}
                      onCopyReference={handleCopyReference}
                      onPreview={setPreviewNotepad}
                      t={t}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="templates" className="p-4 space-y-3">
                {getFilteredTemplates().map(template => (
                  <NotepadTemplateCard
                    key={template.id}
                    template={template}
                    onCreate={handleCreateFromTemplate}
                    t={t}
                  />
                ))}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>

        {/* Create/Edit Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>{editingNotepad ? t("settings.notepads.editNotepad") : t("settings.notepads.newNotepad")}</DialogTitle>
              <DialogDescription>{t("settings.notepads.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {!editingNotepad && (
                <div>
                  <Label>{t("settings.notepads.name")} *</Label>
                  <Input
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "") })}
                    placeholder="my-notepad"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{t("settings.notepads.nameHint")}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("settings.notepads.title")} *</Label>
                  <Input
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                    placeholder="My Notepad"
                  />
                </div>
                <div>
                  <Label>{t("settings.notepads.category")}</Label>
                  <Input
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    placeholder="coding, docs, research"
                  />
                </div>
              </div>
              <div>
                <Label>{t("settings.notepads.description")}</Label>
                <Input
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>{t("settings.notepads.tags")}</Label>
                  <Input
                    value={formData.tags}
                    onChange={e => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="react, typescript, api"
                  />
                </div>
                <div className="flex items-end">
                  <Label className="flex items-center gap-2 w-full">
                    <input
                      type="checkbox"
                      checked={formData.pinned}
                      onChange={e => setFormData({ ...formData, pinned: e.target.checked })}
                      className="rounded border-input"
                    />
                    <span className="text-sm">{t("settings.notepads.pinned")}</span>
                  </Label>
                </div>
              </div>
              <div>
                <Label>{t("settings.notepads.content")} *</Label>
                <Textarea
                  value={formData.content}
                  onChange={e => setFormData({ ...formData, content: e.target.value })}
                  placeholder="# Notepad Content&#10;&#10;Write your notes in markdown..."
                  rows={15}
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving || (!editingNotepad && !formData.name) || !formData.title || !formData.content}>
                {saving ? <Loader2Icon className="h-4 w-4 animate-spin mr-2" /> : null}
                {editingNotepad ? t("common.save") : t("common.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Preview Popover */}
        {previewNotepad && (
          <Popover open={!!previewNotepad} onOpenChange={open => !open && setPreviewNotepad(null)}>
            <PopoverTrigger asChild>
              <span></span>
            </PopoverTrigger>
            <PopoverContent className="max-w-2xl max-h-96" align="center" sideOffset={10}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h4 className="font-medium">{previewNotepad.frontmatter.title}</h4>
                  <p className="text-sm text-muted-foreground">
                    @notepad:{previewNotepad.name} · {previewNotepad.modifiedRelative}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setPreviewNotepad(null)}>
                  <EyeOffIcon className="h-4 w-4" />
                </Button>
              </div>
              <ScrollArea className="max-h-[60vh]">
                <div className="prose prose-sm max-w-none p-3 bg-muted/50 rounded">
                  {previewNotepad.content}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        )}

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
    );
  }
}

function NotepadCard({
  notepad,
  onEdit,
  onDelete,
  onTogglePin,
  onCopyReference,
  onPreview,
  t
}: {
  notepad: Notepad;
  onEdit: (notepad: Notepad) => void;
  onDelete: (notepad: Notepad) => void;
  onTogglePin: (notepad: Notepad) => void;
  onCopyReference: (notepad: Notepad) => void;
  onPreview: (notepad: Notepad) => void;
  t: any;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h4 className="font-medium truncate">{notepad.frontmatter.title}</h4>
              {notepad.frontmatter.pinned && (
                <Tooltip content={t("settings.notepads.pinned")}>
                  <PinIcon className="h-3 w-3 text-yellow-500" />
                </Tooltip>
              )}
              <Badge variant="outline" className="text-xs font-mono">
                @notepad:{notepad.name}
              </Badge>
              <Badge variant={notepad.scope === "user" ? "default" : "secondary"} className="text-xs">
                {notepad.scope === "user" ? t("settings.notepads.scopes.user") : t("settings.notepads.scopes.project")}
              </Badge>
              {notepad.frontmatter.category && (
                <Badge variant="outline" className="text-xs">
                  <TagIcon className="h-2.5 w-2.5 mr-1" />
                  {notepad.frontmatter.category}
                </Badge>
              )}
            </div>
            {notepad.frontmatter.description && (
              <p className="text-sm text-muted-foreground truncate">{notepad.frontmatter.description}</p>
            )}
            {notepad.frontmatter.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {notepad.frontmatter.tags.map((tag, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.notepads.size", { size: formatBytes(notepad.size) })} · {notepad.modifiedRelative}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ChevronDownIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onPreview(notepad)}>
                <EyeIcon className="h-4 w-4 mr-2" />
                {t("settings.notepads.preview")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(notepad)}>
                <EditIcon className="h-4 w-4 mr-2" />
                {t("common.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyReference(notepad)}>
                <CopyIcon className="h-4 w-4 mr-2" />
                {t("settings.notepads.copyRef")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onTogglePin(notepad)}>
                {notepad.frontmatter.pinned ? (
                  <>
                    <PinOffIcon className="h-4 w-4 mr-2" />
                    {t("settings.notepads.unpin")}
                  </>
                ) : (
                  <>
                    <PinIcon className="h-4 w-4 mr-2" />
                    {t("settings.notepads.pin")}
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onDelete(notepad)} className="text-destructive focus:text-destructive">
                <TrashIcon className="h-4 w-4 mr-2" />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="pb-0">
        <div className="bg-muted/50 rounded p-3 max-h-40 overflow-auto font-mono text-sm text-muted-foreground">
          {notepad.content.slice(0, 500)}...
        </div>
      </CardContent>
    </Card>
  );
}

function NotepadTemplateCard({
  template,
  onCreate,
  t
}: {
  template: NotepadTemplate;
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
            {t("settings.notepads.useTemplate")}
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      className="relative"
    >
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg whitespace-nowrap z-50">
          {content}
        </div>
      )}
    </span>
  );
}