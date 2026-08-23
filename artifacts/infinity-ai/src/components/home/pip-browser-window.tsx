import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Minimize2, Maximize2, X } from 'lucide-react';
import { InfinityBrowser } from '@/components/Infinity-browser';
import { useI18n } from '@/lib/i18n';

interface PipBrowserWindowProps {
  open: boolean;
  fullscreen: 'browser' | 'camera' | null;
  agentGoal: string | null;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onGoalHandled: () => void;
}

/** Draggable PiP floating window hosting the Infinity agent browser. */
export function PipBrowserWindow({ open, fullscreen, agentGoal, onToggleFullscreen, onClose, onGoalHandled }: PipBrowserWindowProps) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
          className={`fixed z-50 bg-card border border-border/50 rounded-xl shadow-apple-lg overflow-hidden flex flex-col ${
            fullscreen === 'browser'
              ? 'inset-4'
              : 'bottom-20 right-4 w-80 h-60'
          }`}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-primary/60" />
              <span className="text-[10px] font-medium text-muted-foreground">{t('sidebar.navBrowser')}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={onToggleFullscreen} className="p-1 rounded hover:bg-secondary/80 text-muted-foreground transition-colors">
                {fullscreen === 'browser' ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              </button>
              <button onClick={onClose} className="p-1 rounded hover:bg-secondary/80 text-muted-foreground transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <InfinityBrowser
              className="h-full border-0 rounded-b-xl"
              autoRunGoal={agentGoal}
              onGoalHandled={onGoalHandled}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
