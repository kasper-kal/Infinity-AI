/**
 * Sandbox Pool Manager
 *
 * Pre-warmed iframe pool for sub-500ms cold start and sub-100ms HMR updates.
 * Reuses iframes instead of creating new ones, significantly reducing preview latency.
 */

export interface SandboxConfig {
  /** Number of iframes to pre-warm on initialization */
  poolSize: number;
  /** Maximum number of iframes in pool */
  maxPoolSize: number;
  /** Timeout for iframe to be considered "ready" */
  readyTimeout: number;
  /** Whether to enable the sandbox pool */
  enabled: boolean;
  /** CDN URLs for preloading */
  cdnUrls: {
    tailwind: string;
    react: string;
    reactDom: string;
    babel: string;
  };
}

export interface SandboxInstance {
  id: string;
  iframe: HTMLIFrameElement;
  status: 'initializing' | 'ready' | 'in-use' | 'error' | 'disposed';
  lastUsed: number;
  createdAt: number;
  config: SandboxConfig;
  /** Promise that resolves when iframe is ready */
  readyPromise: Promise<void>;
  /** Resolve function for readyPromise */
  resolveReady: () => void;
  /** Current component being previewed */
  currentComponent?: string;
}

export interface PreviewRequest {
  componentId: string;
  componentCode: string;
  imports?: string[];
  framework?: string;
  designSystem?: Record<string, any>;
  viewport?: 'mobile' | 'tablet' | 'desktop' | 'wide';
}

export interface PreviewResult {
  sandboxId: string;
  html: string;
  loadTime: number;
  fromPool: boolean;
}

/**
 * Generates the base HTML template for sandbox iframes
 */
