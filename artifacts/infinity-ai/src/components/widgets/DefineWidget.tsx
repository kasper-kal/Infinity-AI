import type { DefineMeaning } from '@/types/widget';

interface DefineWidgetProps {
  word: string;
  phonetic?: string;
  meanings: DefineMeaning[];
}

/** Dictionary widget, word, pronunciation, and definitions (dictionaryapi.dev). */
export function DefineWidget({ word, phonetic, meanings }: DefineWidgetProps) {
  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-5 shadow-lg w-full">
      <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase mb-3">Definition</p>
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <span className="font-display text-2xl font-bold text-foreground capitalize">{word}</span>
        {phonetic && <span className="text-sm text-muted-foreground/70 font-mono">{phonetic}</span>}
      </div>
      <ol className="space-y-2.5">
        {meanings.map((m, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
            <span className="text-[10px] font-mono text-primary/70 uppercase tracking-wider mt-1 flex-shrink-0 w-14">
              {m.partOfSpeech || '-'}
            </span>
            <span className="text-foreground/85">
              {m.definition}
              {m.example && (
                <span className="block text-[12px] text-muted-foreground/60 italic mt-0.5">
                  “{m.example}”
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
