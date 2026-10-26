import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Comments from './Comments';
import { useAuthStore } from '@/store/auth';
import { useMarkerStore } from '@/store/marker';
import type { IMarkerData } from '@/data/marker';
import type { UGCComment, UGCCommentSubmission } from '@/services/ugc/client';
import { installResizeObserver } from '../../../../test-support/browser';
import { deferred } from '../../../../test-support/pages';

const api = vi.hoisted(() => ({ t: (key: string) => key, list: vi.fn(), submit: vi.fn(), edit: vi.fn(), vote: vi.fn(), flag: vi.fn(), recall: vi.fn(), auth: vi.fn() }));
vi.mock('@/locale', () => ({ useTranslateUI: () => api.t, useLocale: () => 'en-US', getProjectLangNameKey: () => '' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update: () => {}, stop: () => {} }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getAppDocument: () => document, subscribePictureInPictureState: () => () => {} }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/component/shared/account/authEvents', () => ({ openOemAuthModal: api.auth }));
vi.mock('@/pages/detail/comment/useAutoTrans', () => ({ useAutoTrans: () => {} }));
vi.mock('@/pages/detail/comment/useTrans', () => ({ useTrans: () => () => {} }));
vi.mock('@/services/routing', () => ({ generatePointShareUrl: () => 'https://example.test/comment' }));
vi.mock('@/services/ugc/client', async (original) => ({ ...await original<typeof import('@/services/ugc/client')>(), listUGCComments: api.list, submitUGCComment: api.submit, editUGCComment: api.edit, voteUGCComment: api.vote, toggleUGCCommentFlag: api.flag, recallUGCComment: api.recall, invalidateUGCCommentCache: () => {} }));
const auth = useAuthStore.getState(), markers = useMarkerStore.getState();
const scrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
let serial = 0;
const point = (): IMarkerData => ({ id: `comment-ui-${++serial}`, type: 'crate_ii', subregId: 'VL_1', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 });
const comment = (markerId: string, own = false): UGCComment => ({ id: `comment-${markerId}`, markerId, content: 'Original comment', parentId: null, depth: 0, replies: [], score: 2, replyCount: 0, viewerVote: 0, status: 'active', createdAt: '2026-10-27T00:00:00Z', author: { publicUid: own ? 'a' : 'other', nickname: own ? 'A' : 'Other' } });
beforeEach(() => {
    vi.clearAllMocks(); installResizeObserver(); useAuthStore.setState({ sessionUser: { uid: 'a', nickname: 'A' } }); useMarkerStore.setState({ commentOpenRequest: null }); api.list.mockResolvedValue([]); api.vote.mockRejectedValue(new Error('offline')); api.flag.mockResolvedValue({ flagged: true });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => {} });
});
afterEach(() => { cleanup(); useAuthStore.setState(auth, true); useMarkerStore.setState(markers, true); if (scrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollTo); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo'); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const type = async (text: string) => {
    const editor = await screen.findByRole('textbox'); act(() => { editor.focus(); }); fireEvent.paste(editor, { clipboardData: { getData: () => text } });
    await waitFor(() => expect(editor.textContent).toBe(text)); return editor;
};

it('requires authentication for submission, then shows optimistic content and removes it with an actionable failure', async () => {
    useAuthStore.setState({ sessionUser: null }); const marker = point(); render(<Comments point={marker} pointName="Crate" />); await type('Hello map');
    fireEvent.click(screen.getByRole('button', { name: 'detail.comments.submit' })); expect(api.auth).toHaveBeenCalledExactlyOnceWith('login'); expect(api.submit).not.toHaveBeenCalled();
    act(() => { useAuthStore.setState({ sessionUser: { uid: 'a', nickname: 'A' } }); });
    // Account changes own their draft lifecycle; enter the authenticated draft.
    const editor = await screen.findByRole('textbox');
    if (editor.textContent !== 'Hello map') await type('Hello map');
    const pending = deferred<UGCCommentSubmission>(); api.submit.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'detail.comments.submit' }));
    expect(api.submit).toHaveBeenCalledExactlyOnceWith(marker, 'Hello map', null);
    expect(document.querySelector('[data-comment-id^="local-comment:"]')?.textContent).toContain('Hello map');
    await act(async () => { pending.reject(new Error('offline')); await pending.promise.catch(() => {}); });
    expect(document.querySelector('[data-comment-id^="local-comment:"]')).toBeNull(); expect(screen.getByText('detail.comments.submitFailed')).toBeTruthy();
});

