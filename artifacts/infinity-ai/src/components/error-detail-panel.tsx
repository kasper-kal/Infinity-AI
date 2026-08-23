import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertTriangle,
  Clock,
  Globe,
  Server,
  Cpu,
  FileCode,
  Layers,
  Terminal,
  X,
  Smartphone,
  Package,
  ShieldAlert,
  ClipboardList,
} from 'lucide-react';

/** Detailed error info sent from the backend */
export interface ErrorDetail {
  message: string;
  code: string;
  timestamp: string;
  statusCode: number;
  errorName: string;
  originalMessage: string;
  stack: string;
  request: {
    method: string;
    url: string;
    path: string;
    query: Record<string, unknown>;
    params: Record<string, unknown>;
    bodyKeys: string[];
    bodyPreview: Record<string, unknown>;
    bodySizeBytes: number;
    contentType: string | undefined;
    userAgent: string | undefined;
    origin: string | undefined;
    referer: string | undefined;
    ip: string | undefined;
    headers: Record<string, string>;
    body: string;
  };
  environment: {
    nodeEnv: string | undefined;
    port: string | undefined;
    llmModel: string | undefined;
    llmApiKeyConfigured: boolean;
    elevenLabsConfigured: boolean;
    tavilyConfigured: boolean;
    databaseUrlConfigured: boolean;
    uptimeSeconds: number;
    memoryUsageMB: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
  };
  config: {
    openRouterConfigured: boolean;
    openRouterModel: string | undefined;
    openAiConfigured: boolean;
    openAiModel: string | undefined;
    nvidiaConfigured: boolean;
    elevenLabsConfigured: boolean;
    tavilyConfigured: boolean;
    figmaConfigured: boolean;
    weatherConfigured: boolean;
    gmailConfigured: boolean;
    spotifyConfigured: boolean;
    databaseConfigured: boolean;
    browserAutomationConfigured: boolean;
  };
  process: {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    cwd: string;
    commandLine: string;
    versions: Record<string, string>;
  };
  durationMs: number | null;
  llm?: {
    model: string;
    endpoint: string;
    apiErrorCode: string | undefined;
    apiErrorMessage: string | undefined;
    apiErrorStatus: number | undefined;
    tokensUsed: number | undefined;
    requestId: string | undefined;
    rawError: string | undefined;
    baseUrl: string | undefined;
  };
  /** Client-side context added by the frontend when the error happened locally */
  client?: {
    url: string;
    path: string;
    userAgent: string;
    language: string;
    platform: string;
    online: boolean;
    viewport: string;
    devicePixelRatio: number;
    screen: string;
    memoryGB: number | undefined;
    cores: number | undefined;
    timestamp: string;
    appVersion: string | undefined;
    connectionType: string | undefined;
  };
}

interface ErrorDetailPanelProps {
  detail: ErrorDetail;
  onClose: () => void;
}

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-card/50 hover:bg-card transition-colors text-left"
      >
        <Icon className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
        <span className="text-[11px] font-mono font-medium tracking-wider text-foreground/80 flex-1">
          {title}
        </span>
        {open ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scaleY: 0.95 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0.95 }}
            transition={{ duration: 0.15 }}
            className="origin-top overflow-hidden"
          >
            <div className="px-3 py-2 border-t border-border/30">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, value, mono = true, color }: { label: string; value: string | number | boolean | undefined | null; mono?: boolean; color?: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-[10px] font-mono text-muted-foreground/60 tracking-wider min-w-[100px] flex-shrink-0 uppercase">
        {label}
      </span>
      <span
        className={`text-[11px] ${mono ? 'font-mono' : 'font-sans'} break-all ${
          color ?? 'text-foreground/80'
        }`}
      >
        {value === undefined || value === null ? (
          <span className="text-muted-foreground/40 italic">n/a</span>
        ) : typeof value === 'boolean' ? (
          value ? (
            <span className="text-green-400/80">yes</span>
          ) : (
            <span className="text-red-400/80">no</span>
          )
        ) : (
          String(value)
        )}
      </span>
    </div>
  );
}

