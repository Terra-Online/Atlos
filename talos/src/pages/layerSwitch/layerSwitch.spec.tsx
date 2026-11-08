import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayerStore } from '@/store/layer';
import { LayerSwitch } from '@/pages/layerSwitch/layerSwitch';
import useRegion from '@/store/region';

vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
vi.mock('@/assets/images/UI/layer.svg?react', () => ({ default: () => null }));
vi.mock('@/services/map/tileCoverage', async (original) => ({ ...await original<typeof import('@/services/map/tileCoverage')>(), hasSatelliteTiles: (region: string) => region === 'Dijiang' || region === 'Valley_4' }));
vi.mock('@/assets/logos/_Satellite.svg?react', () => ({ default: () => null }));
afterEach(() => { cleanup(); useLayerStore.setState({ satellite: false }); });

it('allows keyboard activation of the floor control and keeps floor choices outside the main button', () => {
    useLayerStore.setState({ currentLayer: 'B1', satellite: true });
    render(<LayerSwitch isSidebarOpen={false} />);
    const main = screen.getByRole('button', { name: 'mapControls.layerSelect' });
    expect(screen.queryByRole('button', { name: 'Layer B1' })).toBeNull();
    act(() => main.focus());
    userEvent.keyboard('{Enter}');
    expect(useLayerStore.getState()).toMatchObject({ currentLayer: 'M', satellite: false });
    const basement = screen.getByRole('button', { name: 'Layer B1' });
    expect(main.contains(basement)).toBe(false);
    act(() => basement.focus());
    userEvent.keyboard(' ');
    expect(useLayerStore.getState().currentLayer).toBe('B1');
    expect(document.activeElement).toBe(basement);
    act(() => basement.blur());
    expect(screen.queryByRole('button', { name: 'Layer B1' })).toBeNull();
    fireEvent.click(main);
    expect(screen.queryByRole('button', { name: 'Layer B1' })).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: 'Layer B1' })).toBeNull();
});

it('returns to standard imagery when the main floor button is clicked in satellite mode', () => {
    useRegion.setState({ currentRegionKey: 'Valley_4' });
    useLayerStore.setState({ currentLayer: 'M', satellite: true });
    render(<LayerSwitch isSidebarOpen={false} />);
    const satellite = screen.getByRole('button', { name: 'mapControls.satellite' });
    const main = screen.getByRole('button', { name: 'mapControls.layerSelect' });
    expect(satellite.getAttribute('aria-pressed')).toBe('true');
    expect(main.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(main);
    expect(useLayerStore.getState()).toMatchObject({ currentLayer: 'M', satellite: false });
    expect(satellite.getAttribute('aria-pressed')).toBe('false');
    expect(main.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Layer B1' })).not.toBeNull();
});

it('keeps standard mode active on floors and when satellite imagery is unavailable', () => {
    useRegion.setState({ currentRegionKey: 'Valley_4' });
    useLayerStore.setState({ currentLayer: 'B1', satellite: true });
    render(<LayerSwitch isSidebarOpen={false} />);
    const main = screen.getByRole('button', { name: 'mapControls.layerSelect' });
    expect(main.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'mapControls.satellite' }).getAttribute('aria-pressed')).toBe('false');
    act(() => {
        useRegion.getState().setCurrentRegion('Wuling');
        useLayerStore.setState({ currentLayer: 'M' });
    });
    expect(main.getAttribute('aria-pressed')).toBe('true');
});

it('clears the menu when the selected region no longer has floors', () => {
    render(<LayerSwitch isSidebarOpen={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'mapControls.layerSelect' }));
    expect(screen.queryByRole('button', { name: 'Layer B1' })).not.toBeNull();
    act(() => useRegion.getState().setCurrentRegion('Dijiang'));
    expect(screen.queryByRole('button', { name: 'mapControls.layerSelect' })).toBeNull();
    act(() => useRegion.getState().setCurrentRegion('Valley_4'));
    expect(screen.queryByRole('button', { name: 'Layer B1' })).toBeNull();
});

it('offers satellite mode only for covered regions, including regions without floors', () => {
    useRegion.setState({ currentRegionKey: 'Wuling' });
    render(<LayerSwitch isSidebarOpen={false} />);
    expect(screen.queryByRole('button', { name: 'mapControls.satellite' })).toBeNull();
    act(() => useRegion.getState().setCurrentRegion('Dijiang'));
    const satellite = screen.getByRole('button', { name: 'mapControls.satellite' });
    expect(screen.queryByRole('button', { name: 'mapControls.layerSelect' })).toBeNull();
    act(() => useLayerStore.setState({ currentLayer: 'B1' }));
    fireEvent.click(satellite);
    expect(useLayerStore.getState()).toMatchObject({ satellite: true, currentLayer: 'M' });
    expect(satellite.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(satellite);
    expect(useLayerStore.getState().satellite).toBe(false);
    act(() => useRegion.getState().setCurrentRegion('Wuling'));
    expect(screen.queryByRole('button', { name: 'mapControls.satellite' })).toBeNull();
});
