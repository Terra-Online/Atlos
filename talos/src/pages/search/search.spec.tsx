import type { ComponentType } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPopover, installResizeObserver, setScrollMetrics } from '../../../test-support/browser';
import { searchDocs } from '../../../test-support/search';
import styles from './search.module.scss';

const navigation = vi.hoisted(() => vi.fn());
vi.mock('@/services/map', () => ({ navigateToSharedPoint: navigation }));
vi.mock('@/locale', async () => {
    const { default: ui } = await import('@/locale/data/ui/en-US.json');
    const { translateGame } = await import('../../../test-support/search');
    const translate = (key: string) => ui.search[key.slice('search.'.length) as keyof typeof ui.search] ?? key;
    return { useLocale: () => 'en-US', useTranslateUI: () => translate, useTranslateGame: () => translateGame, hasFullSupport: () => true, isUIOnly: () => false, resolveFileContentLocale: (locale: string) => locale };
});
vi.mock('@/locale/useFontRegion', () => { const ref = () => {}; return { useFontRegion: () => ref }; });
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update() {}, stop() {} }) }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/data/marker', async () => {
    const { markerTypes } = await import('../../../test-support/search');
    return {
        MARKER_TYPE_DICT: markerTypes,
        WORLD_TYPE_COUNT_MAP: { ore: 20, report: 1 },
        REGION_TYPE_COUNT_MAP: { Valley_4: { ore: 12, report: 1 }, Wuling: { ore: 8 } },
        SUBREGION_TYPE_COUNT_MAP: { VL_A: { ore: 3, report: 1 }, WL_A: { ore: 4 } },
        loadAllMarkers: vi.fn(() => Promise.resolve([])),
    };
});
vi.mock('@/data/map', () => ({ REGION_DICT: { Valley_4: { subregions: ['VL_A'] }, Wuling: { subregions: ['WL_A'] } }, SUBREGION_DICT: { VL_A: { name: 'A' }, WL_A: { name: 'A' } } }));

let Desktop: ComponentType;
let Mobile: ComponentType<{ width?: number | string }>;
let marker: typeof import('@/store/marker')['useMarkerStore'];
let region: typeof import('@/store/region')['default'];
let popover: ReturnType<typeof installPopover>;
const tick = async (ms = 200) => {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await act(async () => { await vi.dynamicImportSettled(); });
};
beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    installResizeObserver();
    popover = installPopover();
    navigation.mockReset();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(searchDocs), { headers: { 'Content-Type': 'application/json' } }))));
    Desktop = (await import('./search.desktop')).default;
    Mobile = (await import('./search.mobile')).default;
    marker = (await import('@/store/marker')).useMarkerStore;
    vi.mocked((await import('@/data/marker')).loadAllMarkers).mockReset().mockResolvedValue([]);
    region = (await import('@/store/region')).default;
    marker.setState({ searchString: '', filter: [] });
    region.setState({ currentRegionKey: 'Valley_4', currentSubregionKey: 'VL_A' });
});

it('falls back to marker data without assigning Wuling points to Valley', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Search index offline'));
    vi.mocked((await import('@/data/marker')).loadAllMarkers).mockResolvedValue([
        { id: 'fallback', type: 'ore', subregId: 'WL_A', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 },
    ]);
    render(<Desktop />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ore' } });
    await tick();
    fireEvent.click(screen.getByRole('img', { name: 'Copper ore 铜矿石' }).closest('button')!);
    expect(navigation).toHaveBeenCalledExactlyOnceWith({ regionKey: 'Wuling', subregionKey: 'WL_A', pointId: 'fallback' });
});

