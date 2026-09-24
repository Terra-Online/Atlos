import type { MapCore } from '@/component/mapCore/map';
import L, { type Map as LeafletMap } from 'leaflet';
import useRegion from '@/store/region';
import { useMarkerStore } from '@/store/marker';
import { findMarkerById } from '@/data/marker';
import { REGION_DICT } from '@/data/map';

// A marker link focuses one content item.
export type MarkerContentTarget = { kind: 'image'; id: string } | { kind: 'comment'; id: string };

export interface MarkerNavigationOptions {
    content?: MarkerContentTarget;
}

export interface SharedPointTarget extends MarkerNavigationOptions {
    regionKey: string;
    subregionKey?: string;
    pointId: string;
}

export interface SharedLocationTarget {
    regionKey: string;
    center: [number, number];
    zoom?: number;
}

type PendingNavigation =
    | { kind: 'point'; target: SharedPointTarget }
    | { kind: 'location'; target: SharedLocationTarget };

const TARGET_ZOOM = 3.0;

let mapCoreRef: MapCore | null = null;
let pendingNavigation: PendingNavigation | null = null;
let isNavigating = false;

const wait = (ms: number) =>
    new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });

const waitForMoveEnd = (map: LeafletMap, timeoutMs = 1400): Promise<void> =>
    new Promise((resolve) => {
        let done = false;
        let timeoutId = 0;

        const finish = () => {
            if (done) return;
            done = true;
            map.off('moveend', finish);
            window.clearTimeout(timeoutId);
            resolve();
        };

        timeoutId = window.setTimeout(finish, timeoutMs);
        map.once('moveend', finish);
    });

const normalizeTarget = (target: SharedPointTarget): SharedPointTarget => ({
    regionKey: target.regionKey,
    subregionKey: target.subregionKey,
    pointId: String(target.pointId),
    content: target.content,
});

const navigateToPoint = async (target: SharedPointTarget): Promise<void> => {
    const regionStore = useRegion.getState();
    if (regionStore.currentRegionKey !== target.regionKey) {
        regionStore.setCurrentRegion(target.regionKey);
    }

    if (!mapCoreRef) {
        pendingNavigation = { kind: 'point', target };
        return;
    }

    const mapCore = mapCoreRef;

    const regionApplied = await mapCore.switchRegion(target.regionKey);
    if (regionApplied === false) return;

    if (target.subregionKey) {
        useRegion.getState().setCurrentSubregion(target.subregionKey);
    }

    let markerData = mapCore.markerLayer.markerDataDict[target.pointId];
    for (let i = 0; !markerData && i < 20; i++) {
        await wait(50);
        markerData = mapCore.markerLayer.markerDataDict[target.pointId];
    }
    if (!markerData) return;

    const markerStore = useMarkerStore.getState();
    const nextFilter = markerStore.filter.includes(markerData.type)
        ? markerStore.filter
        : [...markerStore.filter, markerData.type];
    if (nextFilter !== markerStore.filter) {
        markerStore.setFilter(nextFilter);
    }
    mapCore.markerLayer.filterMarker(nextFilter);
    await mapCore.markerLayer.ensureMarkerVisible(target.pointId);

    // Ensure detail panel has the focused target.
    useMarkerStore.getState().setCurrentActivePoint(markerData);
    if (target.content?.kind === 'image') {
        useMarkerStore.getState().openMarkerImage(markerData.id, target.content.id);
    } else if (target.content?.kind === 'comment') {
        useMarkerStore.getState().openMarkerComment(markerData.id, target.content.id);
    }

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
        await mapCore.markerLayer.ensureMarkerVisible(target.pointId);
        const started = mapCore.markerLayer.startMarkerPulse(target.pointId);
        if (started) return;
        await wait(80);
    }
};

const navigateToLocation = async (target: SharedLocationTarget): Promise<void> => {
    const regionStore = useRegion.getState();
    if (regionStore.currentRegionKey !== target.regionKey) {
        regionStore.setCurrentRegion(target.regionKey);
    }

    if (!mapCoreRef) {
        pendingNavigation = { kind: 'location', target };
        return;
    }

    const mapCore = mapCoreRef;
    const regionApplied = await mapCore.switchRegion(target.regionKey);
    if (regionApplied === false) return;

    const center = L.latLng(target.center[0], target.center[1]);
    const configuredBounds = mapCore.map.options.maxBounds;
    if (
        configuredBounds
        && typeof (configuredBounds as L.LatLngBounds).contains === 'function'
        && !(configuredBounds as L.LatLngBounds).contains(center)
    ) return;

    const region = REGION_DICT[target.regionKey];
    const requestedZoom = target.zoom ?? region?.initialZoom ?? mapCore.map.getZoom();
    const zoom = Math.min(
        mapCore.map.getMaxZoom(),
        Math.max(mapCore.map.getMinZoom(), requestedZoom),
    );
    mapCore.map.flyTo(center, zoom, { animate: true, duration: 0.9 });
};

const flushPendingNavigation = async (): Promise<void> => {
    if (isNavigating || !pendingNavigation || !mapCoreRef) return;

    const navigation = pendingNavigation;
    pendingNavigation = null;
    isNavigating = true;
    try {
        if (navigation.kind === 'point') await navigateToPoint(navigation.target);
        else await navigateToLocation(navigation.target);
    } finally {
        isNavigating = false;
        if (pendingNavigation) {
            void flushPendingNavigation();
        }
    }
};

export const registerSharedPointMapCore = (mapCore: MapCore): void => {
    mapCoreRef = mapCore;
    void flushPendingNavigation();
};

/**
 * Return the live map core registered by the map component. Lightweight map
 * overlays use this to coordinate with the existing marker layer without
 * owning a second marker registry.
 */
export const getSharedPointMapCore = (): MapCore | null => mapCoreRef;

export const navigateToSharedPoint = (target: SharedPointTarget): void => {
    const normalizedTarget = normalizeTarget(target);
    const regionStore = useRegion.getState();
    if (regionStore.currentRegionKey !== normalizedTarget.regionKey) {
        regionStore.setCurrentRegion(normalizedTarget.regionKey);
    }
    pendingNavigation = { kind: 'point', target: normalizedTarget };
    void flushPendingNavigation();
};

export const navigateToSharedLocation = (target: SharedLocationTarget): void => {
    const normalizedTarget: SharedLocationTarget = {
        regionKey: target.regionKey,
        center: [Number(target.center[0]), Number(target.center[1])],
        zoom: target.zoom,
    };
    if (!Number.isFinite(normalizedTarget.center[0]) || !Number.isFinite(normalizedTarget.center[1])) {
        return;
    }
    const regionStore = useRegion.getState();
    if (regionStore.currentRegionKey !== normalizedTarget.regionKey) {
        regionStore.setCurrentRegion(normalizedTarget.regionKey);
    }
    pendingNavigation = { kind: 'location', target: normalizedTarget };
    void flushPendingNavigation();
};

export const navigateToMarkerId = async (pointId: string, options: MarkerNavigationOptions = {}): Promise<boolean> => {
    const point = await findMarkerById(String(pointId));
    if (!point) return false;

    const regionKey = Object.entries(REGION_DICT).find(([, region]) => (
        region.subregions.includes(point.subregId)
    ))?.[0];
    if (!regionKey) return false;

    navigateToSharedPoint({
        regionKey,
        subregionKey: point.subregId,
        pointId: point.id,
        content: options.content,
    });
    return true;
};
