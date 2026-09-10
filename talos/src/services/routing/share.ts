import type { IMarkerData } from '@/data/marker';
import { useMarkerStore } from '@/store/marker';
import useRegion from '@/store/region';
import {
    PARAM_FILTER,
    PARAM_LANG,
    PARAM_POINT,
    PARAM_REGION,
    PARAM_SUBREGION,
    PARAM_POINT_TOKEN,
    PARAM_IMAGE,
    REGION_CODE_MAP,
    SUBREGION_TO_REGION_MAP,
} from './protocol';
import type { MarkerNavigationOptions } from '@/services/map/navigation';
import { getCurrentLocale, getPointShareOrigin } from './runtime';
import { encodePointIdToken } from './pointToken';
import { getFilterParamValue } from './filterCodec';
import { getLangUrlCode } from '@/lib/i18n/lang';

export const generateShareUrl = (): string => {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();

    const locale = getCurrentLocale();
    if (locale) {
        params.set(PARAM_LANG, getLangUrlCode(locale));
    }

    const filterParam = getFilterParamValue(useMarkerStore.getState().filter);
    if (filterParam) params.set(PARAM_FILTER, filterParam);

    const { currentRegionKey, currentSubregionKey } = useRegion.getState();
    if (currentRegionKey) {
        params.set(PARAM_REGION, REGION_CODE_MAP[currentRegionKey] || currentRegionKey);
    }
    if (currentSubregionKey) params.set(PARAM_SUBREGION, currentSubregionKey);

    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
};

export const buildPointShareToken = (
    point: Pick<IMarkerData, 'id' | 'type' | 'subregId'>,
): string => {
    const token = encodePointIdToken(String(point.id));
    if (token) return token;

    const params = new URLSearchParams();
    const pointFilter = getFilterParamValue([point.type]);
    if (pointFilter) params.set(PARAM_FILTER, pointFilter);
    const fallbackRegion = SUBREGION_TO_REGION_MAP[point.subregId] || useRegion.getState().currentRegionKey;
    params.set(PARAM_REGION, REGION_CODE_MAP[fallbackRegion] || fallbackRegion);
    params.set(PARAM_SUBREGION, point.subregId);
    params.set(PARAM_POINT, String(point.id));
    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
};

export const generatePointShareShortUrl = (
    point: Pick<IMarkerData, 'id' | 'type' | 'subregId'>,
): string => {
    const tokenOrFallback = buildPointShareToken(point);
    if (tokenOrFallback.startsWith('?')) return tokenOrFallback;
    const tokenParams = new URLSearchParams();
    tokenParams.set(PARAM_POINT_TOKEN, tokenOrFallback);
    return `?${tokenParams.toString()}`;
};

export const generatePointShareUrl = (
    point: Pick<IMarkerData, 'id' | 'type' | 'subregId'>,
    options: MarkerNavigationOptions = {},
): string => {
    const tokenOrFallback = buildPointShareToken(point);
    const pointShareOrigin = getPointShareOrigin();
    const path = tokenOrFallback.startsWith('?')
        ? tokenOrFallback
        : encodeURIComponent(tokenOrFallback);
    const url = new URL(`${pointShareOrigin}/${path}`);
    if (options.content?.kind === 'image') {
        url.searchParams.set(PARAM_IMAGE, options.content.id);
    }
    return url.toString();
};

export const copyShareUrl = async (): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(generateShareUrl());
        return true;
    } catch {
        return false;
    }
};

export const useShareUrl = () => ({
    generateShareUrl,
    generatePointShareShortUrl,
    generatePointShareUrl,
    copyShareUrl,
});