function KeyValueBlock({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0)
    return (
      <span className="text-[10px] font-mono text-muted-foreground/40 italic">
        (empty)
      </span>
    );
  return (
    <div className="space-y-0.5">
      {entries.map(([k, v]) => (
        <Row key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')} />
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground/50 hover:text-foreground/70"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/** Status badge color based on HTTP status code */
function statusColor(code: number): string {
  if (code >= 500) return 'text-red-400 bg-red-400/10 border-red-400/30';
  if (code >= 400) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
  return 'text-green-400 bg-green-400/10 border-green-400/30';
}

/** Severity color for error code */
function codeColor(code: string): string {
  if (code.includes('AUTH') || code.includes('RATE')) return 'text-red-400';
  if (code.includes('TIMEOUT') || code.includes('NETWORK')) return 'text-yellow-400';
  if (code.includes('DATABASE')) return 'text-orange-400';
  return 'text-primary';
}

/**
 * Build a fully readable plain-text dump of EVERYTHING known about the
 * error, every field flattened into lines so nothing is lost when pasted
 * into a bug report or chat message.
 */
function buildFullTextReport(detail: ErrorDetail): string {
  const L: string[] = [];
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null) L.push(`${k}: n/a`);
    else if (typeof v === 'object') L.push(`${k}: ${JSON.stringify(v)}`);
    else L.push(`${k}: ${v}`);
  };

  L.push('══════════════════════════════════════════');
  L.push('  INFINITY ERROR REPORT, EVERYTHING KNOWN');
  L.push('══════════════════════════════════════════');
  L.push('');

  L.push('── ERROR ──');
  push('message', detail.message);
  push('code', detail.code);
  push('statusCode', detail.statusCode);
  push('errorName', detail.errorName);
  push('originalMessage', detail.originalMessage);
  push('timestamp', detail.timestamp);
  push('durationMs', detail.durationMs);
  L.push('');

  L.push('── STACK TRACE ──');
  L.push(detail.stack);
  L.push('');

  L.push('── REQUEST ──');
  push('method', detail.request.method);
  push('url', detail.request.url);
  push('path', detail.request.path);
  push('query', detail.request.query);
  push('params', detail.request.params);
  push('bodyKeys', detail.request.bodyKeys);
  push('bodyPreview', detail.request.bodyPreview);
  push('bodySizeBytes', detail.request.bodySizeBytes);
  push('contentType', detail.request.contentType);
  push('userAgent', detail.request.userAgent);
  push('origin', detail.request.origin);
  push('referer', detail.request.referer);
  push('ip', detail.request.ip);
  L.push('headers:');
  for (const [k, v] of Object.entries(detail.request.headers ?? {})) L.push(`  ${k}: ${v}`);
  if (detail.request.body) {
    L.push('body:');
    L.push(detail.request.body.split('\n').map(l => `  ${l}`).join('\n'));
  }
  L.push('');

  L.push('── CLIENT CONTEXT (browser) ──');
  if (detail.client) {
    push('url', detail.client.url);
    push('path', detail.client.path);
    push('userAgent', detail.client.userAgent);
    push('language', detail.client.language);
    push('platform', detail.client.platform);
    push('online', detail.client.online);
    push('viewport', detail.client.viewport);
    push('devicePixelRatio', detail.client.devicePixelRatio);
    push('screen', detail.client.screen);
    push('memoryGB', detail.client.memoryGB);
    push('cores', detail.client.cores);
    push('connectionType', detail.client.connectionType);
    push('appVersion', detail.client.appVersion);
    push('timestamp', detail.client.timestamp);
  } else {
    L.push('(no client-side context captured)');
  }
  L.push('');

  L.push('── LLM / API ──');
  if (detail.llm) {
    push('model', detail.llm.model);
    push('endpoint', detail.llm.endpoint);
    push('baseUrl', detail.llm.baseUrl);
    push('apiErrorStatus', detail.llm.apiErrorStatus);
    push('apiErrorCode', detail.llm.apiErrorCode);
    push('apiErrorMessage', detail.llm.apiErrorMessage);
    push('tokensUsed', detail.llm.tokensUsed);
    push('requestId', detail.llm.requestId);
    if (detail.llm.rawError) {
      L.push('rawError:');
      L.push(detail.llm.rawError.split('\n').map(l => `  ${l}`).join('\n'));
    }
  } else {
    L.push('(not an LLM error)');
  }
  L.push('');

  L.push('── ENVIRONMENT (server) ──');
  push('nodeEnv', detail.environment.nodeEnv);
  push('port', detail.environment.port);
  push('llmModel', detail.environment.llmModel);
  push('llmApiKeyConfigured', detail.environment.llmApiKeyConfigured);
  push('elevenLabsConfigured', detail.environment.elevenLabsConfigured);
  push('tavilyConfigured', detail.environment.tavilyConfigured);
  push('databaseUrlConfigured', detail.environment.databaseUrlConfigured);
  push('uptimeSeconds', detail.environment.uptimeSeconds);
  push('memoryUsageMB', detail.environment.memoryUsageMB);
  L.push('');

  L.push('── SERVICE CONFIGURATION ──');
  push('openRouterConfigured', detail.config.openRouterConfigured);
  push('openRouterModel', detail.config.openRouterModel);
  push('openAiConfigured', detail.config.openAiConfigured);
  push('openAiModel', detail.config.openAiModel);
  push('nvidiaConfigured', detail.config.nvidiaConfigured);
  push('elevenLabsConfigured', detail.config.elevenLabsConfigured);
  push('tavilyConfigured', detail.config.tavilyConfigured);
  push('figmaConfigured', detail.config.figmaConfigured);
  push('weatherConfigured', detail.config.weatherConfigured);
  push('gmailConfigured', detail.config.gmailConfigured);
  push('spotifyConfigured', detail.config.spotifyConfigured);
  push('databaseConfigured', detail.config.databaseConfigured);
  push('browserAutomationConfigured', detail.config.browserAutomationConfigured);
  L.push('');

  L.push('── PROCESS ──');
  push('nodeVersion', detail.process.nodeVersion);
  push('platform', detail.process.platform);
  push('arch', detail.process.arch);
  push('pid', detail.process.pid);
  push('cwd', detail.process.cwd);
  push('commandLine', detail.process.commandLine);
  push('versions', detail.process.versions);
  L.push('');

  L.push('── FULL JSON (raw) ──');
  L.push(JSON.stringify(detail, null, 2));
  L.push('');

  return L.join('\n');
}

/** Build a client-side ErrorDetail when the error happened on the browser */
export function buildClientErrorDetail(msg: string, statusCode = 0): ErrorDetail {
  const now = new Date().toISOString();
  return {
    message: msg,
    code: 'CLIENT_SIDE_ERROR',
    timestamp: now,
    statusCode,
    errorName: 'ClientError',
    originalMessage: msg,
    stack: new Error(msg).stack ?? 'No stack trace available',
    request: {
      method: 'client',
      url: typeof window !== 'undefined' ? window.location.href : 'n/a',
      path: typeof window !== 'undefined' ? window.location.pathname : 'n/a',
      query: {},
      params: {},
      bodyKeys: [],
      bodyPreview: {},
      bodySizeBytes: 0,
      contentType: undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      referer: typeof document !== 'undefined' ? document.referrer : undefined,
      ip: undefined,
      headers: {},
      body: '',
    },
    environment: {
      nodeEnv: 'browser',
      port: undefined,
      llmModel: undefined,
      llmApiKeyConfigured: false,
      elevenLabsConfigured: false,
      tavilyConfigured: false,
      databaseUrlConfigured: false,
      uptimeSeconds: 0,
      memoryUsageMB: { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 },
    },
    config: {
      openRouterConfigured: false,
      openRouterModel: undefined,
      openAiConfigured: false,
      openAiModel: undefined,
      nvidiaConfigured: false,
      elevenLabsConfigured: false,
      tavilyConfigured: false,
      figmaConfigured: false,
      weatherConfigured: false,
      gmailConfigured: false,
      spotifyConfigured: false,
      databaseConfigured: false,
      browserAutomationConfigured: false,
    },
    process: {
      nodeVersion: 'browser',
      platform: 'browser',
      arch: 'browser',
      pid: 0,
      cwd: '',
      commandLine: '',
      versions: {},
    },
    durationMs: null,
    llm: undefined,
    client: {
      url: typeof window !== 'undefined' ? window.location.href : 'n/a',
      path: typeof window !== 'undefined' ? window.location.pathname : 'n/a',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
      language: typeof navigator !== 'undefined' ? navigator.language : 'n/a',
      platform: typeof navigator !== 'undefined' ? (navigator as any).platform ?? 'n/a' : 'n/a',
      online: typeof navigator !== 'undefined' ? navigator.onLine : false,
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'n/a',
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      screen: typeof window !== 'undefined' && window.screen ? `${window.screen.width}x${window.screen.height}` : 'n/a',
      memoryGB: (typeof navigator !== 'undefined' && (navigator as any).deviceMemory) || undefined,
      cores: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || undefined,
      timestamp: now,
      appVersion: typeof navigator !== 'undefined' ? (navigator as any).appVersion ?? undefined : undefined,
      connectionType: (typeof navigator !== 'undefined' && (navigator as any).connection?.effectiveType) || undefined,
    },
  };
}

export function ErrorDetailPanel({ detail, onClose }: ErrorDetailPanelProps) {
  const fullDump = JSON.stringify(detail, null, 2);
  const textReport = buildFullTextReport(detail);
  const [copiedAll, setCopiedAll] = useState(false);

  const copyEverything = () => {
    navigator.clipboard.writeText(textReport).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-x-0 bottom-0 z-[100] max-h-[85vh] bg-background border-t border-border/60 shadow-2xl overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-card/50 backdrop-blur-md flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-display font-bold tracking-wider text-foreground truncate">
              ERROR DETAILS
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${statusColor(detail.statusCode)}`}>
                {detail.statusCode || 'CLIENT'}
              </span>
              <span className={`text-[10px] font-mono font-bold tracking-wider ${codeColor(detail.code)}`}>
                {detail.code}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/50">
                {detail.durationMs !== null ? `${detail.durationMs}ms` : ''}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={copyEverything}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/30 text-primary text-[11px] font-mono font-bold tracking-wider hover:bg-primary/25 transition-colors"
          >
            {copiedAll ? <Check className="w-3.5 h-3.5 text-green-400" /> : <ClipboardList className="w-3.5 h-3.5" />}
            {copiedAll ? 'COPIED' : 'COPY EVERYTHING'}
          </button>
          <CopyButton text={fullDump} />
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 overscroll-contain">
        {/* Error message */}
        <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
          <p className="text-xs font-mono text-red-400/90 leading-relaxed break-all">
            {detail.originalMessage}
          </p>
        </div>

        {/* Client context (frontend-added) */}
        {detail.client && (
          <Section title="CLIENT CONTEXT (BROWSER)" icon={Smartphone} defaultOpen={true}>
            <div className="space-y-0.5">
              <Row label="URL" value={detail.client.url} />
              <Row label="Path" value={detail.client.path} />
              <Row label="User-Agent" value={detail.client.userAgent} />
              <Row label="Language" value={detail.client.language} />
              <Row label="Platform" value={detail.client.platform} />
              <Row label="Online" value={detail.client.online} />
              <Row label="Viewport" value={detail.client.viewport} />
              <Row label="Pixel ratio" value={detail.client.devicePixelRatio} />
              <Row label="Screen" value={detail.client.screen} />
              <Row label="RAM" value={detail.client.memoryGB ? `${detail.client.memoryGB} GB` : undefined} />
              <Row label="CPU cores" value={detail.client.cores} />
              <Row label="Connection" value={detail.client.connectionType} />
              <Row label="App version" value={detail.client.appVersion} />
              <Row label="Captured at" value={detail.client.timestamp} />
            </div>
          </Section>
        )}

        {/* Request Info */}
        <Section title="REQUEST" icon={Globe} defaultOpen={true}>
          <div className="space-y-0.5">
            <Row label="Method" value={detail.request.method} />
            <Row label="URL" value={detail.request.url} />
            <Row label="Path" value={detail.request.path} />
            {Object.keys(detail.request.query).length > 0 && (
              <Row label="Query" value={JSON.stringify(detail.request.query)} />
            )}
            {Object.keys(detail.request.params).length > 0 && (
              <Row label="Params" value={JSON.stringify(detail.request.params)} />
            )}
            <Row label="Body keys" value={detail.request.bodyKeys.join(', ') || '(none)'} />
            <Row label="Body size" value={`${detail.request.bodySizeBytes} bytes`} />
            <Row label="Content-Type" value={detail.request.contentType} />
            <Row label="User-Agent" value={detail.request.userAgent} />
            <Row label="Origin" value={detail.request.origin} />
            <Row label="Referer" value={detail.request.referer} />
            <Row label="IP" value={detail.request.ip} />
            <div className="pt-1 mt-1 border-t border-border/20">
              <p className="text-[9px] font-mono text-muted-foreground/50 mb-1">HEADERS (sanitized)</p>
              <KeyValueBlock data={detail.request.headers as unknown as Record<string, unknown>} />
            </div>
            {detail.request.body && (
              <div className="pt-1 mt-1 border-t border-border/20">
                <p className="text-[9px] font-mono text-muted-foreground/50 mb-1">BODY (redacted)</p>
                <pre className="text-[9px] font-mono text-foreground/60 whitespace-pre-wrap break-all bg-background/50 rounded-md p-2 border border-border/30 max-h-[150px] overflow-y-auto">
                  {detail.request.body}
                </pre>
              </div>
            )}
          </div>
        </Section>

        {/* Stack Trace */}
        <Section title="STACK TRACE" icon={Terminal} defaultOpen={true}>
          <div className="relative">
            <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all leading-relaxed bg-background/50 rounded-md p-2 border border-border/30 max-h-[200px] overflow-y-auto">
              {detail.stack}
            </pre>
            <div className="absolute top-1 right-1">
              <CopyButton text={detail.stack} />
            </div>
          </div>
        </Section>

        {/* Timestamp & Duration */}
        <Section title="TIMING" icon={Clock}>
          <div className="space-y-0.5">
            <Row label="Timestamp" value={detail.timestamp} />
            <Row label="Duration" value={detail.durationMs !== null ? `${detail.durationMs}ms` : 'n/a'} />
            <Row label="Server uptime" value={`${Math.floor(detail.environment.uptimeSeconds / 60)}m ${detail.environment.uptimeSeconds % 60}s`} />
          </div>
        </Section>

        {/* LLM Details (if present) */}
        {detail.llm && (
          <Section title="LLM / API" icon={FileCode}>
            <div className="space-y-0.5">
              <Row label="Model" value={detail.llm.model} />
              <Row label="Endpoint" value={detail.llm.endpoint} />
              <Row label="Base URL" value={detail.llm.baseUrl} />
              <Row label="API status" value={detail.llm.apiErrorStatus} />
              <Row label="API error" value={detail.llm.apiErrorCode} />
              <Row label="API message" value={detail.llm.apiErrorMessage} />
              <Row label="Tokens" value={detail.llm.tokensUsed} />
              <Row label="Request ID" value={detail.llm.requestId} />
              {detail.llm.rawError && (
                <div className="pt-1 mt-1 border-t border-border/20">
                  <p className="text-[9px] font-mono text-muted-foreground/50 mb-1">RAW API ERROR</p>
                  <pre className="text-[9px] font-mono text-red-400/80 whitespace-pre-wrap break-all bg-background/50 rounded-md p-2 border border-border/30 max-h-[150px] overflow-y-auto">
                    {detail.llm.rawError}
                  </pre>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Service configuration */}
        <Section title="SERVICE CONFIGURATION" icon={ShieldAlert}>
          <div className="space-y-0.5">
            <Row label="OpenRouter" value={detail.config.openRouterConfigured} />
            <Row label="OR model" value={detail.config.openRouterModel} />
            <Row label="OpenAI" value={detail.config.openAiConfigured} />
            <Row label="OpenAI model" value={detail.config.openAiModel} />
            <Row label="NVIDIA" value={detail.config.nvidiaConfigured} />
            <Row label="ElevenLabs" value={detail.config.elevenLabsConfigured} />
            <Row label="Tavily" value={detail.config.tavilyConfigured} />
            <Row label="Figma" value={detail.config.figmaConfigured} />
            <Row label="Weather" value={detail.config.weatherConfigured} />
            <Row label="Gmail" value={detail.config.gmailConfigured} />
            <Row label="Spotify" value={detail.config.spotifyConfigured} />
            <Row label="Database" value={detail.config.databaseConfigured} />
            <Row label="Browser" value={detail.config.browserAutomationConfigured} />
          </div>
        </Section>

        {/* Environment */}
        <Section title="ENVIRONMENT" icon={Cpu}>
          <div className="space-y-0.5">
            <Row label="Node env" value={detail.environment.nodeEnv} />
            <Row label="Port" value={detail.environment.port} />
            <Row label="LLM model" value={detail.environment.llmModel} />
            <Row label="LLM key" value={detail.environment.llmApiKeyConfigured} />
            <Row label="ElevenLabs key" value={detail.environment.elevenLabsConfigured} />
            <Row label="Tavily key" value={detail.environment.tavilyConfigured} />
            <Row label="Database URL" value={detail.environment.databaseUrlConfigured} />
          </div>
        </Section>

        {/* Process */}
        <Section title="SERVER PROCESS" icon={Package}>
          <div className="space-y-0.5">
            <Row label="Node" value={detail.process.nodeVersion} />
            <Row label="Platform" value={detail.process.platform} />
            <Row label="Arch" value={detail.process.arch} />
            <Row label="PID" value={detail.process.pid} />
            <Row label="CWD" value={detail.process.cwd} />
            <Row label="Command" value={detail.process.commandLine} />
            <Row label="Versions" value={JSON.stringify(detail.process.versions)} />
          </div>
        </Section>

        {/* Memory Usage */}
        <Section title="MEMORY" icon={Layers}>
          <div className="space-y-0.5">
            <Row label="RSS" value={`${detail.environment.memoryUsageMB.rss} MB`} />
            <Row label="Heap used" value={`${detail.environment.memoryUsageMB.heapUsed} MB`} />
            <Row label="Heap total" value={`${detail.environment.memoryUsageMB.heapTotal} MB`} />
            <Row label="External" value={`${detail.environment.memoryUsageMB.external} MB`} />
            <div className="mt-2 h-2 rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full bg-primary/40 rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (detail.environment.memoryUsageMB.heapUsed / Math.max(1, detail.environment.memoryUsageMB.heapTotal)) * 100)}%`,
                }}
              />
            </div>
            <p className="text-[9px] font-mono text-muted-foreground/40 text-right">
              {Math.round((detail.environment.memoryUsageMB.heapUsed / Math.max(1, detail.environment.memoryUsageMB.heapTotal)) * 100)}% heap used
            </p>
          </div>
        </Section>

        {/* Full JSON dump */}
        <Section title="FULL JSON" icon={Server}>
          <div className="relative">
            <pre className="text-[9px] font-mono text-foreground/60 whitespace-pre-wrap break-all leading-relaxed bg-background/50 rounded-md p-2 border border-border/30 max-h-[300px] overflow-y-auto">
              {fullDump}
            </pre>
            <div className="absolute top-1 right-1">
              <CopyButton text={fullDump} />
            </div>
          </div>
        </Section>

        {/* Copy everything */}
        <div className="sticky bottom-0 pt-2 pb-1 bg-gradient-to-t from-background via-background/95 to-transparent">
          <button
            onClick={copyEverything}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-primary text-xs font-mono font-bold tracking-wider hover:bg-primary/25 transition-colors"
          >
            {copiedAll ? <Check className="w-4 h-4 text-green-400" /> : <ClipboardList className="w-4 h-4" />}
            {copiedAll ? 'ALL DETAILS COPIED TO CLIPBOARD' : 'COPY EVERYTHING TO CLIPBOARD'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
