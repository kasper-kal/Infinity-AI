"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Building2,
  Code,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Loader2,
  Smartphone,
  X,
} from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { getAllProjectTypes, getProjectTypeColor, getProjectTypeIcon, type ProjectType } from '@/lib/project-types';

interface ProjectCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, typeId: string, fromConversationId?: string) => void | Promise<void>;
  activeConversationId?: string | null;
}

const TYPE_ICONS: Record<string, typeof BookOpen> = {
  book: BookOpen,
  website: Globe,
  company: Building2,
  app: Smartphone,
  research: FlaskConical,
  course: GraduationCap,
  general: Folder,
};

export function ProjectCreateModal({
  isOpen,
  onClose,
  onCreate,
  activeConversationId,
}: ProjectCreateModalProps) {
  const { t } = useI18n();
  const [projectName, setProjectName] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectTypes = useMemo(() => getAllProjectTypes(), []);
  const selectedType = projectTypes.find(t => t.id === selectedTypeId);

  const handleClose = useCallback(() => {
    setProjectName('');
    setSelectedTypeId('general');
    setError(null);
    onClose();
  }, [onClose]);

  const handleCreate = useCallback(async () => {
    const name = projectName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name, selectedTypeId, activeConversationId ?? undefined);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setBusy(false);
    }
  }, [projectName, selectedTypeId, busy, activeConversationId, onCreate, handleClose]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleCreate();
    }
    if (event.key === 'Escape') {
      handleClose();
    }
  }, [handleCreate, handleClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={handleClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="liquid-glass w-full max-w-2xl rounded-3xl border border-border/50 overflow-hidden shadow-apple-xl"
          onClick={event => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-border/30 px-6 py-4">
            <h2 id="create-project-title" className="text-lg font-semibold text-foreground">
              {t('projectGallery.createProject')}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-full p-2 text-muted-foreground hover:bg-secondary/70 hover:text-foreground disabled:opacity-40 transition-colors"
              aria-label={t('common.close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Project Name Input */}
            <div className="space-y-2">
              <label htmlFor="project-name" className="block text-sm font-medium text-foreground">
                {t('projectGallery.newProjectPlaceholder')}
              </label>
              <input
                id="project-name"
                type="text"
                value={projectName}
                onChange={event => {
                  setProjectName(event.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder={t('projectGallery.newProjectPlaceholder')}
                autoFocus
                disabled={busy}
                className="w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                aria-describedby={error ? 'create-error' : undefined}
              />
              {error && (
                <p id="create-error" className="text-sm text-rose-500" role="alert">
                  {error}
                </p>
              )}
            </div>

            {/* Project Type Selector */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">
                {t('projectType.selectType')}
              </label>
              <p className="text-sm text-muted-foreground">{t('projectType.selectTypeDesc')}</p>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {projectTypes.map(type => {
                  const IconComponent = TYPE_ICONS[type.id] || Folder;
                  const isSelected = selectedTypeId === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setSelectedTypeId(type.id)}
                      disabled={busy}
                      className={`
                        group relative rounded-2xl border p-4 text-left transition-all duration-200
                        ${isSelected
                          ? 'border-primary/50 bg-primary/5 shadow-lg shadow-primary/10'
                          : 'border-border/40 bg-background/50 hover:border-primary/30 hover:bg-primary/5'
                        }
                        disabled:opacity-50
                      `}
                      aria-pressed={isSelected}
                    >
                      <div className="absolute -top-2 -right-2">
                        {isSelected && (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl text-2xl"
                          style={{ backgroundColor: `${type.color}20` }}>
                          <IconComponent className="h-5 w-5" style={{ color: type.color }} />
                        </span>
                      </div>
                      <div className="mt-3">
                        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                          {t(`projectType.${type.id}` as TranslationKey) || type.name}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {t(`projectType.${type.id}Desc` as TranslationKey) || type.description}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                        {type.tags.slice(0, 2).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-secondary/50">{tag}</span>
                        ))}
                        {type.tags.length > 2 && (
                          <span className="px-1.5 py-0.5 rounded bg-secondary/50">+{type.tags.length - 2}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected Type Summary */}
            {selectedType && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-xl border border-border/40 bg-background/50 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
                    style={{ backgroundColor: `${selectedType.color}20` }}>
                    {(() => {
                      const IconComponent = TYPE_ICONS[selectedType.id] || Folder;
                      return <IconComponent className="h-5 w-5" style={{ color: selectedType.color }} />;
                    })()}
                  </span>
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {t(`projectType.${selectedType.id}` as TranslationKey) || selectedType.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t(`projectType.${selectedType.id}Desc` as TranslationKey) || selectedType.description}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedType.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 rounded-full text-xs text-muted-foreground bg-secondary/50">
                      {tag}
                    </span>
                  ))}
                </div>
                {selectedType.components.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Available components
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedType.components.slice(0, 6).map(comp => (
                        <span key={comp} className="px-2 py-0.5 rounded text-xs text-muted-foreground bg-secondary/50">
                          {comp}
                        </span>
                      ))}
                      {selectedType.components.length > 6 && (
                        <span className="px-2 py-0.5 rounded text-xs text-muted-foreground bg-secondary/50">
                          +{selectedType.components.length - 6} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* Create from conversation option */}
            {activeConversationId && (
              <div className="rounded-xl border border-border/40 bg-primary/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">
                      {t('projectGallery.createFromConversation')}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t('projectGallery.createFromConversation')}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  The current chat will be moved into the new project automatically.
                </p>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="border-t border-border/30 px-6 py-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-lg border border-border/40 bg-background/50 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!projectName.trim() || busy}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.running')}
                </span>
              ) : (
                t('projectType.create')
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default ProjectCreateModal;