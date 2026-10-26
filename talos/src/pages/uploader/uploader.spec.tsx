import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Uploader from './uploader';
import { useAuthStore } from '@/store/auth';
import { useMarkerStore } from '@/store/marker';
import type { IMarkerData } from '@/data/marker';
import type { UGCImage, UGCSubmissionImage } from '@/services/ugc/client';
import { installResizeObserver } from '../../../test-support/browser';
import { deferred } from '../../../test-support/pages';
import type { UGCImageActionPatch } from '@/services/ugc/client';

const api = vi.hoisted(() => ({ t: (key: string) => key, public: vi.fn(), detail: vi.fn(), byId: vi.fn(), upload: vi.fn(), upvote: vi.fn(), flag: vi.fn(), recall: vi.fn(), auth: vi.fn(), copy: vi.fn() }));
vi.mock('@/locale', () => ({ useTranslateUI: () => api.t, useLocale: () => 'en-US' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update: () => {}, stop: () => {} }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getAppDocument: () => document, subscribePictureInPictureState: () => () => {} }));
vi.mock('@/component/shared/account/authEvents', () => ({ openOemAuthModal: api.auth }));
vi.mock('@/platform/clipboard', () => ({ copyTextToClipboard: api.copy }));
vi.mock('@/services/routing', () => ({ generatePointShareUrl: (point: IMarkerData, options: { content?: { id: string } }) => `https://example.test/${point.id}?image=${options.content?.id ?? ''}` }));
vi.mock('@/services/ugc/client', async (original) => ({ ...await original<typeof import('@/services/ugc/client')>(), listPublicUGCImages: api.public, listUGCPointImages: api.detail, getUGCImageById: api.byId,
    uploadUGCImage: api.upload, toggleUGCImageUpvote: api.upvote, toggleUGCImageFlag: api.flag, recallUGCImage: api.recall }));
const auth = useAuthStore.getState(), markers = useMarkerStore.getState();
let serial = 0;
const point = (): IMarkerData => ({ id: `upload-ui-${++serial}`, type: 'crate_ii', subregId: 'VL_1', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 });
const image = (markerId: string, id = 'first'): UGCImage => ({ id, markerId, content: `Image ${id}`, url: `/${id}.webp`, createdAt: '2026-10-27T00:00:00Z', status: 'active', upvotes: 2, author: { nickname: 'Author', publicUid: 'another-user' } });
beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); installResizeObserver(); useAuthStore.setState({ sessionUser: { uid: 'user-a', nickname: 'User A' } }); useMarkerStore.setState({ imageOpenRequest: null });
    api.public.mockResolvedValue([]); api.detail.mockResolvedValue({ images: [], myImages: [] }); api.copy.mockResolvedValue(true); api.recall.mockResolvedValue({ id: 'first' });
    api.upvote.mockResolvedValue({ id: 'first', upvoted: true, upvotes: 3 }); api.flag.mockResolvedValue({ id: 'first', flagged: true });
});
afterEach(() => { cleanup(); useAuthStore.setState(auth, true); useMarkerStore.setState(markers, true); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const flush = async () => act(async () => { await Promise.resolve(); });

it('sends guest upload intent to auth and keeps file/paste handling out of an inactive detail', async () => {
    useAuthStore.setState({ sessionUser: null }); const marker = point();
    const view = render(<Uploader point={marker} pointName="Crate" />); await flush();
    fireEvent.click(screen.getByRole('button'));
    expect(api.auth).toHaveBeenCalledExactlyOnceWith('login');
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const paste = () => {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', getAsFile: () => file }] } });
        document.dispatchEvent(event); return event;
    };
    view.rerender(<Uploader point={marker} pointName="Crate" active={false} />);
    expect(paste().defaultPrevented).toBe(false);
    expect(api.upload).not.toHaveBeenCalled();
});

it('opens the real viewer, keeps carousel selection synchronized and isolates image actions from preview activation', async () => {
    const marker = point(); api.detail.mockResolvedValue({ images: [image(marker.id), image(marker.id, 'second')], myImages: [] });
    render(<Uploader point={marker} pointName="Crate" />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'detail.viewer.upvote' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByAltText('Image first'));
    const viewer = screen.getByRole('dialog', { name: 'Image first' });
    fireEvent.keyDown(within(viewer).getByRole('button', { name: 'Switch image' }), { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Image second' })).toBe(viewer);
    expect(screen.getAllByAltText('Image second')).toHaveLength(2);
    await act(async () => { fireEvent.click(within(viewer).getByRole('button', { name: 'Share' })); await Promise.resolve(); });
    expect(api.copy).toHaveBeenCalledExactlyOnceWith(`https://example.test/${marker.id}?image=second`);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByAltText('Image second')).toBeTruthy();
});

it('debounces vote changes, rolls back a failed request, and leaves the other image state intact', async () => {
    const marker = point(); api.detail.mockResolvedValue({ images: [image(marker.id)], myImages: [] }); api.upvote.mockRejectedValueOnce(new Error('offline'));
    render(<Uploader point={marker} pointName="Crate" />); await flush();
    const vote = screen.getByRole('button', { name: 'detail.viewer.upvote' });
    fireEvent.click(vote); expect(vote.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { await vi.advanceTimersByTimeAsync(299); }); expect(api.upvote).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api.upvote).toHaveBeenCalledExactlyOnceWith('first', true);
    expect(vote.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByAltText('Image first')).toBeTruthy();
    fireEvent.click(vote); fireEvent.click(vote);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(api.upvote).toHaveBeenCalledTimes(1);
});

it('requires a delayed recall confirmation and restores the own image and viewer when recall fails', async () => {
    const marker = point(); const own: UGCSubmissionImage = { ...image(marker.id), poiHash: 'hash', poiType: marker.type, snapshotId: 'snapshot', filePath: '/first.webp', status: 'pending_audit', author: { nickname: 'User A', publicUid: 'user-a' } };
    api.detail.mockResolvedValue({ images: [], myImages: [own] }); api.recall.mockRejectedValueOnce(new Error('offline'));
    render(<Uploader point={marker} pointName="Crate" />); await flush();
    fireEvent.click(screen.getByAltText('Image first'));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Upvote' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'detail.viewer.recall' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.confirmAgain' })); expect(api.recall).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.confirmAgain' })); await Promise.resolve(); });
    expect(api.recall).toHaveBeenCalledExactlyOnceWith('first');
    expect(screen.getByRole('dialog', { name: 'Image first' })).toBeTruthy();
    expect(screen.getAllByAltText('Image first')).toHaveLength(2);
});

