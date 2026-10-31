import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayerStore } from '@/store/layer';
import { LayerSwitch } from '@/pages/layerSwitch/layerSwitch';
import useRegion from '@/store/region';

vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
vi.mock('@/assets/images/UI/layer.svg?react', () => ({ default: () => null }));
vi.mock('@/services/map/tileCoverage', async (original) => ({ ...await original<typeof import('@/services/map/tileCoverage')>(), hasSatelliteTiles: (region: string) => region === 'Dijiang' }));
vi.mock('@/assets/images/UI/satellite.svg?react', () => ({ default: () => null }));
afterEach(() => { cleanup(); useLayerStore.setState({ satellite: false }); });

it('allows keyboard activation of the floor control and keeps floor choices outside the main button', () => {
    useLayerStore.setState({ currentLayer: 'B1' });
    render(<LayerSwitch isSidebarOpen={false} />);
    const main = screen.getByRole('button', { name: 'mapControls.layerSelect' });
    expect(screen.queryByRole('button', { name: 'Layer B1' })).toBeNull();
    act(() => main.focus());
    userEvent.keyboard('{Enter}');
    expect(useLayerStore.getState().currentLayer).toBe('M');
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
    useRegion.setState({ currentRegionKey: 'Valley_4' });
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
    act(() => useRegion.getState().setCurrentRegion('Valley_4'));
    expect(screen.queryByRole('button', { name: 'mapControls.satellite' })).toBeNull();
});
