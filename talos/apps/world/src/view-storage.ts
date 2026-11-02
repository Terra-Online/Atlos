import type { Viewer } from '@endfield-noclip/viewer/host';
import { record, vector } from '@/services/noclip/types';

type Options = Viewer['options'];
export interface SavedView {
    version: 1;
    route: string;
    release: string;
    scene: string;
    level: string;
    subregion: string;
    tier: number;
    position: [number, number, number];
    yaw: number;
    pitch: number;
    fovY: number;
    speed: number;
    options: Partial<Options>;
}
const KEY = 'world-view';
const ranges: Record<string, readonly [number, number]> = {
    exposure: [-4, 4],
    aperture: [1.4, 32],
    focusDistance: [0.1, 10000],
    renderScale: [0.5, 1],
    maxSse: [1, 64],
    terrainPixels: [0.5, 16],
    minBoxPixels: [0, 16],
    outlineMetres: [10, 1000],
    budgetMiB: [64, 2048],
    textureBias: [0, 2],
};
const bounded = (value: unknown, min: number, max: number): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max;

/** Only portable display preferences; environment IDs and story picks belong to a scene. */
export function displayOptions(
    value: unknown,
    defaults: Partial<Options>,
): Partial<Options> {
    if (!record(value)) return {};
    const entries = Object.entries(defaults).flatMap<[string, unknown]>(
        ([key, fallback]) => {
            const item = value[key];
            if (typeof fallback === 'boolean' && typeof item === 'boolean')
                return [[key, item]];
            const range = ranges[key];
            if (range && bounded(item, ...range)) return [[key, item]];
            if (
                key === 'hlodTiers' &&
                Array.isArray(item) &&
                item.length === 3 &&
                item.every((v) => typeof v === 'boolean')
            )
                return [[key, item]];
            if (
                key === 'tonemapper' &&
                typeof item === 'string' &&
                ['game', 'pbr neutral', 'none'].includes(String(item))
            )
                return [[key, item]];
            if (
                key === 'debugView' &&
                typeof item === 'string' &&
                [
                    'lit',
                    'albedo',
                    'normals',
                    'roughness',
                    'ambient',
                    'clouds',
                ].includes(String(item))
            )
                return [[key, item]];
            return [];
        },
    );
    return Object.fromEntries(entries) as Partial<Options>;
}

export function readView(defaults: Partial<Options>): SavedView | null {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
        if (
            !record(value) ||
            value.version !== 1 ||
            !['route', 'release', 'scene', 'level', 'subregion'].every(
                (k) => typeof value[k] === 'string',
            ) ||
            typeof value.route !== 'string' ||
            !/^\/(?:[A-Za-z0-9]+)?(?:\?region=[A-Za-z0-9_]+)?$/.test(
                value.route,
            ) ||
            !vector(value.position) ||
            !Number.isInteger(value.tier) ||
            !bounded(value.yaw, -1e6, 1e6) ||
            !bounded(value.pitch, -Math.PI / 2, Math.PI / 2) ||
            !bounded(
                value.fovY,
                2 * Math.atan(24 / 500),
                (100 * Math.PI) / 180,
            ) ||
            !bounded(value.speed, 0.5, 5000)
        )
            return null;
        return {
            ...value,
            options: displayOptions(value.options, defaults),
        } as SavedView;
    } catch {
        return null;
    }
}

export function writeView(value: SavedView): void {
    try {
        const serialized = JSON.stringify(value);
        if (localStorage.getItem(KEY) !== serialized)
            localStorage.setItem(KEY, serialized);
    } catch {
        /* Private mode/quota failure must not interrupt navigation. */
    }
}
