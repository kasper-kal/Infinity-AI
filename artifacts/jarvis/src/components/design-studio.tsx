import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { Download, FlipHorizontal2, ImagePlus, Layers3, Loader2, MoveDown, MoveUp, Plus, RotateCw, Save, Sparkles, Trash2, Type, Upload, Wand2, X } from 'lucide-react';

interface DesignStudioProps {
  open: boolean;
  onClose: () => void;
  initialImage?: string | null;
}

const FILTERS = [
  { key: 'brightness', i18nKey: 'studio.design.brightness', min: 0, max: 200, def: 100, unit: '%' },
  { key: 'contrast', i18nKey: 'studio.design.contrast', min: 0, max: 200, def: 100, unit: '%' },
  { key: 'saturate', i18nKey: 'studio.design.saturate', min: 0, max: 300, def: 100, unit: '%' },
  { key: 'hue', i18nKey: 'studio.design.hue', min: 0, max: 360, def: 0, unit: '°' },
  { key: 'blur', i18nKey: 'studio.design.blur', min: 0, max: 10, def: 0, unit: 'px' },
  { key: 'grayscale', i18nKey: 'studio.design.grayscale', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'sepia', i18nKey: 'studio.design.sepia', min: 0, max: 100, def: 0, unit: '%' },
  { key: 'invert', i18nKey: 'studio.design.invert', min: 0, max: 100, def: 0, unit: '%' },
] as const;

type FilterValues = Record<string, number>;
type LayerKind = 'image' | 'text' | 'shape';
type ShapeKind = 'rectangle' | 'circle';
interface DesignLayer {
  id: string;
  name: string;
  kind: LayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  text?: string;
  fontSize?: number;
  shape?: ShapeKind;
  fill?: string;
}
interface DesignSnapshot {
  id: string;
  name: string;
  image: string;
  layers: DesignLayer[];
  values: FilterValues;
  createdAt: number;
}

const CROP_PRESETS = [
  { label: 'Free', ratio: 0 },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];
