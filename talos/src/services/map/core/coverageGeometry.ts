import L from 'leaflet';
import type { ZoomTileCoverage } from '@/services/map/tileCoverage';

export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

type Interval = [number, number];
export type CoverageRows = Map<number, Interval[]>;
const EPSILON = 1e-8;

const merge = (intervals: Interval[]): Interval[] => {
    const result: Interval[] = [];
    for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
        const last = result[result.length - 1];
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else result.push([start, end]);
    }
    return result;
};

/** Tile-grid coordinates, with inclusive coverage indices converted to edges. */
export function coverageRows(coverage: ZoomTileCoverage, suffixes: string[]): CoverageRows {
    const rows: CoverageRows = new Map();
    for (const suffix of suffixes) {
        for (const [key, ranges] of Object.entries(coverage[suffix] ?? {})) {
            const y = Number(key);
            const intervals = rows.get(y) ?? [];
            for (let i = 0; i < ranges.length; i += 2) {
                const left = ranges[i];
                const right = ranges[i + 1] + 1;
                if (right > left) intervals.push([left, right]);
            }
            rows.set(y, intervals);
        }
    }
    for (const [y, intervals] of rows) rows.set(y, merge(intervals));
    return rows;
}

const intersect = (a: Interval[], b: Interval[]): Interval[] => {
    const result: Interval[] = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        const left = Math.max(a[i][0], b[j][0]);
        const right = Math.min(a[i][1], b[j][1]);
        if (right >= left) result.push([left, right]);
        if (a[i][1] < b[j][1]) i++; else j++;
    }
    return result;
};

/** All maximal covered rectangles, prepared once per tile level. */
export function coverageRects(rows: CoverageRows): Rect[] {
    const result: Rect[] = [];
    const spans = (row: number, left: number, right: number) =>
        rows.get(row)?.some(([a, b]) => a <= left && b >= right);
    for (const top of rows.keys()) {
        let intervals = rows.get(top)!;
        for (let bottom = top; intervals.length; bottom++) {
            for (const [left, right] of intervals) {
                if (!spans(top - 1, left, right) && !spans(bottom + 1, left, right)) {
                    result.push({ left, right, top, bottom: bottom + 1 });
                }
            }
            const next = rows.get(bottom + 1);
            if (!next) break;
            intervals = intersect(intervals, next).filter(([left, right]) => right > left);
        }
    }
    return result;
}

/** Largest continuous patch with the viewport's aspect ratio, capped at a quadrant. */
export function visiblePatch(rects: Rect[], viewport: L.Point): L.Point {
    const desired = viewport.divideBy(2);
    let fit = 0;
    for (const rect of rects) {
        fit = Math.max(fit, Math.min(1, (rect.right - rect.left) / desired.x,
            (rect.bottom - rect.top) / desired.y));
    }
    return desired.multiplyBy(fit);
}

/**
 * Erode each maximal covered rectangle by the patch, then expand by the spare
 * viewport space. This preserves holes and seams without scanning rows during
 * fractional zoom. Padding reserves elastic travel inside the visible domain.
 */
export function cameraRects(rects: Rect[], viewport: L.Point, padding = 0, patch = visiblePatch(rects, viewport)): Rect[] {
    const spare = viewport.subtract(patch).divideBy(2);
    const half = L.point(patch.x / 2 + Math.max(0, padding - spare.x),
        patch.y / 2 + Math.max(0, padding - spare.y));
    const slack = L.point(Math.max(0, spare.x - padding), Math.max(0, spare.y - padding));
    return rects.filter((rect) => rect.right - rect.left + EPSILON >= half.x * 2
        && rect.bottom - rect.top + EPSILON >= half.y * 2).map((rect) => ({
        left: rect.left + half.x - slack.x, right: rect.right - half.x + slack.x,
        top: rect.top + half.y - slack.y, bottom: rect.bottom - half.y + slack.y,
    }));
}

export const contains = (rect: Rect, point: L.Point): boolean =>
    point.x >= rect.left - EPSILON && point.x <= rect.right + EPSILON
    && point.y >= rect.top - EPSILON && point.y <= rect.bottom + EPSILON;

export function nearest(point: L.Point, rects: Rect[]): L.Point {
    let closest = point;
    let distance = Infinity;
    for (const rect of rects) {
        const candidate = L.point(Math.max(rect.left, Math.min(point.x, rect.right)),
            Math.max(rect.top, Math.min(point.y, rect.bottom)));
        const d = candidate.distanceTo(point);
        if (d < distance) { closest = candidate; distance = d; }
        if (d < EPSILON) return point;
    }
    return closest;
}

/** Clip the whole segment, so a large input cannot tunnel across a gap. */
export function sweep(from: L.Point, to: L.Point, rects: Rect[]): L.Point {
    const delta = to.subtract(from);
    const intervals: Interval[] = [];
    for (const rect of rects) {
        let enter = 0, exit = 1;
        for (const [origin, step, min, max] of [
            [from.x, delta.x, rect.left, rect.right],
            [from.y, delta.y, rect.top, rect.bottom],
        ]) {
            if (Math.abs(step) < EPSILON) {
                if (origin < min - EPSILON || origin > max + EPSILON) { exit = -1; break; }
            } else {
                const a = (min - origin) / step, b = (max - origin) / step;
                enter = Math.max(enter, Math.min(a, b));
                exit = Math.min(exit, Math.max(a, b));
            }
        }
        if (enter <= exit + EPSILON && exit >= 0) intervals.push([enter, exit]);
    }
    let end = 0;
    for (const [enter, exit] of intervals.sort((a, b) => a[0] - b[0])) {
        if (enter > end + EPSILON) break;
        end = Math.max(end, exit);
        if (end >= 1) return to;
    }
    return from.add(delta.multiplyBy(Math.max(0, Math.min(1, end))));
}

export function slide(from: L.Point, to: L.Point, rects: Rect[]): L.Point {
    const hit = sweep(from, to, rects);
    if (hit.distanceTo(to) < EPSILON) return hit;
    const horizontal = sweep(hit, L.point(to.x, hit.y), rects);
    const vertical = sweep(hit, L.point(hit.x, to.y), rects);
    return horizontal.distanceTo(to) < vertical.distanceTo(to) ? horizontal : vertical;
}
