import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { REGION_DICT, SUBREGION_DICT } from '@/data/map';
import { RegionContainer } from './regSwitch';
import { loadRegionMarkers } from '@/data/marker';
import { preloadMapTiles } from '@/services/map/preload';
import { preloadMapFonts } from '@/locale';

vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/locale', () => ({ useTranslateGame: () => (key: string) => key, preloadMapFonts: vi.fn(() => Promise.resolve()) }));
vi.mock('@/data/marker', () => ({ loadRegionMarkers: vi.fn(() => Promise.resolve([])) }));
vi.mock('@/services/map/preload', () => ({ preloadMapTiles: vi.fn(() => vi.fn()) }));
vi.mock('@/assets/logos/_Valley_4.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/_Wuling.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/_Dijiang.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/_Weekraid_1.svg?react', () => ({ default: () => null }));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadRegionMarkers).mockResolvedValue([]);
    vi.mocked(preloadMapFonts).mockResolvedValue();
    useRegion.setState({ currentRegionKey: 'Valley_4', currentSubregionKey: null, subregionSwitchRequest: null });
    useUiPrefsStore.setState({ forceRegionSubOpen: false });
});
afterEach(cleanup);

function pointer(element: HTMLElement, type: string, pointerType = 'mouse', relatedTarget: EventTarget | null = null) {
    const event = new MouseEvent(type, { bubbles: true, relatedTarget });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    fireEvent(element, event);
}

const subButton = (region: 'Valley_4' | 'Wuling') => {
    const code = region === 'Wuling' ? 'WL' : 'VL';
    return screen.queryByRole('button', { name: `region.${code}.sub.${SUBREGION_DICT[REGION_DICT[region].subregions[0]].name}.name` });
};

it('warms only the intended region and reuses pointer, focus and click preparation', () => {
    render(<RegionContainer isSidebarOpen={false} />);
    expect(loadRegionMarkers).not.toHaveBeenCalled();
    const target = screen.getByRole('button', { name: 'region.WL.main' });
    pointer(target, 'pointerover');
    act(() => target.focus());
    fireEvent.click(target);
    expect(loadRegionMarkers).toHaveBeenCalledWith('Wuling');
    expect(preloadMapFonts).toHaveBeenCalledWith('Wuling');
    expect(vi.mocked(loadRegionMarkers).mock.calls.every(([region]) => region === 'Wuling')).toBe(true);
    expect(vi.mocked(preloadMapFonts).mock.calls.every(([region]) => region === 'Wuling')).toBe(true);
    expect(preloadMapTiles).toHaveBeenCalledExactlyOnceWith('Wuling');
});

it('unmounts the previously clicked region as soon as the pointer enters another region', () => {
    render(<RegionContainer isSidebarOpen={false} />);
    const wuling = screen.getByRole('button', { name: 'region.WL.main' });
    const valley = screen.getByRole('button', { name: 'region.VL.main' });
    expect(subButton('Wuling')).toBeNull();
    expect(subButton('Valley_4')).toBeNull();
    pointer(wuling, 'pointerover');
    fireEvent.click(wuling);
    act(() => wuling.focus());
    const oldSubregion = subButton('Wuling')!;
    expect(oldSubregion).not.toBeNull();
    pointer(wuling, 'pointerout', 'mouse', valley);
    pointer(valley, 'pointerover', 'mouse', wuling);
    expect(document.activeElement).toBe(wuling);
    expect(oldSubregion.isConnected).toBe(false);
    expect(subButton('Wuling')).toBeNull();
    expect(subButton('Valley_4')).not.toBeNull();
    pointer(valley, 'pointerout');
    expect(subButton('Valley_4')).toBeNull();
});

it('keeps the submenu available across its padding and keyboard focus, then removes it on blur', () => {
    render(<RegionContainer isSidebarOpen={false} />);
    const valley = screen.getByRole('button', { name: 'region.VL.main' });
    act(() => valley.focus());
    const subregion = subButton('Valley_4')!;
    pointer(valley, 'pointerout', 'mouse', subregion);
    pointer(subregion, 'pointerover', 'mouse', valley);
    expect(subButton('Valley_4')).toBe(subregion);
    act(() => subregion.focus());
    fireEvent.click(subregion);
    expect(useRegion.getState().subregionSwitchRequest).toBe(REGION_DICT.Valley_4.subregions[0]);
    act(() => subregion.blur());
    expect(subButton('Valley_4')).toBeNull();
});

