import type { Segment, Vec3 } from '@oem/ganglia';

export const MOVING_BOUNDS_RADIUS = 200;
export type Box = { min: Vec3; max: Vec3 };
export type MovingDevice = {
    id: string;
    family: string;
    level: string;
    endpoints: { initial: Box; terminal: Box };
    extent: Box;
};
export type MovingCatalog = {
    scene: string;
    source: { buildGuid: string; contentHash: string };
    devices: MovingDevice[];
    missing: number;
};
export type MovingBounds = Omit<MovingCatalog, 'missing'> & {
    position: Vec3;
    radius: number;
    missing: number;
};

const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const vector = (value: unknown): value is Vec3 =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const box = (value: unknown): value is Box => {
    if (!record(value) || !vector(value.min) || !vector(value.max))
        return false;
    const { min, max } = value;
    return min.every((number, axis) => number <= max[axis]);
};

export function isMovingBounds(value: unknown): value is MovingBounds {
    return (
        record(value) &&
        typeof value.scene === 'string' &&
        record(value.source) &&
        typeof value.source.buildGuid === 'string' &&
        typeof value.source.contentHash === 'string' &&
        vector(value.position) &&
        typeof value.radius === 'number' &&
        Number.isFinite(value.radius) &&
        value.radius > 0 &&
        Number.isSafeInteger(value.missing) &&
        Number(value.missing) >= 0 &&
        Array.isArray(value.devices) &&
        value.devices.every(
            (device) =>
                record(device) &&
                typeof device.id === 'string' &&
                typeof device.family === 'string' &&
                typeof device.level === 'string' &&
                record(device.endpoints) &&
                box(device.endpoints.initial) &&
                box(device.endpoints.terminal) &&
                box(device.extent),
        )
    );
}

/** Retain endpoint diagrams and sweep extents without keeping navigation meshes. */
export function movingCatalog(value: unknown, scene: string): MovingCatalog {
    if (
        !record(value) ||
        value.version !== 1 ||
        value.scene !== scene ||
        !record(value.source) ||
        typeof value.source.buildGuid !== 'string' ||
        !value.source.buildGuid ||
        typeof value.source.contentHash !== 'string' ||
        !value.source.contentHash ||
        !Array.isArray(value.movingSupports)
    )
        throw new Error('Invalid moving support catalog');
    const devices: MovingDevice[] = [];
    let missing = 0;
    const ids = new Set<string>();
    for (const item of value.movingSupports) {
        if (
            !record(item) ||
            typeof item.id !== 'string' ||
            !item.id ||
            ids.has(item.id) ||
            typeof item.level !== 'string' ||
            typeof item.family !== 'string'
        )
            throw new Error('Invalid moving support identity');
        ids.add(item.id);
        if (item.endpoints === undefined) {
            missing++;
            continue;
        }
        if (
            !record(item.endpoints) ||
            !box(item.endpoints.initial) ||
            !box(item.endpoints.terminal) ||
            !Array.isArray(item.surfaces)
        )
            throw new Error('Invalid moving support endpoints');
        const { initial, terminal } = item.endpoints;
        const extent: Box = {
            min: [
                Math.min(initial.min[0], terminal.min[0]),
                Math.min(initial.min[1], terminal.min[1]),
                Math.min(initial.min[2], terminal.min[2]),
            ],
            max: [
                Math.max(initial.max[0], terminal.max[0]),
                Math.max(initial.max[1], terminal.max[1]),
                Math.max(initial.max[2], terminal.max[2]),
            ],
        };
        for (const surface of item.surfaces) {
            if (!record(surface) || !Array.isArray(surface.vertices))
                throw new Error('Invalid moving support extent');
            for (const point of surface.vertices) {
                if (!vector(point))
                    throw new Error('Invalid moving support extent');
                for (let axis = 0; axis < 3; axis++) {
                    extent.min[axis] = Math.min(extent.min[axis], point[axis]);
                    extent.max[axis] = Math.max(extent.max[axis], point[axis]);
                }
            }
        }
        devices.push({
            id: item.id,
            family: item.family,
            level: item.level,
            endpoints: { initial, terminal },
            extent,
        });
    }
    return {
        scene,
        source: {
            buildGuid: value.source.buildGuid,
            contentHash: value.source.contentHash,
        },
        devices,
        missing,
    };
}

/** Include a device when any part of its sweep approaches the selected camera neighborhood. */
export function nearbyMovingBounds(
    catalog: MovingCatalog,
    level: string,
    position: Vec3,
): MovingBounds {
    const devices = catalog.devices.filter(
        (device) =>
            device.level === level &&
            Math.hypot(
                ...position.map((v, axis) =>
                    Math.max(
                        device.extent.min[axis] - v,
                        v - device.extent.max[axis],
                        0,
                    ),
                ),
            ) <= MOVING_BOUNDS_RADIUS,
    );
    return { ...catalog, devices, position, radius: MOVING_BOUNDS_RADIUS };
}

/** Twelve independent box edges, using the existing world-line projection and GPU renderer. */
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
