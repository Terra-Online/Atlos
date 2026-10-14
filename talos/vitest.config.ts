import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { projectFiles } from './scripts/project-files.mjs';

// Local ignored diagnostic tests can outlive the source they were written for.
// Run repository tests and new non-ignored tests, matching a fresh CI checkout.
const tests = projectFiles().filter((file) => /^(?:src|oem-relink\/src)\/.*\.(?:test|spec)\.tsx?$/.test(file));

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        include: tests,
        setupFiles: ['./vitest.setup.ts'],
    },
});
