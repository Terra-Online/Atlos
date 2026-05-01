import { useEffect, useMemo, useRef, useState } from 'react';
import { MapCore } from '../mapCore/map';
import { useMarkerStore } from '@/store/marker';
import { useUserRecord } from '@/store/userRecord';
import { useUiPrefsStore, useHideCompletedMarkers } from '@/store/uiPrefs';
import { useLocatorStore } from '@/component/locator/state';
import { LOCATOR_CONFIG_UPDATED_EVENT, readEFTrackerConf, type EFTrackerScope } from '@/utils/endfield/config';
import { getLocatorReminderTypeKeys } from '@/component/locator/proximityReminder';

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
    const selectedPoints = useMarkerStore((state) => state.selectedPoints);
    const markerDataVersion = useMarkerStore((state) => state.markerDataVersion);
    const prefsHideCompletedMarkers = useHideCompletedMarkers();
    const locatorViewMode = useLocatorStore((state) => state.viewMode);
    const locatorPosition = useLocatorStore((state) => state.lastPosition);
    const [locatorConfigVersion, setLocatorConfigVersion] = useState(0);
    const initialFilterApplied = useRef(false);
    const prevSelectedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        const onConfigUpdated = () => setLocatorConfigVersion((version) => version + 1);
        window.addEventListener(LOCATOR_CONFIG_UPDATED_EVENT, onConfigUpdated as EventListener);
        return () => {
            window.removeEventListener(LOCATOR_CONFIG_UPDATED_EVENT, onConfigUpdated as EventListener);
        };
    }, []);

    const locatorReminderTypeKeys = useMemo(() => {
        void locatorConfigVersion;
        const config = readEFTrackerConf();
        const scopes: EFTrackerScope[] = config?.scope && config.scope.length ? config.scope : ['auto'];
        return getLocatorReminderTypeKeys(scopes);
    }, [locatorConfigVersion]);

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
    }, [filter, currentRegion, mapCore, prefsHideCompletedMarkers, collectedPoints, markerDataVersion]);

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

    // Update marker selected style based on selectedPoints changes
    useEffect(() => {
        const markerLayer = mapCore?.markerLayer;
        if (!markerLayer) return;

        const current = new Set(selectedPoints);

        const added = [...current].filter((id) => !prevSelectedRef.current.has(id));
        const removed = [...prevSelectedRef.current].filter((id) => !current.has(id));

        const changedSelectedPoints: { id: string; selected: boolean }[] = [];
        added.forEach((id) => {
            changedSelectedPoints.push({ id, selected: true });
        });
        removed.forEach((id) => {
            changedSelectedPoints.push({ id, selected: false });
        });

        if (changedSelectedPoints.length > 0) {
            markerLayer.updateSelectedMarkers(changedSelectedPoints);
        }

        // Update ref for next comparison
        prevSelectedRef.current = current;
    }, [selectedPoints, mapCore, markerDataVersion]);

    useEffect(() => {
        const markerLayer = mapCore?.markerLayer;
        if (!markerLayer) return;

        if (locatorViewMode === 'off' || !locatorPosition) {
            markerLayer.clearProximityReminder();
            return;
        }

        markerLayer.updateProximityReminder({
            currentRegion,
            subregionKey: locatorPosition.subregionKey,
            locatorProfile: locatorPosition.locatorProfile,
            position: {
                x: locatorPosition.gameX,
                y: locatorPosition.gameY,
                z: locatorPosition.gameZ,
            },
            typeKeys: locatorReminderTypeKeys,
        });
    }, [mapCore, currentRegion, locatorPosition, locatorReminderTypeKeys, locatorViewMode, collectedPoints, markerDataVersion]);
}
