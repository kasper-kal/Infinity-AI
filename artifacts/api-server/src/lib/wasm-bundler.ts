/**
 * WASM Bundler
 *
 * Browser-based incremental compilation using esbuild-wasm or swc-wasm.
 * Enables fast preview updates without server round-trips.
 */

export interface BundlerConfig {
  /** Bundler to use: 'esbuild' or 'swc' */
  bundler: 'esbuild' | 'swc';
  /** Target environment */
  target: 'es2020' | 'es2022' | 'esnext';
  /** Module format */
  format: 'esm' | 'cjs' | 'iife';
  /** Enable minification */
  minify: boolean;
  /** Source map generation */
  sourcemap: boolean | 'inline' | 'external';
  /** JSX transform */
  jsx: 'transform' | 'preserve' | 'automatic';
  /** JSX factory */
  jsxFactory: string;
  /** JSX fragment */
  jsxFragment: string;
  /** External dependencies to exclude from bundle */
  external: string[];
  /** Define replacements */
  define: Record<string, string>;
  /** Loader overrides */
  loader: Record<string, 'js' | 'jsx' | 'ts' | 'tsx' | 'json' | 'css' | 'text' | 'base64' | 'file' | 'dataurl'>;
}

export interface BundleInput {
  /** Entry point file path */
  entryPoint: string;
  /** File contents map (virtual filesystem) */
  files: Map<string, string>;
  /** Optional config overrides */
  config?: Partial<BundlerConfig>;
}

export interface BundleOutput {
  /** Bundled JavaScript code */
  code: string;
  /** Source map */
  map?: string;
  /** Output files (for multi-file outputs) */
  outputFiles: Array<{ path: string; contents: Uint8Array }>;
  /** Warnings during bundling */
  warnings: Array<{ text: string; location?: { file: string; line: number; column: number } }>;
  /** Errors during bundling */
  errors: Array<{ text: string; location?: { file: string; line: number; column: number } }>;
  /** Build time in ms */
  buildTime: number;
}

export interface IncrementalBuildResult {
  /** Updated bundle output */
  output: BundleOutput;
  /** Whether this was a full rebuild or incremental */
  incremental: boolean;
  /** Changed files that triggered rebuild */
  changedFiles: string[];
}

/**
 * WASM Bundler Class
 * Uses dynamic import to load esbuild-wasm or @swc/wasm-web in browser
 */
export class WasmBundler {
  private config: BundlerConfig;
  private bundler: any = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private fileCache: Map<string, string> = new Map();
  private lastBuildHash: string = '';
  private buildCounter = 0;

  // Default configuration
  private static readonly DEFAULT_CONFIG: BundlerConfig = {
    bundler: 'esbuild',
    target: 'es2020',
    format: 'esm',
    minify: false,
    sourcemap: 'inline',
    jsx: 'automatic',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    external: ['react', 'react-dom', 'react-dom/client'],
    define: {
      'process.env.NODE_ENV': '"development"',
      'globalThis.IS_PREVIEW': 'true',
    },
    loader: {
      '.js': 'js',
      '.jsx': 'jsx',
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.json': 'json',
      '.css': 'css',
      '.svg': 'text',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.gif': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl',
      '.ttf': 'dataurl',
      '.eot': 'dataurl',
    },
  };