const AI_ASPECTS = [
  { label: 'Square', w: 1024, h: 1024 },
  { label: 'Landscape', w: 1280, h: 720 },
  { label: 'Portrait', w: 720, h: 1280 },
];
const TEMPLATES = [
  { id: 'poster', label: 'Poster', ratio: 3 / 4, text: 'YOUR TITLE', fill: '#111827' },
  { id: 'social', label: 'Social', ratio: 1, text: 'MAKE IT YOURS', fill: '#172554' },
  { id: 'card', label: 'Card', ratio: 4 / 3, text: 'A NOTE FOR YOU', fill: '#3f1d3b' },
  { id: 'story', label: 'Story', ratio: 9 / 16, text: 'THE MOMENT', fill: '#082f49' },
] as const;
const AI_SUGGESTIONS = [
  'A photorealistic husky in the snow, golden hour',
  'A minimal product poster for a coffee shop',
  'A dreamy anime landscape at sunset',
  'A sleek logo for a creative studio',
];
const defaultValues = (): FilterValues => Object.fromEntries(FILTERS.map((filter) => [filter.key, filter.def]));
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function DesignStudio({ open, onClose, initialImage }: DesignStudioProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingLayersRef = useRef<DesignLayer[] | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [fileName, setFileName] = useState('Untitled design');
  const [values, setValues] = useState<FilterValues>(() => defaultValues());
  const [rotation, setRotation] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [cropRatio, setCropRatio] = useState(0);
  const [layers, setLayers] = useState<DesignLayer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [textSize, setTextSize] = useState(48);
  const [showTextPicker, setShowTextPicker] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<DesignSnapshot[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<DesignLayer[][]>([]);
  const [redoStack, setRedoStack] = useState<DesignLayer[][]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiAspect, setAiAspect] = useState(AI_ASPECTS[0]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('jarvis-design-history');
      if (raw) setHistory(JSON.parse(raw) as DesignSnapshot[]);
    } catch { /* local history is optional */ }
  }, []);

  const pushHistory = useCallback((next: DesignSnapshot[]) => {
    const capped = next.slice(0, 6);
    setHistory(capped);
    try { localStorage.setItem('jarvis-design-history', JSON.stringify(capped)); } catch { /* quota is non-fatal */ }
  }, []);

  const loadImage = useCallback((src: string, name: string, nextLayers?: DesignLayer[]) => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImageLoaded(true);
      setFileName(name);
      setSaved(false);
      setUndoStack([]);
      setRedoStack([]);
      setLayers(nextLayers ?? pendingLayersRef.current ?? [{ id: newId(), name: 'Image', kind: 'image', x: 0, y: 0, width: 1000, height: 700, rotation: 0, opacity: 1, zIndex: 0 }]);
      pendingLayersRef.current = null;
    };
    img.onerror = () => setAiError(t('studio.design.imageLoadError'));
    setImageLoaded(false);
    img.src = src;
  }, [t]);

  useEffect(() => {
    if (initialImage && initialImage.length > 100) loadImage(initialImage, 'generated.png');
  }, [initialImage, loadImage]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imgRef.current;
    if (!canvas || !image || !imageLoaded) return;
    const baseWidth = 1000;
    const sourceRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
    const baseHeight = Math.round(baseWidth / sourceRatio);
    const width = cropRatio > 0 ? baseWidth : baseWidth;
    const height = cropRatio > 0 ? Math.round(width / cropRatio) : baseHeight;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#101827';
    ctx.fillRect(0, 0, width, height);

    const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const imageWidth = image.naturalWidth * coverScale;
    const imageHeight = image.naturalHeight * coverScale;
    const imageLayer = layers.find((layer) => layer.kind === 'image');
    ctx.save();
    ctx.globalAlpha = imageLayer?.opacity ?? 1;
    ctx.filter = `brightness(${values.brightness ?? 100}%) contrast(${values.contrast ?? 100}%) saturate(${values.saturate ?? 100}%) hue-rotate(${values.hue ?? 0}deg) blur(${values.blur ?? 0}px) grayscale(${values.grayscale ?? 0}%) sepia(${values.sepia ?? 0}%) invert(${values.invert ?? 0}%)`;
    ctx.translate(width / 2, height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    if (flipped) ctx.scale(-1, 1);
    ctx.drawImage(image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
    ctx.restore();

    const ordered = layers.filter((layer) => layer.kind !== 'image').sort((a, b) => a.zIndex - b.zIndex);
    for (const layer of ordered) {
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      if (layer.kind === 'shape') {
        ctx.fillStyle = layer.fill ?? '#ffffff';
        if (layer.shape === 'circle') {
          ctx.beginPath();
          ctx.ellipse(0, 0, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
        }
      } else if (layer.kind === 'text') {
        ctx.font = `700 ${layer.fontSize ?? textSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = layer.fill ?? '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 8;
        ctx.fillText(layer.text ?? '', 0, 0, layer.width);
      }
      ctx.restore();
    }
    const selected = layers.find((layer) => layer.id === selectedId && layer.kind !== 'image');
    if (selected) {
      ctx.save();
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(selected.x, selected.y, selected.width, selected.height);
      ctx.restore();
    }
  }, [cropRatio, flipped, imageLoaded, layers, rotation, selectedId, textSize, values]);

  useEffect(() => { renderCanvas(); }, [renderCanvas]);

  const rememberLayers = useCallback((next: DesignLayer[]) => {
    setUndoStack((current) => [...current.slice(-19), layers]);
    setRedoStack([]);
    setLayers(next);
    setSaved(false);
  }, [layers]);

  const handleGenerate = useCallback(async (prompt?: string) => {
    const finalPrompt = (prompt ?? aiPrompt).trim();
    if (!finalPrompt || generating) return;
    setGenerating(true);
    setAiError('');
    try {
      const response = await fetch('/api/jarvis/generate-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: finalPrompt, width: aiAspect.w, height: aiAspect.h }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setAiError(body?.error || `Generation failed (${response.status})`);
        return;
      }
      const data = await response.json() as { image?: string };
      if (data.image) loadImage(data.image, 'ai-generated.png');
    } catch { setAiError(t('studio.design.generateError')); }
    finally { setGenerating(false); }
  }, [aiAspect, aiPrompt, generating, loadImage, t]);

  const applyTemplate = (template: typeof TEMPLATES[number]) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="100%" height="100%" fill="${template.fill}"/></svg>`;
    pendingLayersRef.current = [
      { id: newId(), name: 'Template background', kind: 'image', x: 0, y: 0, width: 1000, height: 700, rotation: 0, opacity: 1, zIndex: 0 },
      { id: newId(), name: 'Accent shape', kind: 'shape', shape: 'circle', x: 700, y: 40, width: 230, height: 230, rotation: 0, opacity: 0.3, fill: '#93c5fd', zIndex: 1 },
      { id: newId(), name: 'Title', kind: 'text', text: template.text, x: 90, y: 270, width: 820, height: 100, rotation: 0, opacity: 1, fontSize: 54, fill: '#ffffff', zIndex: 2 },
    ];
    setCropRatio(template.ratio);
    loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, `${template.label.toLowerCase()}-template.svg`);
    setTemplateOpen(false);
  };

  const addTextLayer = () => {
    const value = text.trim() || 'Double-click to edit';
    rememberLayers([...layers, { id: newId(), name: value.slice(0, 18), kind: 'text', text: value, x: 220, y: 280, width: 560, height: textSize + 24, rotation: 0, opacity: 1, fontSize: textSize, fill: '#ffffff', zIndex: layers.length }]);
    setText('');
  };
  const addShape = (shape: ShapeKind) => rememberLayers([...layers, { id: newId(), name: shape === 'circle' ? 'Circle' : 'Rectangle', kind: 'shape', shape, x: 330, y: 220, width: 260, height: 180, rotation: 0, opacity: 0.8, fill: shape === 'circle' ? '#38bdf8' : '#f59e0b', zIndex: layers.length }]);
  const selected = layers.find((layer) => layer.id === selectedId);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const hit = [...layers].reverse().find((layer) => layer.kind !== 'image' && x >= layer.x && x <= layer.x + layer.width && y >= layer.y && y <= layer.y + layer.height);
    setSelectedId(hit?.id ?? null);
    if (hit) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { id: hit.id, dx: x - hit.x, dy: y - hit.y };
    }
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    setLayers((current) => current.map((layer) => layer.id === drag.id ? { ...layer, x: Math.max(0, Math.min(canvas.width - layer.width, x - drag.dx)), y: Math.max(0, Math.min(canvas.height - layer.height, y - drag.dy)) } : layer));
    setSaved(false);
  };
  const handlePointerUp = () => { dragRef.current = null; };

  const removeSelected = () => { if (selected) rememberLayers(layers.filter((layer) => layer.id !== selected.id)); setSelectedId(null); };
  const moveSelected = (direction: -1 | 1) => {
    if (!selected) return;
    const next = layers.map((layer) => layer.id === selected.id ? { ...layer, zIndex: Math.max(1, layer.zIndex + direction) } : layer);
    rememberLayers(next);
  };
  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((current) => [...current, layers]);
    setUndoStack((current) => current.slice(0, -1));
    setLayers(previous);
  };
  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((current) => [...current, layers]);
    setRedoStack((current) => current.slice(0, -1));
    setLayers(next);
  };

  const snapshot = (name: string): DesignSnapshot | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return { id: newId(), name, image: imgRef.current?.src ?? canvas.toDataURL('image/png'), layers, values, createdAt: Date.now() };
  };
  const saveDesign = () => {
    const next = snapshot(fileName || 'Untitled design');
    if (!next) return;
    pushHistory([next, ...history.filter((item) => item.name !== next.name)]);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const restoreDesign = (item: DesignSnapshot) => {
    pendingLayersRef.current = item.layers;
    setValues(item.values);
    loadImage(item.image, item.name, item.layers);
    setHistoryOpen(false);
  };
  const exportImage = (format: 'png' | 'jpeg') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL(`image/${format}`, 0.92);
    link.download = `jarvis-design-${Date.now()}.${format === 'jpeg' ? 'jpg' : 'png'}`;
    link.click();
  };
  const exportSvg = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = canvas.toDataURL('image/png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><image href="${image}" width="100%" height="100%"/></svg>`;
    const link = document.createElement('a');
    link.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    link.download = `jarvis-design-${Date.now()}.svg`;
    link.click();
  };
  const printPdf = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const printWindow = window.open('about:blank', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<html><head><title>Infinity design PDF</title><style>body{margin:0;display:grid;place-items:center;min-height:100vh}img{max-width:100%;max-height:100vh}</style></head><body><img src="${canvas.toDataURL('image/png')}" alt="Design" /></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  const resetAll = () => { setValues(defaultValues()); setRotation(0); setFlipped(false); setCropRatio(0); setLayers(layers.map((layer) => layer.kind === 'image' ? layer : { ...layer, opacity: 1 })); setSaved(false); };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-2 backdrop-blur-md sm:p-6" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-border/50 bg-background shadow-apple-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-3 sm:px-5">
          <ImagePlus className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{t('studio.design.title')}</p><p className="text-[10px] text-muted-foreground/60">{t('studio.design.subtitle')}</p></div>
          <button type="button" onClick={() => setTemplateOpen((value) => !value)} className="rounded-full border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40"><Layers3 className="mr-1 inline h-3.5 w-3.5" />{t('studio.design.templates')}</button>
          <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="rounded-full border border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40">{t('studio.design.history')} ({history.length})</button>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-muted/50" aria-label={t('studio.design.close')}><X className="h-4 w-4" /></button>
          {templateOpen && <div className="absolute right-16 top-16 z-10 flex gap-1 rounded-2xl border border-border/50 bg-background/95 p-2 shadow-xl">{TEMPLATES.map((template) => <button type="button" key={template.id} onClick={() => applyTemplate(template)} className="rounded-xl px-3 py-2 text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary">{t(`studio.design.template.${template.id}` as TranslationKey)}</button>)}</div>}
        </header>

        {historyOpen && <div className="flex gap-2 overflow-x-auto border-b border-border/40 bg-muted/10 p-3">{history.length === 0 ? <p className="text-xs text-muted-foreground">{t('studio.design.historyEmpty')}</p> : history.map((item) => <button type="button" key={item.id} onClick={() => restoreDesign(item)} className="group flex w-28 shrink-0 flex-col gap-1 text-left"><img src={item.image} alt={item.name} className="h-16 w-28 rounded-lg border border-border/50 object-cover" /><span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground">{item.name}</span></button>)}</div>}

        {!imageLoaded ? <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center sm:p-10"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"><Wand2 className="h-7 w-7 text-primary" /></div><div><p className="mb-1 text-base font-semibold">{t('studio.design.start')}</p><p className="max-w-md text-xs text-muted-foreground">{t('studio.design.startDesc')}</p></div><div className="w-full max-w-lg"><div className="flex items-center gap-2 rounded-2xl border border-border/40 bg-muted/40 px-3 py-1"><Sparkles className="h-4 w-4 shrink-0 text-primary" /><input value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleGenerate(); }} placeholder={t('studio.design.describe')} className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" /><button type="button" onClick={() => void handleGenerate()} disabled={generating || !aiPrompt.trim()} className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40">{generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('studio.design.generate')}</button></div><div className="mt-2 flex justify-center gap-1.5">{AI_ASPECTS.map((aspect) => <button type="button" key={aspect.label} onClick={() => setAiAspect(aspect)} className={`rounded-full px-2.5 py-1 text-[10px] ${aiAspect.label === aspect.label ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'}`}>{t(`studio.design.aspect.${aspect.label.toLowerCase()}` as TranslationKey)}</button>)}</div><div className="mt-2 flex flex-wrap justify-center gap-1.5">{AI_SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => setAiPrompt(suggestion)} className="rounded-full border border-border/40 px-2.5 py-1 text-[10px] text-muted-foreground hover:bg-muted/30">{suggestion}</button>)}</div>{aiError && <p className="mt-2 text-[11px] text-red-400">{aiError}</p>}</div><div className="flex w-full max-w-lg items-center gap-2"><div className="h-px flex-1 bg-border/40" /><span className="text-[9px] uppercase tracking-widest text-muted-foreground/40">{t('studio.design.or')}</span><div className="h-px flex-1 bg-border/40" /></div><div className="flex flex-wrap justify-center gap-2">{TEMPLATES.map((template) => <button type="button" key={template.id} onClick={() => applyTemplate(template)} className="rounded-full border border-border/50 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30">{t(`studio.design.template.${template.id}` as TranslationKey)} {t('studio.design.templateSuffix')}</button>)}<button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-2 rounded-full border border-border/50 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/30"><Upload className="h-4 w-4" />{t('studio.design.upload')}</button></div><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => loadImage(String(reader.result), file.name); reader.readAsDataURL(file); event.target.value = ''; }} /></div> : <><div className="flex min-h-0 flex-1 flex-col lg:flex-row"><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-4"><canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} className="max-h-[52vh] max-w-full rounded-lg bg-checker shadow-lg" /></div><aside className="w-full shrink-0 overflow-y-auto border-t border-border/40 p-4 lg:w-80 lg:border-l lg:border-t-0"><div className="mb-3 flex items-center justify-between"><p className="truncate text-[10px] uppercase tracking-widest text-muted-foreground/60">{fileName}</p><button type="button" onClick={saveDesign} className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1.5 text-[10px] text-primary"><Save className="h-3 w-3" />{saved ? t('studio.design.saved') : t('studio.design.save')}</button></div><p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/50">{t('studio.design.layers')}</p><div className="mb-4 space-y-1">{layers.slice().sort((a, b) => b.zIndex - a.zIndex).map((layer) => <button type="button" key={layer.id} onClick={() => setSelectedId(layer.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] ${selectedId === layer.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/40'}`}><Layers3 className="h-3 w-3" />{layer.name}</button>)}</div><div className="mb-4 flex flex-wrap gap-1.5"><button type="button" onClick={() => addTextLayer()} className="rounded-lg bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground"><Type className="mr-1 inline h-3 w-3" />{t('studio.design.text')}</button><button type="button" onClick={() => addShape('rectangle')} className="rounded-lg bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground"><Plus className="mr-1 inline h-3 w-3" />{t('studio.design.rectangle')}</button><button type="button" onClick={() => addShape('circle')} className="rounded-lg bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground">{t('studio.design.circle')}</button>{selected && selected.kind !== 'image' && <><button type="button" onClick={() => moveSelected(1)} className="rounded-lg bg-muted/40 p-1.5 text-muted-foreground" title={t('studio.design.bringForward')}><MoveUp className="h-3 w-3" /></button><button type="button" onClick={() => moveSelected(-1)} className="rounded-lg bg-muted/40 p-1.5 text-muted-foreground" title={t('studio.design.sendBackward')}><MoveDown className="h-3 w-3" /></button><button type="button" onClick={removeSelected} className="rounded-lg bg-red-500/10 p-1.5 text-red-400" title={t('studio.design.deleteLayer')}><Trash2 className="h-3 w-3" /></button></>}</div>{selected?.kind === 'text' && <div className="mb-4 flex gap-1.5"><input value={selected.text ?? ''} onChange={(event) => setLayers((current) => current.map((layer) => layer.id === selected.id ? { ...layer, text: event.target.value, name: event.target.value.slice(0, 18) || 'Text' } : layer))} className="min-w-0 flex-1 rounded-lg border border-border/30 bg-muted/40 px-2.5 py-1.5 text-xs outline-none" placeholder={t('studio.design.layerText')} /><button type="button" onClick={() => setShowTextPicker((value) => !value)} className="rounded-lg bg-muted/40 p-2 text-muted-foreground"><Type className="h-3.5 w-3.5" /></button></div>}{showTextPicker && selected?.kind === 'text' && <input type="range" min={18} max={120} value={selected.fontSize ?? textSize} onChange={(event) => setLayers((current) => current.map((layer) => layer.id === selected.id ? { ...layer, fontSize: Number(event.target.value) } : layer))} className="mb-4 w-full accent-[var(--primary)]" />}{selected?.kind === 'shape' && <input type="color" value={selected.fill ?? '#ffffff'} onChange={(event) => setLayers((current) => current.map((layer) => layer.id === selected.id ? { ...layer, fill: event.target.value } : layer))} className="mb-4 h-8 w-full rounded-lg border border-border/40 bg-transparent" />}<p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/50">{t('studio.design.imageStyle')}</p><div className="mb-4 space-y-2">{FILTERS.map((filter) => <label key={filter.key} className="block"><div className="flex justify-between text-[10px] text-muted-foreground"><span>{t(filter.i18nKey as TranslationKey)}</span><span>{values[filter.key]}{filter.unit}</span></div><input type="range" min={filter.min} max={filter.max} value={values[filter.key]} onChange={(event) => setValues((current) => ({ ...current, [filter.key]: Number(event.target.value) }))} className="w-full accent-[var(--primary)]" /></label>)}</div><p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/50">{t('studio.design.cropTransform')}</p><div className="mb-3 flex flex-wrap gap-1">{CROP_PRESETS.map((crop) => <button type="button" key={crop.label} onClick={() => setCropRatio(crop.ratio)} className={`rounded-full px-2 py-1 text-[10px] ${cropRatio === crop.ratio ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'}`}>{crop.label === 'Free' ? t('studio.design.free') : crop.label === '1:1' ? t('studio.design.crop.square') : crop.label === '4:3' ? t('studio.design.crop.landscape') : crop.label === '3:4' ? t('studio.design.crop.portrait') : crop.label === '16:9' ? t('studio.design.crop.wide') : t('studio.design.crop.tall')}</button>)}</div><div className="mb-3 flex gap-1.5"><button type="button" onClick={() => setRotation((value) => (value + 90) % 360)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-muted/40 py-1.5 text-[10px] text-muted-foreground"><RotateCw className="h-3 w-3" />{t('studio.design.rotate')}</button><button type="button" onClick={() => setFlipped((value) => !value)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-muted/40 py-1.5 text-[10px] text-muted-foreground"><FlipHorizontal2 className="h-3 w-3" />{t('studio.design.flip')}</button></div><div className="mb-3 flex gap-1.5"><input value={text} onChange={(event) => setText(event.target.value)} placeholder={t('studio.design.layerText')} className="min-w-0 flex-1 rounded-lg border border-border/30 bg-muted/40 px-2.5 py-1.5 text-xs outline-none" /><button type="button" onClick={addTextLayer} className="rounded-lg bg-primary/10 px-2 text-[10px] text-primary">{t('studio.design.add')}</button></div><div className="mb-4 flex gap-1.5"><button type="button" onClick={undo} disabled={!undoStack.length} className="flex-1 rounded-lg border border-border/40 py-1.5 text-[10px] text-muted-foreground disabled:opacity-40">{t('studio.design.undo')}</button><button type="button" onClick={redo} disabled={!redoStack.length} className="flex-1 rounded-lg border border-border/40 py-1.5 text-[10px] text-muted-foreground disabled:opacity-40">{t('studio.design.redo')}</button></div><p className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/50">{t('studio.design.aiEdit')}</p><div className="mb-2 flex gap-1.5"><input value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleGenerate(); }} placeholder={t('studio.design.regenerate')} className="min-w-0 flex-1 rounded-lg border border-border/30 bg-muted/40 px-2.5 py-1.5 text-xs outline-none" /><button type="button" onClick={() => void handleGenerate()} disabled={generating || !aiPrompt.trim()} className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-40">{generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}</button></div>{aiError && <p className="mb-2 text-[10px] text-red-400">{aiError}</p>}<p className="text-[10px] leading-relaxed text-muted-foreground/60">{t('studio.design.regionLimit')}</p></aside></div><footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-4 py-3"><button type="button" onClick={resetAll} className="text-[11px] text-muted-foreground hover:text-foreground">{t('studio.design.reset')}</button><div className="flex flex-wrap gap-1.5"><button type="button" onClick={() => exportImage('png')} className="flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-[10px] text-primary-foreground"><Download className="h-3 w-3" />PNG</button><button type="button" onClick={() => exportImage('jpeg')} className="rounded-full border border-border/50 px-3 py-2 text-[10px] text-muted-foreground">JPG</button><button type="button" onClick={exportSvg} className="rounded-full border border-border/50 px-3 py-2 text-[10px] text-muted-foreground">SVG</button><button type="button" onClick={printPdf} className="rounded-full border border-border/50 px-3 py-2 text-[10px] text-muted-foreground">{t('studio.design.pdfPrint')}</button><button type="button" onClick={() => fileRef.current?.click()} className="rounded-full border border-border/50 px-3 py-2 text-[10px] text-muted-foreground"><Upload className="mr-1 inline h-3 w-3" />{t('studio.design.newImage')}</button></div><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => loadImage(String(reader.result), file.name); reader.readAsDataURL(file); event.target.value = ''; }} /></footer></>}
      </div>
    </div>
  );
}
