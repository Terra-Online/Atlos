import { afterEach, expect, it, vi } from 'vitest';
import { listRecordToolUGCImages, peekRecordToolUGCImages } from './ugcClient';

vi.mock('@/services/http/authRuntime', () => ({
    getAuthBase: () => 'http://localhost:8787',
}));
afterEach(() => vi.unstubAllGlobals());

it('retries a failed marker instead of caching its partial response as empty', async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
            Response.json({
                items: [],
                partial: true,
                failedMarkerIds: ['failed-marker'],
            }),
        )
        .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetcher);

    await expect(listRecordToolUGCImages('failed-marker')).rejects.toThrow();
    expect(peekRecordToolUGCImages('failed-marker')).toBeNull();
    await expect(listRecordToolUGCImages('failed-marker')).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
});
