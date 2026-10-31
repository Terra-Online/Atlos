import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Detail from './detail';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import { useAuthStore } from '@/store/auth';
import { useHistoryStore } from '@/store/history';
import useRegion from '@/store/region';
import { MARKER_TYPE_DICT, type IMarkerData } from '@/data/marker';
import type { UGCComment } from '@/services/ugc/client';
import { installResizeObserver } from '../../../test-support/browser';
import { deferred } from '../../../test-support/pages';

const api = vi.hoisted(() => ({ t: (key: string) => key, locale: 'en-US', comments: vi.fn(), images: vi.fn(), archive: vi.fn(), copy: vi.fn(), loaded: [] as IMarkerData[], stats: vi.fn() }));
vi.mock('@/locale', () => ({ useTranslateUI: () => api.t, useTranslateGame: () => api.t, useLocale: () => api.locale, getProjectLangNameKey: () => '' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update: () => {}, stop: () => {} }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getAppDocument: () => document, getOpenerDocument: () => document, subscribePictureInPictureState: () => () => {} }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/pages/detail/comment/useAutoTrans', () => ({ useAutoTrans: () => {} }));
vi.mock('@/pages/detail/comment/useTrans', () => ({ useTrans: () => () => {} }));
vi.mock('@/services/routing', () => ({ generatePointShareUrl: (point: IMarkerData) => `https://example.test/${point.id}` }));
vi.mock('@/platform/clipboard', () => ({ copyTextToClipboard: api.copy }));
vi.mock('@/data/marker', async (original) => ({ ...await original<typeof import('@/data/marker')>(), getLoadedRegionMarkers: () => api.loaded, loadRegionMarkers: () => Promise.resolve(api.loaded) }));
vi.mock('@/services/assets/resource', async (original) => ({ ...await original<typeof import('@/services/assets/resource')>(), fetchArchiveFile: api.archive }));
vi.mock('@/services/ugc/client', async (original) => ({ ...await original<typeof import('@/services/ugc/client')>(), listUGCComments: api.comments, listPublicUGCImages: api.images }));
vi.mock('@/services/progress', async (original) => ({ ...await original<typeof import('@/services/progress')>(), getProgressMarkerIndex: () => Promise.resolve({ pointIds: [], indexById: new Map(), markerIndexHash: 'fixture' }), fetchProgressStats: api.stats }));
const markerState = useMarkerStore.getState(), records = useUserRecordStore.getState(), auth = useAuthStore.getState(), history = useHistoryStore.getState(), region = useRegion.getState();
const scrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
const point = (id: string, type = 'crate_ii'): IMarkerData => ({ id, type, subregId: 'VL_1', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 });
const comment = (id: string, content: string, score: number, replies: UGCComment[] = []): UGCComment => ({ id, markerId: 'detail-first', content, score, replies, status: 'active', depth: 0, parentId: null, createdAt: '2026-10-27T00:00:00Z', replyCount: replies.length });
beforeEach(() => {
    vi.clearAllMocks(); installResizeObserver(); api.locale = 'en-US'; api.comments.mockResolvedValue([]); api.images.mockResolvedValue([]); api.copy.mockResolvedValue(true); api.stats.mockRejectedValue(new Error('statistics unavailable')); api.archive.mockResolvedValue(new Response(JSON.stringify({ content: 'Archive text' }), { headers: { 'content-type': 'application/json' } }));
    useMarkerStore.setState({ currentActivePoint: null, commentOpenRequest: null, imageOpenRequest: null }); useUserRecordStore.setState({ activePoints: [] }); useAuthStore.setState({ sessionUser: null }); useHistoryStore.setState({ past: [], future: [] }); useRegion.setState({ currentRegionKey: 'Valley_4' });
    api.loaded = [point('detail-first'), point('detail-second'), point('different-type', 'ore_iron')];
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => {} });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => { cleanup(); useMarkerStore.setState(markerState, true); useUserRecordStore.setState(records, true); useAuthStore.setState(auth, true); useHistoryStore.setState(history, true); useRegion.setState(region, true); if (scrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollTo); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo'); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('opens for marker intent, closes without losing the marker and reopens for the same marker', async () => {
    render(<Detail />); expect(screen.queryByRole('tab')).toBeNull();
    act(() => { useMarkerStore.getState().setCurrentActivePoint(api.loaded[0]); });
    await screen.findByRole('tab', { name: 'detail.tabs.general' });
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(useMarkerStore.getState().currentActivePoint?.id).toBe('detail-first');
    await waitFor(() => expect(screen.queryByRole('tab')).toBeNull());
    act(() => { useMarkerStore.getState().setCurrentActivePoint(api.loaded[0]); });
    expect(screen.getByRole('tab', { name: 'detail.tabs.general' })).toBeTruthy();
});

