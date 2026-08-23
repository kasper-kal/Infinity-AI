import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, Music2 } from 'lucide-react';
import type { MusicComposition } from '@/types/widget';

interface MusicWidgetProps {
  composition: MusicComposition;
}

const NOTE_FREQ: Record<string, number> = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };

function noteToFreq(note: string): number {
  const m = note.match(/^([A-G])(#?)(\d)$/);
  if (!m) return 440;
  const semi = NOTE_FREQ[m[1]] + (m[2] === '#' ? 1 : 0) + (parseInt(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semi / 12);
}

/** A tiny Web Audio engine: plays the composition with pads, bass, plucks + drums. */
export function MusicWidget({ composition }: MusicWidgetProps) {
  const { chords } = composition;
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const tone = useCallback((ctx: AudioContext, dest: AudioNode, freq: number, start: number, dur: number, type: OscillatorType, gain: number) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }, []);

  const play = useCallback(() => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = ctxRef.current ?? new Ctx();
    ctxRef.current = ctx;
    void ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);

    const delay = ctx.createDelay();
    delay.delayTime.value = 0.24;
    const fb = ctx.createGain();
    fb.gain.value = 0.25;
    delay.connect(fb).connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    delay.connect(wet).connect(master);

    const { tempo, chords, bass, melody, drumPattern, root } = composition;
    const stepDur = 60 / tempo / 4; // one 16th-note
    const chordRoot = NOTE_FREQ[root] ?? 0;
    const rootFreq = noteToFreq(`${root}3`);

    // Chords: semitone offsets from root (major/minor shapes)
    const chordShapes: Record<string, number[]> = {
      'major': [0, 4, 7], 'minor': [0, 3, 7],
    };
    // Build a simple progression by alternating qualities
    const qualities: Array<keyof typeof chordShapes> = ['major', 'minor', 'major', 'major'];

    let t = ctx.currentTime + 0.05;
    const totalBeats = 16;
    for (let bar = 0; bar < 4; bar++) {
      const chordSemi = chords.length > 0 ? ((NOTE_FREQ[chords[bar % chords.length][0]] ?? 0) + rootFreq) : 0;
      const chordFreqs = chordShapes[qualities[bar % 4]].map((s) => rootFreq * Math.pow(2, (chordSemi + s) / 12));
      // Pad chord (soft saw)
      for (const f of chordFreqs) tone(ctx, master, f, t, stepDur * 4 * 0.9, 'sawtooth', 0.06);
      // Bass
      const bassNote = bass.length > 0 ? bass[bar % bass.length] : `${root}2`;
      tone(ctx, master, noteToFreq(bassNote), t, stepDur * 4 * 0.9, 'triangle', 0.22);
      // Drums (16 steps per bar)
      for (let s = 0; s < 16; s++) {
        const step = drumPattern[bar * 4 + (s % 16)] ?? drumPattern[s % 16];
        const stepTime = t + s * stepDur;
        if (step === 1) {
          // kick
          const kick = ctx.createOscillator();
          const kg = ctx.createGain();
          kick.type = 'sine';
          kick.frequency.setValueAtTime(120, stepTime);
          kick.frequency.exponentialRampToValueAtTime(45, stepTime + 0.1);
          kg.gain.setValueAtTime(0.5, stepTime);
          kg.gain.exponentialRampToValueAtTime(0.001, stepTime + 0.12);
          kick.connect(kg).connect(master);
          kick.start(stepTime); kick.stop(stepTime + 0.15);
          // hat on off-beats
          if (s % 2 === 1) {
            const hat = ctx.createOscillator();
            const hg = ctx.createGain();
            hat.type = 'square';
            hat.frequency.value = 6000;
            hg.gain.setValueAtTime(0.06, stepTime);
            hg.gain.exponentialRampToValueAtTime(0.001, stepTime + 0.04);
            hat.connect(hg).connect(master);
            hat.start(stepTime); hat.stop(stepTime + 0.05);
          }
        }
      }
      // Melody plucks
      for (const n of melody) {
        const noteTime = t + n.time * stepDur;
        const f = noteToFreq(n.note);
        tone(ctx, master, f, noteTime, n.dur * stepDur * 0.85, 'triangle', 0.16);
      }
      t += stepDur * 16;
    }

    // Progress + stop timer
    const durMs = totalBeats * 4 * stepDur * 1000;
    const startAt = Date.now();
    const tick = () => {
      const el = Date.now() - startAt;
      setProgress(Math.min(1, el / durMs));
      if (el >= durMs) {
        setPlaying(false);
        setProgress(0);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      }
    };
    timerRef.current = window.setInterval(tick, 100);
    setPlaying(true);
    stopRef.current = () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      try { void ctx.close(); } catch { /* noop */ }
      ctxRef.current = null;
      setPlaying(false);
      setProgress(0);
    };
  }, [composition, tone]);

  const stop = useCallback(() => {
    stopRef.current?.();
  }, []);

  useEffect(() => () => { stopRef.current?.(); }, []);

  const moodColor: Record<string, string> = {
    happy: 'text-amber-400', chill: 'text-sky-400', epic: 'text-rose-400', sad: 'text-indigo-400',
  };

  return (
    <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Music2 className={`w-4 h-4 ${moodColor[composition.mood] ?? 'text-primary'}`} />
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">{composition.title}</p>
            <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
              {composition.mood} · {composition.tempo} BPM · key of {composition.root}
            </p>
          </div>
        </div>
        <button
          onClick={playing ? stop : play}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
            playing ? 'bg-red-500/15 text-red-500' : 'bg-primary text-primary-foreground hover:opacity-90'
          }`}
          title={playing ? 'Stop' : 'Play'}
        >
          {playing ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-100"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[10px] font-mono text-muted-foreground/50">
          {chords.join(' · ')}
        </p>
        <p className="text-[10px] text-muted-foreground/40">synth · plays in your browser</p>
      </div>
    </div>
  );
}
