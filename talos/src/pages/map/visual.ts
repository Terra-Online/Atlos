import L from 'leaflet';
import { IMapRegion, IMapSubregionAreaData } from '@/data/map';

const highlights = new WeakMap<L.Map, () => void>();

export const createHighlight = (map: L.Map | undefined, subregion: IMapSubregionAreaData, config: IMapRegion) => {
    if (!map) return null;
    highlights.get(map)?.();
    let points = subregion.polygon;
    if (!points?.length && subregion.bounds?.length === 2) {
        const [[x1, y1], [x2, y2]] = subregion.bounds;
        points = [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]]];
    }
    if (!points?.length) return null;
    const coordinates = points.map((ring) => ring.map(([x, y]) => map.unproject([x, y], config.maxZoom)));
    const fill = L.polygon(coordinates, { color: 'transparent', fillOpacity: 0.3, className: 'subregion-highlight-fill' });
    const stroke = L.polygon(coordinates, { weight: 3, opacity: 0.9, fill: false, className: 'subregion-highlight-stroke' });
    const group = L.layerGroup([fill, stroke]).addTo(map);
    const dispose = () => {
        map.off('talos:regionSwitchStart unload', dispose);
        group.remove();
        if (highlights.get(map) === dispose) highlights.delete(map);
    };
    highlights.set(map, dispose);
    map.on('talos:regionSwitchStart unload', dispose);
    // CSS owns the complete timeline; cancellation also settles these promises.
    const animations = [fill, stroke].flatMap((path) => {
        path.bringToFront();
        return path.getElement()?.getAnimations() ?? [];
    });
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(dispose);
    return group;
};
