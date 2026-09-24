import type L from 'leaflet';
import { REGION_DICT, SUBREGION_DICT, type IMapSubregionAreaData } from '@/data/map';

const ringContains = (ring: number[][], point: { x: number; y: number }): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j];
        const [bx, by] = ring[i];
        const cross = (point.x - ax) * (by - ay) - (point.y - ay) * (bx - ax);
        if (Math.abs(cross) <= 1e-7
            && point.x >= Math.min(ax, bx) - 1e-7 && point.x <= Math.max(ax, bx) + 1e-7
            && point.y >= Math.min(ay, by) - 1e-7 && point.y <= Math.max(ay, by) + 1e-7) return true;
        if ((ay > point.y) !== (by > point.y)
            && point.x < (bx - ax) * (point.y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside;
};

/** Match OEM-SDK: first ring is the exterior, remaining rings are holes. */
export const containsSubregionPixel = (
    area: IMapSubregionAreaData,
    point: { x: number; y: number },
): boolean => {
    if (area.polygon?.length) {
        return ringContains(area.polygon[0], point)
            && !area.polygon.slice(1).some((ring) => ringContains(ring, point));
    }
    if (!area.bounds || area.bounds.length < 2) return false;
    const [[ax, ay], [bx, by]] = area.bounds;
    return point.x >= Math.min(ax, bx) && point.x <= Math.max(ax, bx)
        && point.y >= Math.min(ay, by) && point.y <= Math.max(ay, by);
};

const boundaryClearance = (area: IMapSubregionAreaData, point: { x: number; y: number }): number => {
    const rings = area.polygon?.length ? area.polygon : [];
    if (!rings.length && area.bounds) {
        const [[ax, ay], [bx, by]] = area.bounds;
        return Math.min(Math.abs(point.x - ax), Math.abs(point.x - bx),
            Math.abs(point.y - ay), Math.abs(point.y - by)) ** 2;
    }
    let distance = Infinity;
    for (const ring of rings) {
        ring.forEach(([ax, ay], index) => {
            const [bx, by] = ring[(index + 1) % ring.length];
            const dx = bx - ax, dy = by - ay;
            const length = dx * dx + dy * dy;
            const t = length ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / length)) : 0;
            distance = Math.min(distance, (point.x - ax - t * dx) ** 2 + (point.y - ay - t * dy) ** 2);
        });
    }
    return distance;
};

export const resolveSubregionAtLocation = (
    map: Pick<L.Map, 'project'>,
    regionId: string,
    location: L.LatLngExpression,
): string | null => {
    const region = REGION_DICT[regionId];
    if (!region) return null;
    const pixel = map.project(location, region.maxZoom);
    const areas = region.subregions.map((id) => SUBREGION_DICT[id]).filter(Boolean);
    const polygons = areas.filter((area) => area.polygon?.length);
    // Do not fall back to bounding boxes when precise geometry exists but misses.
    const candidates = (polygons.length ? polygons : areas)
        .filter((area) => containsSubregionPixel(area, pixel))
        .map((area) => ({ id: area.id, distance: boundaryClearance(area, pixel), wins: 0, margin: 0 }));
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            const left = candidates[i], right = candidates[j];
            const delta = left.distance - right.distance;
            if (Math.abs(delta) <= 1e-9) continue;
            if (delta > 0) left.wins++;
            else right.wins++;
            left.margin += delta;
            right.margin -= delta;
        }
    }
    candidates.sort((a, b) => b.wins - a.wins || b.margin - a.margin
        || b.distance - a.distance || a.id.localeCompare(b.id));
    return candidates[0]?.id ?? null;
};
