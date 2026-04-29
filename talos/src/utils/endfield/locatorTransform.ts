import type { PositionResponse } from './types';

export type EFLocatorPosition = {
    mapX: number;
    mapZ: number;
    mode: string;
    regionKey: string | null;
};

type LocatorTransformProfile = {
    scaleX: number;
    scaleZ: number;
    offsetX: number;
    offsetZ: number;
    rotateClockwise90?: boolean;
    regionKey?: string | null;
};

type LocatorTransformConfig = {
    defaultProfile?: string;
    emptyProfile?: string;
    profiles: Record<string, LocatorTransformProfile>;
    aliases?: Record<string, string>;
};

let cachedTransformConfig: LocatorTransformConfig | null | undefined;

const readRawTransformConfig = (): unknown => {
    const runtimeValue = globalThis.window?.__ENDFIELD_LOCATOR_TRANSFORMS__;
    if (runtimeValue) return runtimeValue;

    const buildValue = import.meta.env.VITE_ENDFIELD_LOCATOR_TRANSFORMS;
    return typeof buildValue === 'string' ? buildValue.trim() : '';
};

const parseFiniteNumber = (value: unknown, key: string): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid Endfield locator transform value: ${key}`);
    }
    return parsed;
};

const normalizeTransformConfig = (raw: unknown): LocatorTransformConfig => {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Endfield locator transform config is invalid.');
    }

    const config = raw as Partial<LocatorTransformConfig>;
    const profiles = config.profiles;
    if (!profiles || typeof profiles !== 'object') {
        throw new Error('Endfield locator transform profiles are missing.');
    }

    const normalizedProfiles = Object.fromEntries(
        Object.entries(profiles).map(([key, profile]) => [
            key,
            {
                scaleX: parseFiniteNumber(profile.scaleX, `${key}.scaleX`),
                scaleZ: parseFiniteNumber(profile.scaleZ, `${key}.scaleZ`),
                offsetX: parseFiniteNumber(profile.offsetX, `${key}.offsetX`),
                offsetZ: parseFiniteNumber(profile.offsetZ, `${key}.offsetZ`),
                rotateClockwise90: Boolean(profile.rotateClockwise90),
                regionKey: profile.regionKey ?? null,
            },
        ]),
    );

    return {
        defaultProfile: config.defaultProfile,
        emptyProfile: config.emptyProfile,
        profiles: normalizedProfiles,
        aliases: config.aliases,
    };
};

const readTransformConfig = (): LocatorTransformConfig | null => {
    if (cachedTransformConfig !== undefined) return cachedTransformConfig;

    const raw = readRawTransformConfig();
    if (!raw || (typeof raw === 'string' && !raw)) {
        cachedTransformConfig = null;
        return cachedTransformConfig;
    }

    cachedTransformConfig = normalizeTransformConfig(
        typeof raw === 'string' ? JSON.parse(raw) : raw,
    );
    return cachedTransformConfig;
};

const resolveProfileKey = (
    payload: PositionResponse['data'],
    config: LocatorTransformConfig,
): string | null => {
    const mapId = payload.mapId.trim();
    const levelId = payload.levelId.trim();

    if (!mapId && !levelId && config.emptyProfile) {
        return config.emptyProfile;
    }

    const alias = config.aliases?.[`mapId:${mapId}`]
        ?? config.aliases?.[`levelId:${levelId}`]
        ?? config.aliases?.[mapId]
        ?? config.aliases?.[levelId];
    if (alias) return alias;

    if (mapId && config.profiles[mapId]) return mapId;
    if (levelId && config.profiles[levelId]) return levelId;
    return config.defaultProfile ?? null;
};

export const convertEFPosition = (payload: PositionResponse['data']): EFLocatorPosition | null => {
    const config = readTransformConfig();
    if (!config) return null;

    const profileKey = resolveProfileKey(payload, config);
    if (!profileKey) return null;

    const transform = config.profiles[profileKey];
    if (!transform) return null;

    let x = payload.pos.x;
    let z = payload.pos.z;

    if (transform.rotateClockwise90) {
        const rotatedX = z;
        const rotatedZ = -x;
        x = rotatedX;
        z = rotatedZ;
    }

    return {
        mapX: x * transform.scaleX + transform.offsetX,
        mapZ: z * transform.scaleZ + transform.offsetZ,
        mode: profileKey,
        regionKey: transform.regionKey ?? null,
    };
};
