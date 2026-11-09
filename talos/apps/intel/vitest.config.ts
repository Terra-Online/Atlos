import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
    plugins: [react(), svgr()],
    define: { __INTEL_DEPLOY_CHANNEL__: JSON.stringify('beta') },
    resolve: {
        alias: {
            '@intel': fileURLToPath(new URL('./src', import.meta.url)),
            '@main': fileURLToPath(new URL('../../src', import.meta.url)),
            '@': fileURLToPath(new URL('../../src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        include: ['apps/intel/src/**/*.spec.{ts,tsx}'],
        setupFiles: ['./vitest.setup.ts', './apps/intel/src/testSetup.ts'],
    },
});
