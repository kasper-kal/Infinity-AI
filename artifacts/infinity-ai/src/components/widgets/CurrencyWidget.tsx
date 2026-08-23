import { useMemo, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';

interface CurrencyWidgetProps {
  from: string;
  to: string;
  amount: number;
  rate: number;
  updated: string;
}

export function CurrencyWidget({ from, to, amount, rate, updated }: CurrencyWidgetProps) {
  const [fromC, setFromC] = useState(from);
  const [toC, setToC] = useState(to);
  const [input, setInput] = useState<string>(String(amount || 1));
  const [currentRate, setCurrentRate] = useState(rate);

  const result = useMemo(() => {
    const n = parseFloat(input);
    if (Number.isNaN(n)) return '';
    return String(Math.round(n * currentRate * 1e4) / 1e4);
  }, [input, currentRate]);

  const swap = () => { setFromC(toC); setToC(fromC); setCurrentRate(1 / currentRate); };

  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 4 });

  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase">Currency</p>
        <span className="text-[10px] text-muted-foreground/50 font-mono">live rate</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <input
          type="number"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 min-w-0 bg-muted/40 border border-border/30 rounded-xl px-3 py-2 text-sm font-mono tabular-nums outline-none focus:border-primary/40 transition-colors"
        />
        <span className="bg-muted/40 border border-border/30 rounded-xl px-3 py-2 text-sm font-bold w-16 text-center">{fromC}</span>
      </div>

      <button onClick={swap} className="mx-auto flex items-center gap-1 text-[10px] font-mono text-muted-foreground/50 hover:text-primary transition-colors mb-2">
        <ArrowRightLeft className="w-3.5 h-3.5" /> swap
      </button>

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 text-right">
          <span className="text-2xl font-bold tabular-nums text-primary truncate block">{result || '-'}</span>
        </div>
        <span className="bg-muted/40 border border-border/30 rounded-xl px-3 py-2 text-sm font-bold w-16 text-center">{toC}</span>
      </div>

      <p className="mt-2 text-[9px] text-muted-foreground/40">
        1 {fromC} = {fmt(currentRate)} {toC}
        {updated ? ` · updated ${updated}` : ''}
      </p>
    </div>
  );
}
