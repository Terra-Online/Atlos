import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { projectFiles } from './scripts/project-files.mjs';

// Local ignored diagnostic tests can outlive the source they were written for.
// Run tracked and new non-ignored .spec files, matching a fresh CI checkout.
const tests = projectFiles().filter((file) => /^(?:src|oem-relink\/src)\/.*\.spec\.tsx?$/.test(file));

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
