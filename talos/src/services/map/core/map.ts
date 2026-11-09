import { isRegionSwitching, setRegionSwitching } from '@/services/map/regionLifecycle';
import { REGION_DICT } from '@/data/map';
import { TILE_SIZE } from '@/data/map/tiles';
import L from 'leaflet';
import { MarkerLayer } from '@/services/map/core/marker/markerLayer';
import { IMapView } from '@/services/map/types';
import { getTileResourceUrl, type TileSource } from '@/services/assets/resource';
import useViewState from '@/store/viewState';
import { IMarkerData } from '@/data/marker';
import { SubregionBoundaryManager } from '@/services/map/core/boundary';
import { getLayerTileSuffix, useLayerStore, type LayerType } from '@/store/layer';
import { getAvailableLayers, getMaxTileZoom, getRegionTileCoverage, hasSatelliteTiles } from '@/services/map/tileCoverage';
import { enableSmoothWheelZoom } from '@/services/map/core/smoothWheelZoom';
import { SmoothTileLayer } from '@/services/map/core/smoothTileLayer';
import { CoverageBounds } from '@/services/map/core/coverageBounds';

export interface IMapOptions {
    onSwitchCurrentMarker?: (marker: IMarkerData) => void;
    initialView?: { regionId: string; view: IMapView };
}

interface RegionSwitchWaiter {
    regionId: string;
    resolve: (applied: boolean) => void;
    reject: (error: unknown) => void;
}

const getMaxZoomOffset = (regionId: string): number => {
    if (regionId === 'Valley_4' || regionId === 'Wuling') {
        return 1.5;
    }
    return 1;
};

// Keep this switch explicit so the short zoom tail can be tuned independently.
const ENABLE_ZOOM_INERTIA = true;

export class MapCore {
    markerLayer!: MarkerLayer;
    map!: L.Map;

    currentRegionId!: string;
    private boundaryManager!: SubregionBoundaryManager;
    private mainTileLayer?: L.TileLayer;
    private layerTileLayer?: L.TileLayer;
    private currentLayer: LayerType = 'M';
    private tileSource: TileSource = 'clips';
    private coverageBounds: CoverageBounds;

    private destroyed = false;
    private wheelZoom: ReturnType<typeof enableSmoothWheelZoom>;
    private requestedRegionId: string | null = null;
    private switchRegionPromise: Promise<void> | null = null;
    private regionWaiters: RegionSwitchWaiter[] = [];
    private layerRequestId = 0;
    private initialView?: IMapOptions['initialView'];

    constructor(ele: HTMLDivElement, options?: IMapOptions) {
        this.initialView = options?.initialView;
        this.map = L.map(ele, {
            crs: L.CRS.Simple,
            minZoom: 0,
            maxZoom: 3,
            zoomControl: false,
            attributionControl: false,
            doubleClickZoom: false,
            scrollWheelZoom: false,
            zoomAnimation: true,
            markerZoomAnimation: true,
            fadeAnimation: true,
            zoomSnap: 0,
            zoomDelta: 0.25,
        });

        this.coverageBounds = new CoverageBounds(this.map);
        this.wheelZoom = enableSmoothWheelZoom(this.map, {
            enableInertia: ENABLE_ZOOM_INERTIA,
            constrainPan: (center, zoom) => this.coverageBounds.pan(center, zoom),
            constrainZoom: (center, zoom) => this.coverageBounds.zoom(center, zoom),
        });

        this.markerLayer = new MarkerLayer(
            this.map,
            options?.onSwitchCurrentMarker,
        );

        this.boundaryManager = new SubregionBoundaryManager(this.map);

        this.map.on('moveend', () => {
            if (this.currentRegionId && !isRegionSwitching(this.map) && !this.coverageBounds.isOverdragged()) {
                useViewState.getState().saveViewState(this.currentRegionId, this.map);
            }
        });
    }

    switchRegion(regionId: string): Promise<boolean> {
        if (this.destroyed) return Promise.resolve(false);
        if (!REGION_DICT[regionId]) {
            return Promise.reject(new Error(`Region config not found for: ${regionId}`));
        }
        if (this.currentRegionId === regionId && !this.switchRegionPromise) {
            return Promise.resolve(true);
        }

        this.requestedRegionId = regionId;
        const result = new Promise<boolean>((resolve, reject) => {
            this.regionWaiters.push({ regionId, resolve, reject });
        });

        this.startRegionSwitches();
        return result;
    }

    private startRegionSwitches() {
        if (this.switchRegionPromise || this.destroyed || !this.requestedRegionId) return;
        this.switchRegionPromise = this.processRegionSwitches().finally(() => {
            this.switchRegionPromise = null;
            // Resolving a waiter can enqueue another request before this finally
            // runs. Drain that request instead of leaving it behind a completed job.
            this.startRegionSwitches();
        });
    }

