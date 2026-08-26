/**
 * PHASE 12 — CHROME EXTENSION ARTIFACT GENERATOR
 *
 * Generates Manifest V3 Chrome extensions from a single prompt.
 * Types: popup, sidebar, content-script, background, devtools, new-tab, offscreen
 * Features: TypeScript, React/Vanilla, HMR, store-ready packaging.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactConfig,
  ArtifactScaffoldResult,
  ArtifactBuildResult,
  ArtifactDeployResult,
  ArtifactPreviewInfo,
  ChromeExtensionSettings,
  DeployTarget,
} from "../artifact-types";

export class ChromeExtensionGenerator {
  constructor(private config: ArtifactConfig) {}

  async generate(): Promise<ArtifactScaffoldResult> {
    const settings = this.config.settings as ChromeExtensionSettings;
    const type = settings.type || "popup";

    const files = await this.buildFiles(type, settings);
    const installCommands = this.getInstallCommands();
    const devCommands = this.getDevCommands();
    const buildCommands = this.getBuildCommands();
    const previewCommands = this.getPreviewCommands();
    const deployCommands = this.getDeployCommands();

    return {
      config: this.config,
      files,
      entryPoints: ["src/manifest.ts"],
      installCommands,
      devCommands,
      buildCommands,
      previewCommands,
      deployCommands,
    };
  }

  private async buildFiles(type: string, settings: ChromeExtensionSettings): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // package.json
    files.push({
      path: "package.json",
      content: this.generatePackageJson(type, settings),
      purpose: "NPM package configuration",
      isTemplate: false,
    });

    // tsconfig
    files.push({
      path: "tsconfig.json",
      content: this.generateTsConfig(),
      purpose: "TypeScript configuration",
      isTemplate: false,
    });

    // Manifest (dynamic)
    files.push({
      path: "src/manifest.ts",
      content: this.generateManifest(type, settings),
      purpose: "Manifest V3 configuration",
      isTemplate: false,
    });

    // Build script
    files.push({
      path: "build.mjs",
      content: this.generateBuildScript(),
      purpose: "ESBuild build script with HMR",
      isTemplate: false,
    });

    // Type-specific files
    switch (type) {
      case "popup":
        files.push(...this.generatePopupFiles());
        break;
      case "sidebar":
        files.push(...this.generateSidebarFiles());
        break;
      case "content-script":
        files.push(...this.generateContentScriptFiles(settings));
        break;
      case "background":
        files.push(...this.generateBackgroundFiles(settings));
        break;
      case "devtools":
        files.push(...this.generateDevtoolsFiles());
        break;
      case "new-tab":
        files.push(...this.generateNewTabFiles());
        break;
      case "offscreen":
        files.push(...this.generateOffscreenFiles());
        break;
    }

    // Shared: background service worker (if needed)
    if (settings.background || type === "background" || type === "sidebar") {
      files.push({
        path: "src/background/index.ts",
        content: this.generateBackgroundWorker(settings),
        purpose: "Service worker background script",
        isTemplate: false,
      });
    }

    // Shared: content scripts
    if (settings.contentScripts && settings.contentScripts.length > 0) {
      for (const cs of settings.contentScripts) {
        files.push({
          path: `src/content-scripts/${cs.matches[0]?.replace(/\*/g, 'all') || 'content'}.ts`,
          content: this.generateContentScript(cs),
          purpose: `Content script for ${cs.matches.join(', ')}`,
          isTemplate: false,
        });
      }
    }

    // Options page
    if (settings.optionsPage) {
      files.push({
        path: "src/options/index.html",
        content: this.generateOptionsHtml(),
        purpose: "Options page HTML",
        isTemplate: false,
      });
      files.push({
        path: "src/options/index.ts",
        content: this.generateOptionsTs(),
        purpose: "Options page logic",
        isTemplate: false,
      });
    }

    // Styles
    files.push({
      path: "src/styles/global.css",
      content: this.generateGlobalCss(),
      purpose: "Global styles",
      isTemplate: false,
    });

    // Icons (placeholder)
    files.push({
      path: "public/icons/icon16.png",
      content: "",
      purpose: "16x16 icon placeholder",
      isTemplate: false,
    });
    files.push({
      path: "public/icons/icon48.png",
      content: "",
      purpose: "48x48 icon placeholder",
      isTemplate: false,
    });
    files.push({
      path: "public/icons/icon128.png",
      content: "",
      purpose: "128x128 icon placeholder",
      isTemplate: false,
    });

    // README
    files.push({
      path: "README.md",
      content: this.generateReadme(type, settings),
      purpose: "Project documentation",
      isTemplate: false,
    });

    // .gitignore
    files.push({
      path: ".gitignore",
      content: "node_modules\ndist\n*.log\n.env\n.DS_Store\n*.crx\n*.zip",
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    // .webstore-ignore
    files.push({
      path: ".webstore-ignore",
      content: "node_modules\nsrc\ntest\nbuild.mjs\ntsconfig.json\n*.md\n!README.md\n.git\n*.log\n.env",
      purpose: "Chrome Web Store upload ignore",
      isTemplate: false,
    });

    return files;
  }

  private generatePackageJson(type: string, settings: ChromeExtensionSettings): string {
    return JSON.stringify({
      name: this.config.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      description: this.config.description,
      type: "module",
      scripts: {
        dev: "node build.mjs --dev",
        build: "node build.mjs --prod",
        "build:zip": "node build.mjs --prod --zip",
        preview: "npm run build && npx serve dist",
        test: "vitest run",
        lint: "eslint src --ext .ts,.tsx",
      },
      dependencies: {
        "webextension-polyfill": "^0.12.0",
      },
      devDependencies: {
        "typescript": "^5.3.0",
        "esbuild": "^0.19.0",
        "glob": "^10.3.0",
        "vitest": "^1.2.0",
        "@types/chrome": "^0.0.258",
        "@types/webextension-polyfill": "^0.10.0",
      },
    }, null, 2);
  }

  private generateTsConfig(): string {
    return JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        outDir: "./dist",
        rootDir: "./src",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        jsx: "react-jsx",
        jsxImportSource: "react",
        types: ["chrome", "webextension-polyfill"],
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist"],
    }, null, 2);
  }

  private generateManifest(type: string, settings: ChromeExtensionSettings): string {
    const name = this.config.name;
    const description = this.config.description;
    const permissions = settings.permissions || ["activeTab", "storage", "scripting"];
    const hostPermissions = settings.hostPermissions || [];

    const action: Record<string, unknown> = {};
    if (type === "popup") {
      action.default_popup = "popup.html";
      action.default_title = name;
      action.default_icon = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
    } else if (type === "sidebar") {
      action.default_panel = "sidebar.html";
      action.default_title = name;
      action.default_icon = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
    }

    const background = settings.background
      ? { service_worker: "background.js", type: settings.background.type || "module" }
      : (type === "background" ? { service_worker: "background.js", type: "module" } : undefined);

    const contentScripts = settings.contentScripts?.map(cs => ({
      matches: cs.matches,
      js: cs.js,
      css: cs.css,
      run_at: cs.runAt || "document_idle",
    })) || [];

    const devtools = settings.devtools ? { page: "devtools.html" } : undefined;

    const optionsPage = settings.optionsPage ? "options.html" : undefined;

    const manifest = {
      manifest_version: 3,
      name,
      version: "1.0.0",
      description,
      icons: { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" },
      action,
      background,
      content_scripts: contentScripts.length > 0 ? contentScripts : undefined,
      devtools,
      options_page: optionsPage,
      permissions,
      host_permissions: hostPermissions.length > 0 ? hostPermissions : undefined,
      web_accessible_resources: [
        { resources: ["icons/*", "styles/*"], matches: ["<all_urls>"] },
      ],
    };

    // Remove undefined values
    const cleanManifest = Object.fromEntries(
      Object.entries(manifest).filter(([, v]) => v !== undefined)
    );

    return `// Manifest V3 configuration - generated at build time
