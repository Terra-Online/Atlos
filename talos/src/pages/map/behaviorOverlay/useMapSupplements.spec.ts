import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import { getLayerByTier, useLayerStore } from '@/store/layer';
import { useMarkerStore } from '@/store/marker';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { loadMapSupplements, type Wall } from '@/data/marker/supplements';
import { useMapSupplements } from '@/pages/map/behaviorOverlay/useMapSupplements';
import { wallScene, wallStroke, wallScreenSegment, type BehaviorScene } from '@/pages/map/behaviorOverlay/behaviorScene';

vi.mock('@/data/marker/supplements', () => ({ loadMapSupplements: vi.fn() }));

const walls: Wall[] = ['scope-a', 'scope-b'].flatMap((subregion, index) => [
    { id: `${subregion}-ground`, subregion, tier: 0, segment: [[index, 0], [index, 1]] },
    { id: `${subregion}-basement`, subregion, tier: -1, segment: [[index, 2], [index, 3]] },
]);

const layers = vi.hoisted(() => [] as Array<{ setScene: ReturnType<typeof vi.fn>; addTo: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }>);
vi.mock('@/pages/map/behaviorOverlay/BehaviorCanvasLayer', () => ({
    createBehaviorCanvasLayer: () => {
        const layer = { setScene: vi.fn(), addTo: vi.fn(), remove: vi.fn() };
        layers.push(layer);
        return layer;
    },
}));

describe('static map supplements', () => {
    beforeEach(() => {
        layers.length = 0;
        vi.mocked(loadMapSupplements).mockImplementation((region) => Promise.resolve(region === 'Wuling' ? walls : []));
        useUiPrefsStore.setState({ mapSupplementsEnabled: false });
        useRegion.setState({ currentRegionKey: 'Wuling' });
        useMarkerStore.setState({ visibleSubregionKey: null });
        useLayerStore.setState({ currentLayer: 'M' });
    });

    it('draws a single open dashed segment without mutating the source or enabling flow', () => {
        const segment: [[number, number], [number, number]] = [[0, 0], [0, 2]];
        const scene = wallScene([{ segment }]);
        expect(scene.lines[0].points).toEqual([[0, 0], [0, 2]]);
        expect(scene.lines[0].points).toHaveLength(2);
        expect(segment).toEqual([[0, 0], [0, 2]]);
        expect(scene.lines[0].colorRole).toBe('wall');
        expect(scene.lines[0].flow).toBeUndefined();
        expect(scene.timelineDuration).toBe(0);
    });

    it('keeps two complete dashes separated at short screen lengths and caps the normal stroke', () => {
        for (const length of [0.8, 2, 4, 8, 16, 32, 100]) {
            const stroke = wallStroke(length, 3, 0);
            const [dash, gap] = stroke.dash;
            expect(dash).toBeGreaterThan(0);
            expect(gap).toBeGreaterThan(0);
            expect(2 * dash + gap).toBeLessThanOrEqual(length + 1e-9);
            expect(stroke.weight).toBeGreaterThanOrEqual(1.5);
            expect(stroke.weight).toBeLessThanOrEqual(3);
        }
        expect(wallStroke(4, 3, 0).weight).toBeLessThan(wallStroke(4, 3, 4).weight);
        expect(wallStroke(4, 3, 2).weight).toBe(wallStroke(100, 3, 2).weight);
        expect(wallStroke(100, 3, 6).weight).toBe(3);
        expect(wallStroke(100, 3, 4).dash).toEqual([6, 4]);
    });

    it('preserves midpoint and direction when keeping a subpixel wall visible', () => {
        const [start, end] = wallScreenSegment([10, 20], [10.3, 20.4]);
        expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeCloseTo(6);
        expect((start[0] + end[0]) / 2).toBeCloseTo(10.15);
        expect((start[1] + end[1]) / 2).toBeCloseTo(20.2);
        expect((end[0] - start[0]) / (end[1] - start[1])).toBeCloseTo(0.75);
        expect(wallScreenSegment([0, 0], [10, 0])).toEqual([[0, 0], [10, 0]]);
    });

    it.each(['scope-a', 'scope-b'])('applies shared floor opacity and scope behavior in %s, and cleans up on toggle off', async (subregion) => {
        const listeners = new Set<() => void>();
        const map = {
            hasLayer: () => false,
            on: (_event: string, callback: () => void) => listeners.add(callback),
            off: (_event: string, callback: () => void) => listeners.delete(callback),
        } as unknown as L.Map;
        const { unmount } = renderHook(() => useMapSupplements(map));
        expect(layers).toHaveLength(0);
        const lastScene = () => layers[layers.length - 1].setScene.mock.lastCall![0] as BehaviorScene;
        act(() => useUiPrefsStore.getState().setMapSupplementsEnabled(true));
        await waitFor(() => expect(lastScene().lines.length).toBe(walls.length));
        expect(layers[layers.length - 1].setScene.mock.lastCall!.slice(1)).toEqual([false, false]);
        expect(lastScene().lines.map((line) => line.opacity)).toEqual([0.85, 0.25, 0.85, 0.25]);
        act(() => useMarkerStore.getState().setVisibleSubregionKey(subregion));
        const scopedWalls = walls.filter((wall) => wall.subregion === subregion);
        for (const tier of new Set(walls.map((wall) => wall.tier))) {
            const currentLayer = getLayerByTier(tier);
            if (!currentLayer) throw new Error(`Unsupported fixture tier: ${tier}`);
            act(() => useLayerStore.getState().setCurrentLayer(currentLayer));
            await waitFor(() => {
                expect(lastScene().lines.map((line) => line.points)).toEqual(scopedWalls.map((wall) => wall.segment));
                expect(lastScene().lines.map((line) => line.opacity)).toEqual(scopedWalls.map((wall) => wall.tier === tier ? 0.85 : 0.25));
            });
        }
        const layer = layers[layers.length - 1];
        act(() => listeners.forEach((callback) => callback()));
        await waitFor(() => expect(lastScene().lines).toHaveLength(2));
        expect(layer.addTo).toHaveBeenCalledTimes(2);
        act(() => useRegion.getState().setCurrentRegion('Valley_4'));
        await waitFor(() => expect(lastScene().lines).toHaveLength(0));
        const emptyLayer = layers[layers.length - 1];
        act(() => useUiPrefsStore.getState().setMapSupplementsEnabled(false));
        expect(emptyLayer.remove).toHaveBeenCalledOnce();
        expect(listeners.size).toBe(0);
        unmount();
    });
});