it('opens on touch activation, closes outside and preserves the guide override', async () => {
    const view = render(<RegionContainer isSidebarOpen={false} />);
    const wuling = screen.getByRole('button', { name: 'region.WL.main' });
    pointer(wuling, 'pointerover', 'touch');
    expect(subButton('Wuling')).toBeNull();
    fireEvent.click(wuling);
    await act(async () => { await Promise.resolve(); });
    pointer(wuling, 'pointerout', 'touch');
    expect(subButton('Wuling')).not.toBeNull();
    pointer(document.body, 'pointerdown', 'touch');
    expect(subButton('Wuling')).toBeNull();
    act(() => useUiPrefsStore.setState({ forceRegionSubOpen: true }));
    expect(subButton('Wuling')).not.toBeNull();
    pointer(screen.getByRole('button', { name: 'region.VL.main' }), 'pointerover');
    expect(subButton('Wuling')).toBeNull();
    expect(subButton('Valley_4')).not.toBeNull();
    view.unmount();
});

it('keeps the current map selected while destination data or fonts are pending and cancels a superseded choice', async () => {
    let deliver: () => void = () => {};
    vi.mocked(preloadMapFonts).mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
    render(<RegionContainer isSidebarOpen={false} />);
    const wuling = screen.getByRole('button', { name: 'region.WL.main' });
    fireEvent.click(wuling);
    expect(wuling.getAttribute('aria-busy')).toBe('true');
    expect(useRegion.getState().currentRegionKey).toBe('Valley_4');
    fireEvent.click(screen.getByRole('button', { name: 'region.VL.main' }));
    await act(async () => { deliver(); await Promise.resolve(); });
    expect(useRegion.getState().currentRegionKey).toBe('Valley_4');
    expect(wuling.getAttribute('aria-busy')).toBe('false');
});

it('commits a prepared destination and allows retry after a failed preparation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(loadRegionMarkers).mockRejectedValueOnce(new Error('offline'));
    render(<RegionContainer isSidebarOpen={false} />);
    const wuling = screen.getByRole('button', { name: 'region.WL.main' });
    try {
        await act(async () => { fireEvent.click(wuling); await Promise.resolve(); });
        expect(useRegion.getState().currentRegionKey).toBe('Valley_4');
        expect(wuling.getAttribute('aria-busy')).toBe('false');
        expect(warn).toHaveBeenCalledOnce();
        await act(async () => { fireEvent.click(wuling); await Promise.resolve(); });
        expect(useRegion.getState().currentRegionKey).toBe('Wuling');
        expect(wuling.getAttribute('aria-busy')).toBe('false');
    } finally { warn.mockRestore(); }
});

it('prepares a cross-region submenu choice before requesting its camera and lets a return cancel it', async () => {
    let deliver!: () => void;
    vi.mocked(preloadMapFonts).mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
    render(<RegionContainer isSidebarOpen={false} />);
    const wuling = screen.getByRole('button', { name: 'region.WL.main' });
    pointer(wuling, 'pointerover');
    fireEvent.click(subButton('Wuling')!);
    expect(useRegion.getState().currentRegionKey).toBe('Valley_4');
    expect(useRegion.getState().subregionSwitchRequest).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'region.VL.main' }));
    await act(async () => { deliver(); await Promise.resolve(); });
    expect(useRegion.getState().subregionSwitchRequest).toBeNull();
    pointer(wuling, 'pointerover');
    fireEvent.click(subButton('Wuling')!);
    await act(async () => { deliver(); await Promise.resolve(); });
    expect(useRegion.getState().currentRegionKey).toBe('Wuling');
    expect(useRegion.getState().subregionSwitchRequest).toBe(REGION_DICT.Wuling.subregions[0]);
});
