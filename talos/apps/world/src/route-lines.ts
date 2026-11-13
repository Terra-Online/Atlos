import type { Viewer } from '@endfield-noclip/viewer/host';
import type { Segment } from '@opendfieldmap/ganglia';

export const DASH_PERIOD = 32;
// Independent screen-space periods for the travelling highlight and occlusion dashes.
export const WIRE_PERIOD = 96;

export const ROUTE_STYLES = {
    unverified: { label: 'Candidate', color: [0.65, 0.68, 0.74] },
    verified: { label: 'Verified', color: [0.1, 0.85, 0.45] },
    blocked: { label: 'Blocked', color: [1, 0.15, 0.16] },
    terminal: { label: 'Target approach', color: [0.12, 0.6, 1] },
    run: { label: 'Run', color: [0.2, 0.65, 1] },
    sprint: { label: 'Sprint (sustained)', color: [1, 0.8, 0.15] },
    dash: { label: 'Dash', color: [1, 0.4, 0.05] },
    flight: { label: 'Jump / fall', color: [0.73, 0.45, 1] },
    rope: { label: 'Rope', color: [0.3, 0.9, 0.4] },
    launch: { label: 'Launch device', color: [1, 0.35, 0.65] },
    transport: { label: 'Moving support', color: [0.1, 0.85, 0.8] },
};

export function routeStyle(segment: Segment & { validation?: 'unverified' | 'verified' | 'blocked' | 'terminal' }) {
    if (segment.validation) return ROUTE_STYLES[segment.validation];
    if (segment.mode === 'walk') {
        if (segment.gait === 'dash') return ROUTE_STYLES.dash;
        return segment.gait === 'sprint' ? ROUTE_STYLES.sprint : ROUTE_STYLES.run;
    }
    if (segment.mode === 'jump' || segment.mode === 'drop') return ROUTE_STYLES.flight;
    if (segment.mode === 'launch') return ROUTE_STYLES.launch;
    // Moving platforms share the rope traversal mode, with a source-owned ID.
    if (segment.connection?.includes('moving-ride/') || segment.connection?.includes('moving-join/'))
        return ROUTE_STYLES.transport;
    return ROUTE_STYLES.rope;
}

/** Project runs into NDC with separate CSS-pixel phases for dashes and the glow. */
export function projectLines(
    segments: Segment[],
    camera: Pick<
        Viewer['camera'],
        'position' | 'near' | 'fovY' | 'right' | 'up' | 'forward'
    >,
    width: number,
    height: number,
    pixelRatio: number,
    color?: (segment: Segment) => number[],
    blendColors = false,
): Float32Array {
    const count = segments.reduce(
        (sum, segment) => sum + segment.points.length - 1,
        0,
    );
    const stride = color ? (blendColors ? 20 : 12) : 8;
    const result = new Float32Array(Math.max(0, count) * stride);
    const right = camera.right(),
        up = camera.up(),
        forward = camera.forward();
    const dot = (a: number[], b: number[]) =>
        a.reduce((sum, value, axis) => sum + value * b[axis], 0);
    const space = (point: number[]) => {
        const delta = point.map((value, axis) => value - camera.position[axis]);
        return [dot(delta, right), dot(delta, up), dot(delta, forward)];
    };
    const f = 1 / Math.tan(camera.fovY / 2);
    const project = (point: number[]) => [
        (((f * height) / width) * point[0]) / point[2],
        (f * point[1]) / point[2],
        camera.near / point[2],
    ];
    let cursor = 0,
        phase = 0,
        wirePhase = 0;
    for (const [segmentIndex, segment] of segments.entries()) {
        const runStart = cursor;
        let runLength = 0;
        for (let index = 1; index < segment.points.length; index++) {
            let a = space(segment.points[index - 1]),
                b = space(segment.points[index]);
            if (a[2] < camera.near && b[2] < camera.near) continue;
            if (a[2] < camera.near) {
                const t = (camera.near - a[2]) / (b[2] - a[2]);
                a = a.map((value, axis) => value + t * (b[axis] - value));
            }
            if (b[2] < camera.near) {
                const t = (camera.near - b[2]) / (a[2] - b[2]);
                b = b.map((value, axis) => value + t * (a[axis] - value));
            }
            const start = project(a),
                end = project(b);
            const length =
                Math.hypot(
                    ((end[0] - start[0]) * width) / 2,
                    ((end[1] - start[1]) * height) / 2,
                ) / pixelRatio;
            if (length < 1e-6) continue;
            result.set([...start, phase, ...end, phase + length], cursor);
            if (color) result.set([...color(segment), wirePhase], cursor + 8);
            if (color && blendColors) {
                result[cursor + 15] = runLength;
                runLength += length;
            }
            cursor += stride;
            phase = (phase + length) % DASH_PERIOD;
            wirePhase = (wirePhase + length) % WIRE_PERIOD;
        }
        if (color && blendColors) {
            const own = color(segment);
            const previous = segments[segmentIndex - 1], next = segments[segmentIndex + 1];
            const connected = (a: number[] | undefined, b: number[] | undefined) =>
                a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
            const before = connected(previous?.points.at(-1), segment.points[0]) ? color(previous) : own;
            const after = connected(segment.points.at(-1), next?.points[0]) ? color(next) : own;
            for (let offset = runStart; offset < cursor; offset += stride) {
                result.set(before, offset + 12);
                result.set([...after, runLength], offset + 16);
            }
        }
    }
    return result.subarray(0, cursor);
}

