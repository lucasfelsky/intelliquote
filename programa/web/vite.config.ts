import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_INTELLIQUOTE_API_BASE ?? '/api';
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('firebase')) return 'firebase';
            if (id.includes('react-router')) return 'router';
            if (id.includes('react') || id.includes('scheduler')) return 'react';
            return 'vendor';
          },
        },
      },
    },
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(env.VITE_FIREBASE_API_KEY ?? ''),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(env.VITE_FIREBASE_AUTH_DOMAIN ?? ''),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(env.VITE_FIREBASE_PROJECT_ID ?? ''),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(env.VITE_FIREBASE_STORAGE_BUCKET ?? ''),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? ''),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(env.VITE_FIREBASE_APP_ID ?? ''),
      'import.meta.env.VITE_INTELLIQUOTE_API_BASE': JSON.stringify(apiBase),
      'import.meta.env.VITE_PORTAL_URL': JSON.stringify(env.VITE_PORTAL_URL ?? 'https://portal-comex.com'),
    },
  };
});
