import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

async function build() {
  // Build extension (main process)
  const extCtx = await esbuild.context({
    entryPoints: [join(__dirname, 'src/extension.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: join(__dirname, 'dist/extension.js'),
    external: ['vscode', 'ws'],
    format: 'cjs',
    sourcemap: !isProduction,
    minify: isProduction
  });

  // Build webview (React app)
  const webviewCtx = await esbuild.context({
    entryPoints: [join(__dirname, 'src/webview/main.tsx')],
    bundle: true,
    platform: 'browser',
    target: 'es2020',
    outfile: join(__dirname, 'dist/webview.js'),
    format: 'iife',
    globalName: 'InfinityBuildWebview',
    sourcemap: !isProduction,
    minify: isProduction,
    loader: {
      '.tsx': 'tsx',
      '.css': 'text',
      '.svg': 'dataurl'
    },
    define: {
      'process.env.NODE_ENV': isProduction ? '"production"' : '"development"'
    }
  });

  if (isWatch) {
    await extCtx.watch();
    await webviewCtx.watch();
    console.log('Watching for changes...');
  } else {
    await extCtx.rebuild();
    await webviewCtx.rebuild();
    await extCtx.dispose();
    await webviewCtx.dispose();

    // Copy CSS to dist
    const cssSrc = join(__dirname, 'src/webview/styles.css');
    const cssDest = join(__dirname, 'dist/webview.css');
    if (existsSync(cssSrc)) {
      copyFileSync(cssSrc, cssDest);
    }

    // Copy media files
    const mediaSrc = join(__dirname, 'media');
    const mediaDest = join(__dirname, 'dist/media');
    if (existsSync(mediaSrc)) {
      mkdirSync(mediaDest, { recursive: true });
      cpSync(mediaSrc, mediaDest, { recursive: true });
    }

    console.log('Build complete!');
  }
}

build().catch(() => process.exit(1));