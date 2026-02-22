import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react({ jsxRuntime: 'automatic' }),
    {
      name: 'marketing-at-root',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0] || '/';
          const appPaths = ['/diagnostic', '/portal', '/report'];
          const isAppPath = appPaths.some((p) => url === p || url.startsWith(p + '/'));
          if (isAppPath) {
            req.url = '/app.html';
          }
          next();
        });
      },
    },
  ],
  root: '.',
  base: '/',
  publicDir: 'public',
  appType: 'spa',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
