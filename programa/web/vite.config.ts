import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Identidade do build: vai no bundle (VITE_APP_BUILD_ID) e em dist/version.json. A aba aberta
// compara as duas para avisar que saiu deploy novo. No CI usa o commit (redeploy do mesmo commit
// nao gera aviso); build local usa o horario.
function resolveBuildId(mode: string): string {
  if (mode === 'development') return 'dev';
  const sha = process.env.GITHUB_SHA?.trim();
  return sha ? sha.slice(0, 12) : `local-${Date.now()}`;
}

function versionFilePlugin(buildId: string): Plugin {
  return {
    name: 'intelliquote-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ buildId })}
` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_INTELLIQUOTE_API_BASE ?? '/api';
  const buildId = resolveBuildId(mode);
  return {
    plugins: [react(), versionFilePlugin(buildId)],
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
      'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(buildId),
    },
  };
});
