import { useEffect, useState } from 'react';

/** Live date widget, weekday, full date, and a ticking clock with seconds. */
export function DateWidget() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const fullDate = now.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });

  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-5 shadow-lg w-full flex flex-col items-center text-center">
      <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase mb-1">Today</p>
      <p className="font-display text-2xl font-bold text-foreground">{weekday}</p>
      <p className="text-sm text-muted-foreground mt-0.5">{fullDate}</p>
      <p className="font-display text-4xl font-bold tabular-nums text-primary mt-3 leading-none">
        {time}
      </p>
      <p className="text-[10px] font-mono text-muted-foreground/50 mt-2 tracking-wider">
        LIVE · UPDATES EVERY SECOND
      </p>
    </div>
  );
}
