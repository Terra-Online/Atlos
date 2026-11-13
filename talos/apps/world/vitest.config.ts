import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
    resolve: {
        alias: { '@': resolve(import.meta.dirname, '../../src') },
        dedupe: ['react', 'react-dom'],
    },
    test: {
        environment: 'jsdom',
        include: ['apps/world/src/**/*.spec.{ts,tsx}'],
        setupFiles: ['./vitest.setup.ts'],
    },
});
