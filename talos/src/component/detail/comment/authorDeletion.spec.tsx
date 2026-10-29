import { useState } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/auth';
import { useDeleteComment } from './useDeleteComment';
import {
    getCommentSubmissionSnapshot,
    restoreCommentSubmission,
} from './commentSubmissionStore';
import type { UGCComment } from '@/services/ugc/client';
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/services/routing/share', () => ({
    buildPointShareToken: () => 'hash',
}));
vi.mock('@/services/http/authRuntime', () => ({
    getAuthBase: () => '',
    getAuthHeaders: () => ({}),
}));
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const child: UGCComment = {
    id: 'child',
    markerId: 'delete-point',
    parentId: 'parent',
    depth: 1,
    content: 'Child retained',
    createdAt: '',
    score: 3,
    replyCount: 0,
    replies: [],
};
const parent: UGCComment = {
    ...child,
    id: 'parent',
    parentId: null,
    depth: 0,
    content: 'Parent',
    snapshotId: 'A',
    replyCount: 1,
    replies: [child],
};
beforeEach(() => {
    useAuthStore.getState().setSessionUser({ uid: 'owner', nickname: 'Owner' });
    fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAuthStore.getState().clearSessionUser();
});
function setup() {
    return renderHook(() => {
        const [comments, setComments] = useState([parent]);
        const [replyTarget, setReply] = useState<UGCComment | null>(child);
        const [busyIds, setBusyIds] = useState(new Set<string>());
        const remove = useDeleteComment({
            markerId: parent.markerId,
            comments,
            busyIds,
            replyTarget,
            requireAuth: () => true,
            setComments,
            setReply,
            setBusy: (id, pending) =>
                setBusyIds((current) => {
                    const next = new Set(current);
                    if (pending) next.add(id);
                    else next.delete(id);
                    return next;
                }),
            clearSync: () => {},
        });
        return { remove, comments, replyTarget, busyIds, setComments };
    });
}
it('optimistically hides a deleted parent subtree and restores its complete replies and overlay when DELETE fails', async () => {
    let deliver!: (r: Response) => void;
    fetcher.mockReturnValueOnce(
        new Promise((resolve) => {
            deliver = resolve;
        }),
    );
    restoreCommentSubmission(parent.markerId, parent);
    restoreCommentSubmission(parent.markerId, child);
    const { result } = setup();
    act(() => result.current.remove(parent));
    expect(result.current.comments).toEqual([]);
    expect(result.current.replyTarget).toBeNull();
    expect(getCommentSubmissionSnapshot(parent.markerId).comments).toEqual([]);
    expect(fetcher.mock.calls[0][0]).toContain('/comments/parent');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
        method: 'DELETE',
        credentials: 'include',
    });
    act(() =>
        deliver(Response.json({ code: 'DELETE_FAILED' }, { status: 500 })),
    );
    await waitFor(() => expect(result.current.busyIds.size).toBe(0));
    expect(result.current.comments).toEqual([parent]);
    expect(result.current.comments[0].replies).toEqual([child]);
    expect(result.current.replyTarget).toEqual(child);
    expect(
        getCommentSubmissionSnapshot(parent.markerId).comments.map((c) => c.id),
    ).toEqual(['parent', 'child']);
});
it('deletes the existing submission even when legacy data advertises an undo, and leaves unrelated comments intact', async () => {
    fetcher.mockResolvedValueOnce(
        Response.json({ ok: true, authorDeletedAt: '2026-10-29T00:00:00Z' }),
    );
    const { result } = setup();
    act(() =>
        result.current.setComments([
            parent,
            { ...child, id: 'unrelated', parentId: null },
        ]),
    );
    act(() =>
        result.current.remove({ ...parent, ...{ editUndoAvailable: true } }),
    );
    await waitFor(() => expect(result.current.busyIds.size).toBe(0));
    expect(result.current.comments.map((c) => c.id)).toEqual(['unrelated']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toMatch(/comments\/parent$/);
    expect(fetcher.mock.calls[0][1]?.method).toBe('DELETE');
});
it('does not restore private comments from a failed delete into a later account', async () => {
    let deliver!: (r: Response) => void;
    fetcher.mockReturnValueOnce(
        new Promise((resolve) => {
            deliver = resolve;
        }),
    );
    const { result } = setup();
    act(() => result.current.remove(parent));
    act(() =>
        useAuthStore
            .getState()
            .setSessionUser({ uid: 'other', nickname: 'Other' }),
    );
    act(() => deliver(Response.json({}, { status: 500 })));
    await waitFor(() => expect(result.current.busyIds.size).toBe(0));
    expect(result.current.comments).toEqual([]);
    expect(getCommentSubmissionSnapshot(parent.markerId).comments).toEqual([]);
});