/** Round render-only bends within 25 cm; route points and playback stay authoritative. */
export function softenLines(segments: Segment[]): Segment[] {
    const same = (a: number[] | undefined, b: number[] | undefined) =>
        a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    return segments.map((segment, segmentIndex) => {
        if (segment.points.length < 2) return segment;
        const points: Segment['points'] = [];
        const times: number[] = [];
        const append = (point: Segment['points'][number], time: number) => { points.push(point); times.push(time); };
        const mix = (a: number[], b: number[], t: number): Segment['points'][number] =>
            [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        for (let i = 0; i < segment.points.length; i++) {
            const previous = segments[segmentIndex - 1], next = segments[segmentIndex + 1];
            const b = segment.points[i];
            const a = segment.points[i - 1] ?? (same(previous?.points.at(-1), b) ? previous.points.at(-2) : undefined);
            const c = segment.points[i + 1] ?? (same(next?.points[0], b) ? next.points[1] : undefined);
            const time = segment.times[i];
            if (!a || !c) { append(b, time); continue; }
            const before = Math.hypot(...b.map((v, j) => v - a[j]));
            const after = Math.hypot(...c.map((v, j) => v - b[j]));
            if (before < 1e-6 || after < 1e-6) { append(b, time); continue; }
            const dot = b.reduce((sum, v, j) => sum + (v - a[j]) * (c[j] - v), 0) / (before * after);
            // Straight samples and reversals must not grow unnecessary geometry.
            if (dot > 0.995 || dot < -0.95) { append(b, time); continue; }
            const trim = Math.min(0.25, before * 0.25, after * 0.25);
            const entry = mix(b, a, trim / before), exit = mix(b, c, trim / after);
            // Split a shared bend at its midpoint so colour boundaries stay joined.
            const first = i === 0 ? 2 : 0;
            const last = i === segment.points.length - 1 ? 2 : 4;
            const startTime = i === 0 ? time : time + (segment.times[i - 1] - time) * trim / before;
            const endTime = i === segment.points.length - 1 ? time : time + (segment.times[i + 1] - time) * trim / after;
            for (let step = first; step <= last; step++) {
                const t = step / 4;
                append(mix(mix(entry, b, t), mix(b, exit, t), t), startTime + (endTime - startTime) * (step - first) / (last - first));
            }
        }
        return { ...segment, points, times };
    });
}