export default ${JSON.stringify(cleanManifest, null, 2)};`;
  }

  private generateBuildScript(): string {
    return `#!/usr/bin/env node
import { build } from 'esbuild';
import { glob } from 'glob';
import { copyFileSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.argv.includes('--dev');
const isZip = process.argv.includes('--zip');
const outDir = resolve(__dirname, 'dist');

async function main() {
  // Clean output
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // Build manifest
  const manifestModule = await import('./src/manifest.ts');
  const manifest = manifestModule.default;
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Copy public assets
  const publicDir = resolve(__dirname, 'public');
  if (existsSync(publicDir)) {
    copyDir(publicDir, outDir);
  }

  // Find entry points
  const entries = await glob('src/**/*.{ts,tsx,html,css}', { ignore: ['**/*.d.ts'] });

  // Build with esbuild
  await build({
    entryPoints: entries.filter(f => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.html')),
    bundle: true,
    outdir: outDir,
    platform: 'browser',
    format: 'esm',
    target: 'chrome100',
    splitting: true,
    sourcemap: isDev,
    minify: !isDev,
    loader: { '.tsx': 'tsx', '.html': 'text', '.css': 'text' },
    define: { 'process.env.NODE_ENV': isDev ? '"development"' : '"production"' },
    plugins: [
      {
        name: 'html-entry',
        setup(build) {
          build.onResolve({ filter: /\\.html$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path),
            namespace: 'html',
          }));
          build.onLoad({ filter: /.*/, namespace: 'html' }, async (args) => ({
            contents: readFileSync(args.path, 'utf-8'),
            loader: 'text',
          }));
        },
      },
    ],
  });

  // Zip for Chrome Web Store
  if (isZip) {
    const { createWriteStream } = await import('node:fs');
    const { createZip } = await import('zip-lib');
    const zipPath = resolve(__dirname, \`\${manifest.name}-\${manifest.version}.zip\`);
    await createZip(outDir, zipPath);
    console.log(\`✓ Created \${zipPath}\`);
  }

  console.log(isDev ? '✓ Dev build complete (watch mode)' : '✓ Production build complete');
}

function copyDir(src: string, dest: string) {
  const entries = require('node:fs').readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});`;
  }

  private generatePopupFiles(): GeneratedFile[] {
    return [
      {
        path: "src/popup/index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.config.name}</title>
  <link rel="stylesheet" href="../styles/global.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./index.tsx"></script>
</body>
</html>`,
        purpose: "Popup HTML",
        isTemplate: false,
      },
      {
        path: "src/popup/index.tsx",
        content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);`,
        purpose: "Popup entry point",
        isTemplate: false,
      },
      {
        path: "src/popup/App.tsx",
        content: `import React, { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';
import './App.css';

export function App() {
  const [count, setCount] = useState(0);
  const [activeTab, setActiveTab] = useState<browser.Tabs.Tab | null>(null);

  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) setActiveTab(tabs[0]);
    });
  }, []);

  const increment = async () => {
    const newCount = count + 1;
    setCount(newCount);
    await browser.storage.local.set({ count: newCount });
  };

  const saveNote = async (note: string) => {
    await browser.storage.local.set({ note });
  };

  return (
    <div className="popup">
      <header>
        <h1>${this.config.name}</h1>
        <p className="subtitle">${this.config.description}</p>
      </header>

      <section className="counter">
        <h2>Counter: {count}</h2>
        <button onClick={increment}>Increment</button>
      </section>

      <section className="note">
        <h2>Quick Note</h2>
        <textarea
          placeholder="Type a note..."
          onBlur={(e) => saveNote(e.target.value)}
        />
      </section>

      {activeTab && (
        <section className="tab-info">
          <h3>Current Tab</h3>
          <p>{activeTab.title}</p>
          <small>{activeTab.url}</small>
        </section>
      )}
    </div>
  );
}`,
        purpose: "Popup React component",
        isTemplate: false,
      },
      {
        path: "src/popup/App.css",
        content: `.popup {
  width: 360px;
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

header {
  text-align: center;
  margin-bottom: 16px;
}

header h1 { font-size: 18px; margin: 0 0 4px; }
.subtitle { font-size: 12px; color: #666; margin: 0; }

section { margin-bottom: 16px; }
section h2 { font-size: 14px; margin: 0 0 8px; }

button {
  background: #4285f4;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
button:hover { background: #3367d6; }

textarea {
  width: 100%;
  min-height: 80px;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px;
  box-sizing: border-box;
}

.tab-info {
  font-size: 12px;
  color: #666;
}
.tab-info p { margin: 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tab-info small { color: #999; }`,
        purpose: "Popup styles",
        isTemplate: false,
      },
    ];
  }

  private generateSidebarFiles(): GeneratedFile[] {
    return [
      {
        path: "src/sidebar/index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.config.name} - Sidebar</title>
  <link rel="stylesheet" href="../styles/global.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./index.tsx"></script>
</body>
</html>`,
        purpose: "Sidebar HTML",
        isTemplate: false,
      },
      {
        path: "src/sidebar/index.tsx",
        content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarApp } from './SidebarApp';

const root = createRoot(document.getElementById('root')!);
root.render(<SidebarApp />);`,
        purpose: "Sidebar entry point",
        isTemplate: false,
      },
      {
        path: "src/sidebar/SidebarApp.tsx",
        content: `import React, { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';

export function SidebarApp() {
  const [bookmarks, setBookmarks] = useState<browser.Bookmarks.BookmarkTreeNode[]>([]);

  useEffect(() => {
    browser.bookmarks.getTree().then(setBookmarks);
  }, []);

  return (
    <div className="sidebar">
      <header><h1>${this.config.name}</h1></header>
      <nav>
        <BookmarkTree nodes={bookmarks} />
      </nav>
    </div>
  );
}

function BookmarkTree({ nodes }: { nodes: browser.Bookmarks.BookmarkTreeNode[] }) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.id}>
          {node.url ? (
            <a href={node.url} target="_blank">{node.title}</a>
          ) : (
            <>
              <strong>{node.title}</strong>
              {node.children && <BookmarkTree nodes={node.children} />}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}`,
        purpose: "Sidebar React component",
        isTemplate: false,
      },
    ];
  }

  private generateContentScriptFiles(settings: ChromeExtensionSettings): GeneratedFile[] {
    return [
      {
        path: "src/content-script/index.ts",
        content: `import browser from 'webextension-polyfill';

console.log('[${this.config.name}] Content script loaded');

// Example: Inject UI into page
function injectUI() {
  const container = document.createElement('div');
  container.id = '${this.config.name.toLowerCase().replace(/\s+/g, "-")}-container';
  container.innerHTML = \`
    <div style="position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;">
      <button id="ext-toggle" style="padding: 8px 16px; background: #4285f4; color: white; border: none; border-radius: 4px; cursor: pointer;">
        ${this.config.name}
      </button>
    </div>
  \`;
  document.body.appendChild(container);

  document.getElementById('ext-toggle')?.addEventListener('click', () => {
    browser.runtime.sendMessage({ type: 'TOGGLE_POPUP' });
  });
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectUI);
} else {
  injectUI();
}

// Listen for messages from background/popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_INFO') {
    sendResponse({ title: document.title, url: window.location.href });
  }
  return true; // async response
});`,
        purpose: "Content script",
        isTemplate: false,
      },
    ];
  }

  private generateBackgroundFiles(settings: ChromeExtensionSettings): GeneratedFile[] {
    return [
      {
        path: "src/background/index.ts",
        content: this.generateBackgroundWorker(settings),
        purpose: "Background service worker",
        isTemplate: false,
      },
    ];
  }

  private generateBackgroundWorker(settings: ChromeExtensionSettings): string {
    return `import browser from 'webextension-polyfill';

console.log('[${this.config.name}] Background service worker started');

// Install / update handling
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Extension installed');
    // Set default settings
    browser.storage.local.set({ enabled: true, installTime: Date.now() });
  } else if (details.reason === 'update') {
    console.log('Extension updated to', browser.runtime.getManifest().version);
  }
});

// Message passing
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_SETTINGS':
      browser.storage.local.get().then(sendResponse);
      return true;
    case 'SET_SETTING':
      browser.storage.local.set({ [message.key]: message.value }).then(() => sendResponse({ ok: true }));
      return true;
    case 'TOGGLE_POPUP':
      browser.action.openPopup().catch(() => {});
      sendResponse({ ok: true });
      return true;
    default:
      sendResponse({ error: 'Unknown message type' });
  }
  return true;
});

// Tab events
browser.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await browser.tabs.get(activeInfo.tabId);
  console.log('Tab activated:', tab.url);
});

// Context menus
browser.contextMenus.create({
  id: '${this.config.name.toLowerCase().replace(/\s+/g, "-")}-menu',
  title: '${this.config.name}',
  contexts: ['selection', 'link', 'image'],
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === '${this.config.name.toLowerCase().replace(/\s+/g, "-")}-menu') {
    console.log('Context menu clicked:', info);
    // Handle context menu action
  }
});

// Alarm for periodic tasks
browser.alarms.create('periodic-sync', { periodInMinutes: 30 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodic-sync') {
    console.log('Running periodic sync...');
    // Sync data, check updates, etc.
  }
});

// Keyboard shortcuts
browser.commands.onCommand.addListener((command) => {
  if (command === 'toggle-extension') {
    browser.action.openPopup().catch(() => {});
  }
});`;
  }

  private generateContentScript(cs: ChromeExtensionSettings['contentScripts'][0]): string {
    return `import browser from 'webextension-polyfill';

console.log('[${this.config.name}] Content script loaded for:', location.href);

// Content script logic for: ${cs.matches.join(', ')}
// Run at: ${cs.runAt || 'document_idle'}

${cs.js?.map(js => `// Would load: ${js}`).join('\n') || '// Add your content script logic here'}

// Example: Observe DOM changes
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    // Handle DOM changes
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Cleanup on unload
window.addEventListener('unload', () => observer.disconnect());`;
  }

  private generateDevtoolsFiles(): GeneratedFile[] {
    return [
      {
        path: "src/devtools/devtools.html",
        content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this.config.name} DevTools</title>
</head>
<body>
  <script src="./devtools.js"></script>
  <script src="./panel.js"></script>
</body>
</html>`,
        purpose: "DevTools page",
        isTemplate: false,
      },
      {
        path: "src/devtools/devtools.ts",
        content: `import browser from 'webextension-polyfill';

// Create devtools panel
browser.devtools.panels.create(
  '${this.config.name}',
  'icons/icon16.png',
  'panel.html'
).then((panel) => {
  console.log('DevTools panel created');
  panel.onShown.addListener(() => console.log('Panel shown'));
  panel.onHidden.addListener(() => console.log('Panel hidden'));
});

// Access inspected window
const { inspectedWindow } = browser.devtools;
console.log('Inspected window:', inspectedWindow.tabId);

// Evaluate in inspected page
inspectedWindow.eval('console.log("Hello from devtools!")');`,
        purpose: "DevTools entry script",
        isTemplate: false,
      },
      {
        path: "src/devtools/panel.html",
        content: `<!DOCTYPE html>
<html>
<head><title>${this.config.name} Panel</title></head>
<body><div id="root"></div><script type="module" src="./panel.tsx"></script></body>
</html>`,
        purpose: "DevTools panel HTML",
        isTemplate: false,
      },
      {
        path: "src/devtools/panel.tsx",
        content: `import React from 'react';
import { createRoot } from 'react-dom/client';

function Panel() {
  return (
    <div style="padding: 16px; font-family: monospace; font-size: 13px;">
      <h2>${this.config.name} DevTools</h2>
      <p>Custom devtools panel for debugging.</p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);`,
        purpose: "DevTools panel React component",
        isTemplate: false,
      },
    ];
  }

  private generateNewTabFiles(): GeneratedFile[] {
    return [
      {
        path: "src/newtab/index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.config.name} - New Tab</title>
  <link rel="stylesheet" href="../styles/global.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./index.tsx"></script>
</body>
</html>`,
        purpose: "New tab page HTML",
        isTemplate: false,
      },
      {
        path: "src/newtab/index.tsx",
        content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import { NewTabApp } from './NewTabApp';

const root = createRoot(document.getElementById('root')!);
root.render(<NewTabApp />);`,
        purpose: "New tab entry point",
        isTemplate: false,
      },
      {
        path: "src/newtab/NewTabApp.tsx",
        content: `import React, { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';

export function NewTabApp() {
  const [time, setTime] = useState(new Date());
  const [bookmarks, setBookmarks] = useState<browser.Bookmarks.BookmarkTreeNode[]>([]);
  const [shortcuts, setShortcuts] = useState<Array<{title: string, url: string}>>([
    { title: 'GitHub', url: 'https://github.com' },
    { title: 'Twitter', url: 'https://twitter.com' },
    { title: 'Reddit', url: 'https://reddit.com' },
  ]);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    browser.bookmarks.getTree().then((tree) => {
      const bookmarkBar = tree[0]?.children?.find(c => c.title === 'Bookmarks bar')?.children || [];
      setBookmarks(bookmarkBar.slice(0, 8));
    });
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="newtab">
      <header>
        <h1>${this.config.name}</h1>
        <div className="clock">{time.toLocaleTimeString()}</div>
      </header>

      <main>
        <section className="shortcuts">
          <h2>Shortcuts</h2>
          <div className="grid">
            {shortcuts.map((s, i) => (
              <a key={i} href={s.url} target="_blank" className="shortcut">
                {s.title}
              </a>
            ))}
          </div>
        </section>

        {bookmarks.length > 0 && (
          <section className="bookmarks">
            <h2>Bookmarks Bar</h2>
            <div className="grid">
              {bookmarks.map((b) => b.url && (
                <a key={b.id} href={b.url} target="_blank" className="shortcut">
                  {b.title}
                </a>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}`,
        purpose: "New tab React component",
        isTemplate: false,
      },
    ];
  }

  private generateOffscreenFiles(): GeneratedFile[] {
    return [
      {
        path: "src/offscreen/offscreen.html",
        content: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${this.config.name} Offscreen</title></head>
<body><script type="module" src="./offscreen.ts"></script></body>
</html>`,
        purpose: "Offscreen document HTML",
        isTemplate: false,
      },
      {
        path: "src/offscreen/offscreen.ts",
        content: `import browser from 'webextension-polyfill';

console.log('[${this.config.name}] Offscreen document loaded');

// Offscreen document for long-running tasks
// Use cases: audio playback, DOM parsing, clipboard, etc.

// Example: Audio playback
const audio = new Audio();
audio.src = browser.runtime.getURL('audio/notification.mp3');

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'PLAY_AUDIO') {
    audio.play().catch(console.error);
  } else if (message.type === 'PARSE_HTML') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.html, 'text/html');
    // Process DOM...
    browser.runtime.sendMessage({ type: 'PARSE_RESULT', data: doc.body.innerText });
  }
});

