import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Paperclip, Camera, Sparkles, ImageIcon, LayoutGrid, Palette, Music2, FileCode } from 'lucide-react';

export type PlusAction =
  | 'attach-file' | 'camera' | 'new-expert' | 'generate-image'
  | 'studios' | 'design-studio' | 'music-studio'
  | 'thinking' | 'agent-mode' | 'web-search' | 'screen-share'
  | 'build-mode' | 'research' | 'data-lab'
  | 'create-artifact';

/**
 * Viewport-relative {top,left} for the plus menu, anchored to the "+" button.
 * The menu opens upward (right edge aligned to the button) when there's room,
 * otherwise flips below. Portal + fixed positioning means these coordinates
 * are always viewport-relative regardless of transformed ancestors.
 */
export function getPlusMenuCoords(anchor: HTMLElement): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect();
  const MENU_W = 224;
  const isCompactHeight = window.innerHeight <= 700;
  const MENU_H = isCompactHeight ? 220 : 380;
  const left = Math.max(8, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8));
  const composerRect = anchor.closest('[data-chat-composer]')?.getBoundingClientRect();
  const anchorBottom = composerRect?.top ?? rect.top;
  const roomAbove = anchorBottom - 8;
  const top = isCompactHeight
    ? Math.max(8, anchorBottom - MENU_H - 8)
    : roomAbove >= MENU_H
      ? rect.top - MENU_H + 8
      : Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - MENU_H - 8));
  return { top, left };
}

interface PlusMenuProps {
  open: boolean;
  onClose: () => void;
  onAction: (action: PlusAction) => void;
  coords: { top: number; left: number } | null;
  /** Optional controlled text after @ in the composer. */
  query?: string;
  labels: {
    attachFile: string;
    camera: string;
    newExpert: string;
    generateImage: string;
    createArtifact?: string;
    thinking?: string;
    agentMode?: string;
    webSearch?: string;
    screenShare?: string;
    buildMode?: string;
    research?: string;
    dataLab?: string;
  };
}

