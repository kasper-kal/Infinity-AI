import { useState } from 'react';
import { ExternalLink, ImageOff } from 'lucide-react';
import type { ImageResult } from '@/types/widget';

interface ImageResultsWidgetProps {
  query: string;
  results: ImageResult[];
}

/** Real web image search results (via Openverse, CC-licensed images from Flickr/Wikimedia/etc). */
export function ImageResultsWidget({ query, results }: ImageResultsWidgetProps) {
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);

  if (results.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full">
        <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 mb-1 uppercase">Image search</p>
        <p className="text-sm text-muted-foreground">No images found for “{query}”.</p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase">Image search</p>
        <p className="text-[10px] text-muted-foreground/60 truncate">“{query}” · real web results</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {results.map((img, i) => (
          <a
            key={i}
            href={img.landingUrl ?? img.url}
            target="_blank"
            rel="noreferrer noopener"
            onMouseEnter={() => setExpanded(i)}
            onMouseLeave={() => setExpanded(null)}
            className="group relative aspect-square rounded-xl overflow-hidden border border-border/30 bg-muted/20 hover:border-primary/40 transition-all duration-200 active:scale-[0.98]"
            title={img.title || undefined}
          >
            {failed.has(i) ? (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                <ImageOff className="w-6 h-6" />
              </div>
            ) : (
              <img
                src={img.thumbnail || img.url}
                alt={img.title || `${query} image ${i + 1}`}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setFailed(s => new Set(s).add(i))}
                className={`w-full h-full object-cover transition-transform duration-300 ${expanded === i ? 'scale-110' : 'scale-100'}`}
              />
            )}
            <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-between">
              <span className="text-[9px] text-white/90 truncate pr-1">{img.source || img.license}</span>
              <ExternalLink className="w-3 h-3 text-white/80 flex-shrink-0" />
            </div>
          </a>
        ))}
      </div>
      <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground/40">
        CC-licensed images from the web, tap any photo to open its source page.
      </p>
    </div>
  );
}
