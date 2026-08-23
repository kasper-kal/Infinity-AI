import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface ClockTimezone { label: string; tz: string }
interface ClockWidgetProps {
  timezones: ClockTimezone[];
  onClose?: () => void;
}

function useTime(tz: string) {
  const [parts, setParts] = useState<Intl.DateTimeFormatPart[]>([]);
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setParts(new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      }).formatToParts(now));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [tz]);

  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '--';
  return { h: get('hour'), m: get('minute'), s: get('second'), dayPeriod: get('dayPeriod') };
}

function TZClock({ label, tz, primary, solo }: { label: string; tz: string; primary?: boolean; solo?: boolean }) {
  const { h, m, s, dayPeriod } = useTime(tz);

  if (solo) {
    return (
      <div className="flex flex-col items-center py-5">
        <span className="text-[11px] font-mono tracking-widest text-muted-foreground/60 mb-4 uppercase">{label}</span>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-7xl font-bold tabular-nums text-primary leading-none">
            {h}:{m}
          </span>
          <span className="font-mono text-4xl tabular-nums text-primary/70 leading-none">:{s}</span>
          <span className="text-xl font-mono text-muted-foreground/50 ml-2 tracking-wider self-end mb-1">{dayPeriod}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center p-4 rounded-2xl border transition-all ${
      primary ? 'border-primary/40 bg-primary/5' : 'border-border/30 bg-card/30'
    }`}>
      <span className="text-[10px] font-mono tracking-widest text-muted-foreground/60 mb-1 uppercase">{label}</span>
      <div className="flex items-baseline gap-0.5">
        <span className={`font-display font-bold tabular-nums ${primary ? 'text-4xl text-primary' : 'text-3xl text-foreground'}`}>
          {h}:{m}
        </span>
        <span className={`font-mono tabular-nums ml-0.5 ${primary ? 'text-xl text-primary/70' : 'text-lg text-muted-foreground/60'}`}>
          :{s}
        </span>
        <span className="text-[11px] font-mono text-muted-foreground/50 ml-1 tracking-wider">{dayPeriod}</span>
      </div>
    </div>
  );
}

export function ClockWidget({ timezones, onClose }: ClockWidgetProps) {
  const solo = timezones.length === 1;
  const cols = solo ? 'grid-cols-1' :
               timezones.length <= 2 ? 'grid-cols-2' :
               timezones.length === 3 ? 'grid-cols-3' :
               timezones.length === 4 ? 'grid-cols-2 sm:grid-cols-4' :
               'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';

  return (
    <div className="relative mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full">
      {onClose && (
        <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {!solo && (
        <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-3 uppercase">World Clock</p>
      )}
      <div className={`grid ${cols} gap-2`}>
        {timezones.map((tz, i) => (
          <TZClock key={tz.tz} label={tz.label} tz={tz.tz} primary={i === 0} solo={solo} />
        ))}
      </div>
    </div>
  );
}
