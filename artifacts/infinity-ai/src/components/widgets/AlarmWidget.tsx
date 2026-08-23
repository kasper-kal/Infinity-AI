import { useState, useEffect, useRef } from 'react';
import { BellRing, AlarmClock, X } from 'lucide-react';

interface AlarmWidgetProps {
  time: string;   // "HH:MM" 24-h
  label?: string;
  compact?: boolean; // show above orb in voice mode
  onClose?: () => void;
}

// #28: Shared module-level AudioContext, avoids creating a new context on every alarm tick
let _alarmCtx: AudioContext | null = null;
function getAlarmCtx(): AudioContext {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!_alarmCtx || _alarmCtx.state === 'closed') _alarmCtx = new Ctor();
  return _alarmCtx;
}

function playAlarmSound() {
  try {
    const ctx = getAlarmCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const freqs = [440, 554, 659, 554, 440];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.18);
    });
  } catch { /* noop */ }
}

export function AlarmWidget({ time, label, compact, onClose }: AlarmWidgetProps) {
  const [fired, setFired] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const checkedRef = useRef(false);

  // #42: Reset checkedRef when the time prop changes so the alarm re-arms for the next day
  useEffect(() => {
    checkedRef.current = false;
    setFired(false);
    setDismissed(false);
  }, [time]);

  useEffect(() => {
    if (dismissed) return;
    const check = () => {
      const now = new Date();
      const [hh, mm] = time.split(':').map(Number);
      const nowMatches = now.getHours() === hh && now.getMinutes() === mm;

      // #42: Auto-reset checkedRef when the minute passes so it can fire again next day
      if (!nowMatches) {
        if (checkedRef.current) checkedRef.current = false;
        return;
      }

      if (!checkedRef.current) {
        checkedRef.current = true;
        setFired(true);
        playAlarmSound();
      }
    };
    check();
    // #41: Check every second instead of every 5s to reduce max latency from 5s to 1s
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [time, dismissed]);

  const dismiss = () => { setDismissed(true); setFired(false); onClose?.(); };

  // Format for display
  const [hh, mm] = time.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  const display = `${h12}:${String(mm).padStart(2, '0')} ${period}`;

  if (compact) {
    // Above-orb compact mode
    return (
      <div className={`flex flex-col items-center gap-1 ${fired ? 'animate-pulse' : ''}`}>
        <div className="flex items-center gap-1.5">
          <AlarmClock className={`w-5 h-5 ${fired ? 'text-yellow-400' : 'text-primary/70'}`} />
          {fired && <BellRing className="w-4 h-4 text-yellow-400 animate-bounce" />}
        </div>
        <span className="font-display text-2xl font-bold text-primary tabular-nums tracking-wider">{display}</span>
        {label && <span className="text-[10px] font-mono text-muted-foreground/50 tracking-wider uppercase">{label}</span>}
        {fired && (
          <button onClick={dismiss} className="mt-1 text-[10px] font-mono text-yellow-400 hover:text-yellow-300 border border-yellow-400/40 rounded-full px-2 py-0.5">
            DISMISS
          </button>
        )}
        {!fired && onClose && (
          <button onClick={onClose} className="p-0.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`relative mt-3 rounded-2xl border bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full max-w-[240px] ${
      fired ? 'border-yellow-400/60 animate-pulse' : 'border-border/40'
    }`}>
      {onClose && !fired && (
        <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex items-center gap-3">
        <BellRing className={`w-7 h-7 ${fired ? 'text-yellow-400' : 'text-primary/70'}`} />
        <div>
          <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 uppercase">{fired ? 'Alarm firing!' : 'Alarm set'}</p>
          <p className="text-2xl font-display font-bold text-foreground tabular-nums">{display}</p>
          {label && <p className="text-[10px] font-mono text-muted-foreground/50">{label}</p>}
        </div>
      </div>
      {fired && (
        <button onClick={dismiss}
          className="mt-3 w-full py-1.5 rounded-xl border border-yellow-400/50 text-yellow-400 hover:bg-yellow-400/10 text-xs font-display tracking-wider transition-all">
          DISMISS
        </button>
      )}
    </div>
  );
}
