import { ExternalLink } from 'lucide-react';

interface MapWidgetProps {
  query: string;
  lat: number;
  lon: number;
  displayName: string;
}

export function MapWidget({ query, lat, lon, displayName }: MapWidgetProps) {
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.05}%2C${lat - 0.03}%2C${lon + 0.05}%2C${lat + 0.03}&layer=mapnik&marker=${lat}%2C${lon}`;
  const linkUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`;

  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm overflow-hidden shadow-lg w-full">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase">Map</p>
        <a
          href={linkUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary transition-colors"
        >
          open in OSM <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <iframe
        title={`Map of ${query}`}
        src={embedUrl}
        loading="lazy"
        className="w-full h-52 border-0"
        referrerPolicy="no-referrer"
      />
      <p className="px-4 py-2 text-[10px] text-muted-foreground/60 truncate">{displayName}</p>
    </div>
  );
}
