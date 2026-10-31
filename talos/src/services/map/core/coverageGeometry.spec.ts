import L from 'leaflet';
import { describe, expect, it } from 'vitest';
import { cameraRects, contains, coverageRects, coverageRows, nearest, slide, sweep, visiblePatch } from './coverageGeometry';
import type { ZoomTileCoverage } from '@/services/map/tileCoverage';
import standard from '@/data/map/tileCoverage.json';
import satellite from '@/data/map/satelliteCoverage.json';

const shape = (rows: Record<string, number[]>, viewport = L.point(1, 1)) =>
    cameraRects(coverageRects(coverageRows({ '': rows }, [''])), viewport, 0, L.point(Math.min(1, viewport.x), Math.min(1, viewport.y)));

describe('coverage camera geometry', () => {
    it('retains every coverage interval regardless of its sign or distance from the origin', () => {
        const rows = coverageRows({ '': { '-12000': [-20000, -19999, 25000, 25002] } }, ['']);
        expect(rows.get(-12000)).toEqual([[-20000, -19998], [25000, 25003]]);
        expect(coverageRects(rows)).toEqual([
            { left: -20000, right: -19998, top: -12000, bottom: -11999 },
            { left: 25000, right: 25003, top: -12000, bottom: -11999 },
        ]);
    });

    it('keeps a quadrant-sized continuous patch at low, fractional and high zoom', () => {
        const rects = coverageRects(coverageRows({ '': { '0': [0, 5], '1': [0, 5], '2': [0, 5], '3': [0, 5] } }, ['']));
        for (const viewport of [L.point(8, 6), L.point(3.37, 2.73), L.point(0.4, 0.3)]) {
            expect(visiblePatch(rects, viewport)).toEqual(viewport.divideBy(2));
            // A patch of half the viewport width/height must remain at the edge.
            expect(nearest(L.point(-100, -100), cameraRects(rects, viewport))).toEqual(L.point(0, 0));
        }
        expect(rects).toEqual([{ left: 0, right: 6, top: 0, bottom: 4 }]);
    });

    it('uses the largest fitting patch if the entire map is smaller than a quadrant', () => {
        const rects = [{ left: -3, right: 1, top: -2, bottom: -1 }];
        const viewport = L.point(12, 6);
        expect(visiblePatch(rects, viewport)).toEqual(L.point(2, 1));
        expect(cameraRects(rects, viewport).length).toBeGreaterThan(0);
    });

    it('merges adjoining tiles and floor coverage without inserting seams', () => {
        const rows = coverageRows({ '': { '0': [0, 0] }, _b1: { '0': [1, 1] } }, ['', '_b1']);
        const rects = cameraRects(coverageRects(rows), L.point(1, 1), 0, L.point(1, 1));
        expect(sweep(L.point(0.5, 0.5), L.point(1.5, 0.5), rects)).toEqual(L.point(1.5, 0.5));
        expect(rects.some((rect) => contains(rect, L.point(1, 0.5)))).toBe(true);
    });

    it('slides along an L-shaped edge but never fills its missing corner', () => {
        const rects = shape({ '0': [0, 4], '1': [0, 0], '2': [0, 0], '3': [0, 0] });
        expect(rects.some((rect) => contains(rect, L.point(2, 2)))).toBe(false);
        expect(slide(L.point(2, 0.5), L.point(3.5, 3.5), rects)).toEqual(L.point(3.5, 0.5));
    });

    it('blocks internal holes and fast movement between disconnected islands', () => {
        const hole = shape({ '0': [0, 4], '1': [0, 0, 4, 4], '2': [0, 0, 4, 4], '3': [0, 4] });
        expect(sweep(L.point(0.5, 1.5), L.point(4.5, 1.5), hole).x).toBeCloseTo(0.5);
        const islands = shape({ '-2': [-5, -3, 5, 7] });
        const from = L.point(-4, -1.5);
        expect(sweep(from, L.point(6, -1.5), islands)).toEqual(L.point(-2.5, -1.5));
        expect(nearest(L.point(6, -1.5), islands)).toEqual(L.point(6, -1.5));
    });

    it('requires the whole viewport when it is smaller than a tile', () => {
        const rects = shape({ '0': [0, 0] }, L.point(0.7, 0.4));
        expect(nearest(L.point(-10, 10), rects)).toEqual(L.point(0.35, 0.8));
    });

    it('reserves a rebound band without weakening the hard visibility limit', () => {
        const rows = coverageRows({ '': { '0': [0, 3] } }, ['']);
        const hard = cameraRects(coverageRects(rows), L.point(4, 3), 0, L.point(1, 1));
        const soft = cameraRects(coverageRects(rows), L.point(4, 3), 0.48, L.point(1, 1));
        expect(nearest(L.point(-10, 0.5), soft).x - nearest(L.point(-10, 0.5), hard).x).toBeCloseTo(0.48);
    });
});

