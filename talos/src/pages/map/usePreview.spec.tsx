import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UsePreview } from './usePreview';
import SupplementTooltip from './behaviorOverlay/SupplementTooltip';
import { MARKER_PREVIEW_ENTER_EVENT, MARKER_PREVIEW_LEAVE_EVENT } from '@/services/map/events/PreviewEvents';
import type { IMarkerData } from '@/data/marker';
import type { UGCImage } from '@/services/ugc/client';
import { deferred, mapFixture } from '../../../test-support/pages';
import { installPopover } from '../../../test-support/browser';

const api = vi.hoisted(() => ({ list: vi.fn(), cache: vi.fn(), small: false, t: (key: string) => key }));
vi.mock('@/locale', () => ({ useTranslateGame: () => api.t }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update: () => {}, stop: () => {} }) }));
vi.mock('@/devtools/loadDevTool', () => ({ isRecordToolEnabled: () => false }));
vi.mock('@/platform/device', () => ({ useAppViewport: () => ({ isPipUiTooSmall: api.small }) }));
vi.mock('@/platform/pictureInPicture', () => ({ getAppViewport: () => ({ isPipUiTooSmall: api.small }) }));
vi.mock('@/services/ugc/client', () => ({ peekPublicUGCImages: api.cache, peekUGCImages: () => null, listPublicUGCImagesByMarkerIds: api.list }));
let fixture: ReturnType<typeof mapFixture>, popover: ReturnType<typeof installPopover>;
const loads: HTMLImageElement[] = [];
beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); fixture = mapFixture(); popover = installPopover(); api.small = false; api.cache.mockReturnValue(null); api.list.mockResolvedValue({}); loads.length = 0;
    vi.stubGlobal('Image', class { constructor() { const img = document.createElement('img'); img.decode = vi.fn().mockResolvedValue(undefined); loads.push(img); return img; } });
});
afterEach(() => { cleanup(); popover.restore(); fixture.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const marker = (id: string): IMarkerData => ({ id, type: 'crate_ii', subregId: 'VL_1', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 });
const image = (id: string, upvotes: number, createdAt: string): UGCImage => ({ id, markerId: 'point', content: null, url: `/${id}.webp`, createdAt, upvotes });
function Preview() { return UsePreview(fixture.map).PreviewElement; }
const enter = (point: IMarkerData) => act(() => { window.dispatchEvent(new CustomEvent(MARKER_PREVIEW_ENTER_EVENT, { detail: { marker: point } })); });
const leave = (id: string) => act(() => { window.dispatchEvent(new CustomEvent(MARKER_PREVIEW_LEAVE_EVENT, { detail: { markerId: id } })); });

it('uses cached public images, chooses votes then oldest creation, and waits for decode before opening the tooltip', async () => {
    api.cache.mockReturnValue([image('newer', 5, '2026-10-27'), image('older', 5, '2026-10-26'), image('less', 1, '2026-10-20')]);
    render(<Preview />); enter(marker('point'));
    expect(api.list).not.toHaveBeenCalled(); expect(loads).toHaveLength(1); expect(loads[0].getAttribute('src')).toBe('/older.webp');
    expect(screen.queryByRole('img')).toBeNull();
    await act(async () => { loads[0].dispatchEvent(new Event('load')); await Promise.resolve(); });
    expect(screen.getByAltText('markerType.key.crate_ii').getAttribute('src')).toBe('/older.webp');
    expect(popover.isOpen(screen.getByRole('tooltip'))).toBe(true);
    leave('point'); act(() => { vi.advanceTimersByTime(160); }); expect(screen.queryByRole('img')).toBeNull();
});

it('debounces quick hovers, batches recent points and ignores an obsolete response after the next target', async () => {
    const pending = deferred<Record<string, UGCImage[]>>(); api.list.mockReturnValueOnce(pending.promise);
    const view = render(<Preview />); enter(marker('a')); act(() => { vi.advanceTimersByTime(79); }); enter(marker('b'));
    expect(api.list).not.toHaveBeenCalled(); await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    expect(api.list).toHaveBeenCalledExactlyOnceWith(['b', 'a']);
    enter(marker('c'));
    await act(async () => { pending.resolve({ b: [image('obsolete', 99, '2026-10-26')] }); await pending.promise; });
    expect(loads).toHaveLength(0);
    act(() => { fixture.map.fire('talos:regionSwitched'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); }); expect(api.list).toHaveBeenCalledTimes(1);
    view.unmount(); enter(marker('after')); act(() => { vi.advanceTimersByTime(100); }); expect(api.list).toHaveBeenCalledTimes(1);
});

it('disables previews in a small PiP viewport and hides failed image loads', () => {
    api.small = true; api.cache.mockReturnValue([image('failed', 1, '2026-10-26')]);
    const view = render(<Preview />); enter(marker('point')); expect(loads).toHaveLength(0);
    api.small = false; view.rerender(<Preview />); enter(marker('point')); expect(loads).toHaveLength(1);
    act(() => { loads[0].dispatchEvent(new Event('error')); }); expect(screen.queryByRole('tooltip')).toBeNull();
});

it('retains the supplement tooltip anchor through its exit instead of jumping to the origin', () => {
    const view = render(<SupplementTooltip point={{ left: 30, top: 40 }} />);
    const tooltip = screen.getByRole('tooltip'); expect(popover.isOpen(tooltip)).toBe(true);
    const anchor = view.container.querySelector<HTMLElement>('[style]')!; expect(anchor.style.left).toBe('30px');
    view.rerender(<SupplementTooltip point={null} />); expect(anchor.style.left).toBe('30px'); expect(anchor.style.top).toBe('40px');
    act(() => { vi.advanceTimersByTime(120); }); expect(popover.isOpen(tooltip)).toBe(false);
});
