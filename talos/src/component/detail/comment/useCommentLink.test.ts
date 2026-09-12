import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UGCComment, UGCCommentContext } from '@/utils/ugcClient';

vi.mock('@/store/marker', async () => {
    const { create } = await import('zustand');
    return { useMarkerStore: create((set) => ({
        commentOpenRequest: null,
        clearCommentOpenRequest: () => set({ commentOpenRequest: null }),
    })) };
});
vi.mock('@/utils/ugcClient', () => ({ getUGCCommentById: vi.fn(), UGCClientError: class extends Error { code = 'COMMENT_NOT_FOUND'; } }));
import { useMarkerStore } from '@/store/marker';
import { getUGCCommentById, UGCClientError } from '@/utils/ugcClient';
import { useCommentLink } from './useCommentLink';

const target: UGCComment = { id: 'target', parentId: null, markerId: '1', depth: 0, content: 'hello', createdAt: '', score: 0, replyCount: 0, replies: [], status: 'active' };
const context: UGCCommentContext = { targetId: 'target', path: [target], replies: [], repliesTruncated: false };
let list: HTMLDivElement;
let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vi.clearAllMocks();
    list = document.createElement('div');
    list.innerHTML = '<article data-comment-id="target"></article>';
    scrollTo = vi.fn();
    list.scrollTo = scrollTo;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    useMarkerStore.setState({ commentOpenRequest: { markerId: '1', commentId: 'target' } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = (initial = [target]) => {
    const listRef = { current: list };
    return renderHook(({ markerId, active }) => {
        const [comments, setComments] = useState(initial);
        return useCommentLink({ markerId, active, loading: false, comments, setComments, listRef });
    }, { initialProps: { markerId: '1', active: true } });
};

it('focuses a loaded comment and retains the highlight after consuming the request', async () => {
    const { result } = mount();
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(result.current.highlightedId).toBe('target');
    expect(useMarkerStore.getState().commentOpenRequest).toBeNull();
    expect(getUGCCommentById).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
    act(() => useMarkerStore.setState({ commentOpenRequest: { markerId: '1', commentId: 'target' } }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2));
});

it('fetches context for an unloaded target and focuses it', async () => {
    vi.mocked(getUGCCommentById).mockResolvedValue(context);
    const { result } = mount([]);
    await waitFor(() => expect(result.current.highlightedId).toBe('target'));
});

it('ignores a context response after changing markers', async () => {
    let resolve!: (value: UGCCommentContext) => void;
    vi.mocked(getUGCCommentById).mockReturnValue(new Promise(done => { resolve = done; }));
    const { rerender, result } = mount([]);
    rerender({ markerId: '2', active: true });
    await act(async () => { resolve(context); await Promise.resolve(); });
    expect(result.current.highlightedId).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
});

it('waits until the Comments panel is active', async () => {
    const listRef = { current: list };
    const { rerender } = renderHook(({ active }) => useCommentLink({
        markerId: '1', active, loading: false, comments: [target], setComments: vi.fn(), listRef,
    }), { initialProps: { active: false } });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledOnce());
});

it('silently consumes network failures without focusing a comment', async () => {
    vi.mocked(getUGCCommentById).mockRejectedValue(new Error('offline'));
    const { result } = mount([]);
    await waitFor(() => expect(useMarkerStore.getState().commentOpenRequest).toBeNull());
    expect(result.current).toEqual({ highlightedId: null });
    expect(scrollTo).not.toHaveBeenCalled();
});

it('keeps the highlight across time and tab changes until the marker changes', async () => {
    vi.useFakeTimers();
    try {
        const { result, rerender } = mount();
        await act(() => vi.advanceTimersByTimeAsync(32));
        expect(result.current.highlightedId).toBe('target');
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(result.current.highlightedId).toBe('target');
        rerender({ markerId: '1', active: false });
        rerender({ markerId: '1', active: true });
        expect(result.current.highlightedId).toBe('target');
        rerender({ markerId: '2', active: true });
        expect(result.current.highlightedId).toBeNull();
    } finally {
        vi.useRealTimers();
    }
});

it('silently consumes unavailable targets', async () => {
    vi.mocked(getUGCCommentById).mockRejectedValue(new UGCClientError('missing', 'COMMENT_NOT_FOUND'));
    const { result } = mount([]);
    await waitFor(() => expect(useMarkerStore.getState().commentOpenRequest).toBeNull());
    expect(result.current).toEqual({ highlightedId: null });
    expect(scrollTo).not.toHaveBeenCalled();
});
