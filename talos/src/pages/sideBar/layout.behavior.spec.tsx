import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SideBar from './sideBar';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useMarkerStore } from '@/store/marker';
import { installPointerCapture, installResizeObserver } from '../../../test-support/browser';
import desktopStyles from '@/component/shared/siteShell/sideBar.module.scss';
import mobileStyles from '@/component/shared/siteShell/sideBar.mobile.module.scss';

const state = vi.hoisted(() => ({ mobile: false, width: 1200, t: (key: string) => key }));
vi.mock('@/locale', () => ({ useTranslateUI: () => state.t }));
vi.mock('@/platform/device', async (original) => ({ ...await original<typeof import('@/platform/device')>(), useDevice: () => ({ isMobile: state.mobile, width: state.width }), useAppViewport: () => ({ width: state.width, height: 800 }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document }));
vi.mock('@/component/shared/siteShell/sideBar.frame', () => ({ AccountCard: () => null, SidebarFooter: () => null }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('./sidebarFilters', () => ({ categoryCount: 3, SidebarFilters: ({ preparedCount, columns, mobile }: { preparedCount: number; columns?: number; mobile?: boolean }) => <div data-testid="filters" data-count={preparedCount} data-columns={columns} data-mobile={String(mobile)} /> }));
vi.mock('@/pages/search/search.desktop', () => ({ default: () => <input aria-label="desktop-search" /> }));
vi.mock('@/pages/search/search.mobile', () => ({ default: () => <input aria-label="mobile-search" /> }));
vi.mock('@/pages/detail/detail', () => ({ default: ({ inline }: { inline: boolean }) => <div data-testid="detail" data-inline={String(inline)} /> }));
vi.mock('@/devtools/loadDevTool', () => ({ isRecordToolEnabled: () => false }));
const prefs = useUiPrefsStore.getState(), markers = useMarkerStore.getState();
let restorePointer: () => void;
beforeEach(() => { installResizeObserver(); restorePointer = installPointerCapture(); state.mobile = false; state.width = 1200; useUiPrefsStore.setState({ sidebarOpen: false, sidebarWidth: 400, desktopDrawerSnapIndex: null, mobileDrawerSnapIndex: 0 }); useMarkerStore.setState({ searchString: '', filter: [] }); });
afterEach(() => { cleanup(); restorePointer(); useUiPrefsStore.setState(prefs, true); useMarkerStore.setState(markers, true); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('prepares controls on intent, opens from the shared preference and notifies a desktop toggle once', async () => {
    const toggle = vi.fn(); render(<SideBar currentRegion={null} onToggle={toggle} />);
    expect(screen.queryByLabelText('desktop-search')).toBeNull();
    const expand = screen.getByRole('button', { name: 'common.expand' }); fireEvent.focus(expand);
    await waitFor(() => expect(Number(screen.getByTestId('filters').getAttribute('data-count'))).toBeGreaterThan(0));
    fireEvent.click(expand); expect(useUiPrefsStore.getState().sidebarOpen).toBe(true); expect(toggle).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByTestId('filters').getAttribute('data-count')).toBe('3');
    const trigger = screen.getByRole('button', { name: 'trigger.clusterMode' }); const before = trigger.getAttribute('aria-pressed'); fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-pressed')).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'common.collapse' })); expect(toggle).toHaveBeenLastCalledWith(false);
});

it('resizes the desktop sidebar within viewport bounds and recomputes columns after committing', () => {
    useUiPrefsStore.setState({ sidebarOpen: true }); const view = render(<div className="app"><SideBar currentRegion={null} onToggle={vi.fn()} /></div>);
    const handle = view.container.querySelector<HTMLElement>(`.${desktopStyles.resizeHandle}`)!;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400 }); fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800 });
    const liveWidth = view.container.querySelector<HTMLElement>('.app')!.style.getPropertyValue('--sidebar-width'); expect(parseFloat(liveWidth)).toBeLessThanOrEqual(1200);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 800 }); expect(useUiPrefsStore.getState().sidebarWidth).toBe(parseFloat(liveWidth));
    expect(Number(screen.getByTestId('filters').getAttribute('data-columns'))).toBeGreaterThanOrEqual(3);
    expect(handle.hasPointerCapture(1)).toBe(false);
});

it('raises the mobile drawer for a new query, preserves an already expanded drawer and hides the filter divider during search', async () => {
    expect(useUiPrefsStore.persist.hasHydrated()).toBe(true);
    state.mobile = true; const view = render(<SideBar currentRegion={null} onToggle={vi.fn()} />);
    expect(screen.getByTestId('detail').getAttribute('data-inline')).toBe('true');
    act(() => { useMarkerStore.getState().setSearchString('ore'); });
    expect(useUiPrefsStore.getState().mobileDrawerSnapIndex).toBe(1);
    expect(view.container.querySelector(`.${mobileStyles.searchMode}`)).toBeTruthy();
    expect(view.container.querySelector('[role="separator"][aria-orientation="vertical"]')).toBeNull();
    const drawer = view.container.querySelector<HTMLElement>('[data-font-region="drawer"]')!;
    await waitFor(() => expect(parseFloat(drawer.style.getPropertyValue('--drawer-size'))).toBe(440));
    act(() => { useUiPrefsStore.getState().setMobileDrawerSnapIndex(2); });
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('680px'));
    act(() => { useMarkerStore.getState().setSearchString(''); }); act(() => { useMarkerStore.getState().setSearchString('another'); });
    expect(useUiPrefsStore.getState().mobileDrawerSnapIndex).toBe(2);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe('680px');
    view.rerender(<SideBar currentRegion={null} visible={false} onToggle={vi.fn()} />); expect(view.container.querySelector('[data-sidebar-layout]')?.hasAttribute('inert')).toBe(true);
});

it('keeps desktop and mobile layouts mutually exclusive across a responsive transition', () => {
    const view = render(<SideBar currentRegion={null} onToggle={vi.fn()} />);
    expect(view.container.querySelector('[data-sidebar-layout="desktop"]')).toBeTruthy();
    state.mobile = true; state.width = 390; view.rerender(<SideBar currentRegion={null} onToggle={vi.fn()} />);
    expect(view.container.querySelector('[data-sidebar-layout="desktop"]')).toBeNull(); expect(screen.getByLabelText('mobile-search')).toBeTruthy();
});
