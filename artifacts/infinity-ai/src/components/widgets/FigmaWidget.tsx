import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Figma, Type, Palette, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';

export interface FigmaTokenCard {
  fileKey: string;
  name: string;
  frameName: string;
  width: number;
  height: number;
  fonts: { family: string; weight: string; size: number }[];
  colors: { hex: string; rgba: string; count: number }[];
}

const EMBED_BASE = 'https://www.figma.com/embed?embed_host=Infinity&url=';

export function FigmaWidget({ data }: { data: FigmaTokenCard }) {
  const [expanded, setExpanded] = useState(false);
  const embedUrl = `${EMBED_BASE}${encodeURIComponent(`https://www.figma.com/design/${data.fileKey}/${encodeURIComponent(data.name || 'design')}`)}`;
  const openUrl = `https://www.figma.com/design/${data.fileKey}`;

  return (
    <div className="rounded-2xl border border-[#a259ff]/25 bg-[#a259ff]/[0.04] overflow-hidden mt-2 max-w-[420px]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-[#a259ff]/15">
        <Figma className="w-4 h-4 text-[#a259ff] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{data.frameName || 'Design'}</p>
          <p className="text-[10px] font-mono text-muted-foreground/60 truncate">{Math.round(data.width)}×{Math.round(data.height)} · {data.name}</p>
        </div>
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer"
          className="p-1.5 rounded-full hover:bg-[#a259ff]/10 text-muted-foreground hover:text-[#a259ff] transition-colors"
          title="Open in Figma"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Live frame embed */}
      <div className="relative aspect-video bg-black/5">
        <iframe
          src={embedUrl}
          title={`${data.frameName}, Figma design`}
          className="absolute inset-0 w-full h-full border-0"
          loading="lazy"
          allowFullScreen
        />
      </div>

      {/* Design tokens */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#a259ff]/[0.05] transition-colors"
      >
        <Palette className="w-3.5 h-3.5 text-[#a259ff]" />
        <span className="flex-1 text-[11px] font-medium">Design tokens, real fonts & colors</span>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />}
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
            <div className="border-t border-[#a259ff]/10 px-3 py-2.5 space-y-3 max-h-[240px] overflow-y-auto">
              {/* Fonts */}
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-muted-foreground/50 uppercase mb-1.5">
                  <Type className="w-3 h-3" /> Fonts
                </p>
                {data.fonts.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/50">No text styles found</p>
                ) : (
                  <div className="space-y-1">
                    {data.fonts.slice(0, 8).map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span style={{ fontFamily: `'${f.family}', sans-serif` }} className="font-medium truncate">{f.family}</span>
                        <span className="font-mono text-muted-foreground/60 flex-shrink-0 ml-2">{f.weight} · {f.size}px</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Colors */}
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-muted-foreground/50 uppercase mb-1.5">
                  <Palette className="w-3 h-3" /> Colors
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {data.colors.slice(0, 12).map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg border border-border/30 bg-background/60"
                      title={`${c.hex}, used ${c.count}x`}
                    >
                      <span className="w-3.5 h-3.5 rounded border border-black/10" style={{ background: c.hex }} />
                      <span className="font-mono text-[9.5px] text-muted-foreground">{c.hex}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
