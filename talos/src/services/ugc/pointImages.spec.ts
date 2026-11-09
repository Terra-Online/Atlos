import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/services/routing/share', () => ({ buildPointShareToken: vi.fn() }));
const image = { id: 'i', markerId: 'm', url: '/i', createdAt: '2026-10-17' };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.resetModules(); fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('combined detail client', () => {
    it('deduplicates cold reads and only reads mine on warm public data', async () => {
        const { listUGCPointImages } = await import('./client');
        fetcher.mockResolvedValueOnce(Response.json({ images: { items: [image] }, mine: { items: [] } }));
        const first = listUGCPointImages('m', 'a');
        expect(listUGCPointImages('m', 'a')).toBe(first);
        expect((await first).images?.[0].id).toBe('i');
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0][0]).toContain('includeMine=1');
        fetcher.mockResolvedValueOnce(Response.json({ items: [] }));
        await listUGCPointImages('m', 'a');
        expect(fetcher.mock.calls[1][0]).toContain('/images/mine?');
        fetcher.mockResolvedValueOnce(Response.json({ images: { items: [] }, mine: { items: [] } }));
        await listUGCPointImages('m', 'b');
        expect(fetcher.mock.calls[2][0]).toContain('includeMine=1');
    });
    it('retains pending images after public failure and retries rather than caching an empty public list', async () => {
        const { listUGCPointImages } = await import('./client');
        fetcher.mockImplementation(() => Promise.resolve(Response.json({ images: { items: [], partial: true, failedMarkerIds: ['m'] }, mine: { items: [{ ...image, status: 'pending_audit' }] } }, { status: 207 })));
        const result = await listUGCPointImages('m', 'a');
        expect(result.images).toBeUndefined();
        expect(result.myImages?.[0].status).toBe('pending_audit');
        await listUGCPointImages('m', 'a');
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[1][0]).toContain('includeMine=1');
    });
    it('releases the shared request slot before anonymous recovery', async () => {
        const { listUGCPointImages } = await import('./client');
        fetcher.mockImplementation((url: string) => Promise.resolve(url.includes('includeMine=1')
            ? Response.json({}, { status: 401 }) : Response.json({ items: [] })));
        await Promise.all(Array.from({ length: 10 }, (_, i) => listUGCPointImages(`m${i}`, 'a')));
        expect(fetcher.mock.calls.some(([url]) => String(url).includes('publicOnly=1'))).toBe(true);
    });
});

describe('resource batch isolation', () => {
    it('keeps public and authenticated requests and caches separate; mine remains uncached', async () => {
        const client = await import('./client');
        fetcher.mockImplementation(() => Promise.resolve(Response.json({ items: [image] })));
        await Promise.all([
            client.listPublicUGCImages('m'), client.listUGCImages('m'), client.listUGCMyImages('m'),
        ]);
        expect(fetcher).toHaveBeenCalledTimes(3);
        const publicCall = fetcher.mock.calls.find(([url]) => String(url).includes('publicOnly=1'));
        expect(publicCall?.[1]).toEqual({ credentials: 'omit' });
        for (const [url, init] of fetcher.mock.calls) {
            if (!String(url).includes('publicOnly=1')) expect(init).toMatchObject({ credentials: 'include' });
        }
        await Promise.all([
            client.listPublicUGCImages('m'), client.listUGCImages('m'), client.listUGCMyImages('m'),
        ]);
        expect(fetcher).toHaveBeenCalledTimes(4);
        expect(fetcher.mock.calls[3][0]).toContain('/images/mine?');
        client.invalidateUGCImageCache('m');
        await client.listPublicUGCImages('m');
        expect(fetcher).toHaveBeenCalledTimes(4);
        await client.listUGCImages('m');
        expect(fetcher).toHaveBeenCalledTimes(5);
    });
});
