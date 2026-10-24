import { act, renderHook } from '@testing-library/react';
import L from 'leaflet';
import { expect, it, vi } from 'vitest';
import { setRegionSwitching } from '@/services/map/regionLifecycle';
import { useLink } from '@/pages/map/useLink';

vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));

it('subscribes during a region switch and renders the current links on completion', () => {
    const svg = L.Browser.svg;
    Object.defineProperty(L.Browser, 'svg', { configurable: true, value: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 0);
    const countHits = () => {
        let count = 0;
        map.eachLayer((layer) => { if (layer instanceof L.Rectangle) count++; });
        return count;
    };
    setRegionSwitching(map, true);
    const hook = renderHook(({ region }) => useLink(map, region, 3), { initialProps: { region: 'Valley_4' } });
    try {
        expect(countHits()).toBe(0);
        act(() => { setRegionSwitching(map, false); map.fire('talos:regionSwitched'); });
        expect(countHits()).toBeGreaterThan(0);
        act(() => { setRegionSwitching(map, true); map.fire('talos:regionSwitchStart'); });
        hook.rerender({ region: 'Wuling' });
        expect(countHits()).toBe(0);
        act(() => { setRegionSwitching(map, false); map.fire('talos:regionSwitched'); });
        expect(countHits()).toBeGreaterThan(0);
        hook.unmount();
        expect(countHits()).toBe(0);
    } finally {
        hook.unmount();
        map.remove(); host.remove();
        Object.defineProperty(L.Browser, 'svg', { configurable: true, value: svg });
    }
});