  constructor(config: Partial<BundlerConfig> = {}) {
    this.config = { ...WasmBundler.DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the WASM bundler
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.initializing = this._initialize();
    return this.initializing;
  }

  private async _initialize(): Promise<void> {
    try {
      if (this.config.bundler === 'esbuild') {
        await this.initializeEsbuild();
      } else {
        await this.initializeSwc();
      }
      this.initialized = true;
      console.log(`[WasmBundler] Initialized with ${this.config.bundler}`);
    } catch (error) {
      console.error('[WasmBundler] Initialization failed:', error);
      throw error;
    } finally {
      this.initializing = null;
    }
  }

  /**
   * Initialize esbuild-wasm
   */
  private async initializeEsbuild(): Promise<void> {
    // Dynamic import esbuild-wasm
    // In production, this would be loaded from a CDN or bundled
    const esbuild = await import('esbuild-wasm');
    this.bundler = esbuild;

    // Initialize with WASM binary
    await this.bundler.initialize({
      wasmURL: 'https://unpkg.com/esbuild-wasm@0.23.0/esbuild.wasm',
      worker: false, // Run in main thread for simplicity
    });
  }

  /**
   * Initialize swc-wasm
   */
  private async initializeSwc(): Promise<void> {
    // Dynamic import @swc/wasm-web
    const swc = await import('@swc/wasm-web');
    this.bundler = swc;

    // SWC doesn't need explicit initialization like esbuild
    // It's ready to use after import
  }

  /**
   * Bundle files
   */
  async bundle(input: BundleInput): Promise<BundleOutput> {
    await this.initialize();

    const startTime = performance.now();
    this.buildCounter++;

    // Update file cache
    for (const [path, content] of input.files) {
      this.fileCache.set(path, content);
    }

    const config = { ...this.config, ...input.config };
    const entryPoint = input.entryPoint;

    let output: BundleOutput;

    if (this.config.bundler === 'esbuild') {
      output = await this.bundleWithEsbuild(entryPoint, config);
    } else {
      output = await this.bundleWithSwc(entryPoint, config);
    }

    output.buildTime = performance.now() - startTime;

    // Calculate hash for incremental builds
    const fileContents = Array.from(this.fileCache.values()).join('');
    this.lastBuildHash = this.hashString(fileContents);

    return output;
  }

  /**
   * Bundle with esbuild
   */
  private async bundleWithEsbuild(entryPoint: string, config: BundlerConfig): Promise<BundleOutput> {
    // Write virtual files to esbuild's virtual filesystem
    const writeResult = await this.bundler.writeVirtualFiles(
      Array.from(this.fileCache.entries()).map(([path, content]) => ({
        path,
        contents: new TextEncoder().encode(content),
      }))
    );

    if (writeResult.errors.length > 0) {
      return {
        code: '',
        outputFiles: [],
        warnings: [],
        errors: writeResult.errors,
        buildTime: 0,
      };
    }

    // Build
    const result = await this.bundler.build({
      entryPoints: [entryPoint],
      bundle: true,
      format: config.format,
      target: config.target,
      minify: config.minify,
      sourcemap: config.sourcemap,
      jsx: config.jsx,
      jsxFactory: config.jsxFactory,
      jsxFragment: config.jsxFragment,
      external: config.external,
      define: config.define,
      loader: config.loader,
      write: false,
      outdir: '/out',
      plugins: [
        {
          name: 'virtual-files',
          setup(build: any) {
            build.onResolve({ filter: /.*/ }, (args: any) => {
              // Handle virtual file resolution
              if (this.fileCache.has(args.path)) {
                return { path: args.path, namespace: 'virtual' };
              }
              return { external: true };
            });
          },
        },
      ],
    });

    // Read output files
    const outputFiles = await this.bundler.readVirtualFiles(
      result.outputFiles.map((f: any) => f.path)
    );

    const mainFile = outputFiles.find((f: any) => f.path.endsWith('.js') || f.path.endsWith('.mjs'));
    const mapFile = outputFiles.find((f: any) => f.path.endsWith('.map'));

    return {
      code: mainFile ? new TextDecoder().decode(mainFile.contents) : '',
      map: mapFile ? new TextDecoder().decode(mapFile.contents) : undefined,
      outputFiles: outputFiles.map((f: any) => ({
        path: f.path,
        contents: f.contents,
      })),
      warnings: result.warnings || [],
      errors: result.errors || [],
      buildTime: 0, // Will be set by caller
    };
  }

  /**
   * Bundle with swc
   */
  private async bundleWithSwc(entryPoint: string, config: BundlerConfig): Promise<BundleOutput> {
    // SWC doesn't have a built-in bundler like esbuild
    // For SWC, we'd need to use @swc/core with bundler plugin or use a different approach
    // For now, fall back to a simple transform

    const entryContent = this.fileCache.get(entryPoint);
    if (!entryContent) {
      return {
        code: '',
        outputFiles: [],
        warnings: [],
        errors: [{ text: `Entry point not found: ${entryPoint}` }],
        buildTime: 0,
      };
    }

    // Transform with SWC
    const result = await this.bundler.transform(entryContent, {
      filename: entryPoint,
      jsc: {
        parser: {
          syntax: entryPoint.endsWith('.tsx') ? 'typescript' : 'ecmascript',
          tsx: true,
          jsx: true,
          dynamicImport: true,
        },
        transform: {
          react: {
            runtime: config.jsx === 'automatic' ? 'automatic' : 'classic',
            pragma: config.jsxFactory,
            pragmaFrag: config.jsxFragment,
          },
        },
        target: config.target,
        externalHelpers: true,
      },
      module: {
        type: config.format === 'esm' ? 'es6' : 'commonjs',
      },
      sourceMaps: config.sourcemap !== false ? 'inline' : false,
      minify: config.minify,
    });

    return {
      code: result.code,
      map: result.map,
      outputFiles: [{ path: 'bundle.js', contents: new TextEncoder().encode(result.code) }],
      warnings: [],
      errors: [],
      buildTime: 0,
    };
  }

  /**
   * Incremental build - only rebuild changed files
   */
  async incrementalBuild(changedFiles: Map<string, string>): Promise<IncrementalBuildResult> {
    await this.initialize();

    const startTime = performance.now();

    // Update cache with changed files
    for (const [path, content] of changedFiles) {
      this.fileCache.set(path, content);
    }

    // For true incremental builds, we'd need to track dependency graph
    // For now, do a full rebuild but with cached files
    // A production implementation would use esbuild's incremental API

    const entryPoint = this.findEntryPoint();
    if (!entryPoint) {
      return {
        output: {
          code: '',
          outputFiles: [],
          warnings: [],
          errors: [{ text: 'No entry point found' }],
          buildTime: performance.now() - startTime,
        },
        incremental: true,
        changedFiles: Array.from(changedFiles.keys()),
      };
    }

    const output = await this.bundle({
      entryPoint,
      files: this.fileCache,
    });

    return {
      output,
      incremental: true,
      changedFiles: Array.from(changedFiles.keys()),
    };
  }

  /**
   * Find entry point from cached files
   */
  private findEntryPoint(): string | null {
    // Look for common entry points
    const entryPoints = ['/src/main.tsx', '/src/index.tsx', '/src/App.tsx', '/main.tsx', '/index.tsx', '/App.tsx'];
    for (const ep of entryPoints) {
      if (this.fileCache.has(ep)) return ep;
    }
    // Return first .tsx or .jsx file
    for (const [path] of this.fileCache) {
      if (path.endsWith('.tsx') || path.endsWith('.jsx')) return path;
    }
    return null;
  }

  /**
   * Transform a single file (for HMR)
   */
  async transformFile(filePath: string, code: string): Promise<{ code: string; map?: string }> {
    await this.initialize();

    if (this.config.bundler === 'esbuild') {
      const result = await this.bundler.transform(code, {
        loader: this.getLoaderForFile(filePath),
        jsx: this.config.jsx,
        jsxFactory: this.config.jsxFactory,
        jsxFragment: this.config.jsxFragment,
        target: this.config.target,
        sourcemap: this.config.sourcemap,
      });
      return { code: result.code, map: result.map };
    } else {
      const result = await this.bundler.transform(code, {
        filename: filePath,
        jsc: {
          parser: {
            syntax: filePath.endsWith('.tsx') ? 'typescript' : 'ecmascript',
            tsx: true,
            jsx: true,
          },
          transform: {
            react: {
              runtime: this.config.jsx === 'automatic' ? 'automatic' : 'classic',
              pragma: this.config.jsxFactory,
              pragmaFrag: this.config.jsxFragment,
            },
          },
          target: this.config.target,
        },
        sourceMaps: this.config.sourcemap !== false ? 'inline' : false,
      });
      return { code: result.code, map: result.map };
    }
  }

  /**
   * Get loader for file extension
   */
  private getLoaderForFile(filePath: string): string {
    const ext = '.' + filePath.split('.').pop()!;
    return this.config.loader[ext] || 'js';
  }

  /**
   * Simple hash function for change detection
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  /**
   * Get current file cache
   */
  getFileCache(): Map<string, string> {
    return new Map(this.fileCache);
  }

  /**
   * Clear file cache
   */
  clearCache(): void {
    this.fileCache.clear();
    this.lastBuildHash = '';
  }

  /**
   * Dispose the bundler
   */
  async dispose(): Promise<void> {
    if (this.bundler && typeof this.bundler.stop === 'function') {
      await this.bundler.stop();
    }
    this.bundler = null;
    this.initialized = false;
    this.fileCache.clear();
  }
}

/**
 * Create a bundler instance for preview components
 */
export function createPreviewBundler(config?: Partial<BundlerConfig>): WasmBundler {
  return new WasmBundler({
    ...config,
    // Preview-specific defaults
    minify: false,
    sourcemap: 'inline',
    target: 'es2020',
    format: 'esm',
  });
}

/**
 * Generate a standalone preview bundle for a component
 * This creates a self-contained HTML file that can run in an iframe
 */
export async function generatePreviewBundle(
  componentCode: string,
  componentName: string,
  imports: string[] = [],
  designSystem?: Record<string, any>
): Promise<string> {
  const bundler = createPreviewBundler();

  // Create virtual files
  const files = new Map<string, string>();

  // Add React and ReactDOM as external (loaded via CDN in preview)
  files.set('/src/main.tsx', `
import React from 'react';
import { createRoot } from 'react-dom/client';

${imports.map(imp => `import ${imp.split('/').pop()} from '${imp}';`).join('\n')}

${componentCode}

const App = () => (
  <div className="preview-container space-y-8">
    <${componentName} />
  </div>
);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
`);

  // Add design system CSS if provided
  if (designSystem) {
    const cssVars = `
:root {
  ${Object.entries(designSystem.colors || {}).map(([k, v]) => `--color-${k}: ${v};`).join('\n  ')}
  ${Object.entries(designSystem.spacing || {}).map(([k, v]) => `--spacing-${k}: ${v};`).join('\n  ')}
  ${Object.entries(designSystem.typography || {}).map(([k, v]) => `--font-${k}: ${JSON.stringify(v)};`).join('\n  ')}
}
`;
    files.set('/src/design-tokens.css', cssVars);
  }

  await bundler.initialize();

  const result = await bundler.bundle({
    entryPoint: '/src/main.tsx',
    files,
  });

  await bundler.dispose();

  if (result.errors.length > 0) {
    throw new Error(`Bundle failed: ${result.errors.map(e => e.text).join(', ')}`);
  }

  // Generate HTML with bundled code
  const designTokensCSS = designSystem ? `
    <style>
      :root {
        ${Object.entries(designSystem.colors || {}).map(([k, v]) => `--color-${k}: ${v};`).join('\n        ')}
        ${Object.entries(designSystem.spacing || {}).map(([k, v]) => `--spacing-${k}: ${v};`).join('\n        ')}
        ${Object.entries(designSystem.typography || {}).map(([k, v]) => `--font-${k}: ${JSON.stringify(v)};`).join('\n        ')}
      }
    </style>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview - ${componentName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: { extend: { colors: {}, borderRadius: {}, fontFamily: {} } },
    };
  </script>
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
    body { @apply bg-background text-foreground; font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; min-height: 100vh; }
    #root { width: 100%; }
    .preview-container { max-width: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    ${result.code}
  </script>
</body></html>`;
}