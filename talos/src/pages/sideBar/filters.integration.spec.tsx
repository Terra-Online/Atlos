import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MARKER_TYPE_DICT } from '@/data/marker';
import { useMarkerStore } from '@/store/marker';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { type BinderItem, type SelectorItem } from './model';
import MarkBinder from '@/pages/markBinder/markBinder';
import MarkFilter from '@/pages/markFilter/markFilter';
import { MarkFilterDragProvider } from '@/pages/markFilter/reorderContext';
import FilterListDesktop from '@/pages/filterList/filterList.desktop';
import FilterListMobile from '@/pages/filterList/filterList.mobile';
import ScopeIndicator from '@/pages/scopeIndicator/ScopeIndicator';
import { installResizeObserver } from '../../../test-support/browser';
import stripStyles from '@/pages/filterList/filterList.module.scss';

const locale = vi.hoisted(() => ({ t: (key: string) => key === 'contextMenu.scopeLabel' ? 'Showing {region} only' : key }));
vi.mock('@/locale', () => ({ useTranslateUI: () => locale.t, useTranslateGame: () => locale.t }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document }));
const initialMarkers = useMarkerStore.getState(), initialPrefs = useUiPrefsStore.getState();
const ordinary = Object.values(MARKER_TYPE_DICT).filter((type) => type.category.main !== 'files').slice(0, 2);
const fileType = Object.values(MARKER_TYPE_DICT).find((type) => type.category.main === 'files')!;
const children: SelectorItem[] = ordinary.map((typeInfo, index) => ({ typeInfo, name: `Ore ${index + 1}`, count: { total: 2, collected: index }, visible: true }));
const binder: BinderItem = {
    group: { id: 'drop:fixture', dropKey: 'fixture', dropName: 'Ore group', sharedKey: 'drop', types: ordinary },
    name: 'Ore group', count: { total: 4, collected: 1 }, visible: true, children, collapseChildren: false,
};
let resize: ReturnType<typeof installResizeObserver>;
beforeEach(() => { resize = installResizeObserver(); useMarkerStore.setState({ filter: [], visibleSubregionKey: null }); });
afterEach(() => { cleanup(); useMarkerStore.setState(initialMarkers, true); useUiPrefsStore.setState(initialPrefs, true); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([false, true])('keeps binder/selector/filter-list selection consistent in the %s mobile layout', (mobile) => {
    const outside = 'unrelated-existing-filter';
    useMarkerStore.setState({ filter: [outside, fileType.key] });
    const view = render(<><MarkBinder item={binder} mobile={mobile} />{mobile ? <FilterListMobile /> : <FilterListDesktop isSidebarOpen />}</>);
    const header = screen.getByAltText('Ore group').closest('[data-binder-wrap]')!;
    fireEvent.click(header);
    expect(useMarkerStore.getState().filter).toEqual([outside, fileType.key, ...ordinary.map((type) => type.key)]);
    expect(header.getAttribute('data-active')).toBe('true');
    const first = screen.getByAltText('Ore 1').closest('[data-mark-selector-item]')!;
    const second = screen.getByAltText('Ore 2').closest('[data-mark-selector-item]')!;
    expect(first.getAttribute('data-active')).toBe('true');
    fireEvent.click(first);
    expect(useMarkerStore.getState().filter).toEqual([outside, fileType.key, ordinary[1].key]);
    expect(header.getAttribute('data-active')).toBe('false');
    expect(second.getAttribute('data-active')).toBe('true');
    // File filters remain selected but have no icon in either filter strip.
    const stripImages = [...view.container.querySelectorAll('img[alt=""]')];
    expect(stripImages).toHaveLength(2);
    fireEvent.click(stripImages[0].parentElement!);
    expect(useMarkerStore.getState().filter).toEqual([outside, fileType.key]);
    expect(second.getAttribute('data-active')).toBe('false');
});

it('auto-collapses empty categories, allows explicit expansion, and retains children only through the close animation', () => {
    vi.useFakeTimers();
    useUiPrefsStore.setState({ markFilterExpanded: { fixture: true } });
    const view = (empty: boolean) => <MarkFilterDragProvider><MarkFilter idKey="fixture" title="Fixture category" initialEmpty={empty} itemCount={empty ? 0 : 1} typeKeys={[ordinary[0].key]}><span>Category child</span></MarkFilter></MarkFilterDragProvider>;
    const rendered = render(view(true));
    expect(screen.queryByText('Category child')).toBeNull();
    fireEvent.click(screen.getByText('Fixture category'));
    expect(screen.getByText('markFilter.emptyTitle')).toBeTruthy();
    expect(screen.getByText('Category child')).toBeTruthy();
    rendered.rerender(view(false));
    expect(screen.queryByText('markFilter.emptyTitle')).toBeNull();
    fireEvent.click(screen.getByText('Fixture category'));
    expect(screen.getByText('Category child')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(499); });
    expect(screen.getByText('Category child')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Category child')).toBeNull();
});

it('clears a subregion scope without changing selected marker types', () => {
    useMarkerStore.setState({ filter: [ordinary[0].key], visibleSubregionKey: 'VL_1' });
    render(<ScopeIndicator />);
    expect(screen.getByRole('status').textContent).toContain('Showing');
    fireEvent.click(screen.getByRole('button', { name: 'contextMenu.showAllSubregions' }));
    expect(useMarkerStore.getState().visibleSubregionKey).toBeNull();
    expect(useMarkerStore.getState().filter).toEqual([ordinary[0].key]);
    expect(screen.queryByRole('status')).toBeNull();
});

it.each([false, true])('updates filter-strip edge masks and releases measurements in mobile=%s', (mobile) => {
    useMarkerStore.setState({ filter: ordinary.map((type) => type.key) });
    const width = vi.fn(); const view = render(mobile ? <FilterListMobile onContentWidthChange={width} /> : <FilterListDesktop isSidebarOpen />);
    const viewport = view.container.querySelector<HTMLElement>(`.${stripStyles.mainFilterContentContainer}`)!, inner = viewport.firstElementChild as HTMLElement;
    Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 100 }, scrollWidth: { configurable: true, value: 300 } });
    Object.defineProperty(inner, 'scrollWidth', { configurable: true, value: 300 });
    act(() => { resize.notify(); });
    if (mobile) {
        expect(width).toHaveBeenLastCalledWith(300);
        fireEvent.scroll(viewport); expect(viewport.classList.contains(stripStyles.rightMaskOpacity)).toBe(true);
        viewport.scrollLeft = 100; fireEvent.scroll(viewport); expect(viewport.classList.contains(stripStyles.leftMaskOpacity)).toBe(true);
        viewport.scrollLeft = 200; fireEvent.scroll(viewport); expect(viewport.classList.contains(stripStyles.rightMaskOpacity)).toBe(false);
    } else {
        expect(viewport.classList.contains(stripStyles.rightMaskOpacity)).toBe(true);
        const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }); fireEvent(viewport, wheel);
        expect(wheel.defaultPrevented).toBe(true); expect(viewport.classList.contains(stripStyles.leftMaskOpacity)).toBe(true);
        fireEvent.wheel(viewport, { deltaY: 999 }); expect(viewport.classList.contains(stripStyles.rightMaskOpacity)).toBe(false);
    }
    view.unmount(); expect(resize.observers.every((observer) => observer.targets.size === 0)).toBe(true);
});
