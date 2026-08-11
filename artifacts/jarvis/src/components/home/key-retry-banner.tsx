import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import type { ManualKeyRetry } from '@/hooks/use-chat-stream';
import { useI18n } from '@/lib/i18n';

interface KeyRetryBannerProps {
  keyRetry: ManualKeyRetry | null;
  onSameKey: () => void;
  onNextKey: () => void;
  onDismiss: () => void;
}

/**
 * Manual LLM-key retry banner (chat/voice only): the chosen key failed, the
 * user decides to try the same key again or switch to the next one.
 */
export function KeyRetryBanner({ keyRetry, onSameKey, onNextKey, onDismiss }: KeyRetryBannerProps) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {keyRetry && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-2rem)] max-w-md"
          data-testid="llm-key-retry"
        >
          <div className="rounded-xl border border-amber-400/30 bg-card/95 backdrop-blur-xl shadow-apple-lg p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono tracking-widest text-amber-400 uppercase">{t('keyRetry.title')}</p>
                <p className="text-xs text-foreground/90 mt-1 leading-relaxed">{keyRetry.message}</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-1 truncate">{keyRetry.keyName}</p>
              </div>
              <button
                onClick={onDismiss}
                className="p-1 rounded-md hover:bg-secondary/70 text-muted-foreground transition-colors flex-shrink-0"
                aria-label={t('keyRetry.dismiss')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={onSameKey}
                className="flex-1 px-3 py-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-400 text-[11px] font-medium hover:bg-amber-400/20 active:scale-[0.98] transition-all"
                data-testid="retry-same-key"
              >
                {t('keyRetry.sameKey')}
              </button>
              <button
                onClick={onNextKey}
                disabled={!keyRetry.nextKeyId}
                className="flex-1 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
                data-testid="retry-next-key"
              >
                {keyRetry.nextKeyName
                  ? t('keyRetry.nextKeyWithName', { name: keyRetry.nextKeyName.split(' ').slice(-2).join(' ') })
                  : t('keyRetry.nextKey')}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
