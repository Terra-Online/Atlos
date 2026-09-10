import { REGION_DICT } from '@/data/map';

export const PARAM_LANG = 'l';
export const PARAM_FILTER = 'f';
export const PARAM_TYPE = 'type';
export const PARAM_REGION = 'r';
export const PARAM_SUBREGION = 's';
export const PARAM_POINT = 'p';
export const PARAM_POINT_TOKEN = 'x';
export const PARAM_IMAGE = 'imageId';

export const MAP_URL_PARAMS = [
    PARAM_LANG,
    PARAM_FILTER,
    PARAM_TYPE,
    PARAM_REGION,
    PARAM_SUBREGION,
    PARAM_POINT,
    PARAM_POINT_TOKEN,
    PARAM_IMAGE,
] as const;

export const AUTH_URL_PARAM_WHITELIST = new Set(['token', 'email', 'error', 'domain']);

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
