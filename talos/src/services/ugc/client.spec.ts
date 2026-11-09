import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());

vi.mock('@/services/http/authRuntime', () => ({
    getAuthBase: () => '/api',
    getAuthHeaders: () => ({}),
}));

describe('UGC translation request credentials', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ items: [] }),
        } as Response);
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps cache reads anonymous and includes cookies for live translation', async () => {
        const { transUGCComments } = await import('./client');

        await transUGCComments(['comment-1'], 'zh-cn', { cachedOnly: true });
        await transUGCComments(['comment-1'], 'zh-hk', { cachedOnly: false });

        expect(fetchMock.mock.calls[0][1]?.credentials).toBe('omit');
        expect(fetchMock.mock.calls[1][1]?.credentials).toBe('include');
    });
});
