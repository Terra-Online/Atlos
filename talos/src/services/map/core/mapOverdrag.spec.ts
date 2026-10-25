import { describe, expect, it } from 'vitest';
import L from 'leaflet';
import { isMapOverdragged } from '@/services/map/core/mapOverdrag';

const createMap = (center: L.LatLngExpression) => {
    const currentCenter = L.latLng(center);
    return {
        getCenter: () => currentCenter,
        getZoom: () => 0,
        project: (latLng: L.LatLng) => L.point(latLng.lng, latLng.lat),
        _limitCenter: () => L.latLng(0, 0),
    } as unknown as L.Map;
};

describe('isMapOverdragged', () => {
    const bounds = L.latLngBounds([-1, -1], [1, 1]);

    it('does not flag a legal center when the viewport is larger than bounds', () => {
        expect(isMapOverdragged(createMap([0, 0]), bounds)).toBe(false);
    });

    it('flags a center that still needs to be constrained', () => {
        expect(isMapOverdragged(createMap([2, 0]), bounds)).toBe(true);
    });
});