it.each(['upvote', 'flag'] as const)('cancels queued %s actions when the account changes before their debounce fires', async (action) => {
    const marker = point(); api.detail.mockResolvedValue({ images: [image(marker.id)], myImages: [] });
    render(<Uploader point={marker} pointName="Crate" />); await flush();
    fireEvent.click(screen.getByRole('button', { name: `detail.viewer.${action}` }));
    act(() => { useAuthStore.setState({ sessionUser: { uid: 'user-b', nickname: 'User B' } }); }); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(api[action]).not.toHaveBeenCalled();
});

it('ignores a late vote response from the previous account after a fresh image list is displayed', async () => {
    const marker = point(), pending = deferred<UGCImageActionPatch>();
    api.detail.mockResolvedValue({ images: [image(marker.id)], myImages: [] }); api.upvote.mockReturnValue(pending.promise);
    render(<Uploader point={marker} pointName="Crate" />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'detail.viewer.upvote' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(api.upvote).toHaveBeenCalledOnce();
    act(() => { useAuthStore.setState({ sessionUser: { uid: 'user-b', nickname: 'User B' } }); }); await flush();
    await act(async () => { pending.resolve({ id: 'first', upvoted: true, upvotes: 3 }); await pending.promise; });
    expect(screen.getByRole('button', { name: 'detail.viewer.upvote' }).getAttribute('aria-pressed')).toBe('false');
});

it.each(['point round trip', 'same account login'] as const)('does not restore an old recall snapshot after a %s', async (mode) => {
    const marker = point(), other = point(), pending = deferred<{ id: string }>();
    const own: UGCSubmissionImage = { ...image(marker.id), poiHash: 'hash', poiType: marker.type, snapshotId: 'snapshot', filePath: '/first.webp', status: 'pending_audit', author: { nickname: 'User A', publicUid: 'user-a' } };
    api.detail.mockResolvedValue({ images: [], myImages: [own] });
    api.recall.mockReturnValueOnce(pending.promise);
    const view = render(<Uploader point={marker} pointName="Crate" />);
    await flush();
    fireEvent.click(screen.getByAltText('Image first'));
    fireEvent.click(screen.getByRole('button', { name: 'detail.viewer.recall' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    fireEvent.click(screen.getByRole('button', { name: 'common.confirmAgain' }));
    expect(api.recall).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    if (mode === 'point round trip') {
        view.rerender(<Uploader point={other} pointName="Other" />);
        await flush();
        api.detail.mockResolvedValue({ images: [image(marker.id, 'fresh')], myImages: [] });
        view.rerender(<Uploader point={marker} pointName="Crate" />);
        await flush();
        expect(screen.getByAltText('Image fresh')).toBeTruthy();
    } else {
        act(() => {
            useAuthStore.getState().clearSessionUser();
            useAuthStore.getState().setSessionUser({ uid: 'user-a', nickname: 'User A' });
        });
    }
    await act(async () => { pending.reject(new Error('Old recall failed')); await Promise.resolve(); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByAltText('Image first')).toBeNull();
});
