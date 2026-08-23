import { useState } from 'react';
import { Terminal, ChevronDown, Check, Copy } from 'lucide-react';
import type { TerminalResult } from '@/types/widget';

interface CommandCardProps {
  result: TerminalResult;
}

/** Clean minimal box: the command the AI ran, with expandable output. */
export function CommandCard({ result }: CommandCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ok = result.exitCode === 0;

  const copy = () => {
    navigator.clipboard.writeText(`${result.command}\n${result.output}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mt-2 rounded-xl border border-border/35 bg-muted/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <Terminal className={`w-3.5 h-3.5 flex-shrink-0 ${ok ? 'text-primary/70' : 'text-red-400'}`} />
        <code className="flex-1 min-w-0 font-mono text-[11.5px] text-foreground/85 truncate">
          $ {result.command}
        </code>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0 ${ok ? 'text-green-500 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
          {ok ? 'OK' : `exit ${result.exitCode}`}
        </span>
        <button
          onClick={copy}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors flex-shrink-0"
          title="Copy"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => setOpen(o => !o)}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors flex-shrink-0"
          title={open ? 'Hide output' : 'Show output'}
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
        </button>
      </div>
      {open && (
        <pre className="px-3 pb-2.5 pt-1 text-[10.5px] leading-relaxed font-mono text-muted-foreground/75 whitespace-pre-wrap break-all border-t border-border/20 max-h-52 overflow-y-auto">
          {result.output || '(no output)'}
        </pre>
      )}
    </div>
  );
}
