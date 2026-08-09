import { motion, AnimatePresence } from 'framer-motion';
import {
  X, MessageSquare, AudioWaveform, Camera, Telescope, Hammer,
  ImagePlus, Music2, ShieldCheck, Database, ChevronRight,
} from 'lucide-react';

export type StudioId =
  | 'chat' | 'voice' | 'camera' | 'research' | 'build'
  | 'design' | 'music' | 'factcheck' | 'datalab';

interface Studio {
  id: StudioId;
  name: string;
  tagline: string;
  replaces: string;
  icon: typeof MessageSquare;
  tint: string;        // icon tile bg (light)
  tintDark: string;    // icon tile bg (dark)
  text: string;        // icon color
}

const STUDIOS: Studio[] = [
  {
    id: 'chat',
    name: 'Chat',
    tagline: 'Instant answers, deep conversations',
    replaces: 'ChatGPT · Gemini · Grok · Claude',
    icon: MessageSquare,
    tint: 'bg-blue-500/10', tintDark: 'dark:bg-blue-400/15', text: 'text-blue-500 dark:text-blue-400',
  },
  {
    id: 'voice',
    name: 'Voice',
    tagline: 'Talk to Jarvis hands-free, hear it reply',
    replaces: 'Siri · Alexa · Google Assistant',
    icon: AudioWaveform,
    tint: 'bg-indigo-500/10', tintDark: 'dark:bg-indigo-400/15', text: 'text-indigo-500 dark:text-indigo-400',
  },
  {
    id: 'camera',
    name: 'Camera',
    tagline: 'Point at anything, identify it live',
    replaces: 'Google Lens',
    icon: Camera,
    tint: 'bg-sky-500/10', tintDark: 'dark:bg-sky-400/15', text: 'text-sky-500 dark:text-sky-400',
  },
  {
    id: 'research',
    name: 'Deep Research',
    tagline: 'Multi-hour investigations with sources',
    replaces: 'Perplexity · ResearchGPT',
    icon: Telescope,
    tint: 'bg-violet-500/10', tintDark: 'dark:bg-violet-400/15', text: 'text-violet-500 dark:text-violet-400',
  },
  {
    id: 'build',
    name: 'Jarvis Build',
    tagline: 'A Linux workspace Jarvis codes in',
    replaces: 'Replit · Claude Code · Cursor',
    icon: Hammer,
    tint: 'bg-amber-500/10', tintDark: 'dark:bg-amber-400/15', text: 'text-amber-500 dark:text-amber-400',
  },
  {
    id: 'design',
    name: 'Design Studio',
    tagline: 'Edit photos, add text, export PNG',
    replaces: 'Canva · Photo editors',
    icon: ImagePlus,
    tint: 'bg-pink-500/10', tintDark: 'dark:bg-pink-400/15', text: 'text-pink-500 dark:text-pink-400',
  },
  {
    id: 'music',
    name: 'Music Studio',
    tagline: 'Compose + play original tracks',
    replaces: 'Suno · Udio',
    icon: Music2,
    tint: 'bg-emerald-500/10', tintDark: 'dark:bg-emerald-400/15', text: 'text-emerald-500 dark:text-emerald-400',
  },
  {
    id: 'factcheck',
    name: 'Fact-check a message',
    tagline: 'Verifies chat responses against the web',
    replaces: 'Snopes · Fact-check sites',
    icon: ShieldCheck,
    tint: 'bg-green-500/10', tintDark: 'dark:bg-green-400/15', text: 'text-green-500 dark:text-green-400',
  },
  {
    id: 'datalab',
    name: 'Data Lab',
    tagline: 'Analyze data, get insights',
    replaces: 'Excel AI · NotebookLM',
    icon: Database,
    tint: 'bg-cyan-500/10', tintDark: 'dark:bg-cyan-400/15', text: 'text-cyan-500 dark:text-cyan-400',
  },
];

interface StudiosHubProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: StudioId) => void;
}

export function StudiosHub({ open, onClose, onSelect }: StudiosHubProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[92vh] bg-background border border-border/50 rounded-3xl shadow-apple-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 flex-shrink-0">
              <div>
                <p className="text-base font-semibold">Studios</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  One app instead of ten, every tool, organized.
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-muted/50 text-muted-foreground transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Grid */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {STUDIOS.map((s, i) => (
                  <motion.button
                    key={s.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.03 * i, duration: 0.25 }}
                    onClick={() => onSelect(s.id)}
                    className="group text-left flex items-start gap-3 p-3.5 rounded-2xl border border-border/40 bg-background hover:bg-muted/30 transition-all active:scale-[0.98]"
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.tint} ${s.tintDark}`}>
                      <s.icon className={`w-5 h-5 ${s.text}`} strokeWidth={1.9} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold leading-tight">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">{s.tagline}</p>
                      <p className="text-[9.5px] font-mono text-muted-foreground/40 mt-1.5 tracking-wide truncate">
                        replaces {s.replaces}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground/70 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
