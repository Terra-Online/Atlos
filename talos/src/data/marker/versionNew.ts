import diffData from './diff.generated.json';
import { MARKER_TYPE_DICT, type IMarkerType } from './index';
import { getLoadedRegionMarkers } from './index';
import useRegion from '@/store/region';
import { useMarkerStore } from '@/store/marker';
import { useDisplayedPointProgress } from '@/store/guideProgress';
import { useMemo } from 'react';

export type VersionNewRule = string;

export interface VersionNewFilterConfig {
    key: string;
    titleKey: string;
}

export interface VersionNewFilterGroup extends VersionNewFilterConfig {
    types: IMarkerType[];
}

export type VersionNewDiffType = {
    key: string;
    markerIds: string[];
    count: number;
};

export const VERSION_NEW_FILTER_CONFIGS = [
    {
        key: 'version-new',
        titleKey: 'sidebar.newlyAdded',
    },
] satisfies VersionNewFilterConfig[];

type VersionNewGeneratedData = {
    types?: [string, ...Array<string | number>][];
};

const generatedData = diffData as unknown as VersionNewGeneratedData;

export const VERSION_NEW_TYPE_MAP: Record<string, VersionNewDiffType> = Object.fromEntries(
    (generatedData.types ?? []).filter((row) => row.length >= 2).map(([key, ...rest]) => {
        const count = Number(rest[rest.length - 1] ?? 0);
        const markerIds = rest.slice(0, -1).map(String);
        return [key, { key, markerIds, count }];
    }),
);

export const getVersionNewType = (typeKey: string): VersionNewDiffType | undefined =>
    VERSION_NEW_TYPE_MAP[typeKey];

export const useVersionNewMarkerCounts = (): Record<string, { total: number; collected: number }> => {
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const pointsRecord = useDisplayedPointProgress();
    const markerDataVersion = useMarkerStore((state) => state.markerDataVersion);

    return useMemo(() => {
        void markerDataVersion;
        if (!currentRegion) return {};

        const regionMarkers = getLoadedRegionMarkers(currentRegion);
        const regionMarkerIds = new Set(regionMarkers.map((marker) => marker.id));
        const collectedIds = new Set(pointsRecord);

        return Object.fromEntries(
            Object.values(VERSION_NEW_TYPE_MAP).map((diffType) => {
                const markerIds = diffType.markerIds.filter((id) => regionMarkerIds.has(id));
                const collected = markerIds.filter((id) => collectedIds.has(id)).length;
                return [diffType.key, { total: markerIds.length, collected }];
            }),
        );
    }, [currentRegion, markerDataVersion, pointsRecord]);
};

const resolveVersionNewFilterTypes = (config: VersionNewFilterConfig): IMarkerType[] => {
    return Object.values(MARKER_TYPE_DICT).filter((typeInfo) => {
        void config;
        if (!VERSION_NEW_TYPE_MAP[typeInfo.key]) return false;
        return true;
    });
};

export const VERSION_NEW_FILTER_GROUPS: VersionNewFilterGroup[] = VERSION_NEW_FILTER_CONFIGS
    .map((config) => ({
        ...config,
        types: resolveVersionNewFilterTypes(config),
    }))
    .filter((group) => group.types.length > 0);
