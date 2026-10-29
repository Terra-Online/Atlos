import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';
import type { UGCComment } from '@/services/ugc/client';
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/services/routing/share', () => ({
    buildPointShareToken: () => 'hash',
}));
vi.mock('@/services/http/authRuntime', () => ({
    getAuthBase: () => '',
    getAuthHeaders: () => ({}),
}));
let fetcher: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
beforeEach(() => {
    vi.resetModules();
    fetcher = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
const point = { id: 'marker-1', type: 'test' } as IMarkerData;
const parent: UGCComment = {
    id: 'parent',
    snapshotId: 'public-A',
    markerId: 'marker-1',
    parentId: null,
    depth: 0,
    content: 'Parent',
    createdAt: '',
    status: 'active',
    score: 3,
    viewerVote: 0,
    replyCount: 0,
    replies: [],
};

it.each([false, true])(
    'merges an optimistic create with the returned fixed snapshot (reply=%s)',
    async (reply) => {
        const store = await import(
            '@/component/detail/comment/commentSubmissionStore'
        );
        let deliver!: (response: Response) => void;
        fetcher.mockReturnValueOnce(
            new Promise<Response>((resolve) => {
                deliver = resolve;
            }),
        );
        const localId = store.submitCommentOptimistic(
            point,
            'New comment',
            reply ? parent : null,
            null,
        );
        expect(store.getCommentSubmissionSnapshot(point.id)).toMatchObject({
            submittingIds: [localId],
            comments: [{ id: localId, content: 'New comment' }],
        });
        expect(
            store.getCommentSubmissionSnapshot(point.id).comments[0].snapshotId,
        ).toBeUndefined();
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        const body = fetcher.mock.calls[0][1]?.body;
        if (typeof body !== 'string')
            throw new Error('Expected JSON request body');
        const payload: unknown = JSON.parse(body);
        expect(payload).toMatchObject({
            markerId: 'marker-1',
            content: 'New comment',
            ...(reply ? { parentId: 'parent' } : {}),
        });
        expect(payload).not.toHaveProperty('parentSnapshotId');
        deliver(
            Response.json({
                ok: true,
                submission: {
                    id: 'saved',
                    snapshotId: 'saved-version',
                    markerId: point.id,
                    parentId: reply ? 'parent' : null,
                    depth: reply ? 1 : 0,
                    status: 'pending_openai',
                },
            }),
        );
        await waitFor(() =>
            expect(store.getCommentSubmissionSnapshot(point.id)).toMatchObject({
                submittingIds: [],
                comments: [
                    {
                        id: 'saved',
                        snapshotId: 'saved-version',
                        content: 'New comment',
                    },
                ],
            }),
        );
        const saved = store.getCommentSubmissionSnapshot(point.id).comments[0];
        const server = reply
            ? [{ ...parent, replyCount: 1, replies: [saved] }]
            : [saved];
        expect(
            store.mergeCommentSubmissions(
                server,
                store.getCommentSubmissionSnapshot(point.id),
            ),
        ).toEqual(server);
        store.syncCommentSubmissions(point.id, server);
        expect(store.getCommentSubmissionSnapshot(point.id).comments).toEqual(
            [],
        );
    },
);

it('removes the optimistic reply and exposes the error when its parent became hidden', async () => {
    const store = await import(
        '@/component/detail/comment/commentSubmissionStore'
    );
    fetcher.mockResolvedValueOnce(
        Response.json({ code: 'PARENT_COMMENT_NOT_VISIBLE' }, { status: 409 }),
    );
    store.submitCommentOptimistic(point, 'Late reply', parent, null);
    await waitFor(() =>
        expect(store.getCommentSubmissionSnapshot(point.id)).toMatchObject({
            comments: [],
            submittingIds: [],
            lastError: { code: 'PARENT_COMMENT_NOT_VISIBLE' },
        }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
});

it('rolls back the displayed vote and score when the public target becomes unavailable', async () => {
    const { useVoteSync } = await import(
        '@/component/detail/comment/useActionSync'
    );
    fetcher.mockResolvedValueOnce(
        Response.json({ code: 'INVALID_SUBMISSION_STATUS' }, { status: 409 }),
    );
    const { result } = renderHook(() => {
        const [comment, setComment] = useState<UGCComment>({
            ...parent,
            viewerVote: 1,
            score: 4,
        });
        const patch = useCallback(
            (_id: string, update: (value: UGCComment) => UGCComment) =>
                setComment(update),
            [],
        );
        const sync = useVoteSync(0, patch);
        return { comment, sync };
    });
    act(() => result.current.sync.start(parent.id, 0, 1));
    await waitFor(() =>
        expect(result.current.comment).toMatchObject({
            viewerVote: 0,
            score: 3,
            snapshotId: 'public-A',
        }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/comments/parent/upvote');
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
});