    private settleRegionWaiters(
        regionId: string,
        applied: boolean,
        error?: unknown,
    ) {
        const remaining: RegionSwitchWaiter[] = [];
        for (const waiter of this.regionWaiters) {
            if (waiter.regionId !== regionId) {
                remaining.push(waiter);
            } else if (error !== undefined) {
                waiter.reject(error);
            } else {
                waiter.resolve(applied);
            }
        }
        this.regionWaiters = remaining;
    }

    private settleSupersededRegionWaiters(currentRegionId: string) {
        const supersededRegionIds = new Set(
            this.regionWaiters
                .map((waiter) => waiter.regionId)
                .filter((regionId) => regionId !== currentRegionId),
        );
        supersededRegionIds.forEach((regionId) => {
            this.settleRegionWaiters(regionId, false);
        });
    }

    private async processRegionSwitches(): Promise<void> {
        while (this.requestedRegionId) {
            const regionId = this.requestedRegionId;
            this.requestedRegionId = null;

            try {
                await this.performSwitchRegion(regionId);
            } catch (error) {
                if (!this.requestedRegionId) setRegionSwitching(this.map, false);
                this.settleRegionWaiters(regionId, false, error);
                if (this.requestedRegionId) {
                    this.settleSupersededRegionWaiters(this.requestedRegionId);
                }
                continue;
            }

            if (this.destroyed) break;
            const nextRegionId = this.requestedRegionId;
            if (nextRegionId && nextRegionId !== regionId) {
                this.settleRegionWaiters(regionId, false);
                this.settleSupersededRegionWaiters(nextRegionId);
                continue;
            }

            if (nextRegionId === regionId) {
                this.requestedRegionId = null;
            }
            this.settleSupersededRegionWaiters(regionId);
            this.applyStoredLayer(regionId);
            setRegionSwitching(this.map, false);
            this.map.fire('talos:regionSwitched', { regionId });
            this.settleRegionWaiters(regionId, true);
        }
    }

    private async performSwitchRegion(regionId: string): Promise<void> {
        // Finish the old camera before changing the coordinate space or its identity.
        this.wheelZoom.cancel();
        this.map.stop();
        if (this.currentRegionId && !isRegionSwitching(this.map)) {
            useViewState.getState().saveViewState(this.currentRegionId, this.map);
        }
        let view = useViewState.getState().getViewState(regionId);
        setRegionSwitching(this.map, true);
        this.coverageBounds.clear();
        this.map.fire('talos:regionSwitchStart', { regionId });
        this.currentRegionId = regionId;
        this.mainTileLayer?.remove();
        this.layerTileLayer?.remove();
        this.boundaryManager.clear();

        const config = REGION_DICT[regionId];

        // switchRegion validates this before queuing the operation.
        if (!config) throw new Error(`Region config not found for: ${regionId}`);

        if (config.coordZoom === undefined) {
            throw new Error(
                `Invalid region config for: ${regionId}. Missing coordZoom.`,
            );
        }

        const targetLayer = this.getAvailableLayer(regionId, useLayerStore.getState().currentLayer);
        this.tileSource = this.getTileSource(regionId, targetLayer);
        const maxZoom = this.updateCameraLimits(targetLayer);
        const initial = this.initialView;
        this.initialView = undefined;
        if (initial?.regionId === regionId
            && [initial.view.lat, initial.view.lng, initial.view.zoom].every(Number.isFinite)) {
            view = initial.view;
        }
        if (
            view &&
            view.lat !== undefined &&
            view.lng !== undefined &&
            view.zoom !== undefined
        ) {
            const clampedZoom = Math.max(this.map.getMinZoom(), Math.min(view.zoom, maxZoom));
            this.map.setView([view.lat, view.lng], clampedZoom, {
                animate: false,
            });
        } else {
            if (
                !config.initialCenter ||
                config.initialZoom === undefined
            ) {
                throw new Error(
                    `Invalid region config for: ${regionId}. Missing required properties. Config: ${JSON.stringify(config)}`,
                );
            }
            const clampedZoom = Math.min(config.initialZoom, maxZoom);
            this.map.setView([config.initialCenter.lat, config.initialCenter.lng], clampedZoom, {
                animate: false,
            });
        }

        this.mainTileLayer = this.createTileLayer(this.tileSource).addTo(this.map);
        this.layerTileLayer = undefined;
        this.currentLayer = 'M';

        // A region is ready when its map state and marker data are committed. Tile
        // image downloads continue independently and expose Leaflet's loading events.
        await this.markerLayer.changeRegion(regionId, () => !this.destroyed
            && (!this.requestedRegionId || this.requestedRegionId === regionId));
    }
    setMapView(view: IMapView) {
        this.map.stop();
        this.map.setView([view.lat, view.lng], view.zoom);
    }

