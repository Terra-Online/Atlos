import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
    plugins: [react(), svgr()],
    resolve: {
        alias: {
            '@hub': fileURLToPath(new URL('./src', import.meta.url)),
            '@main': fileURLToPath(new URL('../../src', import.meta.url)),
            '@': fileURLToPath(new URL('../../src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        include: ['apps/user-hub/src/**/*.spec.ts'],
        setupFiles: ['./vitest.setup.ts'],
    },
});
