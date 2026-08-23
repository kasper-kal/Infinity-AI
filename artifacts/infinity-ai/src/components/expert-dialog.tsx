import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Loader2, Wand2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { haptics } from '@/lib/haptics';

interface ExpertDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the created conversation row, opens it in the feed. */
  onCreated: (conv: { id: string; title: string }) => void;
}

export function ExpertDialog({ open, onClose, onCreated }: ExpertDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    haptics.medium?.();
    if (!prompt.trim()) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/infinity/conversations/expert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name.trim(), systemPrompt: prompt.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setError(err?.error ?? `Failed to create expert (${res.status})`);
        return;
      }
      const conv = (await res.json()) as { id: string; title: string };
      setName('');
      setPrompt('');
      onClose();
      onCreated(conv);
    } catch {
      setError('Network error, is the server running?');
    } finally {
      setStarting(false);
    }
  }, [name, prompt, onClose, onCreated]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            className="relative w-full max-w-md rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-apple-lg overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-[12px] font-semibold tracking-wide font-rounded">{t('expert.title')}</span>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-full hover:bg-secondary/70 text-muted-foreground transition-colors" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-mono tracking-widest text-muted-foreground/50">{t('expert.name')}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('expert.namePlaceholder')}
                  maxLength={120}
                  className="mt-1 w-full rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-[13px] outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono tracking-widest text-muted-foreground/50">{t('expert.prompt')}</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  placeholder={t('expert.promptPlaceholder')}
                  maxLength={12000}
                  className="mt-1 w-full rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-[13px] leading-relaxed outline-none resize-none focus:border-primary/50 placeholder:text-muted-foreground/40"
                />
              </div>

              {error && (
                <p className="text-[11px] text-red-400/90">{error}</p>
              )}

              <button
                onClick={handleCreate}
                disabled={!prompt.trim() || starting}
                className="w-full px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-rounded"
              >
                {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {t('expert.create')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
