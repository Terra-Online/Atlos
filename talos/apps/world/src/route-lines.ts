import type { Viewer } from '@endfield-noclip/viewer/host';
import type { Segment } from '@oem/ganglia';

export const DASH_PERIOD = 8;

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
): Float32Array {
    const count = segments.reduce(
        (sum, segment) => sum + segment.points.length - 1,
        0,
    );
    const result = new Float32Array(Math.max(0, count) * 8);
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
            cursor += 8;
            phase = (phase + length) % DASH_PERIOD;
        }
    return result.subarray(0, cursor);
}
