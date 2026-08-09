import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Image, Check, X, Loader2, Monitor, Globe, Code2 , TerminalSquare } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface ImageConfirmationCardProps {
  imagePrompt: string;
  confirmationMessage: string;
  onConfirm: (prompt: string) => void;
  onCancel: () => void;
}

export function ImageConfirmationCard({
  imagePrompt,
  confirmationMessage,
  onConfirm,
  onCancel,
}: ImageConfirmationCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      className="max-w-[420px] self-start"
    >
      <div className="rounded-2xl border border-purple-400/30 bg-purple-500/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0">
            <Image className="w-4 h-4 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-display font-semibold tracking-wider text-purple-300">
              IMAGE REQUEST
            </p>
            <p className="text-[11px] font-mono text-muted-foreground/60 truncate">
              {confirmationMessage}
            </p>
          </div>
        </div>

        {/* Prompt preview */}
        <div className="px-4 pb-2">
          <div className="px-3 py-2 rounded-lg bg-background/50 border border-border/30">
            <p className="text-[11px] font-mono text-foreground/70 leading-relaxed line-clamp-3">
              {imagePrompt}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-4 pb-3.5">
          <button
            onClick={() => onConfirm(imagePrompt)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-500/20 border border-purple-400/30 text-purple-300 text-[11px] font-display font-semibold tracking-wider hover:bg-purple-500/30 hover:border-purple-400/50 transition-all active:scale-[0.97]"
          >
            <Check className="w-3.5 h-3.5" />
            GENERATE
          </button>
          <button
            onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-border/50 text-muted-foreground text-[11px] font-display font-semibold tracking-wider hover:bg-muted/50 hover:text-foreground transition-all active:scale-[0.97]"
          >
            <X className="w-3.5 h-3.5" />
            CANCEL
          </button>
        </div>
      </div>
    </motion.div>
  );
}

interface ImageGeneratingCardProps {
  prompt: string;
}

export function ImageGeneratingCard({ prompt }: ImageGeneratingCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="max-w-[420px] self-start"
    >
      <div className="rounded-2xl border border-purple-400/20 bg-purple-500/5 p-4 flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-purple-400 animate-spin flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-display font-semibold tracking-wider text-purple-300">
            GENERATING IMAGE…
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/50 truncate">
            {prompt}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

interface ScreenShareConfirmationCardProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ScreenShareConfirmationCard({ onConfirm, onCancel }: ScreenShareConfirmationCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      className="max-w-[420px] self-start"
    >
      <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/5 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
            <Monitor className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-display font-semibold tracking-wider text-cyan-300">
              SCREEN SHARE REQUEST
            </p>
            <p className="text-[11px] font-mono text-muted-foreground/60 truncate">
              Do you want to share your screen with Jarvis?
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 pb-3.5">
          <button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-[11px] font-display font-semibold tracking-wider hover:bg-cyan-500/30 hover:border-cyan-400/50 transition-all active:scale-[0.97]"
          >
            <Monitor className="w-3.5 h-3.5" />
            START SHARING
          </button>
          <button
            onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-border/50 text-muted-foreground text-[11px] font-display font-semibold tracking-wider hover:bg-muted/50 hover:text-foreground transition-all active:scale-[0.97]"
          >
            <X className="w-3.5 h-3.5" />
            CANCEL
          </button>
        </div>
      </div>
    </motion.div>
  );
}

interface AgentBrowserConfirmationCardProps {
  onConfirm: (query: string) => void;
  onCancel: () => void;
}

