import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` lanza al importarse fuera de un Server Component. El propio
      // paquete trae `empty.js` para la condition `react-server`; se apunta ahí
      // para poder testear módulos server-only (repositorios, servicios).
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Fija el restaurante con el que corren las pruebas. Ver `src/test/profiles.ts`.
    setupFiles: ['./src/test/setup.ts'],
  },
});
