import { useMemo, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';

interface UnitConverterWidgetProps {
  value: number;
  fromUnit: string;
  toUnit: string;
  category: string;
  label: string;
}

/** Per-category unit lists + factors (relative to a base unit). */
const CATEGORIES: Record<string, { base: string; units: Record<string, { label: string; factor: number; offset?: number }> }> = {
  length: {
    base: 'm',
    units: {
      'mm': { label: 'mm', factor: 0.001 }, 'cm': { label: 'cm', factor: 0.01 },
      'm': { label: 'm', factor: 1 }, 'km': { label: 'km', factor: 1000 },
      'in': { label: 'in', factor: 0.0254 }, 'ft': { label: 'ft', factor: 0.3048 },
      'mi': { label: 'mi', factor: 1609.344 },
    },
  },
  weight: {
    base: 'kg',
    units: {
      'g': { label: 'g', factor: 0.001 }, 'kg': { label: 'kg', factor: 1 },
      'oz': { label: 'oz', factor: 0.028349523125 }, 'lb': { label: 'lb', factor: 0.45359237 },
      'tonne': { label: 't', factor: 1000 },
    },
  },
  volume: {
    base: 'l',
    units: {
      'ml': { label: 'ml', factor: 0.001 }, 'l': { label: 'l', factor: 1 },
      'gal': { label: 'gal', factor: 3.785411784 }, 'fl oz': { label: 'fl oz', factor: 0.0295735295625 },
    },
  },
  temperature: {
    base: '°C',
    units: {
      '°C': { label: '°C', factor: 1, offset: 0 },
      '°F': { label: '°F', factor: 1, offset: 32 }, // special-cased below
    },
  },
};

function tempToC(value: number, unit: string): number {
  return unit === '°F' ? (value - 32) * 5 / 9 : value;
}
function cToTemp(c: number, unit: string): number {
  return unit === '°F' ? c * 9 / 5 + 32 : c;
}

export function UnitConverterWidget({ value, fromUnit, toUnit, category, label }: UnitConverterWidgetProps) {
  const cat = CATEGORIES[category] ?? CATEGORIES.length;
  const units = cat ? Object.keys(cat.units) : [];
  const [from, setFrom] = useState(units.includes(fromUnit) ? fromUnit : (units[0] ?? ''));
  const [to, setTo] = useState(units.includes(toUnit) ? toUnit : (units[1] ?? units[0] ?? ''));
  const [input, setInput] = useState<string>(String(value || 1));

  const result = useMemo(() => {
    const n = parseFloat(input);
    if (Number.isNaN(n) || !cat) return '';
    if (category === 'temperature') {
      const c = tempToC(n, from);
      const out = cToTemp(c, to);
      return String(Math.round(out * 1e6) / 1e6);
    }
    const base = n * cat.units[from].factor;
    const out = base / cat.units[to].factor;
    return String(Math.round(out * 1e6) / 1e6);
  }, [input, from, to, cat, category]);

  if (!cat) return null;

  const swap = () => { setFrom(to); setTo(from); };

  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase">Converter</p>
        <span className="text-[10px] text-muted-foreground/50 font-mono capitalize">{category}</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <input
          type="number"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 min-w-0 bg-muted/40 border border-border/30 rounded-xl px-3 py-2 text-sm font-mono tabular-nums outline-none focus:border-primary/40 transition-colors"
        />
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="bg-muted/40 border border-border/30 rounded-xl px-2 py-2 text-sm outline-none focus:border-primary/40"
        >
          {units.map((u) => <option key={u} value={u}>{cat.units[u].label}</option>)}
        </select>
      </div>

      <button onClick={swap} className="mx-auto flex items-center gap-1 text-[10px] font-mono text-muted-foreground/50 hover:text-primary transition-colors mb-2">
        <ArrowRightLeft className="w-3.5 h-3.5" /> swap
      </button>

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 text-right">
          <span className="text-2xl font-bold tabular-nums text-primary truncate block">{result || '-'}</span>
        </div>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="bg-muted/40 border border-border/30 rounded-xl px-2 py-2 text-sm outline-none focus:border-primary/40"
        >
          {units.map((u) => <option key={u} value={u}>{cat.units[u].label}</option>)}
        </select>
      </div>
      <p className="mt-2 text-[9px] text-muted-foreground/40 truncate">{label}</p>
    </div>
  );
}
