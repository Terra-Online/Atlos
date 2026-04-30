import type { PositionResponse } from './types';
import { SUBREGION_DICT } from '@/data/map';

export type EFLocatorPosition = {
    mapX: number;
    mapZ: number;
    mode: string;
    regionKey: string | null;
    subregionKey: string | null;
};

type RegionTransform = {
    scaleX: number;
    scaleZ: number;
    offsetX: number;
    offsetZ: number;
    rotateClockwise90?: boolean;
};

type RegionProfile = 'VL' | 'WL' | 'WL2' | 'DJ' | 'ES' | 'default';

const REGION_TRANSFORMS: Record<RegionProfile, RegionTransform> = {
    VL: {
        scaleX: 0.4687511298,
        scaleZ: 0.4687511298,
        offsetX: 519.6990737,
        offsetZ: -479.9101599,
    },
    WL: {
        scaleX: 0.41397681175575596,
        scaleZ: 0.4123987909522064,
        offsetX: 955.8805906115372,
        offsetZ: -155.59250075860632,
    },
    WL2: {
        scaleX: 0.35414771840391185,
        scaleZ: 0.33417957195526954,
        offsetX: 229.5095336217924,
        offsetZ: -639.5187069784344,
    },
    DJ: {
        scaleX: 2.817109225144681,
        scaleZ: 2.8369668977222067,
        offsetX: 481.07581876506237,
        offsetZ: -528.2046998395613,
        rotateClockwise90: true,
    },
    ES: {
        scaleX: 2.1236893194106514,
        scaleZ: 2.1398455301912183,
        offsetX: 613.9427764351295,
        offsetZ: -898.0955173659895,
    },
    default: {
        scaleX: 0.4687511298,
        scaleZ: 0.4687511298,
        offsetX: 519.6990737,
        offsetZ: -476.8398401,
    },
};

const MAP_ID_TO_PROFILE: Record<string, RegionProfile> = {
    map01: 'VL',
    map02: 'WL',
    base01: 'DJ',
    dung01: 'ES',
    indie07: 'WL2',
    indie_dg007: 'WL2',
};

const MAP_ID_TO_REGION_KEY: Record<string, string> = {
    map01: 'Valley_4',
    map02: 'Wuling',
    base01: 'Dijiang',
    dung01: 'Weekraid_1',
    indie07: 'Wuling',
    indie_dg007: 'Wuling',
};

const REGION_KEY_BY_PROFILE: Record<string, string | null> = {
    VL: 'Valley_4',
    WL: 'Wuling',
    WL2: 'Wuling',
    DJ: 'Dijiang',
    ES: 'Weekraid_1',
    default: 'Valley_4',
};

const isRegionProfile = (value: string): value is RegionProfile =>
    Object.prototype.hasOwnProperty.call(REGION_TRANSFORMS, value);

const SUBREGION_ID_BY_LEVEL_ID = Object.keys(SUBREGION_DICT).reduce<Record<string, string>>(
    (acc, subregionId) => {
        acc[subregionId.toLowerCase()] = subregionId;
        return acc;
    },
    {},
);

const normalizeSceneId = (value: string | null | undefined): string =>
    (value ?? '').trim().toLowerCase();

const resolveProfileKey = (mapId: string, levelId: string): RegionProfile => {
    if (!mapId && !levelId) return 'ES';
    if (mapId && MAP_ID_TO_PROFILE[mapId]) return MAP_ID_TO_PROFILE[mapId];
    if (mapId && isRegionProfile(mapId)) return mapId;
    if (levelId && isRegionProfile(levelId)) return levelId;
    if (mapId.startsWith('map01') || levelId.startsWith('map01')) return 'VL';
    if (mapId.startsWith('map02') || levelId.startsWith('map02')) return 'WL';
    if (mapId.startsWith('base01') || levelId.startsWith('base01')) return 'DJ';
    if (mapId.startsWith('dung01') || levelId.startsWith('dung01')) return 'ES';
    if (
        mapId.startsWith('indie07')
        || levelId.startsWith('indie07')
        || mapId.includes('indie_dg007')
        || levelId.includes('indie_dg007')
        || mapId.includes('wl2')
        || levelId.includes('wl2')
        || mapId.includes('wuling2')
        || levelId.includes('wuling2')
    ) {
        return 'WL2';
    }
    return 'default';
};

const resolveRegionKey = (mapId: string, levelId: string): string | null => {
    if (!mapId && !levelId) return null;
    if (mapId && MAP_ID_TO_REGION_KEY[mapId]) return MAP_ID_TO_REGION_KEY[mapId];
    if (mapId.startsWith('map01') || levelId.startsWith('map01')) return 'Valley_4';
    if (mapId.startsWith('map02') || levelId.startsWith('map02')) return 'Wuling';
    if (mapId.startsWith('base01') || levelId.startsWith('base01')) return 'Dijiang';
    if (mapId.startsWith('dung01') || levelId.startsWith('dung01')) return 'Weekraid_1';
    if (
        mapId.startsWith('indie07')
        || levelId.startsWith('indie07')
        || mapId.includes('indie_dg007')
        || levelId.includes('indie_dg007')
        || mapId.includes('wl2')
        || levelId.includes('wl2')
        || mapId.includes('wuling2')
        || levelId.includes('wuling2')
    ) {
        return 'Wuling';
    }
    return null;
};

export const convertEFPosition = (payload: PositionResponse['data']): EFLocatorPosition => {
    const mapId = normalizeSceneId(payload.mapId);
    const levelId = normalizeSceneId(payload.levelId);
    const profileKey = resolveProfileKey(mapId, levelId);
    const transform = REGION_TRANSFORMS[profileKey] ?? REGION_TRANSFORMS.default;
    let x = payload.pos.x;
    let z = payload.pos.z;

    if (transform.rotateClockwise90) {
        const rotatedX = x;
        const rotatedZ = z;
        x = rotatedX;
        z = rotatedZ;
    }

    return {
        mapX: x * transform.scaleX + transform.offsetX,
        mapZ: z * transform.scaleZ + transform.offsetZ,
        mode: profileKey,
        regionKey: (!mapId && !levelId)
            ? null
            : (resolveRegionKey(mapId, levelId) ?? REGION_KEY_BY_PROFILE[profileKey] ?? null),
        subregionKey: SUBREGION_ID_BY_LEVEL_ID[levelId] ?? null,
    };
};
