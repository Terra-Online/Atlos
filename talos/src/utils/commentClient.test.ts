import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/component/login/authFlow', () => ({ getAuthBase: () => 'https://api.example.test', getAuthHeaders: () => ({}) }));
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('./urlState', () => ({ buildPointShareToken: vi.fn() }));
import { getUGCCommentById } from './ugcClient';

afterEach(() => vi.unstubAllGlobals());
it('requests marker-scoped context and normalizes flat public comments', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ item: {
        targetId: 'reply/1', path: [{ id: 'reply/1', markerId: 'marker', status: 'active' }], replies: [], repliesTruncated: true,
    } }))));
    vi.stubGlobal('fetch', fetch);
    const result = await getUGCCommentById('marker', 'reply/1');
    expect(fetch).toHaveBeenCalledWith('https://api.example.test/uploads/v1/comments/reply%2F1?markerId=marker', expect.any(Object));
    expect(result).toMatchObject({ targetId: 'reply/1', path: [{ replies: [], parentId: null, score: 0 }], repliesTruncated: true });
});
it('preserves the unavailable-comment error code', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ error: { code: 'COMMENT_NOT_FOUND', message: 'Missing' } }), { status: 404 })));
    await expect(getUGCCommentById('marker', 'missing')).rejects.toMatchObject({ code: 'COMMENT_NOT_FOUND' });
});
