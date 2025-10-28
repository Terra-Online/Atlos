import { useEffect, useRef } from 'react';
import { MapCore } from '../mapCore/map';
import { useMarkerStore } from '@/store/marker';
import { useUserRecord } from '@/store/userRecord';

/**
 * Hook for managing marker layer logic
 * Handles marker filtering and collected points updates
 */
export function useMarker(
    mapCore: MapCore | null,
    currentRegion: string,
    mapInitialized: boolean,
) {
    const { filter } = useMarkerStore();
    const collectedPoints = useUserRecord();
    const initialFilterApplied = useRef(false);

    // 第一次初始化时应用已保存的 filter
    useEffect(() => {
        if (mapCore && mapInitialized && !initialFilterApplied.current) {
            mapCore.markerLayer.initializeWithFilter(filter);
            initialFilterApplied.current = true;
        }
    }, [mapCore, mapInitialized, filter]);

    // 区域切换时重置 filter 应用标记
    useEffect(() => {
        initialFilterApplied.current = false;
    }, [currentRegion]);

    // 应用 filter 筛选
    useEffect(() => {
        const markerLayer = mapCore?.markerLayer;
        markerLayer?.filterMarker(filter);
        useMarkerStore.setState({
            points:
                markerLayer
                    ?.getCurrentPoints(currentRegion)
                    .map((point) => point.id) ?? [],
        });
    }, [filter, currentRegion, mapCore]);

    // 更新已收集的点位
    useEffect(() => {
        const markerLayer = mapCore?.markerLayer;
        if (markerLayer) {
            markerLayer.updateCollectedPoints(collectedPoints);
        }
    }, [collectedPoints, mapCore]);
}
