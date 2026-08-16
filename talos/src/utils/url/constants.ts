import { REGION_DICT } from '@/data/map';

export const PARAM_LANG = 'l';
export const PARAM_FILTER = 'f';
export const PARAM_TYPE = 'type';
export const PARAM_REGION = 'r';
export const PARAM_SUBREGION = 's';
export const PARAM_POINT = 'p';
export const PARAM_POINT_TOKEN = 'x';

export const MAP_URL_PARAMS = [
    PARAM_LANG,
    PARAM_FILTER,
    PARAM_TYPE,
    PARAM_REGION,
    PARAM_SUBREGION,
    PARAM_POINT,
    PARAM_POINT_TOKEN,
] as const;

export const AUTH_URL_PARAM_WHITELIST = new Set(['token', 'email', 'error', 'domain']);
export const POINT_SHARE_SHORT_ORIGIN = 'https://oem.re';
export const POINT_SHARE_CN_ORIGIN = 'https://opendfieldmap.cn';
export const POINT_SHARE_CN_HOSTNAME = 'opendfieldmap.cn';

export const REGION_CODE_MAP: Record<string, string> = {
    Valley_4: 'VL',
    Wuling: 'WL',
    Dijiang: 'DJ',
    Weekraid_1: 'ES',
};

export const REGION_CODE_REVERSE: Record<string, string> = Object.fromEntries(
    Object.entries(REGION_CODE_MAP).map(([key, value]) => [value, key]),
);

export const SUBREGION_TO_REGION_MAP = Object.entries(REGION_DICT).reduce(
    (acc, [regionKey, region]) => {
        region.subregions.forEach((subregionKey) => {
            acc[subregionKey] = regionKey;
        });
        return acc;
    },
    {} as Record<string, string>,
);

export const POINT_TOKEN_PATTERN = /^[0-9a-zA-Z]{7}$/;

const isPointShareCnHostname = (hostname: string): boolean => (
    hostname === POINT_SHARE_CN_HOSTNAME || hostname.endsWith(`.${POINT_SHARE_CN_HOSTNAME}`)
);

export const getPointShareOrigin = (): string => {
    if (typeof window !== 'undefined' && isPointShareCnHostname(window.location.hostname)) {
        return POINT_SHARE_CN_ORIGIN;
    }

    return POINT_SHARE_SHORT_ORIGIN;
};

export const getPathPointToken = (pathname: string): string | null => {
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    return lastSegment && POINT_TOKEN_PATTERN.test(lastSegment) ? lastSegment : null;
};

export const stripPathPointToken = (pathname: string): string => {
    const segments = pathname.split('/').filter(Boolean);
    if (!segments.length || !POINT_TOKEN_PATTERN.test(segments[segments.length - 1])) {
        return pathname;
    }
    const keptSegments = segments.slice(0, -1);
    return keptSegments.length ? `/${keptSegments.join('/')}/` : '/';
};

export const getCurrentLocale = (): string | null => {
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('talos:locale');
        }
    } catch {
        // Ignore unavailable storage during startup or SSR.
    }
    return null;
};
