import { getLayerByTier, useLayerStore } from '@/store/layer';
import type { MapCore } from '@/services/map/core/map';
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
let finishCameraMove: (() => void) | null = null;
let navigationVersion = 0;

const waitForMoveEnd = (map: LeafletMap): Promise<void> => new Promise((resolve) => {
    const finish = () => {
        map.off('moveend unload', finish);
        if (finishCameraMove === finish) finishCameraMove = null;
        resolve();
    };
    finishCameraMove?.();
    finishCameraMove = finish;
    map.once('moveend unload', finish);
});

const beginNavigation = () => {
    navigationVersion++;
    pendingNavigation = null;
    finishCameraMove?.();
    mapCoreRef?.map.stop();
    return navigationVersion;
};

const normalizeTarget = (target: SharedPointTarget): SharedPointTarget => ({
    regionKey: target.regionKey,
    subregionKey: target.subregionKey,
    pointId: String(target.pointId),
    content: target.content,
});

const navigateToPoint = async (target: SharedPointTarget, isCurrent: () => boolean): Promise<void> => {
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
    if (regionApplied === false || !isCurrent()) return;

    if (target.subregionKey) {
        useRegion.getState().setCurrentSubregion(target.subregionKey);
    }

    const markerData = mapCore.markerLayer.markerDataDict[target.pointId];
    if (!markerData) return;
    const targetLayer = getLayerByTier(markerData.tier ?? 0);
    if (targetLayer) {
        useLayerStore.getState().setCurrentLayer(targetLayer);
        await mapCore.switchLayer(targetLayer);
        if (!isCurrent()) return;
    }

    const markerStore = useMarkerStore.getState();
    const nextFilter = markerStore.filter.includes(markerData.type)
        ? markerStore.filter
        : [...markerStore.filter, markerData.type];
    if (nextFilter !== markerStore.filter) {
        markerStore.setFilter(nextFilter);
    }
    mapCore.markerLayer.filterMarker(nextFilter);
    await mapCore.markerLayer.ensureMarkerVisible(target.pointId);
    if (!isCurrent()) return;

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
    if (!isCurrent()) return;

    await mapCore.markerLayer.ensureMarkerVisible(target.pointId);
    if (isCurrent()) mapCore.markerLayer.startMarkerPulse(target.pointId);
};

const navigateToLocation = async (target: SharedLocationTarget, isCurrent: () => boolean): Promise<void> => {
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
    if (regionApplied === false || !isCurrent()) return;

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
    if (!pendingNavigation || !mapCoreRef) return;
    const navigation = pendingNavigation;
    pendingNavigation = null;
    const version = navigationVersion;
    const owner = mapCoreRef;
    const isCurrent = () => version === navigationVersion && mapCoreRef === owner;
    if (navigation.kind === 'point') await navigateToPoint(navigation.target, isCurrent);
    else await navigateToLocation(navigation.target, isCurrent);
};

export const registerSharedPointMapCore = (mapCore: MapCore): (() => void) => {
    finishCameraMove?.();
    mapCoreRef = mapCore;
    void flushPendingNavigation();
    return () => {
        if (mapCoreRef !== mapCore) return;
        mapCoreRef = null;
        navigationVersion++;
        finishCameraMove?.();
    };
};

/**
 * Return the live map core registered by the map component. Lightweight map
 * overlays use this to coordinate with the existing marker layer without
 * owning a second marker registry.
 */
export const getSharedPointMapCore = (): MapCore | null => mapCoreRef;

export const navigateToSharedPoint = (target: SharedPointTarget): void => {
    beginNavigation();
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
    beginNavigation();
    const regionStore = useRegion.getState();
    if (regionStore.currentRegionKey !== normalizedTarget.regionKey) {
        regionStore.setCurrentRegion(normalizedTarget.regionKey);
    }
    pendingNavigation = { kind: 'location', target: normalizedTarget };
    void flushPendingNavigation();
};

export const navigateToMarkerId = async (pointId: string, options: MarkerNavigationOptions = {}): Promise<boolean> => {
    const version = beginNavigation();
    const point = await findMarkerById(String(pointId));
    if (!point || version !== navigationVersion) return false;

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
