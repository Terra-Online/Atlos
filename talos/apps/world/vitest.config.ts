import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
    resolve: { alias: { '@': resolve(import.meta.dirname, '../../src') } },
    test: {
        environment: 'jsdom',
        include: ['apps/world/src/**/*.spec.ts'],
        setupFiles: ['./vitest.setup.ts'],
    },
});
