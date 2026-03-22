import type { MapCore } from '@/component/mapCore/map';
import type { Map as LeafletMap } from 'leaflet';
import useRegion from '@/store/region';
import { useMarkerStore } from '@/store/marker';

export interface SharedPointTarget {
    regionKey: string;
    subregionKey?: string;
    pointId: string;
}

const TARGET_ZOOM = 3.0;

let mapCoreRef: MapCore | null = null;
let pendingTarget: SharedPointTarget | null = null;
let isNavigating = false;

const wait = (ms: number) =>
    new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });

const waitForMoveEnd = (map: LeafletMap): Promise<void> =>
    new Promise((resolve) => {
        map.once('moveend', () => resolve());
    });

const normalizeTarget = (target: SharedPointTarget): SharedPointTarget => ({
    regionKey: target.regionKey,
    subregionKey: target.subregionKey,
    pointId: String(target.pointId),
});

const navigateToPoint = async (target: SharedPointTarget): Promise<void> => {
    if (!mapCoreRef) {
        pendingTarget = target;
        return;
    }

    const mapCore = mapCoreRef;
    const regionStore = useRegion.getState();

    if (mapCore.currentRegionId !== target.regionKey) {
        await mapCore.switchRegion(target.regionKey);
    }

    regionStore.setCurrentRegion(target.regionKey);
    if (target.subregionKey) {
        regionStore.setCurrentSubregion(target.subregionKey);
    }

    const markerData = mapCore.markerLayer.markerDataDict[target.pointId];
    if (!markerData) return;

    // Ensure detail panel has the focused target.
    useMarkerStore.getState().setCurrentActivePoint(markerData);

    const targetZoom = Math.min(TARGET_ZOOM, mapCore.map.getMaxZoom());
    const [lat, lng] = markerData.pos;
    const moving = waitForMoveEnd(mapCore.map);
    mapCore.map.flyTo([lat, lng], targetZoom, {
        animate: true,
        duration: 0.9,
    });
    await moving;

    // Marker DOM can appear slightly later after region/filter updates.
    for (let i = 0; i < 20; i++) {
        const started = mapCore.markerLayer.startMarkerPulse(target.pointId);
        if (started) return;
        await wait(80);
    }
};

const flushPendingNavigation = async (): Promise<void> => {
    if (isNavigating || !pendingTarget || !mapCoreRef) return;

    const target = pendingTarget;
    pendingTarget = null;
    isNavigating = true;
    try {
        await navigateToPoint(target);
    } finally {
        isNavigating = false;
        if (pendingTarget) {
            void flushPendingNavigation();
        }
    }
};

export const registerSharedPointMapCore = (mapCore: MapCore): void => {
    mapCoreRef = mapCore;
    void flushPendingNavigation();
};

export const navigateToSharedPoint = (target: SharedPointTarget): void => {
    pendingTarget = normalizeTarget(target);
    void flushPendingNavigation();
};
