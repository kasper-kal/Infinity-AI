import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CloudRain, Download, Heart, History, Moon, Music2, RefreshCw, Sparkles, Sun, Swords, X } from 'lucide-react';
import type { MusicComposition } from '@/types/widget';
import { useI18n } from '@/lib/i18n';
import { MusicWidget } from '@/components/widgets/MusicWidget';

interface MusicStudioProps { open: boolean; onClose: () => void; }
interface MoodCfg { tempo: number; root: string; scale: number[]; chords: number[]; bass: number[]; title: string; drum: number[]; }
interface TrackHistory { id: string; prompt: string; composition: MusicComposition; createdAt: number; }

const MOODS: Record<MusicComposition['mood'], MoodCfg> = {
  happy: { tempo: 128, root: 'C', scale: [0, 2, 4, 5, 7, 9, 11], chords: [0, 5, 7, 9], bass: [0, 5, 7, 9], title: 'Sunshine Groove', drum: [1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1] },
  chill: { tempo: 88, root: 'A', scale: [0, 2, 3, 5, 7, 9, 10], chords: [9, 5, 7, 0], bass: [9, 5, 7, 0], title: 'Midnight Drive', drum: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0] },
  epic: { tempo: 140, root: 'D', scale: [0, 2, 3, 5, 7, 8, 10], chords: [5, 0, 7, 3], bass: [5, 0, 7, 3], title: 'Rise of Heroes', drum: [1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0] },
  sad: { tempo: 72, root: 'E', scale: [0, 2, 3, 5, 7, 8, 10], chords: [0, 8, 5, 3], bass: [0, 8, 5, 3], title: 'Rainy Window', drum: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] },
};
const MOOD_META: { id: MusicComposition['mood']; icon: typeof Sun }[] = [
  { id: 'happy', icon: Sun },
  { id: 'chill', icon: Moon },
  { id: 'epic', icon: Swords },
  { id: 'sad', icon: CloudRain },
];

function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
function hashPrompt(prompt: string): number {
  let hash = 2166136261;
  for (let index = 0; index < prompt.length; index += 1) hash = Math.imul(hash ^ prompt.charCodeAt(index), 16777619);
  return hash >>> 0;
}
function moodFromPrompt(prompt: string): MusicComposition['mood'] {
  const value = prompt.toLowerCase();
  if (/sad|rain|melancholy|piano|emotional|nostalgic/.test(value)) return 'sad';
  if (/epic|hero|cinematic|battle|orchestra|powerful/.test(value)) return 'epic';
  if (/happy|bright|sun|dance|upbeat|fun/.test(value)) return 'happy';
  return 'chill';
}
function generateComposition(mood: MusicComposition['mood'], seed: number, prompt = ''): MusicComposition {
  const cfg = MOODS[mood];
  const rnd = seededRandom(seed);
  const melody: MusicComposition['melody'] = [];
  let time = 0;
  for (let bar = 0; bar < 4; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      if (rnd() < 0.28) { time += 1; continue; }
      const semi = cfg.scale[Math.floor(rnd() * cfg.scale.length)];
      const octave = 4 + Math.floor(rnd() * 2);
      const root = cfg.root;
      const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const rootIndex = noteNames.indexOf(root);
      melody.push({ note: `${noteNames[(rootIndex + semi) % 12]}${octave}`, dur: 1, time });
      time += 1;
    }
  }
  const title = prompt.trim() ? prompt.trim().slice(0, 36) : cfg.title;
  return { title, mood, tempo: cfg.tempo, root: cfg.root, scale: cfg.scale, chords: cfg.chords.map((semi) => `${cfg.root}${semi >= 12 ? 4 : 3}`), bass: cfg.bass.map((semi) => `${cfg.root}${semi >= 12 ? 3 : 2}`), melody, drumPattern: cfg.drum };
}

