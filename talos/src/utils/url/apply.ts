import { setLocale } from '@/locale';
import {
    findMarkerById,
    findUniqueArchiveMarkerByType,
    type IMarkerData,
    MARKER_TYPE_DICT,
} from '@/data/marker';
import useRegion from '@/store/region';
import { useMarkerStore } from '@/store/marker';
import { completeCurrentUserGuide } from '@/store/userGuide';
import { getLangFromUrlCode } from '@/utils/lang';
import { navigateToSharedPoint } from '@/utils/navigation';
import {
    AUTH_URL_PARAM_WHITELIST,
    MAP_URL_PARAMS,
    PARAM_FILTER,
    PARAM_LANG,
    PARAM_POINT,
    PARAM_POINT_TOKEN,
    PARAM_REGION,
    PARAM_SUBREGION,
    PARAM_TYPE,
    REGION_CODE_REVERSE,
    SUBREGION_TO_REGION_MAP,
    getCurrentLocale,
    getPathPointToken,
    stripPathPointToken,
} from './constants';
import { decodePointIdToken, decompressFilter } from './codecs';

let suppressInitialAutoOverlays = false;

export const shouldSuppressInitialAutoOverlays = (): boolean => suppressInitialAutoOverlays;

const mergeFilterKeys = (keys: string[]): void => {
    const validKeys = keys.filter((key) => MARKER_TYPE_DICT[key]);
    if (validKeys.length === 0) return;
    const currentFilter = useMarkerStore.getState().filter;
    useMarkerStore.getState().setFilter(Array.from(new Set([...currentFilter, ...validKeys])));
};

const resolvePointShareTarget = async (
    pointId: string,
): Promise<{ point: IMarkerData; regionKey: string } | null> => {
    const point = await findMarkerById(String(pointId));
    if (!point) return null;
    const regionKey = SUBREGION_TO_REGION_MAP[point.subregId];
    return regionKey ? { point, regionKey } : null;
};

const resolveArchiveTypeShareTarget = async (
    typeKey: string,
): Promise<{ point: IMarkerData; regionKey: string } | null> => {
    const point = await findUniqueArchiveMarkerByType(typeKey);
    if (!point) return null;
    const regionKey = SUBREGION_TO_REGION_MAP[point.subregId];
    return regionKey ? { point, regionKey } : null;
};

const readFilterParam = (filterParam: string): string[] => {
    const rawKeys = filterParam.split(',').map((value) => value.trim()).filter(Boolean);
    const isRawFormat = filterParam.includes(',') || Boolean(rawKeys[0] && MARKER_TYPE_DICT[rawKeys[0]]);
    return isRawFormat ? rawKeys : decompressFilter(filterParam);
};

const cleanMapUrlState = (pathPointToken: string | null): void => {
    const params = new URLSearchParams(window.location.search);
    MAP_URL_PARAMS.forEach((param) => params.delete(param));

    const preservedParams = new URLSearchParams();
    params.forEach((value, key) => {
        if (AUTH_URL_PARAM_WHITELIST.has(key)) preservedParams.append(key, value);
    });

    const queryString = preservedParams.toString();
    const pathname = pathPointToken
        ? stripPathPointToken(window.location.pathname)
        : window.location.pathname;
    const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;
    window.history.replaceState({}, '', nextUrl);
};

export const applyUrlParams = async (): Promise<void> => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const pathPointToken = getPathPointToken(window.location.pathname);
    const hasMapUrlState = Boolean(pathPointToken || MAP_URL_PARAMS.some((param) => params.has(param)));
    suppressInitialAutoOverlays = hasMapUrlState;

    if (hasMapUrlState) completeCurrentUserGuide();

    const langParam = params.get(PARAM_LANG);
    if (langParam && !getCurrentLocale()) {
        const fullLocale = getLangFromUrlCode(langParam);
        if (fullLocale) await setLocale(fullLocale);
    }

    const filterParam = params.get(PARAM_FILTER);
    if (filterParam) mergeFilterKeys(readFilterParam(filterParam).filter((key) => MARKER_TYPE_DICT[key]));

    const regionParam = params.get(PARAM_REGION);
    const navRegion = regionParam ? (REGION_CODE_REVERSE[regionParam] || regionParam) : null;
    if (regionParam) {
        const { currentRegionKey } = useRegion.getState();
        if (!currentRegionKey || currentRegionKey === 'Valley_4') {
            useRegion.getState().setCurrentRegion(navRegion || regionParam);
        }
    }

    const subregionParam = params.get(PARAM_SUBREGION);
    if (subregionParam && !useRegion.getState().currentSubregionKey) {
        useRegion.getState().setCurrentSubregion(subregionParam);
    }

    const pointParam = params.get(PARAM_POINT);
    const typeParam = params.get(PARAM_TYPE)?.trim() || null;
    const pointTokenParam = params.get(PARAM_POINT_TOKEN)?.trim() || pathPointToken;
    const pointIdFromToken = pointTokenParam ? decodePointIdToken(pointTokenParam) : null;
    const resolvedFromToken = pointIdFromToken
        ? await resolvePointShareTarget(pointIdFromToken)
        : null;
    const resolvedFromType = typeParam ? await resolveArchiveTypeShareTarget(typeParam) : null;

    if (resolvedFromToken) {
        mergeFilterKeys([resolvedFromToken.point.type]);
        navigateToSharedPoint({
            regionKey: resolvedFromToken.regionKey,
            subregionKey: resolvedFromToken.point.subregId,
            pointId: resolvedFromToken.point.id,
        });
    } else if (pointParam) {
        const resolvedFromQueryPoint = await resolvePointShareTarget(pointParam);
        if (resolvedFromQueryPoint) {
            mergeFilterKeys([resolvedFromQueryPoint.point.type]);
            navigateToSharedPoint({
                regionKey: resolvedFromQueryPoint.regionKey,
                subregionKey: resolvedFromQueryPoint.point.subregId,
                pointId: resolvedFromQueryPoint.point.id,
            });
        } else if (filterParam) {
            navigateToSharedPoint({
                regionKey: navRegion || useRegion.getState().currentRegionKey,
                subregionKey: subregionParam || undefined,
                pointId: pointParam,
            });
        }
    } else if (resolvedFromType) {
        mergeFilterKeys([resolvedFromType.point.type]);
        navigateToSharedPoint({
            regionKey: resolvedFromType.regionKey,
            subregionKey: resolvedFromType.point.subregId,
            pointId: resolvedFromType.point.id,
        });
    } else if (typeParam) {
        mergeFilterKeys([typeParam]);
    }

    if (params.toString() || pathPointToken) cleanMapUrlState(pathPointToken);
};