// Keep alive
setInterval(() => {}, 1000 * 60 * 5); // 5 min keepalive`,
        purpose: "Offscreen document script",
        isTemplate: false,
      },
    ];
  }

  private generateOptionsHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.config.name} - Options</title>
  <link rel="stylesheet" href="../styles/global.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./index.tsx"></script>
</body>
</html>`;
  }

  private generateOptionsTs(): string {
    return `import React from 'react';
import { createRoot } from 'react-dom/client';
import { OptionsApp } from './OptionsApp';

createRoot(document.getElementById('root')!).render(<OptionsApp />);`;
  }

  private generateGlobalCss(): string {
    return `:root {
  --primary: #4285f4;
  --primary-hover: #3367d6;
  --bg: #fff;
  --text: #202124;
  --text-secondary: #5f6368;
  --border: #dadce0;
  --shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
button { font-family: inherit; }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.shortcut { display: block; padding: 12px; background: #f8f9fa; border: 1px solid var(--border); border-radius: 8px; text-align: center; font-size: 13px; transition: transform 0.1s, box-shadow 0.1s; }
.shortcut:hover { transform: translateY(-2px); box-shadow: var(--shadow); text-decoration: none; }`;
  }

  private generateReadme(type: string, settings: ChromeExtensionSettings): string {
    const typeDescriptions: Record<string, string> = {
      popup: "Click the extension icon to open a popup",
      sidebar: "Open a sidebar panel (Chrome 114+)",
      "content-script": "Runs on matching web pages",
      background: "Service worker for background tasks",
      devtools: "Adds a panel to Chrome DevTools",
      "new-tab": "Replaces the new tab page",
      offscreen: "Offscreen document for long-running tasks",
    };

    return `# ${this.config.name}

${this.config.description}

## Type: ${type}
${typeDescriptions[type]}

## Development

\`\`\`bash
npm install
npm run dev        # Development build with watch mode
npm run build      # Production build
npm run build:zip  # Create .zip for Chrome Web Store
\`\`\`

## Loading in Chrome

1. Open \`chrome://extensions/\`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the \`dist\` folder

## Project Structure

- \`src/manifest.ts\` — Manifest V3 config (source of truth)
- \`src/background/\` — Service worker
- \`src/popup/\` — Popup UI (if type=popup)
- \`src/sidebar/\` — Sidebar UI (if type=sidebar)
- \`src/content-scripts/\` — Content scripts
- \`src/devtools/\` — DevTools panel (if type=devtools)
- \`src/newtab/\` — New tab page (if type=new-tab)
- \`src/offscreen/\` — Offscreen document (if type=offscreen)
- \`src/options/\` — Options page (if enabled)
- \`public/icons/\` — Extension icons
- \`build.mjs\` — ESBuild build script

## Permissions

\`\`\`json
${JSON.stringify(settings.permissions, null, 2)}
\`\`\`

${settings.hostPermissions.length > 0 ? `## Host Permissions\n\n\`\`\`json\n${JSON.stringify(settings.hostPermissions, null, 2)}\n\`\`\`` : ''}

## Chrome Web Store

1. Run \`npm run build:zip\`
2. Upload the \`.zip\` to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Fill in store listing, screenshots, privacy policy
4. Submit for review

---

Generated by Infinity AI — Multi-Artifact Support (Phase 12)`;
  }

  private getInstallCommands(): string[] {
    return ["npm install"];
  }

  private getDevCommands(): string[] {
    return ["npm run dev"];
  }

  private getBuildCommands(): string[] {
    return ["npm run build"];
  }

  private getPreviewCommands(): string[] {
    return ["npm run preview"];
  }

  private getDeployCommands(): Record<string, string> {
    return {
      "chrome-web-store": "npm run build:zip && echo 'Upload dist.zip to Chrome Web Store'",
      "github-pages": "echo 'Not applicable for extensions'",
      "self-hosted": "echo 'Host dist/ folder or .crx file'",
    };
  }

  async build(artifactId: string, projectDir: string): Promise<ArtifactBuildResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Building Chrome extension: ${artifactId}`);
      const { execSync } = await import("node:child_process");
      const output = execSync("npm run build", { cwd: projectDir, encoding: "utf-8", timeout: 120000 });
      logs.push(output);

      const duration = Date.now() - startTime;
      logs.push(`✓ Build completed in ${duration}ms`);

      return {
        artifactId,
        success: true,
        outputDir: path.join(projectDir, "dist"),
        assets: ["dist/manifest.json"],
        logs,
        errors,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      errors.push(`Build failed: ${error}`);
      logs.push(`✗ Build failed in ${duration}ms`);
      return {
        artifactId,
        success: false,
        outputDir: "",
        assets: [],
        logs,
        errors,
        durationMs: duration,
      };
    }
  }

  async deploy(artifactId: string, projectDir: string, target: DeployTarget): Promise<ArtifactDeployResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Deploying Chrome extension ${artifactId} to ${target}`);

      const { execSync } = await import("node:child_process");
      if (target === "chrome-web-store") {
        execSync("npm run build:zip", { cwd: projectDir, encoding: "utf-8", timeout: 120000 });
        logs.push("✓ Created .zip for Chrome Web Store upload");
      }

      const duration = Date.now() - startTime;
      logs.push(`✓ Deploy preparation completed in ${duration}ms`);

      return {
        artifactId,
        target,
        success: true,
        url: target === "chrome-web-store" ? "https://chrome.google.com/webstore/devconsole" : undefined,
        logs,
        errors,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      errors.push(`Deploy failed: ${error}`);
      logs.push(`✗ Deploy failed in ${duration}ms`);
      return {
        artifactId,
        target,
        success: false,
        logs,
        errors,
        durationMs: duration,
      };
    }
  }

  async preview(artifactId: string, projectDir: string): Promise<ArtifactPreviewInfo> {
    return {
      artifactId,
      type: "local",
      url: "chrome://extensions (load unpacked from dist/)",
    };
  }
}

interface GeneratedFile {
  path: string;
  content: string;
  purpose: string;
  isTemplate: boolean;
}

export function generateChromeExtension(config: ArtifactConfig): ChromeExtensionGenerator {
  return new ChromeExtensionGenerator(config);
}