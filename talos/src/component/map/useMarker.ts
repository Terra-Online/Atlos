import { useEffect, useRef } from 'react';
import { MapCore } from '../mapCore/map';
import { useMarkerStore } from '@/store/marker';
import { useUserRecord } from '@/store/userRecord';
import { useUiPrefsStore, useHideCompletedMarkers } from '@/store/uiPrefs';

const AUTO_CLUSTER_THRESHOLD = 300;
const AUTO_CLUSTER_FILTER_COUNT = 6;

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
    const prefsHideCompletedMarkers = useHideCompletedMarkers();
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
        const currentPoints = markerLayer
            ?.getCurrentPoints(currentRegion)
            .map((point) => point.id) ?? [];
        
        useMarkerStore.setState({ points: currentPoints });
    }, [filter, currentRegion, mapCore, prefsHideCompletedMarkers, collectedPoints]);

    // Auto-cluster logic: enable clustering if preference is on and visible markers > threshold
    useEffect(() => {
        const prefsAutoCluster = useUiPrefsStore.getState().prefsAutoClusterEnabled;
        if (!prefsAutoCluster) return;

        const markerLayer = mapCore?.markerLayer;
        if (!markerLayer) return;

        // Count visible markers after filtering
        const visibleMarkerCount = markerLayer.getVisibleMarkerCount();
        const triggerCluster = useUiPrefsStore.getState().triggerCluster;

        // Auto-enable clustering only when visible markers exceed threshold or multiple filters active
        const shouldAutoCluster =
            visibleMarkerCount > AUTO_CLUSTER_THRESHOLD || filter.length > AUTO_CLUSTER_FILTER_COUNT;

        if (shouldAutoCluster && !triggerCluster) {
            useUiPrefsStore.getState().setTriggerCluster(true);
        }
    }, [mapCore, filter]);

    useEffect(() => {
        const markerLayer = mapCore?.markerLayer;
        if (markerLayer) {
            markerLayer.updateCollectedPoints(collectedPoints);
        }
    }, [collectedPoints, mapCore]);
}