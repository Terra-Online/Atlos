import { setLocale } from '@/locale';
import {
    findMarkerById,
    findUniqueArchiveMarkerByType,
    getMarkerSubregion,
    getUniqueArchivePointId,
    type IMarkerData,
    MARKER_TYPE_DICT,
} from '@/data/marker';
import { DEFAULT_REGION, REGION_DICT } from '@/data/map';
import useRegion from '@/store/region';
import { useMarkerStore } from '@/store/marker';
import { completeCurrentUserGuide } from '@/store/userGuide';
import { getLangFromUrlCode } from '@/lib/i18n/lang';
import { navigateToSharedLocation, navigateToSharedPoint } from '@/services/map/navigation';
import type { MarkerContentTarget } from '@/services/map/navigation';
import { SUBREGION_TO_REGION_MAP } from './protocol';
import { getCurrentLocale } from './runtime';
import { decodePointIdToken } from './pointToken';
import { buildCleanUrl } from './cleanup';
import { parseUrlState, type ParsedUrlState, type UrlLocationLike } from './parse';

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

/** Resolve the startup data target without committing routing or store changes. */
export const resolveInitialRegion = async (location: UrlLocationLike): Promise<string> => {
    const state = parseUrlState(location);
    const stored = useRegion.getState().currentRegionKey;
    const current = REGION_DICT[stored] ? stored : DEFAULT_REGION;
    const requested = state.regionKey && REGION_DICT[state.regionKey] ? state.regionKey : null;
    const regionForPoint = async (id: string) => {
        const subregion = await getMarkerSubregion(id);
        return subregion ? SUBREGION_TO_REGION_MAP[subregion] : undefined;
    };
    const tokenId = state.pointToken ? decodePointIdToken(state.pointToken) : null;
    if (tokenId) {
        const target = await regionForPoint(tokenId);
        if (target) return target;
    }
    if (state.pointId) {
        const target = await regionForPoint(state.pointId);
        if (target) return target;
        if (state.filterParam) return requested || current;
    } else if (state.typeKey) {
        const id = await getUniqueArchivePointId(state.typeKey);
        const target = id ? await regionForPoint(id) : null;
        if (target) return target;
    }
    if (state.coordinate && requested) return requested;
    return requested && current === DEFAULT_REGION ? requested : current;
};

const applyLanguage = async (state: ParsedUrlState): Promise<void> => {
    if (!state.languageCode || getCurrentLocale()) return;
    const locale = getLangFromUrlCode(state.languageCode);
    if (locale) await setLocale(locale);
};

const applyRegion = (state: ParsedUrlState): void => {
    if (state.regionKey) {
        const { currentRegionKey } = useRegion.getState();
        if (!currentRegionKey || currentRegionKey === 'Valley_4') {
            useRegion.getState().setCurrentRegion(state.regionKey);
        }
    }

    if (state.subregionKey && !useRegion.getState().currentSubregionKey) {
        useRegion.getState().setCurrentSubregion(state.subregionKey);
    }
};

const applyPointDestination = async (state: ParsedUrlState): Promise<boolean> => {
    const content: MarkerContentTarget | undefined = state.imageId
        ? { kind: 'image', id: state.imageId }
        : state.commentId
            ? { kind: 'comment', id: state.commentId }
            : undefined;
    const pointIdFromToken = state.pointToken
        ? decodePointIdToken(state.pointToken)
        : null;
    const resolvedFromToken = pointIdFromToken
        ? await resolvePointShareTarget(pointIdFromToken)
        : null;
    const resolvedFromType = state.typeKey
        ? await resolveArchiveTypeShareTarget(state.typeKey)
        : null;

    if (resolvedFromToken) {
        mergeFilterKeys([resolvedFromToken.point.type]);
        navigateToSharedPoint({
            regionKey: resolvedFromToken.regionKey,
            subregionKey: resolvedFromToken.point.subregId,
            pointId: resolvedFromToken.point.id,
            content,
        });
        return true;
    }

    if (state.pointId) {
        const resolvedFromQueryPoint = await resolvePointShareTarget(state.pointId);
        if (resolvedFromQueryPoint) {
            mergeFilterKeys([resolvedFromQueryPoint.point.type]);
            navigateToSharedPoint({
                regionKey: resolvedFromQueryPoint.regionKey,
                subregionKey: resolvedFromQueryPoint.point.subregId,
                pointId: resolvedFromQueryPoint.point.id,
                content,
            });
        } else if (state.filterParam) {
            navigateToSharedPoint({
                regionKey: state.regionKey || useRegion.getState().currentRegionKey,
                subregionKey: state.subregionKey || undefined,
                pointId: state.pointId,
                content,
            });
        }
        return Boolean(resolvedFromQueryPoint || state.filterParam);
    }

    if (resolvedFromType) {
        mergeFilterKeys([resolvedFromType.point.type]);
        navigateToSharedPoint({
            regionKey: resolvedFromType.regionKey,
            subregionKey: resolvedFromType.point.subregId,
            pointId: resolvedFromType.point.id,
            content,
        });
        return true;
    }

    if (state.typeKey) mergeFilterKeys([state.typeKey]);
    return false;
};

const applyLocationDestination = (state: ParsedUrlState): void => {
    if (!state.coordinate || !state.regionKey || !REGION_DICT[state.regionKey]) return;
    navigateToSharedLocation({
        regionKey: state.regionKey,
        center: state.coordinate,
        zoom: state.zoom ?? REGION_DICT[state.regionKey].initialZoom,
    });
};

export const applyUrlParams = async (): Promise<void> => {
    if (typeof window === 'undefined') return;

    const state = parseUrlState(window.location);
    suppressInitialAutoOverlays = state.hasMapUrlState;
    if (state.hasMapUrlState) completeCurrentUserGuide();

    await applyLanguage(state);
    mergeFilterKeys(state.filterKeys);
    applyRegion(state);
    const appliedPointDestination = await applyPointDestination(state);
    if (!appliedPointDestination) applyLocationDestination(state);

    if (state.hasSearchParams || state.pathPointToken) {
        window.history.replaceState(
            {},
            '',
            buildCleanUrl(window.location, state.pathPointToken),
        );
    }
};