it('retries an unavailable fallback source while the query is active and stops after recovery', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Search index offline'));
    const load = vi.mocked((await import('@/data/marker')).loadAllMarkers);
    load.mockRejectedValueOnce(new Error('Marker shard offline')).mockResolvedValue([
        { id: 'fallback', type: 'ore', subregId: 'WL_A', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 },
    ]);
    const view = render(<Desktop />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ore' } });
    await tick();
    expect(screen.queryByRole('img', { name: 'Copper ore 铜矿石' })).toBeNull();
    await tick(800);
    expect(screen.getByRole('img', { name: 'Copper ore 铜矿石' })).toBeTruthy();
    const calls = load.mock.calls.length;
    view.unmount();
    await tick(1600);
    expect(load).toHaveBeenCalledTimes(calls);
});
afterEach(() => { cleanup(); popover.restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('connects the real search engine and store to grouped filters and unique point navigation', async () => {
    render(<Desktop />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  COPPER  ' } });
    expect(marker.getState().searchString).toBe('  COPPER  ');
    await tick();
    expect(screen.getByText('2 results')).toBeTruthy();
    const group = screen.getByRole('img', { name: 'Copper ore 铜矿石' }).closest('button')!;
    fireEvent.click(group);
    expect(marker.getState().filter).toEqual(['ore']);
    expect(navigation).not.toHaveBeenCalled();
    fireEvent.click(group);
    expect(marker.getState().filter).toEqual([]);
    const unique = screen.getByRole('button', { name: /Field report/ });
    fireEvent.click(unique);
    expect(marker.getState().filter).toEqual(['report']);
    expect(navigation).toHaveBeenCalledExactlyOnceWith({ regionKey: 'Valley_4', subregionKey: 'VL_A', pointId: 'archive-a' });
    fireEvent.click(unique);
    expect(marker.getState().filter).toEqual(['report']);
    expect(navigation).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('img', { name: 'Copper ore 铜矿石' }).getAttribute('src')).toContain('/assets/images/marker/copper_spot.webp');
});

it('shares the query with mobile search, highlights archive snippets and updates counts for a new region', async () => {
    const view = render(<Mobile width={240} />);
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('240px');
    expect(root.classList.contains(styles.mobile)).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '铜矿石' } });
    await tick();
    expect(screen.getByText('2 results')).toBeTruthy();
    expect(root.querySelectorAll(`.${styles.matchHighlight}`).length).toBeGreaterThanOrEqual(2);
    const counts = screen.getByRole('button', { name: /Copper ore/ }).querySelector(`.${styles.resultCount}`)!;
    expect(counts.textContent).toBe('20/12/3');
    act(() => region.setState({ currentRegionKey: 'Wuling', currentSubregionKey: 'WL_A' }));
    await tick();
    expect(counts.textContent).toBe('20/8/4');
    expect(fetch).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mineral studies' } });
    await tick();
    expect(screen.getByRole('button', { name: /Mineral studies.*Field report/ })).toBeTruthy();
    view.rerender(<Desktop />);
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Mineral studies');
});

it('does not submit or reset the query and filters on Enter', async () => {
    const view = render(<Desktop />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ore' } });
    await tick();
    act(() => marker.getState().setFilter(['ore']));
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    fireEvent(view.container.querySelector('form')!, submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(marker.getState()).toMatchObject({ searchString: 'ore', filter: ['ore'] });
    expect(navigation).not.toHaveBeenCalled();
});

it('updates scroll-edge masks and closes empty or whitespace-only results', async () => {
    const view = render(<Desktop />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'copper' } });
    await tick();
    const panel = view.container.querySelector<HTMLElement>(`.${styles.searchResultPanel}`)!;
    const shell = panel.parentElement!;
    setScrollMetrics(panel, 100, 300);
    fireEvent.scroll(panel);
    expect(shell.dataset).toMatchObject({ maskTop: 'false', maskBottom: 'true', open: 'true', loading: 'false' });
    panel.scrollTop = 100;
    fireEvent.scroll(panel);
    expect(shell.dataset).toMatchObject({ maskTop: 'true', maskBottom: 'true' });
    panel.scrollTop = 200;
    fireEvent.scroll(panel);
    expect(shell.dataset).toMatchObject({ maskTop: 'true', maskBottom: 'false' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no matching fixture item' } });
    await tick();
    expect(screen.getByText('0 results')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    await tick();
    expect(shell.dataset.open).toBe('false');
    expect(screen.queryByText(/\d results/)).toBeNull();
    expect(shell.dataset).toMatchObject({ maskTop: 'false', maskBottom: 'false' });
});

it.each(['', 'a completely different query'])('does not publish an older in-flight result after the query changes to %j', async (nextQuery) => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const view = render(<Desktop />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ore' } });
    await tick();
    expect(fetch).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: nextQuery } });
    // The first response arrives during the next query's debounce window.
    await act(async () => { resolve(new Response(JSON.stringify(searchDocs))); await Promise.resolve(); });
    await act(async () => { await vi.dynamicImportSettled(); });
    const panel = view.container.querySelector(`.${styles.searchResultPanel}`)!;
    expect(panel.querySelectorAll('button')).toHaveLength(0);
});
