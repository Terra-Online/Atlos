import { test as base, expect } from 'playwright/test';
import { readProductionArtifact } from '../../scripts/lib/production-server.mjs';
import { createServices, installBrowserServices } from './services.mjs';
export { browserUser, deferred } from './services.mjs';

export const test = base.extend({
    services: async ({ browserName }, provide) => { await provide({ ...createServices(), browserName }); },
    _behaviorIsolation: [async ({ context, services, baseURL }, use, testInfo) => {
        // Only URL resolution is needed here; the runner owns the listening server.
        const production = process.env.BEHAVIOR_DIST ? await readProductionArtifact(process.env.BEHAVIOR_DIST) : null;
        try {
            await installBrowserServices(context, services, { origin: baseURL, production });
            await use();
        } finally {
            await testInfo.attach('fixture-services', { body: JSON.stringify({ requests: services.requests, unexpected: services.unexpected,
                pageErrors: services.pageErrors, boundary: production ? 'Frozen production HTML/JS/CSS/fonts/images from local artifact; explicit HTTP/session fixtures. No live backend.' : 'Real dev modules/layout/motion and bundled fonts; fixture HTTP/session/cloud data and remote imagery.' }, null, 2), contentType: 'application/json' });
        }
        expect(services.unexpected, 'Every service or resource request needs an explicit contract').toEqual([]);
        expect(services.pageErrors, 'No unhandled frontend exceptions').toEqual([]);
    }, { auto: true }],
});
export { expect };
