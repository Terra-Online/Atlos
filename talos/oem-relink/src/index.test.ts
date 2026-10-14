import { describe, expect, it, vi } from 'vitest';
import worker from './index';

const stableManifest = {
    schemaVersion: 1,
    channel: 'stable',
    version: '1.2.3',
    tag: 'v1.2.3',
    filename: 'OEA-windows-x86_64-v1.2.3.zip',
    key: 'releases/oea/v1.2.3/OEA-windows-x86_64-v1.2.3.zip',
    url: 'https://package.oem.re/releases/oea/v1.2.3/OEA-windows-x86_64-v1.2.3.zip',
    size: 1234,
    sha256: 'a'.repeat(64),
    publishedAt: '2026-08-30T10:00:00.000Z',
};

describe('oem-relink worker routes', () => {
    it('redirects the translation subdomain to Crowdin', async () => {
        const response = await worker.fetch(
            new Request('https://translate.oem.re/'),
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe(
            'https://crowdin.com/project/oem',
        );
    });

    it('redirects the latest OEA package to the validated manifest URL', async () => {
        const get = vi.fn().mockResolvedValue({
            text: () => Promise.resolve(JSON.stringify(stableManifest)),
        });

        const response = await worker.fetch(
            new Request('https://oea.oem.re/latest'),
            { OEA_PACKAGES: { get } },
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe(stableManifest.url);
        expect(get).toHaveBeenCalledWith('channels/oea/stable.json');
    });

    it('forwards an allowed short-domain request to the geo target', async () => {
        const response = await worker.fetch(
            new Request('https://oem.re/map?x=1'),
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe(
            'https://opendfieldmap.org/map?x=1',
        );
    });

    it('preserves image and comment deep-link parameters', async () => {
        const response = await worker.fetch(
            new Request('https://oem.re/0oGIf3b?imageId=image%2F1&commentId=comment%2B2'),
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe(
            'https://opendfieldmap.org/0oGIf3b?imageId=image%2F1&commentId=comment%2B2',
        );
    });

    it.each([
        ['CN', 'https://opendfieldmap.cn'],
        ['US', 'https://opendfieldmap.org'],
    ])('preserves user-center routes for %s visitors', async (country, origin) => {
        for (const path of [
            '/me',
            '/me/',
            '/me/content',
            '/me/profile?lang=zh-HK&returnTo=%2Fme%2Fcontent',
        ]) {
            const response = await worker.fetch(
                new Request(`https://oem.re${path}`, {
                    headers: { 'cf-ipcountry': country },
                }),
            );

            expect(response.status).toBe(302);
            expect(response.headers.get('location')).toBe(`${origin}${path}`);
            expect(response.headers.get('cache-control')).toBe('no-store');
        }
    });

    it('rejects hosts outside the short-domain whitelist', async () => {
        const response = await worker.fetch(
            new Request('https://example.com/map'),
        );

        expect(response.status).toBe(404);
    });
});