/** Independent oracle: integrate covered cell area inside a candidate patch. */
function hasPatch(coverage: ZoomTileCoverage, center: L.Point, viewport: L.Point, patch: L.Point): boolean {
    const width = patch.x, height = patch.y;
    const left = center.x - viewport.x / 2, top = center.y - viewport.y / 2;
    const right = center.x + viewport.x / 2, bottom = center.y + viewport.y / 2;
    const xs = new Set([left, right - width]), ys = new Set([top, bottom - height]);
    for (const [row, ranges] of Object.entries(coverage[''] ?? {})) {
        const y = Number(row);
        for (const edge of [y, y + 1 - height]) if (edge >= top && edge + height <= bottom) ys.add(edge);
        for (let i = 0; i < ranges.length; i += 2) {
            for (const edge of [ranges[i], ranges[i + 1] + 1 - width]) {
                if (edge >= left && edge + width <= right) xs.add(edge);
            }
        }
    }
    for (const x of xs) for (const y of ys) {
        let area = 0;
        for (const [row, ranges] of Object.entries(coverage[''] ?? {})) {
            const dy = Math.max(0, Math.min(y + height, Number(row) + 1) - Math.max(y, Number(row)));
            if (!dy) continue;
            for (let i = 0; i < ranges.length; i += 2) {
                area += dy * Math.max(0, Math.min(x + width, ranges[i + 1] + 1) - Math.max(x, ranges[i]));
            }
        }
        if (area >= width * height - 1e-7) return true;
    }
    return false;
}

it('retains a continuous visible patch in the real region coverage at fractional and overzoomed scales', () => {
    const datasets: Array<{ regions: Record<string, Record<string, ZoomTileCoverage>> }> = [standard, satellite];
    for (const data of datasets) for (const zooms of Object.values(data.regions)) {
        for (const [level, coverage] of Object.entries(zooms)) {
            for (const zoom of [Number(level), Number(level) + 0.37, Number(level) + 1.5]) {
                const tile = 200 * 2 ** (zoom - Number(level));
                const viewport = L.point(390 / tile, 700 / tile);
                const covered = coverageRects(coverageRows(coverage, ['']));
                const patch = visiblePatch(covered, viewport);
                const rects = cameraRects(covered, viewport);
                expect(rects.length).toBeGreaterThan(0);
                for (const target of [L.point(-100, -100), L.point(100, 100), L.point(12, 18)]) {
                    const center = nearest(target, rects);
                    expect(hasPatch(coverage, center, viewport, patch)).toBe(true);
                }
            }
        }
    }
});

it('prepares every maximal continuous rectangle without filling a hole or excluding a seam', () => {
    const coverage = { '': { '-1': [-3, 2], '0': [-3, -2, 1, 2], '1': [-3, 2], '3': [6, 7] } };
    const rows = coverageRows(coverage, ['']);
    const rects = coverageRects(rows);
    // Exhaustively compare all integer-edge rectangles with the original cells.
    for (let left = -3; left < 8; left++) for (let right = left + 1; right <= 8; right++) {
        for (let top = -1; top < 4; top++) for (let bottom = top + 1; bottom <= 4; bottom++) {
            let filled = true;
            for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
                if (!rows.get(y)?.some(([a, b]) => a <= x && b >= x + 1)) filled = false;
            }
            expect(rects.some((rect) => rect.left <= left && rect.right >= right && rect.top <= top && rect.bottom >= bottom)).toBe(filled);
        }
    }
});
