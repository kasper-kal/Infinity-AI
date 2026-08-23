import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, X, Loader2, Upload, Table2, MessageSquare } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useI18n } from '@/lib/i18n';
import { haptics } from '@/lib/haptics';

interface DataLabDialogProps {
  open: boolean;
  onClose: () => void;
  /** Ask Infinity to analyze the loaded data, payload is a text summary. */
  onAskInfinity: (summaryText: string) => void;
}

interface ParsedData {
  columns: string[];
  rows: Record<string, string>[];
  numericColumns: { name: string; min: number; max: number; mean: number; sum: number; count: number }[];
}

/** Parse CSV text into columns + rows (handles quoted fields). */
function parseCSV(text: string): ParsedData {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [], numericColumns: [] };

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',' || ch === ';' || ch === '\t') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const header = parseLine(lines[0]);
  const columns = header.map((h, i) => h || `Column ${i + 1}`);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < Math.min(lines.length, 5000); i++) {
    const cells = parseLine(lines[i]);
    const row: Record<string, string> = {};
    columns.forEach((c, idx) => { row[c] = cells[idx] ?? ''; });
    rows.push(row);
  }

  const numericColumns = columns
    .map((col) => {
      const vals = rows
        .map((r) => parseFloat(String(r[col]).replace(/[€$£,%\s]/g, '')))
        .filter((v) => Number.isFinite(v));
      if (vals.length === 0) return null;
      const sum = vals.reduce((a, b) => a + b, 0);
      return {
        name: col,
        min: Math.min(...vals),
        max: Math.max(...vals),
        mean: sum / vals.length,
        sum,
        count: vals.length,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return { columns, rows, numericColumns };
}

/** Build chart data from the first numeric column + first text column. */
function buildChartData(data: ParsedData) {
  const numeric = data.numericColumns[0];
  if (!numeric) return [];
  const labelCol = data.columns.find((c) => c !== numeric.name) ?? numeric.name;
  return data.rows.slice(0, 50).map((r, i) => {
    const raw = parseFloat(String(r[numeric.name]).replace(/[€$£,%\s]/g, ''));
    return {
      label: String(r[labelCol] || `Row ${i + 1}`).slice(0, 18),
      value: Number.isFinite(raw) ? raw : 0,
    };
  });
}

const CHART_COLORS = ['#007AFF', '#5856D6', '#FF9F0A', '#34C759', '#FF2D55', '#64D2FF', '#BF5AF2'];

export function DataLab({ open, onClose, onAskInfinity }: DataLabDialogProps) {
  const { t } = useI18n();
  const [data, setData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCol, setActiveCol] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    setParsing(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseCSV(String(reader.result ?? ''));
        if (parsed.columns.length === 0) {
          setError(t('datalab.empty'));
        } else {
          setData(parsed);
          setFileName(file.name);
          setActiveCol(parsed.numericColumns[0]?.name ?? parsed.columns[0]);
        }
      } catch {
        setError(t('datalab.parseError'));
      } finally {
        setParsing(false);
      }
    };
    reader.onerror = () => { setParsing(false); setError(t('datalab.readError')); };
    reader.readAsText(file);
  }, [t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const close = () => {
    haptics.light();
    setData(null);
    setFileName(null);
    setError(null);
    onClose();
  };

  /** Build a compact summary to hand to Infinity for analysis. */
  const askInfinity = () => {
    if (!data) return;
    haptics.medium?.();
    const numeric = data.numericColumns.slice(0, 5)
      .map((c) => `${c.name}: min=${c.min} max=${c.max} mean=${c.mean.toFixed(2)} sum=${c.sum.toFixed(2)} (${c.count} values)`)
      .join(' | ');
    const sample = data.rows.slice(0, 15).map((r) => JSON.stringify(r)).join('\n');
    const summary = [
      `DATA LAB analysis request, file: ${fileName ?? 'uploaded.csv'}`,
      `Columns: ${data.columns.join(', ')}`,
      `Rows: ${data.rows.length}`,
      numeric ? `Numeric stats, ${numeric}` : 'No numeric columns detected.',
      '',
      'Sample rows:',
      sample,
      '',
      'Please analyze this data: identify trends, anomalies, and anything interesting. Be specific and cite numbers.',
    ].join('\n');
    close();
    onAskInfinity(summary);
  };

  const chartData = data ? buildChartData(data) : [];
  const activeStats = data?.numericColumns.find((c) => c.name === activeCol);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            className="relative w-full max-w-lg rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-apple-lg overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="text-[12px] font-semibold tracking-wide font-rounded">{t('datalab.title')}</span>
              </div>
              <button onClick={close} className="p-1.5 rounded-full hover:bg-secondary/70 text-muted-foreground transition-colors" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto scrollbar-thin">
              {!data ? (
                <>
                  <label
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/50 bg-secondary/20 px-6 py-10 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  >
                    <Upload className="w-8 h-8 text-muted-foreground/50" />
                    <div className="text-center">
                      <p className="text-[13px] font-medium">{t('datalab.drop')}</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-1">{t('datalab.dropHint')}</p>
                    </div>
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                    />
                    <span className="px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">{t('datalab.browse')}</span>
                  </label>
                  {parsing && (
                    <p className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground/70">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('datalab.parsing')}
                    </p>
                  )}
                  {error && <p className="text-[11px] text-red-400/90 text-center">{error}</p>}
                </>
              ) : (
                <>
                  {/* File info */}
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                    <Table2 className="w-3.5 h-3.5" />
                    <span className="truncate">{fileName}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{data.columns.length} cols</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{data.rows.length} rows</span>
                  </div>

                  {/* Numeric column pills */}
                  {data.numericColumns.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-1.5">{t('datalab.column')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.numericColumns.map((c) => (
                          <button
                            key={c.name}
                            onClick={() => { haptics.light(); setActiveCol(c.name); }}
                            className={`px-2.5 py-1.5 rounded-full text-[10px] font-medium border transition-all ${
                              activeCol === c.name
                                ? 'border-primary/60 bg-primary/10 text-primary'
                                : 'border-border/40 text-muted-foreground/60 hover:text-foreground'
                            }`}
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-400/80">{t('datalab.noNumeric')}</p>
                  )}

                  {/* Stats */}
                  {activeStats && (
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: t('datalab.min'), value: activeStats.min },
                        { label: t('datalab.max'), value: activeStats.max },
                        { label: t('datalab.mean'), value: activeStats.mean.toFixed(2) },
                        { label: t('datalab.sum'), value: activeStats.sum.toFixed(0) },
                      ].map((s) => (
                        <div key={s.label} className="rounded-xl border border-border/40 bg-card/50 px-2 py-2 text-center">
                          <p className="text-[9px] font-mono text-muted-foreground/50">{s.label}</p>
                          <p className="text-[12px] font-semibold tabular-nums">{Number(s.value).toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Chart */}
                  {chartData.length > 0 && (
                    <div className="rounded-xl border border-border/40 bg-card/50 p-3">
                      <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 mb-2">
                        {activeCol} · {t('datalab.chart')}
                      </p>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                            <XAxis
                              dataKey="label"
                              tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                              interval="preserveStartEnd"
                              tickFormatter={(v: string) => (v.length > 8 ? `${v.slice(0, 8)}…` : v)}
                            />
                            <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip
                              contentStyle={{
                                background: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: 12,
                                fontSize: 11,
                              }}
                              labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                            />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                              {chartData.map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { haptics.light(); setData(null); setFileName(null); }}
                      className="flex-1 px-3 py-2.5 rounded-xl border border-border/50 text-[11px] font-medium text-muted-foreground hover:bg-secondary/70 transition-colors"
                    >
                      {t('datalab.newFile')}
                    </button>
                    <button
                      onClick={askInfinity}
                      className="flex-1 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      {t('datalab.askInfinity')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