export function PlusMenu({ open, onClose, onAction, coords, labels, query = '' }: PlusMenuProps) {
  const [autoQuery, setAutoQuery] = useState<string | null>(null);
  const [autoCoords, setAutoCoords] = useState<{ top: number; left: number } | null>(null);

  // The composer lives in a large page component whose JSX is intentionally
  // kept stable. Observe its input here so @ autocomplete remains independent
  // of the regular + menu and does not require a duplicate composer.
  useEffect(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.chat-composer-input');
    if (!textarea) return;
    const update = () => {
      const match = textarea.value.match(/(?:^|\s)@([^\s@]*)$/);
      if (!match) {
        setAutoQuery(null);
        setAutoCoords(null);
        return;
      }
      setAutoQuery(match[1]);
      setAutoCoords(getPlusMenuCoords(textarea));
    };
    textarea.addEventListener('input', update);
    textarea.addEventListener('keyup', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      textarea.removeEventListener('input', update);
      textarea.removeEventListener('keyup', update);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const isPluginAutocomplete = autoQuery !== null || query.length > 0;
  const activeQuery = query || autoQuery || '';
  const effectiveOpen = isPluginAutocomplete || open;
  const effectiveCoords = isPluginAutocomplete ? autoCoords ?? coords : coords;

  const normalizedQuery = activeQuery.trim().toLowerCase();
  const matches = (label: string) => !normalizedQuery || label.toLowerCase().includes(normalizedQuery);
  const toolLabels = {
    thinking: labels.thinking ?? 'Thinking mode',
    agentMode: labels.agentMode ?? 'Agent mode',
    webSearch: labels.webSearch ?? 'Web search',
    screenShare: labels.screenShare ?? 'Share screen',
    buildMode: labels.buildMode ?? 'Build mode',
    research: labels.research ?? 'Deep research',
    dataLab: labels.dataLab ?? 'Data Lab',
  };
  const showAttach = !isPluginAutocomplete || !normalizedQuery || matches(labels.attachFile) || matches(labels.camera);
  const showCreate = !isPluginAutocomplete || !normalizedQuery || matches(labels.newExpert) || matches(labels.generateImage) || matches(labels.createArtifact ?? 'Create Artifact');
  const showTools = isPluginAutocomplete && Object.values(toolLabels).some(matches);
  const showStudios = !isPluginAutocomplete || !normalizedQuery || ['All Studios', 'Design Studio', 'Music Studio'].some(matches);
  const pluginActions: readonly [string, PlusAction][] = [
    [labels.attachFile, 'attach-file'],
    [labels.camera, 'camera'],
    [labels.newExpert, 'new-expert'],
    [labels.generateImage, 'generate-image'],
    [toolLabels.thinking, 'thinking'],
    [toolLabels.agentMode, 'agent-mode'],
    [toolLabels.webSearch, 'web-search'],
    [toolLabels.screenShare, 'screen-share'],
    [toolLabels.buildMode, 'build-mode'],
    [toolLabels.research, 'research'],
    [toolLabels.dataLab, 'data-lab'],
    ['All Studios', 'studios'],
    ['Design Studio', 'design-studio'],
    ['Music Studio', 'music-studio'],
  ];
  const invoke = (action: PlusAction) => {
    if (isPluginAutocomplete) {
      window.dispatchEvent(new CustomEvent<PlusAction>('Infinity-plugin-action', { detail: action }));
      setAutoQuery(null);
      setAutoCoords(null);
      return;
    }
    onAction(action);
  };
  const closeMenu = () => {
    setAutoQuery(null);
    setAutoCoords(null);
    onClose();
  };
  useEffect(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.chat-composer-input');
    if (!textarea) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (autoQuery === null) return;
      // Don't intercept @Build <message> shortcut - let handleChatSubmit handle it
      const textareaValue = textarea.value.trim();
      const buildMatch = textareaValue.match(/^@build\b\s+(.+)$/i);
      if (buildMatch) return; // Allow default Enter handling for @Build shortcut
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== 'Enter' || event.shiftKey) return;
      const normalized = autoQuery.trim().toLowerCase();
      const action = pluginActions.find(([label]) => label.toLowerCase().includes(normalized))?.[1];
      if (action) {
        event.preventDefault();
        invoke(action);
      }
    };
    textarea.addEventListener('keydown', onKeyDown);
    return () => textarea.removeEventListener('keydown', onKeyDown);
  }, [autoQuery, labels, toolLabels]);

  // Hooks must run on every render, including while the menu has no anchor
  // coordinates. Keep the null render below all hooks to avoid changing the
  // hook count when @ autocomplete opens or closes.
  if (!effectiveCoords) {
    // Return a null portal to keep hook count stable
    return createPortal(null, document.body);
  }

  return createPortal(
    <AnimatePresence>
      {effectiveOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="plus-menu fixed z-50 w-56 rounded-xl border border-border/50 bg-background shadow-xl overflow-y-auto max-h-[min(70vh,480px)] flex flex-col"
            style={{ top: effectiveCoords.top, left: effectiveCoords.left }}
          >
            {showAttach && (
              <>
                <p className="px-3 pt-1.5 pb-0.5 text-[9px] font-mono tracking-widest text-muted-foreground/40 uppercase">Attach</p>
                {matches(labels.attachFile) && <Item icon={Paperclip} label={labels.attachFile} onClick={() => invoke('attach-file')} />}
                {matches(labels.camera) && <Item icon={Camera} label={labels.camera} onClick={() => invoke('camera')} />}
              </>
            )}
            {showCreate && (
              <>
                <p className="px-3 pt-2 pb-0.5 text-[9px] font-mono tracking-widest text-muted-foreground/40 uppercase">Create</p>
                {matches(labels.newExpert) && <Item icon={Sparkles} label={labels.newExpert} onClick={() => invoke('new-expert')} />}
                {matches(labels.generateImage) && <Item icon={ImageIcon} label={labels.generateImage} onClick={() => invoke('generate-image')} />}
                {matches('Create Artifact') && <Item icon={FileCode} label="Create Artifact" onClick={() => invoke('create-artifact')} />}
              </>
            )}
            {showTools && (
              <>
                <p className="px-3 pt-2 pb-0.5 text-[9px] font-mono tracking-widest text-muted-foreground/40 uppercase">Tools</p>
                {matches(toolLabels.thinking) && <Item icon={Sparkles} label={toolLabels.thinking} onClick={() => invoke('thinking')} />}
                {matches(toolLabels.agentMode) && <Item icon={LayoutGrid} label={toolLabels.agentMode} onClick={() => invoke('agent-mode')} />}
                {matches(toolLabels.webSearch) && <Item icon={ImageIcon} label={toolLabels.webSearch} onClick={() => invoke('web-search')} />}
                {matches(toolLabels.screenShare) && <Item icon={Camera} label={toolLabels.screenShare} onClick={() => invoke('screen-share')} />}
                {matches(toolLabels.buildMode) && <Item icon={LayoutGrid} label={toolLabels.buildMode} onClick={() => invoke('build-mode')} />}
                {matches(toolLabels.research) && <Item icon={Sparkles} label={toolLabels.research} onClick={() => invoke('research')} />}
                {matches(toolLabels.dataLab) && <Item icon={ImageIcon} label={toolLabels.dataLab} onClick={() => invoke('data-lab')} />}
              </>
            )}
            {showStudios && (
              <>
                <p className="px-3 pt-2 pb-0.5 text-[9px] font-mono tracking-widest text-muted-foreground/40 uppercase">Studios</p>
                {matches('All Studios') && <Item icon={LayoutGrid} label="All Studios" accent onClick={() => invoke('studios')} />}
                {matches('Design Studio') && <Item icon={Palette} label="Design Studio" onClick={() => invoke('design-studio')} />}
                {matches('Music Studio') && <Item icon={Music2} label="Music Studio" onClick={() => invoke('music-studio')} />}
              </>
            )}
            {isPluginAutocomplete && normalizedQuery && !showAttach && !showCreate && !showTools && !showStudios && (
              <p className="px-3 py-3 text-xs text-muted-foreground">No plug-in matches</p>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Item({ icon: Icon, label, accent, onClick }: {
  icon: typeof Paperclip; label: string; accent?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`plus-menu-item w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[12.5px] transition-colors ${
        accent ? 'text-foreground hover:bg-muted/50' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 ${accent ? 'text-primary' : ''}`} strokeWidth={1.8} />
      {label}
    </button>
  );
}
