import { useMemo, useState } from 'react';
import { Delete } from 'lucide-react';

interface CalculatorWidgetProps {
  expression: string;
  result: string;
}

/** Tiny safe arithmetic evaluator (client mirror of the server parser). */
function safeEvaluate(expr: string): number | null {
  const tokens = expr.replace(/\s+/g, '').match(/\d+\.?\d*|[+\-*/^%()]/g);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  function parseExpr(): number | null {
    let left = parseTerm(); if (left === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = consume(); const right = parseTerm(); if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parseFactor(); if (left === null) return null;
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume(); const right = parseFactor(); if (right === null) return null;
      if (op === '*') left = left * right;
      else if (op === '/') { if (right === 0) return null; left = left / right; }
      else left = left % right;
    }
    return left;
  }
  function parseFactor(): number | null {
    const tok = peek();
    if (tok === '(') { consume(); const inner = parseExpr(); if (inner === null || consume() !== ')') return null; return parsePow(inner); }
    const n = Number(consume()); if (Number.isNaN(n)) return null; return parsePow(n);
  }
  function parsePow(base: number): number {
    if (peek() === '^') { consume(); const exp = Number(consume()); if (!Number.isNaN(exp)) return Math.pow(base, exp); }
    return base;
  }
  const result = parseExpr();
  if (result === null || pos !== tokens.length) return null;
  if (!Number.isFinite(result)) return null;
  return Math.round(result * 1e8) / 1e8;
}

const BTNS = [
  'C', '(', ')', '÷',
  '7', '8', '9', '×',
  '4', '5', '6', '−',
  '1', '2', '3', '+',
  '0', '.', '^', '=',
];

/** A REAL interactive calculator, full working keypad, not just the answer. */
export function CalculatorWidget({ expression, result }: CalculatorWidgetProps) {
  const [display, setDisplay] = useState<string>(
    expression && result ? expression : (result || '0'),
  );
  const [liveResult, setLiveResult] = useState<string>(result || '');

  const handleKey = (key: string) => {
    if (key === 'C') { setDisplay(''); setLiveResult(''); return; }
    if (key === '=') {
      const normalized = display
        .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
      const v = safeEvaluate(normalized);
      if (v === null) { setLiveResult('Error'); return; }
      setDisplay(String(v));
      setLiveResult('');
      return;
    }
    const normalizedKey = key === '÷' ? '÷' : key === '×' ? '×' : key === '−' ? '−' : key;
    const next = display === '0' && /[0-9]/.test(key) ? key : display + normalizedKey;
    setDisplay(next);
    const evaluated = safeEvaluate(next.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-'));
    setLiveResult(evaluated !== null && evaluated !== undefined ? String(evaluated) : '');
  };

  const preview = useMemo(() => liveResult, [liveResult]);

  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase">Calculator</p>
        <span className="text-[10px] text-muted-foreground/50 font-mono">interactive</span>
      </div>

      <div className="rounded-xl bg-muted/40 border border-border/30 px-3 py-2.5 mb-3 text-right min-h-[64px] flex flex-col justify-center">
        <div className="text-sm text-muted-foreground/70 font-mono truncate min-h-[18px]">
          {display || '0'}
        </div>
        <div className="text-2xl font-bold tabular-nums text-primary truncate min-h-[30px]">
          {preview || ' '}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {BTNS.map((b) => (
          <button
            key={b}
            onClick={() => handleKey(b)}
            className={`h-10 rounded-xl text-sm font-medium transition-all active:scale-95 flex items-center justify-center ${
              b === '='
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : b === 'C'
                  ? 'text-red-500 bg-red-500/10 hover:bg-red-500/15'
                  : /[+\-×÷^]/.test(b)
                    ? 'text-primary bg-primary/8 hover:bg-primary/15'
                    : 'bg-muted/40 hover:bg-muted/60 text-foreground'
            }`}
          >
            {b === 'C' ? <Delete className="w-4 h-4" /> : b}
          </button>
        ))}
      </div>
    </div>
  );
}
