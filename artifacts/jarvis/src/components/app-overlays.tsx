import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, Sparkles } from 'lucide-react';
import { SettingsPanel } from '@/components/settings-panel';
import { ErrorDetailPanel, type ErrorDetail } from '@/components/error-detail-panel';
import { ResearchPanel, type ResearchJob } from '@/components/research-panel';
import { DataLab } from '@/components/data-lab';
import { GemDialog } from '@/components/gem-dialog';
import { CommandPalette } from '@/components/command-palette';
import { DesignStudio } from '@/components/design-studio';
import { MusicStudio } from '@/components/music-studio';
import { StudiosHub, type StudioId } from '@/components/studios-hub';
import { CommandCard } from '@/components/widgets/CommandCard';
import type { TerminalResult } from '@/types/widget';
import { BuildStudio } from '@/components/build-studio';

interface AppOverlaysProps {
  // Settings
  settingsOpen: boolean;
  onCloseSettings: () => void;
  theme: string;
  onToggleTheme: () => void;
  // Error
  errorDetail: ErrorDetail | null;
  onCloseError: () => void;
  // Research
  researchPanelOpen: boolean;
  researchJobs: ResearchJob[];
  onCloseResearch: () => void;
  onOpenGem: (convId: string) => void;
  onStartResearch: () => void;
  onCancelResearch: (jobId: string) => Promise<void>;
  // Gem + DataLab + CommandPalette
  gemDialogOpen: boolean;
  onCloseGem: () => void;
  onGemCreated: (conv: { id: string; title: string }) => void;
  dataLabOpen: boolean;
  onCloseDataLab: () => void;
  onDataLabAsk: (summaryText: string) => void;
  paletteOpen: boolean;
  onClosePalette: () => void;
  onOpenGemFromPalette: () => void;
  onOpenDataLabFromPalette: () => void;
  onOpenConversation: (id: string) => void;
  onNewChat: () => void;
  onNavigate: (mode: 'voice' | 'chat' | 'agent' | 'camera') => void;
  onOpenResearch: () => void;
  onToggleWebSearch: () => void;
  onOpenSettings: () => void;
  // Jarvis Build
  buildPanelOpen: boolean;
  onCloseBuild: () => void;
  buildFiles?: { path: string; type: 'file' | 'dir'; size: number }[];
  onRefreshBuildFiles?: () => void;
  sessionCommands?: TerminalResult[];
  buildTitle: string;
  /** "@Build <message>" shortcut: prefill + auto-run the build prompt. */
  buildInitialPrompt?: string | null;
  buildRunKey?: number;
  /** Legacy Jarvis Build props kept for callers during the Studio migration. */
  buildTab?: string;
  setBuildTab?: (tab: string) => void;
  commandInput?: string;
  setCommandInput?: (value: string) => void;
  commandBusy?: boolean;
  // Studios / Design / Music
  studiosOpen: boolean;
  onCloseStudios: () => void;
  onSelectStudio: (id: StudioId) => void;
  designStudioOpen: boolean;
  onCloseDesign: () => void;
  designInitialImage?: string | null;
  musicStudioOpen: boolean;
  onCloseMusic: () => void;
  // Research pulse chip
  showResearchPulse: boolean;
}

function CloneForm({ onClone }: { onClone: (url: string) => void }) {
  const [url, setUrl] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) { onClone(url.trim()); setUrl(''); } }} className="flex items-center gap-2 w-full max-w-sm">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/user/repo.git" className="flex-1 min-w-0 bg-muted/40 border border-border/30 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary/40 transition-colors" spellCheck={false} />
      <button type="submit" disabled={!url.trim()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/15 transition-colors disabled:opacity-40"><Download className="w-3.5 h-3.5" />Clone</button>
    </form>
  );
}

export function AppOverlays(props: AppOverlaysProps) {
  return (
    <>
      <BuildStudio open={props.buildPanelOpen} onClose={props.onCloseBuild} title={props.buildTitle} initialCommands={props.sessionCommands ?? []} onRefreshFiles={props.onRefreshBuildFiles} initialPrompt={props.buildInitialPrompt} runKey={props.buildRunKey} />

      {/* ── Research pulse chip ── */}
      <AnimatePresence>
        {props.showResearchPulse && (
          <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            onClick={props.onOpenResearch}
            className="fixed z-40 bottom-24 right-4 flex items-center gap-2 px-3 py-2 rounded-full border border-border/60 bg-background/90 backdrop-blur-xl shadow-apple-lg hover:bg-secondary/70 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span className="text-[10px] font-mono text-muted-foreground">DEEP RESEARCH</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Studios hub ── */}
      <StudiosHub open={props.studiosOpen} onClose={props.onCloseStudios} onSelect={props.onSelectStudio} />

      {/* ── Design Studio ── */}
      <DesignStudio open={props.designStudioOpen} onClose={props.onCloseDesign} initialImage={props.designInitialImage} />

      {/* ── Music Studio ── */}
      <MusicStudio open={props.musicStudioOpen} onClose={props.onCloseMusic} />

      {/* ── Settings ── */}
      <SettingsPanel open={props.settingsOpen} onClose={props.onCloseSettings} theme={props.theme as 'dark' | 'light' | 'auto'} onToggleTheme={props.onToggleTheme as any} />

      {/* ── Error Detail ── */}
      <AnimatePresence>
        {props.errorDetail && <ErrorDetailPanel detail={props.errorDetail} onClose={props.onCloseError} />}
      </AnimatePresence>

      {/* ── Research Panel ── */}
      <AnimatePresence>
        {props.researchPanelOpen && (
          <ResearchPanel
            jobs={props.researchJobs}
            onClose={props.onCloseResearch}
            onOpenGem={props.onOpenGem}
            onStarted={props.onStartResearch}
            onCancel={props.onCancelResearch}
          />
        )}
      </AnimatePresence>

      {/* ── Gem Dialog ── */}
      <GemDialog open={props.gemDialogOpen} onClose={props.onCloseGem} onCreated={props.onGemCreated} />

      {/* ── Data Lab ── */}
      <DataLab open={props.dataLabOpen} onClose={props.onCloseDataLab} onAskJarvis={props.onDataLabAsk} />

      {/* ── Command Palette ── */}
      <CommandPalette
        open={props.paletteOpen}
        onClose={props.onClosePalette}
        onNavigate={props.onNavigate}
        onOpenResearch={props.onOpenResearch}
        onOpenGem={props.onOpenGemFromPalette}
        onOpenDataLab={props.onOpenDataLabFromPalette}
        onToggleWebSearch={props.onToggleWebSearch}
        onToggleTheme={props.onToggleTheme as any}
        onOpenSettings={props.onOpenSettings}
        onOpenConversation={props.onOpenConversation}
        onNewChat={props.onNewChat}
      />
    </>
  );
}
