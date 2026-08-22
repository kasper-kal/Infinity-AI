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
    rollupOptions: {
      output: {
        manualChunks: undefined,
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
      // Jarvis's personal browser — live screenshots over WebSocket.
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
