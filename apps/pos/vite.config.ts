import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// En desarrollo el POS habla con el backend a través de `/api` (proxy de Vite):
// mismo origen, así no depende de CORS_ORIGINS. En producción se compila con
// VITE_API_URL apuntando al backend desplegado, y ese origen sí debe estar en
// su CORS_ORIGINS.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backend = env.POS_BACKEND_URL || 'http://localhost:3100';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5180,
      strictPort: true,
      proxy: { '/api': { target: backend, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
    },
    preview: {
      port: 5180,
      proxy: { '/api': { target: backend, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
    },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
