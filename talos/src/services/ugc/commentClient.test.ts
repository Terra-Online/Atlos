import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/services/http/authRuntime', () => ({
    getAuthBase: () => 'https://api.example.test',
    getAuthHeaders: () => ({}),
}));
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/services/routing/share', () => ({ buildPointShareToken: vi.fn() }));

import { getUGCCommentById, listUGCCommentsByMarkerIds } from './client';

afterEach(() => vi.unstubAllGlobals());

it('requests marker-scoped context and normalizes flat public comments', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ item: {
        targetId: 'reply/1',
        path: [{ id: 'reply/1', markerId: 'marker', status: 'active' }],
        replies: [],
        repliesTruncated: true,
    } }))));
    vi.stubGlobal('fetch', fetch);

    const result = await getUGCCommentById('marker', 'reply/1');

    expect(fetch).toHaveBeenCalledWith(
        'https://api.example.test/uploads/v1/comments/reply%2F1?markerId=marker',
        expect.any(Object),
    );
    expect(result).toMatchObject({
        targetId: 'reply/1',
        path: [{ replies: [], parentId: null, score: 0 }],
        repliesTruncated: true,
    });
});

it('preserves the unavailable-comment error code', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({
        error: { code: 'COMMENT_NOT_FOUND', message: 'Missing' },
    }), { status: 404 })));

    await expect(getUGCCommentById('marker', 'missing')).rejects.toMatchObject({
        code: 'COMMENT_NOT_FOUND',
    });
});

it('does not negative-cache a failed marker, while caching successful empty results', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json({ items: [], partial: true, failedMarkerIds: ['partial-failed'] }))
        .mockImplementation(async () => Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetch);
    await expect(listUGCCommentsByMarkerIds(['partial-ok', 'partial-failed']))
        .rejects.toMatchObject({ code: 'partialResponse' });
    await expect(listUGCCommentsByMarkerIds(['partial-ok'])).resolves.toEqual({ 'partial-ok': [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    await listUGCCommentsByMarkerIds(['partial-failed']);
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not turn an older partial response into an empty cache hit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ items: [], partial: true }));
    vi.stubGlobal('fetch', fetch);
    await expect(listUGCCommentsByMarkerIds(['legacy-partial'])).rejects.toMatchObject({ code: 'partialResponse' });
    await expect(listUGCCommentsByMarkerIds(['legacy-partial'])).rejects.toMatchObject({ code: 'partialResponse' });
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('splits 201 missing markers without dropping any marker', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetch);
    const ids = Array.from({ length: 201 }, (_, index) => `batch-${index}`);
    const result = await listUGCCommentsByMarkerIds(ids);
    expect(Object.keys(result)).toHaveLength(201);
    expect(fetch).toHaveBeenCalledTimes(3);
    const sent = fetch.mock.calls.flatMap(([url]) => new URL(String(url)).searchParams.get('markerIds')!.split(','));
    expect(new Set(sent)).toEqual(new Set(ids));
    expect(fetch.mock.calls.every(([url]) => new URL(String(url)).searchParams.get('markerIds')!.split(',').length <= 100)).toBe(true);
});
