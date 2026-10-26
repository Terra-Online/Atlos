import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidebarFilters, categoryCount } from './sidebarFilters';
import { SelectorRows, SidebarWindow } from './sidebarWindow';
import { SelectionLayer } from './selectionLayer';
import type { SelectorItem } from './model';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import { useUiPrefsStore } from '@/store/uiPrefs';
import useRegion from '@/store/region';
import { installPointerCapture, installResizeObserver, setRect, setScrollMetrics } from '../../../test-support/browser';

const data = vi.hoisted(() => ({
    types: [
        { key: 'ore', category: { main: 'normal', sub: 'natural' } },
        { key: 'file_a', ctgr: 'records', category: { main: 'files', sub: 'archives' } },
        { key: 'file_b', ctgr: 'records', category: { main: 'files', sub: 'archives' } },
    ],
    t: (key: string) => key,
}));
vi.mock('@/locale', () => ({ useTranslateGame: () => data.t, useTranslateUI: () => data.t, useLocale: () => 'en-US' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document }));
vi.mock('@/devtools/loadDevTool', () => ({ isRecordToolEnabled: () => false }));
vi.mock('@/data/marker/diff.generated.json', () => ({ default: { types: [['ore', 'point-ore', 1]] } }));
vi.mock('@/data/marker', async (original) => ({ ...await original<typeof import('@/data/marker')>(),
    MARKER_TYPE_DICT: Object.fromEntries(data.types.map((type) => [type.key, type])), MARKER_TYPE_TREE: { natural: [data.types[0]], archives: data.types.slice(1) }, DEFAULT_SUBCATEGORY_ORDER: ['natural', 'archives'],
    REGION_TYPE_COUNT_MAP: { Valley_4: { ore: 1, file_a: 1, file_b: 1 }, Dijiang: {} },
    getLoadedRegionMarkers: () => data.types.map((type, index) => ({ id: `point-${type.key}`, type: type.key, subregId: 'VL_1', x: index, y: 0, z: 0, pos: [0, index], tier: 0 })),
}));
const markers = useMarkerStore.getState(), records = useUserRecordStore.getState(), prefs = useUiPrefsStore.getState(), region = useRegion.getState();
let resize: ReturnType<typeof installResizeObserver>, pointer: () => void;
beforeEach(() => { resize = installResizeObserver(); pointer = installPointerCapture(); useMarkerStore.setState({ filter: [], searchString: '' }); useUserRecordStore.setState({ activePoints: [] }); useUiPrefsStore.setState({ markFilterExpanded: { 'version-new': true, natural: true, archives: true } }); useRegion.setState({ currentRegionKey: 'Valley_4' }); });
afterEach(() => { cleanup(); pointer(); useMarkerStore.setState(markers, true); useUserRecordStore.setState(records, true); useUiPrefsStore.setState(prefs, true); useRegion.setState(region, true); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('admits prepared categories, binds actual model counts and keeps archive children distinct from their binder', () => {
    const view = render(<SidebarFilters preparedCount={0} columns={3} />); expect(screen.queryByAltText('markerType.key.ore')).toBeNull();
    view.rerender(<SidebarFilters preparedCount={categoryCount} columns={3} />);
    const ore = screen.getAllByAltText('markerType.key.ore'); expect(ore).toHaveLength(2);
    fireEvent.click(ore[0].closest('[data-mark-selector-item]')!);
    expect(useMarkerStore.getState().filter).toEqual(['ore']);
    for (const icon of screen.getAllByAltText('markerType.key.ore')) expect(icon.closest('[data-mark-selector-item]')?.getAttribute('data-active')).toBe('true');
    const link = screen.getByRole('link', { name: '(markFilter.archiveHub)' }); expect(link.getAttribute('href')).toBe('https://oem.re/intel'); expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const binder = screen.getByAltText('markerType.FileCtgr.records').closest('[data-binder-wrap]')!;
    fireEvent.click(binder); expect(useMarkerStore.getState().filter).toEqual(['ore', 'file_a', 'file_b']);
    fireEvent.click(screen.getByAltText('markerType.key.file_a').closest('[data-mark-selector-item]')!);
    expect(useMarkerStore.getState().filter).toEqual(['ore', 'file_b']);
});

it('filters the same real model on query and region changes without silently clearing selected types', () => {
    render(<SidebarFilters preparedCount={categoryCount} mobile />);
    act(() => { useMarkerStore.setState({ searchString: 'file_a', filter: ['ore'] }); });
    expect(screen.queryByAltText('markerType.key.ore')).toBeNull(); expect(screen.getByAltText('markerType.key.file_a')).toBeTruthy();
    act(() => { useRegion.setState({ currentRegionKey: 'Dijiang' }); });
    expect(screen.queryByAltText('markerType.key.file_a')).toBeNull(); expect(useMarkerStore.getState().filter).toEqual(['ore']);
});

const rows: SelectorItem[] = Array.from({ length: 20 }, (_, index) => ({ typeInfo: { key: `row-${index}`, category: { main: 'normal', sub: 'natural' } }, name: `Row ${index}`, count: { total: 1, collected: 0 }, visible: true }));
function WindowedSelection() {
    const ref = useRef<HTMLDivElement>(null);
    return <SidebarWindow containerRef={ref}><div ref={ref} data-testid="root"><SelectionLayer containerRef={ref} /><div data-sidebar-scroll="true" data-sidescroll="true">
        <SelectorRows items={rows} renderItem={(item, index, style) => <div key={item.typeInfo.key} style={style} data-sidebar-index={index} data-key={item.typeInfo.key} data-mark-selector-item="true">{item.name}</div>} />
    </div></div></SidebarWindow>;
}

it('keeps virtual rows, pointer selection and selected state consistent and removes observers after unmount', () => {
    vi.useFakeTimers(); const view = render(<WindowedSelection />);
    const root = screen.getByTestId('root'), scroll = root.querySelector<HTMLElement>('[data-sidebar-scroll]')!, grid = root.querySelector<HTMLElement>('[data-sidebar-rows]')!;
    setRect(root, 0, 0, 200, 100); setRect(scroll, 0, 0, 200, 100); setScrollMetrics(scroll, 100, 420);
    grid.style.gridAutoRows = '40px'; grid.style.gridTemplateColumns = '100px 100px'; grid.style.columnGap = '0px';
    vi.spyOn(grid, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 20 - scroll.scrollTop, 200, 400));
    act(() => { resize.notify(); }); expect(screen.getByText('Row 0')).toBeTruthy(); expect(screen.queryByText('Row 19')).toBeNull();
    fireEvent.pointerDown(scroll, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 90 });
    act(() => { vi.advanceTimersToNextFrame(); }); fireEvent.pointerUp(window, { pointerId: 1, clientX: 50, clientY: 90 });
    expect(useMarkerStore.getState().filter).toEqual(['row-0', 'row-2']);
    expect(screen.getByText('Row 0').getAttribute('data-active')).toBe('true');
    scroll.scrollTop = 300; fireEvent.scroll(scroll); expect(screen.getByText('Row 19')).toBeTruthy();
    view.unmount(); expect(resize.observers.every((observer) => observer.targets.size === 0)).toBe(true);
    expect(document.body.style.userSelect).toBe('');
});
