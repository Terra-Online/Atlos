import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@intel': fileURLToPath(new URL('./src', import.meta.url)),
            '@main': fileURLToPath(new URL('../../src', import.meta.url)),
            '@': fileURLToPath(new URL('../../src', import.meta.url)),
        },
    },
    test: {
        // The import contract uses real Web Streams/Blob gzip APIs. jsdom's Blob
        // lacks stream(), while Node provides the same APIs without DOM mocks.
        environment: 'node',
        include: ['apps/intel/src/**/*.spec.ts'],
    },
});
