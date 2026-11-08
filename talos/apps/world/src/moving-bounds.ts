import type { Segment, Vec3 } from '@opendfieldmap/ganglia';

export type Box = { min: Vec3; max: Vec3 };
export type SupportBox = Box & {
    device: string;
    family: string;
    role: 'board' | 'leave' | 'use';
};

/** Optional route annotations never substitute for the selected trajectory. */
export function supportBoxes(value: unknown): SupportBox[] {
    if (!Array.isArray(value)) return [];
    const vector = (v: unknown): v is Vec3 =>
        Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    return value.filter((box): box is SupportBox => {
        if (box === null || typeof box !== 'object') return false;
        const { min, max, device, family, role } = box;
        return (
            typeof device === 'string' &&
            typeof family === 'string' &&
            ['board', 'leave', 'use'].includes(role) &&
            vector(min) &&
            vector(max) &&
            min.every((number, axis) => number <= max[axis])
        );
    });
}

/** Twelve independent world-space edges for one route contact pose. */
export function boxSegments(bounds: Box): Segment[] {
    const corners: Vec3[] = Array.from({ length: 8 }, (_, bits) => [
        bits & 1 ? bounds.max[0] : bounds.min[0],
        bits & 2 ? bounds.max[1] : bounds.min[1],
        bits & 4 ? bounds.max[2] : bounds.min[2],
    ]);
    const segments: Segment[] = [];
    for (let corner = 0; corner < corners.length; corner++) {
        for (const bit of [1, 2, 4]) {
            if ((corner & bit) === 0)
                segments.push({
                    mode: 'walk',
                    points: [corners[corner], corners[corner | bit]],
                    times: [0, 1],
                });
        }
    }
    return segments;
}