it('submits a reply with the actual parent, clears its quote, and keeps a pending reply in the rendered tree', async () => {
    const marker = point(), original = comment(marker.id); api.list.mockResolvedValue([original]); api.submit.mockResolvedValue({ id: 'reply-result', markerId: marker.id, parentId: original.id, depth: 1, status: 'pending_audit', snapshotId: 's' });
    render(<Comments point={marker} pointName="Crate" />); await screen.findByText('Original comment'); fireEvent.click(screen.getByRole('button', { name: 'detail.comments.reply' }));
    await type('A reply'); fireEvent.click(screen.getByRole('button', { name: 'detail.comments.submit' }));
    await waitFor(() => expect(document.querySelector('[data-comment-id="reply-result"]')).toBeTruthy());
    expect(api.submit).toHaveBeenCalledExactlyOnceWith(marker, 'A reply', original.id);
    expect(document.querySelector('[data-comment-input]')?.getAttribute('data-replying')).toBe('false');
    expect(document.querySelector('[data-comment-id="reply-result"]')?.getAttribute('style')).toContain('--comment-display-depth: 1');
});

it('restores the editable draft and original comment when an edit fails without changing another comment', async () => {
    const marker = point(), own = comment(marker.id, true); api.list.mockResolvedValue([own]); api.edit.mockRejectedValue(new Error('offline'));
    render(<Comments point={marker} pointName="Crate" />); await screen.findByText('Original comment'); fireEvent.click(screen.getByRole('button', { name: 'detail.comments.edit' }));
    const editor = await screen.findByRole('textbox'); await waitFor(() => expect(editor.textContent).toBe('Original comment'));
    // Replace the controlled source through the real editor selection.
    act(() => { editor.focus(); }); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(editor); selection?.removeAllRanges(); selection?.addRange(range); fireEvent(document, new Event('selectionchange'));
    fireEvent.paste(editor, { clipboardData: { getData: () => 'Edited comment' } }); await waitFor(() => expect(editor.textContent).toBe('Edited comment'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'detail.comments.submitEdit' })); await Promise.resolve(); });
    expect(api.edit).toHaveBeenCalledExactlyOnceWith(own.id, 'Edited comment'); expect(screen.getByText('detail.comments.editFailed')).toBeTruthy();
    expect(document.querySelector(`[data-comment-id="${own.id}"]`)?.textContent).toContain('Original comment');
    await waitFor(() => expect(screen.getByRole('textbox').textContent).toBe('Edited comment'));
});

it('rolls back a failed vote and collapses a quick on/off sequence without an unnecessary request', async () => {
    const marker = point(); api.list.mockResolvedValue([comment(marker.id)]); render(<Comments point={marker} pointName="Crate" />); await screen.findByText('Original comment');
    vi.useFakeTimers(); const vote = screen.getByRole('button', { name: 'detail.comments.upvote' }); fireEvent.click(vote); expect(vote.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(api.vote).toHaveBeenCalledExactlyOnceWith(`comment-${marker.id}`, 1); expect(vote.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(vote); fireEvent.click(vote); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(api.vote).toHaveBeenCalledTimes(1);
});

it('cancels an unsent vote on account changes and does not expose the previous account pending submission', async () => {
    const marker = point(), original = comment(marker.id), pending = deferred<UGCCommentSubmission>(); api.list.mockResolvedValue([original]); api.submit.mockReturnValue(pending.promise);
    render(<Comments point={marker} pointName="Crate" />); await screen.findByText('Original comment'); await type('Private pending A');
    fireEvent.click(screen.getByRole('button', { name: 'detail.comments.submit' }));
    vi.useFakeTimers(); const publicComment = document.querySelector(`[data-comment-id="${original.id}"]`)!;
    const toolbarId = publicComment.querySelector('article')?.getAttribute('data-short-actions-root'); expect(toolbarId).toBe('true');
    const vote = screen.getAllByRole('button', { name: 'detail.comments.upvote' }).find((button) => !(button as HTMLButtonElement).disabled)!; fireEvent.click(vote);
    act(() => { useAuthStore.setState({ sessionUser: { uid: 'b', nickname: 'B' } }); }); await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Private pending A')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(api.vote).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ id: 'private-result', markerId: marker.id, parentId: null, depth: 0, status: 'pending_audit', snapshotId: 's' }); await pending.promise; });
    expect(screen.queryByText('Private pending A')).toBeNull();
    act(() => { useAuthStore.setState({ sessionUser: { uid: 'a', nickname: 'A' } }); }); await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Private pending A')).toBeTruthy();
});

it.each(['relogin', 'account-roundtrip'])('releases drafts and queued votes across a batched %s even when the final uid matches', async (transition) => {
    const marker = point(); api.list.mockResolvedValue([comment(marker.id)]);
    render(<Comments point={marker} pointName="Crate" />); await screen.findByText('Original comment'); await type('Old session draft');
    vi.useFakeTimers(); fireEvent.click(screen.getByRole('button', { name: 'detail.comments.upvote' }));
    act(() => {
        const state = useAuthStore.getState();
        if (transition === 'relogin') state.clearSessionUser(); else state.setSessionUser({ uid: 'b', nickname: 'B' });
        state.setSessionUser({ uid: 'a', nickname: 'A' });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole('textbox').textContent).toBe(''); expect(api.vote).not.toHaveBeenCalled();
});
