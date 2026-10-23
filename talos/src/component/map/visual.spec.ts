import L from 'leaflet';
import { expect, it } from 'vitest';
import type { IMapRegion, IMapSubregionAreaData } from '@/data/map';
import { createHighlight } from './visual';

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
        const config = { maxZoom: 2 } as IMapRegion;
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
