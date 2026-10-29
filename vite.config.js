import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser calls same-origin /api; the dev and preview servers forward it to the
// local Function API (npm run api), so no CORS setup is needed locally.
const apiProxy = { '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:7071', changeOrigin: true } };

// base: './' keeps every asset path relative, so the built `dist/` folder
// can be served from any static host, sub-path or CDN folder.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: { chunkSizeWarningLimit: 800 },
  test: { environment: 'node' },
});
