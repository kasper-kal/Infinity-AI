import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, ChevronDown, ChevronRight, Download } from 'lucide-react';

const downloadFile = (path: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = path.split('/').pop() || 'Infinity-file.txt';
  anchor.click();
  URL.revokeObjectURL(url);
};
import type { FileEdit } from '@/types/widget';

export function FileEditCard({ edit }: { edit: FileEdit }) {
  const [expanded, setExpanded] = useState(false);
  const isNew = !edit.oldContent || edit.oldContent.length === 0;
  const label = isNew ? `Created ${edit.path}` : `Edited ${edit.path}`;

  const removedLines = !isNew
    ? edit.oldContent.split('\n').filter((l) => !edit.newContent.includes(l)).length
    : 0;
  const addedLines = edit.newContent.split('\n').length;

  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.04] overflow-hidden mt-2">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-emerald-500/[0.06] transition-colors"
      >
        <FileText className="w-4 h-4 text-emerald-500 flex-shrink-0" />
        <span className="flex-1 min-w-0 text-xs font-mono text-emerald-600 dark:text-emerald-400 truncate">
          {label}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/60 flex-shrink-0">
          {isNew ? `+${addedLines} lines` : `+${addedLines} −${removedLines}`}
        </span>
        <button type="button" onClick={(event) => { event.stopPropagation(); downloadFile(edit.path, edit.newContent); }} title="Download file" className="rounded-md p-1 text-muted-foreground/70 hover:bg-emerald-500/10 hover:text-emerald-400">
          <Download className="h-3.5 w-3.5" />
        </button>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-emerald-400/10 px-3 py-2 max-h-[400px] overflow-y-auto bg-card/30">
              {isNew ? (
                <pre className="text-[10px] font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {edit.newContent.slice(0, 5000)}
                </pre>
              ) : (
                <pre className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap">
                  {edit.oldContent.slice(0, 3000).split('\n').map((line, i) => (
                    <div key={i} className="text-red-400/80 bg-red-400/[0.06]">{line || ' '}</div>
                  ))}
                  {edit.newContent.slice(0, 3000).split('\n').map((line, i) => (
                    <div key={`n${i}`} className="text-emerald-400/80 bg-emerald-400/[0.06]">{line || ' '}</div>
                  ))}
                </pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
