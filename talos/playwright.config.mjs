import { defineConfig } from 'playwright/test';

const production = process.env.BEHAVIOR_DIST;
const desktop = { viewport: { width: 1440, height: 1000 }, locale: 'en-US' };
const mobile = { viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true };

export default defineConfig({
    testDir: './test-support/browser',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    outputDir: './test-results/behavior',
    reporter: [
        ['list'],
        ['json', { outputFile: './test-results/behavior-report/report.json' }],
        ['html', { outputFolder: './test-results/behavior-report/html', open: 'never' }],
    ],
    use: {
        baseURL: process.env.BEHAVIOR_BASE_URL || (production ? 'http://localhost:4173' : 'http://localhost:5173'),
        trace: 'on',
        screenshot: 'only-on-failure',
    },
    projects: [
        ...['chromium', 'firefox', 'webkit'].map((browserName) => ({
            name: `${browserName}-desktop`,
            testMatch: production ? ['production.spec.mjs'] : ['components.spec.mjs', 'app.spec.mjs', 'guide.spec.mjs'],
            use: { browserName, ...desktop },
        })),
        ...['chromium', 'webkit'].map((browserName) => ({
            name: `${browserName}-mobile`,
            testMatch: production ? ['mobile.spec.mjs'] : ['components.spec.mjs', 'mobile.spec.mjs', 'guide.spec.mjs', ...(browserName === 'chromium' ? ['touch.chromium.spec.mjs'] : [])],
            use: { browserName, ...mobile },
        })),
    ],
    webServer: production ? [{ command: 'node scripts/lib/production-server.mjs --port 4173', url: 'http://localhost:4173', reuseExistingServer: false }] : [
        { command: 'pnpm exec vite --mode dev --host 127.0.0.1 --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
        { command: 'pnpm --filter @atlos/intel dev', url: 'http://localhost:5174/intel/', reuseExistingServer: !process.env.CI },
        { command: 'pnpm --filter @atlos/user-hub dev', url: 'http://localhost:5175/me/', reuseExistingServer: !process.env.CI },
    ],
});
