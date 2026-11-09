import type { Viewer } from '@endfield-noclip/viewer/host';
import type { Segment } from '@opendfieldmap/ganglia';

export const DASH_PERIOD = 8;

export const ROUTE_STYLES = {
    run: { label: 'Run', color: [0.2, 0.65, 1] },
    sprint: { label: 'Sprint (sustained)', color: [1, 0.8, 0.15] },
    dash: { label: 'Dash', color: [1, 0.4, 0.05] },
    flight: { label: 'Jump / fall', color: [0.73, 0.45, 1] },
    rope: { label: 'Rope', color: [0.3, 0.9, 0.4] },
    launch: { label: 'Launch device', color: [1, 0.35, 0.65] },
    transport: { label: 'Moving support', color: [0.1, 0.85, 0.8] },
};

export function routeStyle(segment: Segment) {
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

/** Project continuous runs into output NDC and a shared CSS-pixel dash phase. */
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
): Float32Array {
    const count = segments.reduce(
        (sum, segment) => sum + segment.points.length - 1,
        0,
    );
    const stride = color ? 12 : 8;
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
        phase = 0;
    for (const segment of segments)
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
            if (color) result.set([...color(segment), 1], cursor + 8);
            cursor += stride;
            phase = (phase + length) % DASH_PERIOD;
        }
    return result.subarray(0, cursor);
}
