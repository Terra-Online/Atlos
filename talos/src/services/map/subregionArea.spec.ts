import { describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { containsSubregionPixel, resolveSubregionAtLocation } from './subregionArea';

vi.mock('@/data/map', () => ({
    REGION_DICT: {
        overlap: { coordZoom: 3, subregions: ['edge', 'deep'] },
        bounds: { coordZoom: 2, subregions: ['rectangle'] },
    },
    SUBREGION_DICT: {
        edge: { id: 'edge', polygon: [[[0, 0], [10, 0], [10, 10], [0, 10]]] },
        deep: { id: 'deep', polygon: [[[5, 0], [15, 0], [15, 10], [5, 10]]] },
        rectangle: { id: 'rectangle', bounds: [[10, 10], [0, 0]] },
    },
}));

describe('configured subregion geometry', () => {
    it('uses polygon rather than its bounding box and excludes holes and hole edges', () => {
        const area = { id: 'test', name: 'test', bounds: [[0, 0], [20, 20]], polygon: [
            [[0, 0], [10, 0], [10, 10], [0, 10]],
            [[3, 3], [7, 3], [7, 7], [3, 7]],
        ] };
        expect(containsSubregionPixel(area, { x: 1, y: 1 })).toBe(true);
        expect(containsSubregionPixel(area, { x: 0, y: 5 })).toBe(true);
        expect(containsSubregionPixel(area, { x: 5, y: 5 })).toBe(false);
        expect(containsSubregionPixel(area, { x: 3, y: 5 })).toBe(false);
        expect(containsSubregionPixel(area, { x: 15, y: 5 })).toBe(false);
    });

    it('projects at the configured coordinate zoom and selects the deeper overlapping region', () => {
        const project = vi.fn(() => L.point(9, 5));
        expect(resolveSubregionAtLocation({ project }, 'overlap', [1, 2])).toBe('deep');
        expect(project).toHaveBeenCalledWith([1, 2], 3);
    });

    it('resolves equally deep regions deterministically and leaves gaps unresolved', () => {
        expect(resolveSubregionAtLocation({ project: () => L.point(7.5, 5) }, 'overlap', [0, 0])).toBe('deep');
        expect(resolveSubregionAtLocation({ project: () => L.point(20, 5) }, 'overlap', [0, 0])).toBeNull();
        expect(resolveSubregionAtLocation({ project: () => L.point(5, 5) }, 'missing', [0, 0])).toBeNull();
    });

    it('falls back to bounds when no polygon geometry is configured', () => {
        expect(resolveSubregionAtLocation({ project: () => L.point(5, 5) }, 'bounds', [0, 0])).toBe('rectangle');
    });
});