export function AgentBrowserConfirmationCard({ onConfirm, onCancel }: AgentBrowserConfirmationCardProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      className="max-w-[420px] self-start"
    >
      <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/5 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
            <Globe className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-display font-semibold tracking-wider text-cyan-300">
              AGENT MODE
            </p>
            <p className="text-[11px] font-mono text-muted-foreground/60 truncate">
              What do you want me to search for?
            </p>
          </div>
        </div>
        <div className="px-4 pb-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim()) onConfirm(query.trim()); if (e.key === 'Escape') onCancel(); }}
            placeholder="Type your search query..."
            className="w-full px-3 py-2 rounded-lg bg-background border border-border/50 text-foreground placeholder:text-muted-foreground/40 font-mono text-[11px] outline-none focus:border-cyan-400/50"
          />
        </div>
        <div className="flex items-center gap-2 px-4 pb-3.5">
          <button
            onClick={() => { if (query.trim()) onConfirm(query.trim()); }}
            disabled={!query.trim()}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-[11px] font-display font-semibold tracking-wider hover:bg-cyan-500/30 hover:border-cyan-400/50 transition-all active:scale-[0.97] disabled:opacity-30"
          >
            <Globe className="w-3.5 h-3.5" />
            SEARCH
          </button>
          <button
            onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-border/50 text-muted-foreground text-[11px] font-display font-semibold tracking-wider hover:bg-muted/50 hover:text-foreground transition-all active:scale-[0.97]"
          >
            <X className="w-3.5 h-3.5" />
            CANCEL
          </button>
        </div>
      </div>
    </motion.div>
  );
}

interface SourceCodeConfirmationCardProps {
  userText: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Use code for this answer?", Confirm allows Jarvis to read his own source
 *  code for this message; Cancel still sends the message but without code access. */
export function SourceCodeConfirmationCard({ userText, onConfirm, onCancel }: SourceCodeConfirmationCardProps) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      className="max-w-[420px] self-start"
    >
      <div className="rounded-2xl border border-blue-400/30 bg-blue-500/5 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
            <Code2 className="w-4 h-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-display font-semibold tracking-wider text-blue-300">
              {t('chat.useCodeTitle')}
            </p>
            <p className="text-[11px] font-mono text-muted-foreground/60 truncate">
              {t('chat.useCodePrompt')}
            </p>
          </div>
        </div>
        <div className="px-4 pb-2">
          <div className="px-3 py-2 rounded-lg bg-background/50 border border-border/30">
            <p className="text-[11px] font-mono text-foreground/70 leading-relaxed line-clamp-3">
              {userText}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 pb-3.5">
          <button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/20 border border-blue-400/30 text-blue-300 text-[11px] font-display font-semibold tracking-wider hover:bg-blue-500/30 hover:border-blue-400/50 transition-all active:scale-[0.97]"
          >
            <Check className="w-3.5 h-3.5" />
            {t('chat.useCodeConfirm')}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-border/50 text-muted-foreground text-[11px] font-display font-semibold tracking-wider hover:bg-muted/50 hover:text-foreground transition-all active:scale-[0.97]"
          >
            <X className="w-3.5 h-3.5" />
            {t('chat.useCodeCancel')}
          </button>
        </div>
      </div>
    </motion.div>
  );
}


interface BuildModeConfirmationCardProps {
  userText: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Open Jarvis Build?", Confirm gives Jarvis a Linux terminal + workspace to
 *  set up the requested project (Replit-style). Cancel sends the message
 *  normally, no shell access. */
export function BuildModeConfirmationCard({ userText, onConfirm, onCancel }: BuildModeConfirmationCardProps) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      className="max-w-[420px] self-start"
    >
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <TerminalSquare className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-display font-semibold tracking-wider text-emerald-300">
              JARVIS BUILD
            </p>
            <p className="text-[11px] font-mono text-muted-foreground/60 truncate">
              Jarvis gets a Linux terminal + workspace to set this up
            </p>
          </div>
        </div>
        <div className="px-4 pb-2">
          <div className="px-3 py-2 rounded-lg bg-background/50 border border-border/30">
            <p className="text-[11px] font-mono text-foreground/70 leading-relaxed line-clamp-3">
              {userText}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 pb-3.5">
          <button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[11px] font-display font-semibold tracking-wider hover:bg-emerald-500/30 hover:border-emerald-400/50 transition-all active:scale-[0.97]"
          >
            OPEN BUILD MODE
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg bg-muted/40 text-muted-foreground text-[11px] font-display font-semibold tracking-wider hover:bg-muted/60 transition-all active:scale-[0.97]"
          >
            SKIP
          </button>
        </div>
      </div>
    </motion.div>
  );
}
