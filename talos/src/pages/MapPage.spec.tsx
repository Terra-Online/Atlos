import L from 'leaflet';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MapPage from './MapPage';
import { useUiPrefsStore } from '@/store/uiPrefs';

const scene = vi.hoisted(() => ({ map: null as L.Map | null, fail: false, desktop: true }));
vi.mock('@/pages/map/Map', async () => {
    const { useEffect } = await import('react');
    return { default: function MapFixture({ onMapReady }: { onMapReady: (map: L.Map) => void }) {
        useEffect(() => { if (scene.map) onMapReady(scene.map); }, [onMapReady]);
        if (scene.fail) throw new Error('Map render failed');
        return <div data-testid="map" />;
    } };
});
vi.mock('@/pages/uiOverlay/UIOverlay', () => ({ default: ({ visible, onToggleUI, userGuideReady }: { visible: boolean; onToggleUI: () => void; userGuideReady: boolean }) => <div data-testid="overlay" data-visible={visible} data-guide-ready={userGuideReady}><button onClick={onToggleUI}>Toggle UI</button></div> }));
vi.mock('@/pages/sideBar/sideBar', () => ({ default: ({ visible }: { visible: boolean }) => <aside data-testid="sidebar" data-visible={visible} /> }));
vi.mock('@/pages/domain/domain', () => ({ default: () => <div>Domain notice</div> }));
vi.mock('@/pages/locator/LocatorBanner', () => ({ default: () => null }));
vi.mock('@/pages/locator/LocationAuth', () => ({ default: () => null }));
vi.mock('@/pages/locator/EndfieldBindingHost', () => ({ default: () => null }));
vi.mock('@/pages/MetaHelper', () => ({ MetaHelper: () => null }));
vi.mock('@/pages/userGuide/UserGuide', async () => {
    const { useEffect } = await import('react');
    return { default: function GuideFixture({ onReady }: { onReady: () => void }) { useEffect(onReady, [onReady]); return <div>Guide ready</div>; } };
});
vi.mock('@/pages/settings/useShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/services/map/selection/useMapMultiSelect', () => ({ useMapMultiSelect: vi.fn() }));
vi.mock('@/pages/map/useLocator', () => ({ useLocator: vi.fn() }));
vi.mock('@/store/locator', () => ({ useLocatorStore: (select: (state: { authOpen: boolean }) => boolean) => select({ authOpen: false }) }));
vi.mock('@/platform/device', () => ({ DESKTOPER_BREAKPOINT: 1280, DESKTOPEST_BREAKPOINT: 1600, useDevice: () => ({ isDesktop: scene.desktop }), useAppViewport: () => ({ isPipUiTooSmall: false, isPipCompact: false }) }));
vi.mock('@/platform/platform', () => ({ isApplePlatform: () => false }));
vi.mock('@/platform/pictureInPicture', () => ({ getAppDocument: () => document, getAppViewport: () => ({ isPipCompact: false }), subscribePictureInPictureState: () => () => {} }));

let host: HTMLDivElement;
beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    scene.map = L.map(host, { zoomControl: false }).setView([0, 0], 3);
    scene.fail = false;
    scene.desktop = true;
    useUiPrefsStore.setState({ sidebarOpen: false, sidebarWidth: 500, isUserGuideOpen: false });
});
afterEach(() => { cleanup(); scene.map?.remove(); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('pans desktop maps only on sidebar toggles without detaching camera constraints', () => {
    const map = scene.map!;
    const pan = vi.spyOn(map, 'panBy').mockReturnValue(map);
    const setBounds = vi.spyOn(map, 'setMaxBounds');
    render(<MapPage />);
    expect(pan).not.toHaveBeenCalled();
    act(() => useUiPrefsStore.getState().setSidebarOpen(true));
    expect(pan).toHaveBeenLastCalledWith([-250, 0], expect.objectContaining({ animate: true }));
    act(() => { map.fire('talos:regionSwitchStart'); });
    act(() => useUiPrefsStore.getState().setSidebarWidth(450));
    expect(pan).toHaveBeenCalledOnce();
    act(() => useUiPrefsStore.getState().setSidebarOpen(false));
    expect(pan).toHaveBeenLastCalledWith([225, 0], expect.anything());
    act(() => { map.fire('moveend'); });
    expect(setBounds).not.toHaveBeenCalled();
});

it.each([false, true])('does not pan a mobile map or a wide view (desktop=%s)', (desktop) => {
    scene.desktop = desktop;
    if (desktop) scene.map!.setZoom(1);
    const pan = vi.spyOn(scene.map!, 'panBy');
    render(<MapPage />);
    act(() => useUiPrefsStore.getState().setSidebarOpen(true));
    expect(pan).not.toHaveBeenCalled();
});

it('coordinates UI visibility and guide readiness without unmounting the map', async () => {
    vi.useFakeTimers();
    render(<MapPage />);
    const map = screen.getByTestId('map');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle UI' }));
    expect(screen.getByTestId('overlay').dataset.visible).toBe('false');
    expect(screen.getByTestId('sidebar').dataset.visible).toBe('false');
    expect(screen.queryByText('Domain notice')).toBeNull();
    fireEvent.keyDown(document, { key: 'h', ctrlKey: true });
    expect(screen.getByTestId('overlay').dataset.visible).toBe('true');
    expect(screen.getByText('Domain notice')).toBeTruthy();
    expect(screen.getByTestId('map')).toBe(map);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await vi.dynamicImportSettled(); });
    expect(screen.getByTestId('overlay').dataset.guideReady).toBe('true');
});

it('contains map render errors while keeping the sidebar and UI available', () => {
    scene.fail = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MapPage />);
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByTestId('sidebar')).toBeTruthy();
    expect(screen.getByTestId('overlay')).toBeTruthy();
    expect(errors).toHaveBeenCalled();
});

it('owns global Safari gesture prevention and releases it on unmount', () => {
    const view = render(<MapPage />);
    const gesture = new Event('gesturestart', { bubbles: true, cancelable: true });
    fireEvent(document.body, gesture);
    expect(gesture.defaultPrevented).toBe(true);
    const multi = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [{} as Touch, {} as Touch] });
    fireEvent(document.body, multi);
    expect(multi.defaultPrevented).toBe(true);
    const single = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [{} as Touch] });
    fireEvent(document.body, single);
    expect(single.defaultPrevented).toBe(false);
    view.unmount();
    const after = new Event('gesturechange', { cancelable: true });
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
});