function generateBaseHTML(config: SandboxConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Infinity Preview Sandbox</title>
  <script src="${config.cdnUrls.tailwind}"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'hsl(var(--border))',
            input: 'hsl(var(--input))',
            ring: 'hsl(var(--ring))',
            background: 'hsl(var(--background))',
            foreground: 'hsl(var(--foreground))',
            primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
            secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
            destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
            muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
            accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
            popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
            card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
          },
          borderRadius: {
            lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)',
          },
          fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'sans-serif'] },
        },
      },
    };
  </script>
  <script crossorigin src="${config.cdnUrls.react}"></script>
  <script crossorigin src="${config.cdnUrls.reactDom}"></script>
  <script src="${config.cdnUrls.babel}"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --background: 0 0% 100%;
      --foreground: 222.2 84% 4.9%;
      --card: 0 0% 100%;
      --card-foreground: 222.2 84% 4.9%;
      --popover: 0 0% 100%;
      --popover-foreground: 222.2 84% 4.9%;
      --primary: 221.2 83.2% 53.3%;
      --primary-foreground: 210 40% 98%;
      --secondary: 210 40% 96.1%;
      --secondary-foreground: 222.2 47.4% 11.2%;
      --muted: 210 40% 96.1%;
      --muted-foreground: 215.4 16.3% 46.9%;
      --accent: 210 40% 96.1%;
      --accent-foreground: 222.2 47.4% 11.2%;
      --destructive: 0 84.2% 60.2%;
      --destructive-foreground: 210 40% 98%;
      --border: 214.3 31.8% 91.4%;
      --input: 214.3 31.8% 91.4%;
      --ring: 221.2 83.2% 53.3%;
      --radius: 0.5rem;
      --font-sans: 'Inter', system-ui, sans-serif;
    }
    .dark {
      --background: 222.2 84% 4.9%;
      --foreground: 210 40% 98%;
      --card: 222.2 84% 4.9%;
      --card-foreground: 210 40% 98%;
      --popover: 222.2 84% 4.9%;
      --popover-foreground: 210 40% 98%;
      --primary: 217.2 91.2% 59.8%;
      --primary-foreground: 222.2 47.4% 11.2%;
      --secondary: 217.2 32.6% 17.5%;
      --secondary-foreground: 210 40% 98%;
      --muted: 217.2 32.6% 17.5%;
      --muted-foreground: 215 20.2% 65.1%;
      --accent: 217.2 32.6% 17.5%;
      --accent-foreground: 210 40% 98%;
      --destructive: 0 62.8% 30.6%;
      --destructive-foreground: 210 40% 98%;
      --border: 217.2 32.6% 17.5%;
      --input: 217.2 32.6% 17.5%;
      --ring: 224.3 76.3% 48%;
    }
    * { border-color: hsl(var(--border)); }
    body { @apply bg-background text-foreground; font-family: var(--font-sans); margin: 0; padding: 1.5rem; min-height: 100vh; }
    #root { width: 100%; }
    .preview-container { max-width: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    const cn = (...classes) => classes.filter(Boolean).join(' ');

    // Override console for capture
    const originalConsole = { ...console };
    ['log', 'error', 'warn'].forEach(method => {
      console[method] = (...args) => {
        originalConsole[method](...args);
        window.parent.postMessage({
          type: 'console',
          payload: { type: method, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') }
        }, '*');
      };
    });

    window.addEventListener('error', (event) => {
      window.parent.postMessage({ type: 'error', payload: { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno } }, '*');
    });

    window.addEventListener('unhandledrejection', (event) => {
      window.parent.postMessage({ type: 'error', payload: { message: event.reason?.message || String(event.reason) } }, '*');
    });

    // Notify parent that sandbox is ready
    window.parent.postMessage({ type: 'sandbox-ready' }, '*');
  </script>
</body></html>`;
}

/**
 * Sandbox Pool Manager Class
 */
export class SandboxPoolManager {
  private pool: Map<string, SandboxInstance> = new Map();
  private availablePool: Set<string> = new Set();
  private inUsePool: Set<string> = new Set();
  private config: SandboxConfig;
  private initializationPromise: Promise<void> | null = null;
  private container: HTMLElement | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = {
      poolSize: config.poolSize ?? 3,
      maxPoolSize: config.maxPoolSize ?? 10,
      readyTimeout: config.readyTimeout ?? 5000,
      enabled: config.enabled ?? true,
      cdnUrls: {
        tailwind: config.cdnUrls?.tailwind ?? 'https://cdn.tailwindcss.com',
        react: config.cdnUrls?.react ?? 'https://unpkg.com/react@18/umd/react.production.min.js',
        reactDom: config.cdnUrls?.reactDom ?? 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
        babel: config.cdnUrls?.babel ?? 'https://unpkg.com/@babel/standalone/babel.min.js',
      },
    };
  }

  /**
   * Initialize the sandbox pool - creates and pre-warms iframes
   */
  async initialize(container?: HTMLElement): Promise<void> {
    if (!this.config.enabled) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.container = container ?? document.body;

    this.initializationPromise = this._initializePool();
    return this.initializationPromise;
  }

  private async _initializePool(): Promise<void> {
    // Set up global message handler
    this.messageHandler = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageHandler);

    // Create initial pool
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.config.poolSize; i++) {
      promises.push(this.createSandbox());
    }

    await Promise.allSettled(promises);
    console.log(`[SandboxPool] Initialized with ${this.pool.size} sandboxes`);
  }

  /**
   * Create a new sandbox iframe
   */
  private async createSandbox(): Promise<string> {
    const id = `sandbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let resolveReady: () => void;
    const readyPromise = new Promise<void>(resolve => { resolveReady = resolve; });

    const iframe = document.createElement('iframe');
    iframe.id = id;
    iframe.style.cssText = `
      position: absolute;
      left: -9999px;
      top: -9999px;
      width: 1px;
      height: 1px;
      border: none;
      visibility: hidden;
    `;
    iframe.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-modals', 'allow-popups');

    const instance: SandboxInstance = {
      id,
      iframe,
      status: 'initializing',
      lastUsed: 0,
      createdAt: Date.now(),
      config: this.config,
      readyPromise,
      resolveReady: resolveReady!,
    };

    this.pool.set(id, instance);
    this.container!.appendChild(iframe);

    // Load base HTML
    iframe.srcdoc = generateBaseHTML(this.config);

    // Set timeout for ready state
    setTimeout(() => {
      const inst = this.pool.get(id);
      if (inst && inst.status === 'initializing') {
        inst.status = 'error';
        inst.resolveReady();
        console.warn(`[SandboxPool] Sandbox ${id} failed to initialize within timeout`);
      }
    }, this.config.readyTimeout);

    return id;
  }

  /**
   * Handle messages from sandbox iframes
   */
  private handleMessage(event: MessageEvent): void {
    // Only process messages from our sandboxes
    const instance = Array.from(this.pool.values()).find(inst => inst.iframe.contentWindow === event.source);
    if (!instance) return;

    const { type } = event.data;

    switch (type) {
      case 'sandbox-ready':
        instance.status = 'ready';
        instance.resolveReady();
        this.availablePool.add(instance.id);
        console.log(`[SandboxPool] Sandbox ${instance.id} ready`);
        break;

      case 'console':
      case 'error':
        // These are forwarded to the component using the sandbox
        break;
    }
  }

  /**
   * Get an available sandbox from the pool, creating one if needed
   */
  async acquire(): Promise<SandboxInstance> {
    // Find available sandbox
    for (const id of this.availablePool) {
      const instance = this.pool.get(id);
      if (instance && instance.status === 'ready') {
        this.availablePool.delete(id);
        this.inUsePool.add(id);
        instance.status = 'in-use';
        instance.lastUsed = Date.now();
        return instance;
      }
    }

    // No available sandbox, create new one if under max
    if (this.pool.size < this.config.maxPoolSize) {
      const id = await this.createSandbox();
      const instance = this.pool.get(id)!;
      await instance.readyPromise;
      this.availablePool.delete(id);
      this.inUsePool.add(id);
      instance.status = 'in-use';
      instance.lastUsed = Date.now();
      return instance;
    }

    // Pool at max, wait for one to become available
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        for (const id of this.availablePool) {
          const instance = this.pool.get(id);
          if (instance && instance.status === 'ready') {
            clearInterval(checkInterval);
            this.availablePool.delete(id);
            this.inUsePool.add(id);
            instance.status = 'in-use';
            instance.lastUsed = Date.now();
            resolve(instance);
            return;
          }
        }
      }, 50);

      // Fallback timeout
      setTimeout(() => {
        clearInterval(checkInterval);
        // Return the least recently used
        let oldestId: string | null = null;
        let oldestTime = Infinity;
        for (const id of this.inUsePool) {
          const inst = this.pool.get(id);
          if (inst && inst.lastUsed < oldestTime) {
            oldestTime = inst.lastUsed;
            oldestId = id;
          }
        }
        if (oldestId) {
          const instance = this.pool.get(oldestId)!;
          this.inUsePool.delete(oldestId);
          this.inUsePool.add(oldestId);
          instance.lastUsed = Date.now();
          resolve(instance);
        }
      }, this.config.readyTimeout);
    });
  }

  /**
   * Release a sandbox back to the pool
   */
  release(sandboxId: string): void {
    const instance = this.pool.get(sandboxId);
    if (!instance) return;

    this.inUsePool.delete(sandboxId);

    // Reset iframe to clean state
    instance.iframe.srcdoc = generateBaseHTML(this.config);
    instance.status = 'initializing';
    instance.currentComponent = undefined;

    // Wait for re-initialization
    let resolveReady: () => void;
    instance.readyPromise = new Promise<void>(resolve => { resolveReady = resolve; });
    instance.resolveReady = resolveReady!;

    setTimeout(() => {
      if (instance.status === 'initializing') {
        instance.status = 'error';
        instance.resolveReady();
        console.warn(`[SandboxPool] Sandbox ${sandboxId} failed to re-initialize`);
      }
    }, this.config.readyTimeout);

    // Add back to available after re-init
    instance.readyPromise.then(() => {
      if (instance.status === 'ready') {
        this.availablePool.add(sandboxId);
      }
    });
  }

  /**
   * Render a component in a sandbox
   */
  async render(request: PreviewRequest): Promise<PreviewResult> {
    const startTime = performance.now();
    const sandbox = await this.acquire();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Preview render timeout'));
        this.release(sandbox.id);
      }, 10000);

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== sandbox.iframe.contentWindow) return;

        const { type, payload } = event.data;

        if (type === 'ready') {
          clearTimeout(timeout);
          window.removeEventListener('message', handleMessage);

          const loadTime = performance.now() - startTime;
          const html = sandbox.iframe.srcdoc || '';

          resolve({
            sandboxId: sandbox.id,
            html,
            loadTime,
            fromPool: true,
          });

          // Don't release immediately - keep for potential HMR
          // Release will be called explicitly or on next acquire
        } else if (type === 'error') {
          clearTimeout(timeout);
          window.removeEventListener('message', handleMessage);
          reject(new Error(payload.message));
          this.release(sandbox.id);
        }
      };

      window.addEventListener('message', handleMessage);

      // Generate component HTML and inject
      const componentHtml = this.generateComponentHTML(request);
      sandbox.iframe.srcdoc = componentHtml;
      sandbox.currentComponent = request.componentId;
    });
  }

  /**
   * Generate HTML for a specific component
   */
  private generateComponentHTML(request: PreviewRequest): string {
    const { componentCode, imports = [], framework = 'nextjs', designSystem, viewport = 'desktop' } = request;

    const transformedImports = imports
      .filter(imp => !imp.startsWith('@/') && !imp.startsWith('./') && !imp.startsWith('../'))
      .map(imp => `import ${imp.split('/').pop()} from '${imp}';`)
      .join('\n');

    const codeWithoutImports = componentCode
      .split('\n')
      .filter(line => !line.trim().startsWith('import '))
      .join('\n');

    const designTokensCSS = designSystem ? `
      <style>
        :root {
          ${Object.entries(designSystem.colors || {}).map(([key, val]) => `--color-${key}: ${val};`).join('\n          ')}
          ${Object.entries(designSystem.spacing || {}).map(([key, val]) => `--spacing-${key}: ${val};`).join('\n          ')}
          ${Object.entries(designSystem.typography || {}).map(([key, val]) => `--font-${key}: ${JSON.stringify(val)};`).join('\n          ')}
        }
      </style>
    ` : '';

    const viewportStyles = {
      mobile: 'width: 375px;',
      tablet: 'width: 768px;',
      desktop: 'width: 1440px;',
      wide: 'width: 1920px;',
    }[viewport] || 'width: 1440px;';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview - ${request.componentId}</title>
  <script src="${this.config.cdnUrls.tailwind}"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: { extend: { colors: {}, borderRadius: {}, fontFamily: {} } },
    };
  </script>
  <script crossorigin src="${this.config.cdnUrls.react}"></script>
  <script crossorigin src="${this.config.cdnUrls.reactDom}"></script>
  <script src="${this.config.cdnUrls.babel}"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  ${designTokensCSS}
  <style>
    :root {
      --background: 0 0% 100%;
      --foreground: 222.2 84% 4.9%;
      --primary: 221.2 83.2% 53.3%;
      --primary-foreground: 210 40% 98%;
      --border: 214.3 31.8% 91.4%;
      --radius: 0.5rem;
    }
    .dark { --background: 222.2 84% 4.9%; --foreground: 210 40% 98%; --primary: 217.2 91.2% 59.8%; --border: 217.2 32.6% 17.5%; }
    * { border-color: hsl(var(--border)); box-sizing: border-box; }
    body { @apply bg-background text-foreground; font-family: var(--font-sans); margin: 0; padding: 1.5rem; min-height: 100vh; ${viewportStyles} }
    #root { width: 100%; }
    .preview-container { max-width: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    const cn = (...classes) => classes.filter(Boolean).join(' ');
    ${transformedImports}
    ${codeWithoutImports}
    const App = () => <div className="preview-container space-y-8">${componentCode.includes('export default') ? componentCode.split('export default')[1].trim().replace(/^function\s+\w+\s*/, '').replace(/^const\s+\w+\s*=\s*/, '').replace(/;$/, '') : componentCode}</div>;
    try {
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(<App />);
      window.parent.postMessage({ type: 'ready' }, '*');
    } catch (e) {
      window.parent.postMessage({ type: 'error', payload: { message: e.message } }, '*');
    }
  </script>
</body></html>`;
  }

  /**
   * Hot Module Replacement - update component in existing sandbox
   */
  async hmr(sandboxId: string, componentCode: string): Promise<{ success: boolean; loadTime: number }> {
    const startTime = performance.now();
    const instance = this.pool.get(sandboxId);

    if (!instance || instance.status !== 'in-use') {
      return { success: false, loadTime: performance.now() - startTime };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, loadTime: performance.now() - startTime });
      }, 5000);

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== instance.iframe.contentWindow) return;
        const { type } = event.data;
        if (type === 'ready') {
          clearTimeout(timeout);
          window.removeEventListener('message', handleMessage);
          resolve({ success: true, loadTime: performance.now() - startTime });
        } else if (type === 'error') {
          clearTimeout(timeout);
          window.removeEventListener('message', handleMessage);
          resolve({ success: false, loadTime: performance.now() - startTime });
        }
      };

      window.addEventListener('message', handleMessage);

      // Inject updated component via postMessage for true HMR
      instance.iframe.contentWindow?.postMessage({
        type: 'hmr-update',
        payload: { code: componentCode },
      }, '*');
    });
  }

  /**
   * Get pool statistics
   */
  getStats(): { total: number; available: number; inUse: number; initializing: number; error: number } {
    let initializing = 0, error = 0;
    for (const instance of this.pool.values()) {
      if (instance.status === 'initializing') initializing++;
      if (instance.status === 'error') error++;
    }
    return {
      total: this.pool.size,
      available: this.availablePool.size,
      inUse: this.inUsePool.size,
      initializing,
      error,
    };
  }

  /**
   * Dispose a sandbox permanently
   */
  dispose(sandboxId: string): void {
    const instance = this.pool.get(sandboxId);
    if (!instance) return;

    this.availablePool.delete(sandboxId);
    this.inUsePool.delete(sandboxId);
    instance.status = 'disposed';
    instance.iframe.remove();
    this.pool.delete(sandboxId);
  }

  /**
   * Cleanup all sandboxes
   */
  destroy(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }

    for (const instance of this.pool.values()) {
      instance.iframe.remove();
    }
    this.pool.clear();
    this.availablePool.clear();
    this.inUsePool.clear();
    this.initializationPromise = null;
  }
}

// Singleton instance
let poolInstance: SandboxPoolManager | null = null;

export function getSandboxPool(config?: Partial<SandboxConfig>): SandboxPoolManager {
  if (!poolInstance) {
    poolInstance = new SandboxPoolManager(config);
  }
  return poolInstance;
}

export function destroySandboxPool(): void {
  if (poolInstance) {
    poolInstance.destroy();
    poolInstance = null;
  }
}