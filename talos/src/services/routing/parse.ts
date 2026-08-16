import { MARKER_TYPE_DICT } from '@/data/marker';
import {
    PARAM_FILTER,
    PARAM_LANG,
    PARAM_POINT,
    PARAM_POINT_TOKEN,
    PARAM_REGION,
    PARAM_SUBREGION,
    PARAM_TYPE,
    REGION_CODE_REVERSE,
    MAP_URL_PARAMS,
} from './protocol';
import { getPathPointToken } from './path';
import { decompressFilter } from './filterCodec';

export type UrlLocationLike = Pick<Location, 'pathname' | 'search'>;

export type ParsedUrlState = {
    hasMapUrlState: boolean;
    hasSearchParams: boolean;
    languageCode: string | null;
    filterParam: string | null;
    filterKeys: string[];
    regionKey: string | null;
    regionParam: string | null;
    subregionKey: string | null;
    pointId: string | null;
    pointToken: string | null;
    typeKey: string | null;
    pathPointToken: string | null;
};

const parseFilterParam = (value: string | null): string[] => {
    if (!value) return [];

    const rawKeys = value.split(',').map((key) => key.trim()).filter(Boolean);
    const isRawFormat = value.includes(',') || Boolean(rawKeys[0] && MARKER_TYPE_DICT[rawKeys[0]]);
    const decodedKeys = isRawFormat ? rawKeys : decompressFilter(value);
    return decodedKeys.filter((key) => MARKER_TYPE_DICT[key]);
};

export const parseUrlState = (location: UrlLocationLike): ParsedUrlState => {
    const params = new URLSearchParams(location.search);
    const pathPointToken = getPathPointToken(location.pathname);
    const regionParam = params.get(PARAM_REGION);

    return {
        hasMapUrlState: Boolean(pathPointToken || MAP_URL_PARAMS.some((param) => params.has(param))),
        hasSearchParams: params.toString().length > 0,
        languageCode: params.get(PARAM_LANG),
        filterParam: params.get(PARAM_FILTER),
        filterKeys: parseFilterParam(params.get(PARAM_FILTER)),
        regionKey: regionParam ? (REGION_CODE_REVERSE[regionParam] || regionParam) : null,
        regionParam,
        subregionKey: params.get(PARAM_SUBREGION),
        pointId: params.get(PARAM_POINT),
        pointToken: params.get(PARAM_POINT_TOKEN)?.trim() || pathPointToken,
        typeKey: params.get(PARAM_TYPE)?.trim() || null,
        pathPointToken,
    };
};
