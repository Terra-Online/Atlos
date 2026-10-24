import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { REGION_DICT, SUBREGION_DICT } from '@/data/map';
import { RegionContainer } from './regSwitch';

vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/locale', () => ({ useTranslateGame: () => (key: string) => key }));
vi.mock('@/assets/logos/_Valley_4.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/_Wuling.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/_Dijiang.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/logos/_Weekraid_1.svg?react', () => ({ default: () => null }));

beforeEach(() => {
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

it('opens on touch activation, closes outside and preserves the guide override', () => {
    const view = render(<RegionContainer isSidebarOpen={false} />);
    const wuling = screen.getByRole('button', { name: 'region.WL.main' });
    pointer(wuling, 'pointerover', 'touch');
    expect(subButton('Wuling')).toBeNull();
    fireEvent.click(wuling);
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
