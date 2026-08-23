import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Coins, Dice5 } from 'lucide-react';

interface RandomWidgetProps {
  kind: 'dice' | 'coin' | 'number';
  value: number;
  label: string;
}

export function RandomWidget({ kind, value, label }: RandomWidgetProps) {
  const [val, setVal] = useState(value);
  const [spinning, setSpinning] = useState(false);

  const reroll = () => {
    setSpinning(true);
    let next = val;
    if (kind === 'dice') next = Math.floor(Math.random() * 6) + 1;
    else if (kind === 'coin') next = Math.random() < 0.5 ? 0 : 1;
    else {
      const m = label.match(/(\d+)-(\d+)/);
      if (m) { const lo = Math.min(+m[1], +m[2]); const hi = Math.max(+m[1], +m[2]); next = lo + Math.floor(Math.random() * (hi - lo + 1)); }
      else next = Math.floor(Math.random() * 100) + 1;
    }
    setTimeout(() => { setVal(next); setSpinning(false); }, 350);
  };

  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full flex flex-col items-center">
      <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase mb-3">
        {kind === 'dice' ? `Dice · ${label}` : kind === 'coin' ? 'Coin flip' : `Random · ${label}`}
      </p>
      <AnimatePresence mode="wait">
        <motion.div
          key={val}
          initial={{ rotate: spinning ? 0 : -20, scale: 0.6, opacity: 0 }}
          animate={{ rotate: spinning ? 720 : 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 20, scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.35, type: 'spring', bounce: 0.4 }}
          className="text-7xl leading-none mb-3 select-none"
        >
           {kind === 'coin'
             ? <Coins className="w-20 h-20 text-primary" strokeWidth={1.5} />
             : kind === 'dice'
               ? <Dice5 className="w-20 h-20 text-primary" strokeWidth={1.5} />
               : val}
        </motion.div>
      </AnimatePresence>
      <motion.p
        key={`label-${val}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-sm font-medium text-foreground mb-3"
      >
        {kind === 'coin' ? (val === 0 ? 'Tails' : 'Heads') : kind === 'dice' ? `You rolled ${val}` : val}
      </motion.p>
      <button
        onClick={reroll}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/40 bg-muted/30 hover:bg-muted/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors active:scale-95"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} /> {kind === 'coin' ? 'Flip again' : 'Roll again'}
      </button>
    </div>
  );
}
