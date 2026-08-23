import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Increase memory limit for build
if (process.env.NODE_OPTIONS?.includes('--max-old-space-size') === false) {
  process.env.NODE_OPTIONS = '--max-old-space-size=8192 ' + (process.env.NODE_OPTIONS || '');
}

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    target: 'esnext',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          tensorflow: ['@tensorflow/tfjs', '@mediapipe/tasks-vision'],
          codemirror: ['@codemirror/state', '@codemirror/view', '@codemirror/lang-javascript', '@codemirror/lang-python', '@codemirror/lang-json', '@codemirror/lang-html', '@codemirror/lang-css', '@codemirror/autocomplete', '@codemirror/commands', '@codemirror/search', '@codemirror/lint', '@codemirror/fold'],
          xterm: ['xterm', 'xterm-addon-fit', 'xterm-addon-web-links', 'xterm-addon-search'],
          radix: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tooltip', '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-toast', '@radix-ui/react-popover', '@radix-ui/react-avatar', '@radix-ui/react-checkbox', '@radix-ui/react-radio-group', '@radix-ui/react-slider', '@radix-ui/react-switch', '@radix-ui/react-separator', '@radix-ui/react-label'],
          charts: ['recharts', 'd3-scale', 'd3-array', 'd3-shape'],
          leaflet: ['leaflet', 'react-leaflet', 'react-leaflet-markercluster'],
          puppeteer: ['puppeteer-core'],
          'react-heavy': ['react-markdown', 'remark-gfm', 'rehype-highlight', 'rehype-raw'],
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      '/api': {
        target: process.env.API_SERVER_URL || 'http://localhost:8080',
        // Keep the original Host header so the backend can build correct
        // absolute URLs (OAuth redirects, browser WebSocket URL) from
        // req.headers.host — e.g. the public preview domain.
        changeOrigin: false,
      },
      // Infinity's personal browser — live screenshots over WebSocket.
      // Forwards to the Puppeteer WS server so the client connects to the
      // same origin (works behind the preview proxy without opening ports).
      '/browser-ws': {
        target: `ws://localhost:${process.env.BROWSER_WS_PORT || '3002'}`,
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
