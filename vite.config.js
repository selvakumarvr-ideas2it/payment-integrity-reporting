import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const AZURE_FUNCTION_APP = 'https://func-hpm-api-001.azurewebsites.net';

// The browser calls same-origin /api; the dev and preview servers forward it so
// no CORS setup is needed locally.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appApi = env.API_PROXY_TARGET || 'http://localhost:7071';
  const queryApi = (env.QUERY_API_PROXY_TARGET || env.VITE_QUERY_API_BASE_URL || AZURE_FUNCTION_APP)
    .replace(/\/$/, '')
    .replace(/\/api$/i, '');
  const functionKey = (env.QUERY_API_FUNCTION_KEY || env.VITE_QUERY_API_KEY || env.VITE_API_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  const apiProxy = {
    '/api/v1': {
      target: queryApi,
      changeOrigin: true,
      secure: true,
      headers: functionKey ? { 'x-functions-key': functionKey } : {},
      configure(proxy) {
        proxy.on('proxyReq', (proxyReq) => {
          // App session JWT is not valid on the Function App and causes 401.
          proxyReq.removeHeader('Authorization');
          if (functionKey) proxyReq.setHeader('x-functions-key', functionKey);
        });
      },
    },
    '/api': { target: appApi, changeOrigin: true },
  };

  return {
    base: './',
    plugins: [react()],
    server: { port: 5173, proxy: apiProxy },
    preview: { proxy: apiProxy },
    build: { chunkSizeWarningLimit: 800 },
    test: { environment: 'node', exclude: ['node_modules/**', 'dist/**'] },
  };
});