    showSubregionBoundaries() {
        this.boundaryManager.showBoundaries(this.currentRegionId);
    }

    hideSubregionBoundaries() {
        this.boundaryManager.hideBoundaries();
    }

    enableMarkerClustering() {
        this.markerLayer.enableClustering();
    }

    disableMarkerClustering() {
        this.markerLayer.disableClustering();
    }

    private applyStoredLayer(regionId: string) {
        const configuredLayer = useLayerStore.getState().currentLayer;
        const targetLayer = this.getAvailableLayer(regionId, configuredLayer);
        if (targetLayer !== configuredLayer) {
            useLayerStore.getState().setCurrentLayer(targetLayer);
        }
        this.applyLayer(targetLayer);
    }

    private getAvailableLayer(regionId: string, layer: LayerType): LayerType {
        return getAvailableLayers(regionId).includes(layer) ? layer : 'M';
    }

    private getTileSource(regionId: string, layer: LayerType): TileSource {
        return layer === 'M' && useLayerStore.getState().satellite && hasSatelliteTiles(regionId)
            ? 'satellite' : 'clips';
    }

    private updateCameraLimits(layer: LayerType) {
        const coverage = getRegionTileCoverage(this.currentRegionId, this.tileSource);
        const suffixes = layer === 'M' ? [''] : ['', getLayerTileSuffix(layer)];
        const maxNativeZoom = getMaxTileZoom(coverage, suffixes);
        this.coverageBounds.setCoverage({
            coverage,
            suffixes,
            tileSize: TILE_SIZE,
            maxNativeZoom,
        });
        const maxZoom = maxNativeZoom + getMaxZoomOffset(this.currentRegionId);
        // A base with fewer native levels must still display beneath a detailed floor.
        for (const tiles of [this.mainTileLayer, this.layerTileLayer]) {
            if (tiles) tiles.options.maxZoom = Math.ceil(maxZoom);
        }
        // Avoid a queued zoom animation arriving after a source/region switch.
        if (this.map.getZoom() > maxZoom) this.map.setZoom(maxZoom, { animate: false });
        this.map.setMaxZoom(maxZoom);
        return maxZoom;
    }

    private createTileLayer(source: TileSource, suffix = ''): L.TileLayer {
        const coverage = getRegionTileCoverage(this.currentRegionId, source);
        return new SmoothTileLayer(
            getTileResourceUrl(`${this.currentRegionId}/{z}/{x}_{y}${suffix}.webp`, source),
            {
                tileSize: TILE_SIZE,
                noWrap: true,
                pane: 'tilePane',
                zIndex: suffix ? 2 : 1,
                maxNativeZoom: getMaxTileZoom(coverage, [suffix]),
                // Leaflet rounds fractional map zooms when choosing a tile level.
                maxZoom: Math.ceil(this.map.getMaxZoom()),
                errorTileUrl: 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAP8B/wE=',
            },
            coverage,
            suffix,
        );
    }

    private applyLayer(layer: LayerType) {
        const source = this.getTileSource(this.currentRegionId, layer);
        if (this.currentLayer === layer && this.tileSource === source) return;

        const sourceChanged = this.tileSource !== source;
        this.wheelZoom.cancel();
        this.map.stop();
        this.tileSource = source;
        this.updateCameraLimits(layer);
        this.layerTileLayer?.remove();
        this.layerTileLayer = undefined;
        if (sourceChanged) {
            this.mainTileLayer?.remove();
            this.mainTileLayer = this.createTileLayer(source).addTo(this.map);
        }
        const container = this.mainTileLayer?.getContainer();
        if (container) container.style.filter = layer === 'M' ? 'brightness(1)' : 'brightness(0.5)';
        if (layer !== 'M') {
            this.layerTileLayer = this.createTileLayer('clips', getLayerTileSuffix(layer)).addTo(this.map);
        }
        this.currentLayer = layer;
        this.coverageBounds.refresh();
        this.markerLayer.updateLayerTier(layer);
        this.map.fire('talos:layerSwitched', { layer });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.requestedRegionId = null;
        this.layerRequestId++;
        this.regionWaiters.splice(0).forEach((waiter) => waiter.resolve(false));
        this.wheelZoom.dispose();
        this.coverageBounds.dispose();
        this.boundaryManager.destroy();
        this.markerLayer.destroy();
        this.map.remove();
        setRegionSwitching(this.map, false);
    }

    async switchLayer(layer: LayerType): Promise<void> {
        const requestId = ++this.layerRequestId;
        while (this.switchRegionPromise) await this.switchRegionPromise;
        if (this.destroyed || requestId !== this.layerRequestId) return;
        const targetLayer = this.getAvailableLayer(this.currentRegionId, layer);
        if (targetLayer !== layer) {
            useLayerStore.getState().setCurrentLayer(targetLayer);
        }
        this.applyLayer(targetLayer);
    }
}