export function MusicStudio({ open, onClose }: MusicStudioProps) {
  const { t } = useI18n();
  const [mood, setMood] = useState<MusicComposition['mood']>('chill');
  const [seed, setSeed] = useState(1);
  const [prompt, setPrompt] = useState('');
  const [composition, setComposition] = useState<MusicComposition>(() => generateComposition('chill', 1));
  const [history, setHistory] = useState<TrackHistory[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('jarvis-music-history');
      if (raw) setHistory(JSON.parse(raw) as TrackHistory[]);
    } catch { /* history is optional */ }
  }, []);
  const persistHistory = useCallback((next: TrackHistory[]) => {
    const capped = next.slice(0, 8);
    setHistory(capped);
    try { localStorage.setItem('jarvis-music-history', JSON.stringify(capped)); } catch { /* quota is non-fatal */ }
  }, []);
  const compose = useCallback((nextMood: MusicComposition['mood'], nextSeed: number, nextPrompt = prompt, remember = true) => {
    const next = generateComposition(nextMood, nextSeed, nextPrompt);
    setMood(nextMood);
    setSeed(nextSeed);
    setComposition(next);
    if (remember) persistHistory([{ id: `${Date.now()}-${nextSeed}`, prompt: nextPrompt, composition: next, createdAt: Date.now() }, ...history.filter((item) => item.composition.title !== next.title)].slice(0, 8));
  }, [history, persistHistory, prompt]);
  const composeFromPrompt = () => {
    const nextPrompt = prompt.trim() || 'A chilled instrumental for a late-night drive';
    compose(moodFromPrompt(nextPrompt), hashPrompt(nextPrompt), nextPrompt);
  };
  const downloadTrack = () => {
    const payload = JSON.stringify({ format: 'jarvis-procedural-instrumental', composition, prompt, note: 'This is a composition recipe for the browser synth, not a rendered audio file.' }, null, 2);
    const link = document.createElement('a');
    link.href = `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`;
    link.download = `${composition.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'jarvis-track'}.json`;
    link.click();
  };
  const restore = (item: TrackHistory) => { setPrompt(item.prompt); setMood(item.composition.mood); setSeed(hashPrompt(item.prompt || item.composition.title)); setComposition(item.composition); setHistoryOpen(false); };

  return <AnimatePresence>{open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-3 backdrop-blur-md" onClick={onClose}><motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.97 }} transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }} onClick={(event) => event.stopPropagation()} className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border/50 bg-background shadow-apple-2xl">
    <header className="flex items-center gap-2 border-b border-border/40 px-5 py-4"><Music2 className="h-4 w-4 text-emerald-500" /><div className="min-w-0 flex-1"><p className="text-base font-semibold leading-tight">{t('studio.music.title')}</p><p className="text-[10px] text-muted-foreground/60">{t('studio.music.subtitle')}</p></div><button type="button" onClick={() => setHistoryOpen((value) => !value)} className="flex items-center gap-1.5 rounded-full border border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-muted/40"><History className="h-3 w-3" />{t('studio.music.history')} ({history.length})</button><button type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-muted/50" aria-label={t('studio.music.close')}><X className="h-4 w-4" /></button></header>
    {historyOpen && <div className="flex gap-2 overflow-x-auto border-b border-border/40 bg-muted/10 p-3">{history.length === 0 ? <p className="text-xs text-muted-foreground">{t('studio.music.historyEmpty')}</p> : history.map((item) => <button type="button" key={item.id} onClick={() => restore(item)} className="w-36 shrink-0 rounded-xl border border-border/40 bg-background/70 p-2 text-left hover:border-primary/40"><p className="truncate text-[11px] font-medium">{item.composition.title}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{item.composition.mood} · {item.composition.tempo} BPM</p></button>)}</div>}
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"><div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3"><div className="flex items-center gap-2 text-xs font-medium text-emerald-400"><Sparkles className="h-3.5 w-3.5" />{t('studio.music.promptTitle')}</div><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t('studio.music.promptDesc')}</p><div className="mt-3 flex gap-2"><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') composeFromPrompt(); }} placeholder={t('studio.music.promptPlaceholder')} className="min-w-0 flex-1 rounded-xl border border-border/40 bg-background/70 px-3 py-2.5 text-xs outline-none" /><button type="button" onClick={composeFromPrompt} className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-400">{t('studio.music.create')}</button></div></div><div><p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground/50">{t('studio.music.mood')}</p><div className="grid grid-cols-2 gap-2">{MOOD_META.map((item) => <button type="button" key={item.id} onClick={() => compose(item.id, seed, prompt, true)} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px] font-medium transition-all active:scale-[0.98] ${mood === item.id ? 'border-emerald-500/40 bg-emerald-500/10 text-foreground' : 'border-border/40 text-muted-foreground hover:bg-muted/30'}`}><item.icon className="h-4 w-4 text-emerald-500" />{t(`studio.music.mood.${item.id}` as const)}</button>)}</div></div><div><div className="mb-2 flex items-center justify-between"><p className="text-[10px] uppercase tracking-widest text-muted-foreground/50">{t('studio.music.nowPlaying')}</p><button type="button" onClick={() => compose(mood, seed + 1, prompt, true)} className="flex items-center gap-1.5 rounded-full border border-border/40 px-2.5 py-1 text-[10px] text-muted-foreground hover:bg-muted/30"><RefreshCw className="h-3 w-3" />{t('studio.music.newTake')}</button></div><MusicWidget composition={composition} /></div><div className="flex flex-wrap gap-2"><button type="button" onClick={downloadTrack} className="flex items-center gap-1.5 rounded-xl border border-border/50 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"><Download className="h-3.5 w-3.5" />{t('studio.music.downloadRecipe')}</button><span className="rounded-xl bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">Seed {seed}</span></div><p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground/50"><Heart className="h-3 w-3" />{t('studio.music.previewNote')}</p></div>
  </motion.div></motion.div>}</AnimatePresence>;
}