it('commits collection through the real history store and keeps undo and delayed bulk collection consistent', async () => {
    vi.useFakeTimers(); useMarkerStore.setState({ currentActivePoint: api.loaded[0] }); render(<Detail />); await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByAltText('markerType.key.crate_ii'));
    expect(useUserRecordStore.getState().activePoints).toEqual(['detail-first']);
    act(() => { useHistoryStore.getState().undo(); }); expect(useUserRecordStore.getState().activePoints).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'detail.tabs.collectAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.confirmAgain' })); expect(useUserRecordStore.getState().activePoints).toEqual([]);
    act(() => { vi.advanceTimersByTime(300); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.confirmAgain' })); await Promise.resolve(); });
    expect(useUserRecordStore.getState().activePoints).toEqual(['detail-first', 'detail-second']);
    act(() => { useHistoryStore.getState().undo(); }); expect(useUserRecordStore.getState().activePoints).toEqual([]);
});

it('selects the highest-rated nested excerpt and opens real Comments on intent without remounting when tabs change', async () => {
    const best = comment('best', 'Best nested reply', 9); api.comments.mockResolvedValue([comment('root', 'Root comment', 1, [best])]);
    useMarkerStore.setState({ currentActivePoint: api.loaded[0] }); render(<Detail inline />);
    await screen.findByText('Best nested reply'); expect(api.comments).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'detail.tabs.comments' }));
    await waitFor(() => expect(document.querySelector('[data-comment-id="best"][data-highlighted="true"]')).toBeTruthy());
    expect(api.comments).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('tab', { name: 'detail.tabs.general' }));
    fireEvent.click(screen.getByRole('tab', { name: 'detail.tabs.comments' }));
    expect(api.comments).toHaveBeenCalledTimes(2);
    act(() => { useMarkerStore.getState().setCurrentActivePoint(api.loaded[1]); });
    expect(screen.getByRole('tab', { name: 'detail.tabs.general' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-comment-id="best"][data-highlighted="true"]')).toBeNull();
});

it('aborts stale archive reads and renders full text through the real modal/parser without executable HTML', async () => {
    const file = Object.values(MARKER_TYPE_DICT).find((type) => type.category.main === 'files')!;
    const pending = deferred<Response>(); api.archive.mockReturnValueOnce(pending.promise);
    const archive = point('archive', file.key); useMarkerStore.setState({ currentActivePoint: archive }); render(<Detail />);
    expect(api.archive).toHaveBeenCalledTimes(1); const signal = api.archive.mock.calls[0][1] as AbortSignal;
    act(() => { useMarkerStore.getState().setCurrentActivePoint(api.loaded[0]); }); expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(new Response(JSON.stringify({ content: 'Obsolete archive' }), { headers: { 'content-type': 'application/json' } })); await pending.promise; });
    expect(screen.queryByRole('button', { name: 'detail.readFullText' })).toBeNull();
    api.archive.mockResolvedValue(new Response(JSON.stringify({ content: '<b>Visible archive</b>\n<script>bad()</script><img src="files/illustration" onerror="bad()">' }), { headers: { 'content-type': 'application/json' } }));
    act(() => { useMarkerStore.getState().setCurrentActivePoint(archive); });
    fireEvent.click(await screen.findByRole('button', { name: 'detail.readFullText' }));
    expect(screen.getByRole('dialog').querySelector('b')?.textContent).toBe('Visible archive');
    expect(screen.getByRole('dialog').querySelector('script,[onerror]')).toBeNull();
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toContain('files/illustration.webp');
});
