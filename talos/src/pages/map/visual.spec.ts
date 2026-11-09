import { SubregionBoundaryManager } from '@/services/map/core/boundary';
import L from 'leaflet';
import { expect, it, vi } from 'vitest';
import type { IMapRegion, IMapSubregionAreaData } from '@/data/map';
import { createHighlight } from '@/pages/map/visual';

it('removes the owned group after its full animation and cancels it when changing region', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations');
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [{ finished }] });
    const svg = L.Browser.svg;
    Object.defineProperty(L.Browser, 'svg', { value: true, configurable: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 0);
    try {
        const area = { bounds: [[0, 0], [10, 10]] } as IMapSubregionAreaData;
        const config = { coordZoom: 2 } as IMapRegion;
        const first = createHighlight(map, area, config)!;
        expect(map.hasLayer(first)).toBe(true);
        expect(map.hasLayer(first)).toBe(true);
        finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(map.hasLayer(first)).toBe(false);
        first.eachLayer((layer) => expect(map.hasLayer(layer)).toBe(false));
        const second = createHighlight(map, area, config)!;
        map.fire('talos:regionSwitchStart');
        expect(map.hasLayer(second)).toBe(false);

    } finally {
        if (original) Object.defineProperty(Element.prototype, 'getAnimations', original);
        else Reflect.deleteProperty(Element.prototype, 'getAnimations');
        map.remove(); host.remove(); Object.defineProperty(L.Browser, 'svg', { value: svg, configurable: true }); }
});

it('cancels repeated boundary exits before the map is disposed', () => {
    vi.useFakeTimers();
    const svg = L.Browser.svg;
    Object.defineProperty(L.Browser, 'svg', { value: true, configurable: true });
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 0);
    const boundaries = new SubregionBoundaryManager(map);
    try {
        boundaries.showBoundaries('Valley_4');
        boundaries.hideBoundaries(); boundaries.hideBoundaries();
        boundaries.destroy();
        const remove = vi.spyOn(map, 'removeLayer');
        vi.advanceTimersByTime(500);
        expect(remove).not.toHaveBeenCalled();
        remove.mockRestore();
    } finally {
        map.remove(); host.remove(); vi.useRealTimers();
        Object.defineProperty(L.Browser, 'svg', { value: svg, configurable: true });
    }
});

it('retains a boundary start frame and cancels entry when it is hidden', () => {
    vi.useFakeTimers();
    const svg = L.Browser.svg;
    Object.defineProperty(L.Browser, 'svg', { value: true, configurable: true });
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 0);
    const boundaries = new SubregionBoundaryManager(map);
    try {
        boundaries.showBoundaries('Valley_4');
        const path = host.querySelector('.subregion-boundary-fill')!;
        vi.advanceTimersToNextFrame();
        expect(path.classList.contains('boundary-hidden')).toBe(true);
        vi.advanceTimersToNextFrame();
        expect(path.classList.contains('boundary-hidden')).toBe(false);
        boundaries.hideBoundaries();
        boundaries.showBoundaries('Valley_4');
        const entering = host.querySelectorAll('.subregion-boundary-fill');
        vi.advanceTimersToNextFrame();
        boundaries.hideBoundaries();
        vi.advanceTimersToNextFrame();
        expect([...entering].every((node) => node.classList.contains('boundary-hidden'))).toBe(true);
    } finally {
        boundaries.destroy(); map.remove(); host.remove(); vi.useRealTimers();
        Object.defineProperty(L.Browser, 'svg', { value: svg, configurable: true });
    }
});
