import { afterEach, expect, it, vi } from 'vitest';

const doc = ['ore-1', 'point-1', 'ore', 'natural', 'Ore sample', 'iron', '', '', 'Valley_4', 'VL_1', 'Mine the ore', ''];
const request = (path = '/search?q=ore&locale=en-US') => new Request(`https://search.example${path}`);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

it.each([
    'https://data.example/search/{locale}.json',
    'https://data.example/search/en-US.json',
])('recovers a failed index load for %s without retaining a rejected cache promise', async (url) => {
    const fetchDocs = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(Response.json([doc]));
    vi.stubGlobal('fetch', fetchDocs);
    const { default: worker } = await import('./index');
    const env = { INDEX_DOCS_URL: url, ALLOW_ORIGIN: 'https://map.example' };
    const first = await worker.fetch(request(), env);
    expect(first.status).toBe(500);
    const next = await worker.fetch(request(), env);
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ hits: [{ pointId: 'point-1', typeKey: 'ore', regionKey: 'Valley_4', subregionId: 'VL_1' }] });
    expect(fetchDocs).toHaveBeenCalledTimes(2);
    expect(next.headers.get('access-control-allow-origin')).toBe('https://map.example');
});

it('keeps health, preflight, empty queries and rejected routes independent from index loading', async () => {
    const fetchDocs = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetchDocs);
    const { default: worker } = await import('./index');
    const env = { INDEX_DOCS_URL: 'https://data.example/{locale}.json', ALLOW_ORIGIN: 'https://map.example' };
    expect((await worker.fetch(new Request('https://search.example/search', { method: 'OPTIONS' }), env)).status).toBe(204);
    expect(await (await worker.fetch(request('/health'), env)).json()).toEqual({ ok: true, service: 'oem-search' });
    expect((await worker.fetch(new Request('https://search.example/search', { method: 'POST' }), env)).status).toBe(405);
    expect((await worker.fetch(request('/missing'), env)).status).toBe(404);
    expect(await (await worker.fetch(request('/search?q=%20'), env)).json()).toEqual({ hits: [] });
    expect(fetchDocs).not.toHaveBeenCalled();
});

it('shares a successful locale index and maps Hong Kong queries to traditional Chinese documents', async () => {
    const fetchDocs = vi.fn<typeof fetch>().mockResolvedValue(Response.json([doc]));
    vi.stubGlobal('fetch', fetchDocs);
    const { default: worker } = await import('./index');
    const env = { INDEX_DOCS_URL: 'https://data.example/{locale}.json' };
    const responses = await Promise.all([worker.fetch(request('/search?q=ore&locale=zh-HK&limit=1'), env), worker.fetch(request('/search?q=ore&locale=zh-HK&limit=1'), env)]);
    expect(fetchDocs).toHaveBeenCalledOnce();
    expect(fetchDocs.mock.calls[0][0]).toBe('https://data.example/zh-TW.json');
    for (const response of responses) {
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ hits: [{ pointId: 'point-1' }] });
    }
});

it('falls back from a missing localized shard to English before caching the successful index', async () => {
    const fetchDocs = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(Response.json([doc]));
    vi.stubGlobal('fetch', fetchDocs);
    const { default: worker } = await import('./index');
    const response = await worker.fetch(request('/search?q=ore&locale=fr-FR'), { INDEX_DOCS_URL: 'https://data.example/{locale}.json' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hits: [{ pointId: 'point-1' }] });
    expect(fetchDocs.mock.calls.map(([url]) => url)).toEqual(['https://data.example/fr-FR.json', 'https://data.example/en-US.json']);
});

it('ignores malformed rows while returning Chinese substring matches in the consumer hit shape', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json([
        ['invalid'],
        [null, ...doc.slice(1)],
        [doc[0], doc[1], doc[2], doc[3], '矿石记录', ...doc.slice(5)],
    ])));
    const { default: worker } = await import('./index');
    const response = await worker.fetch(request('/search?q=%E7%9F%BF%E7%9F%B3&locale=zh-CN'), { INDEX_DOCS_URL: 'https://data.example/{locale}.json' });
    expect(response.status).toBe(200);
    const payload = await response.json<{ hits: Array<{ score: unknown }> }>();
    const score = payload.hits[0].score;
    expect(typeof score).toBe('number');
    expect(payload).toEqual({ hits: [{
        pointId: 'point-1', typeKey: 'ore', typeMain: 'natural', title: '矿石记录', aliases: 'iron',
        binderTokens: '', binderDisplay: '', regionKey: 'Valley_4', subregionId: 'VL_1', body: 'Mine the ore', score,
    }] });
});

it('prioritizes archive binder matches, deduplicates merged hits and bounds the requested limit', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json([
        [doc[0], doc[1], doc[2], doc[3], 'Binder record', ...doc.slice(5)],
        ['archive', 'archive-point', 'nar_archive', 'files', 'Report', '', 'binder record', 'Grouped file', ...doc.slice(8)],
    ])));
    const { default: worker } = await import('./index');
    const env = { INDEX_DOCS_URL: 'https://data.example/{locale}.json' };
    const response = await worker.fetch(request('/search?q=binder%20record&limit=2'), env);
    expect(await response.json()).toMatchObject({ hits: [{ pointId: 'archive-point' }, { pointId: 'point-1' }] });
    const limited = await worker.fetch(request('/search?q=binder%20record&limit=0'), env);
    expect(await limited.json()).toMatchObject({ hits: [{ pointId: 'archive-point' }] });
});
