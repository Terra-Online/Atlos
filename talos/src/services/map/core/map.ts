import { isRegionSwitching, setRegionSwitching } from '@/services/map/regionLifecycle';
import { REGION_DICT, type IMapRegion } from '@/data/map';
import L from 'leaflet';
import { MarkerLayer } from '@/services/map/core/marker/markerLayer';
import { IMapView } from '@/services/map/types';
import { getTileResourceUrl } from '@/services/assets/resource';
import useViewState from '@/store/viewState';
import { IMarkerData } from '@/data/marker';
import { SubregionBoundaryManager } from '@/services/map/core/boundary';
import { getLayerTileSuffix, useLayerStore, type LayerType } from '@/store/layer';
import { getRegionTileCoverage } from '@/services/map/tileCoverage';
import { enableSmoothWheelZoom } from '@/services/map/core/smoothWheelZoom';
import { SmoothTileLayer } from '@/services/map/core/smoothTileLayer';

export interface IMapOptions {
    onSwitchCurrentMarker?: (marker: IMarkerData) => void;
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

const getRegionPixelBounds = (
    config: IMapRegion,
): [[number, number], [number, number]] => {
    const offsetX = config.boundsOffset?.x ?? 0;
    const offsetY = config.boundsOffset?.y ?? 0;
    return [
        [offsetX, offsetY],
        [offsetX + config.dimensions[0], offsetY + config.dimensions[1]],
    ];
};

export class MapCore {
    markerLayer!: MarkerLayer;
    map!: L.Map;

    currentRegionId!: string;
    private boundaryManager!: SubregionBoundaryManager;
    private mainTileLayer?: L.TileLayer;
    private layerTileLayer?: L.TileLayer;
    private currentLayer: LayerType = 'M';

    private destroyed = false;
    private wheelZoom: ReturnType<typeof enableSmoothWheelZoom>;
    private requestedRegionId: string | null = null;
    private switchRegionPromise: Promise<void> | null = null;
    private regionWaiters: RegionSwitchWaiter[] = [];
    private layerRequestId = 0;

    constructor(ele: HTMLDivElement, options?: IMapOptions) {
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

        this.wheelZoom = enableSmoothWheelZoom(this.map, {
            enableInertia: ENABLE_ZOOM_INERTIA,
        });

        this.markerLayer = new MarkerLayer(
            this.map,
            options?.onSwitchCurrentMarker,
        );

        this.boundaryManager = new SubregionBoundaryManager(this.map);

        this.map.on('moveend', () => {
            if (this.currentRegionId && !isRegionSwitching(this.map)) {
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
            setRegionSwitching(this.map, false);
            this.applyStoredLayer(regionId);
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
        const view = useViewState.getState().getViewState(regionId);
        setRegionSwitching(this.map, true);
        this.map.fire('talos:regionSwitchStart', { regionId });
        this.currentRegionId = regionId;
        this.map.setMaxBounds(null as unknown as L.LatLngBoundsExpression);
        this.mainTileLayer?.remove();
        this.layerTileLayer?.remove();
        this.boundaryManager.clear();

        const config = REGION_DICT[regionId];

        // switchRegion validates this before queuing the operation.
        if (!config) throw new Error(`Region config not found for: ${regionId}`);

        if (config.maxZoom === undefined) {
            throw new Error(
                `Invalid region config for: ${regionId}. Missing maxZoom.`,
            );
        }

        // Keep Leaflet's zoom constraints in sync with region config.
        // Otherwise users can zoom beyond available tiles (blank map).
        const maxNativeZoom = config.maxZoom;
        const maxZoom = maxNativeZoom + getMaxZoomOffset(regionId);
        this.map.setMaxZoom(maxZoom);

        const [[minPixelX, minPixelY], [maxPixelX, maxPixelY]] =
            getRegionPixelBounds(config);
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
                !config.dimensions ||
                !config.initialOffset ||
                config.maxZoom === undefined ||
                config.initialZoom === undefined
            ) {
                throw new Error(
                    `Invalid region config for: ${regionId}. Missing required properties. Config: ${JSON.stringify(config)}`,
                );
            }
            const center = this.map.unproject(
                [
                    minPixelX +
                        config.dimensions[0] / 2 +
                        config.initialOffset.x,
                    minPixelY +
                        config.dimensions[1] / 2 +
                        config.initialOffset.y,
                ],
                config.maxZoom,
            );
            if (
                !center ||
                center.lat === undefined ||
                center.lng === undefined
            ) {
                throw new Error(
                    `Invalid center coordinates for region: ${regionId}. Center: ${JSON.stringify(center)}`,
                );
            }
            const clampedZoom = Math.min(config.initialZoom, maxZoom);
            this.map.setView([center.lat, center.lng], clampedZoom, {
                animate: false,
            });
        }

        const southWest = this.map.unproject(
            [minPixelX, maxPixelY],
            config.maxZoom,
        );
        const northEast = this.map.unproject(
            [maxPixelX, minPixelY],
            config.maxZoom,
        );

        const mapBounds = L.latLngBounds(southWest, northEast);

        // set map bounds to restrict panning
        this.map.setMaxBounds(mapBounds);

        const coverage = getRegionTileCoverage(regionId);
        const tileLayer = new SmoothTileLayer(
            getTileResourceUrl(`/clips/${regionId}/{z}/{x}_{y}.webp`),
            {
                tileSize: config.tileSize,
                noWrap: true,
                bounds: mapBounds,
                pane: 'tilePane',
                maxNativeZoom: config.maxZoom,
                // Use Math.ceil so that Leaflet's internal Math.round(zoom) never
                // exceeds the tile layer's maxZoom (which would set _tileZoom to
                // undefined and silently skip tile loading at fractional max zoom).
                maxZoom: Math.ceil(maxZoom),
                // Use 1x1 transparent webp to suppress 404 console errors for missing tiles
                errorTileUrl:
                    'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAP8B/wE=',
            },
            coverage,
        ).addTo(this.map);

        // Store main tile layer reference
        this.mainTileLayer = tileLayer;
        this.layerTileLayer = undefined;
        this.currentLayer = 'M';

        // A region is ready when its map state and marker data are committed. Tile
        // image downloads continue independently and expose Leaflet's loading events.
        await this.markerLayer.changeRegion(regionId);
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
        const availableLayers = REGION_DICT[regionId]?.layers as
            | LayerType[]
            | undefined;
        return layer === 'M' || availableLayers?.includes(layer) ? layer : 'M';
    }

    private applyLayer(layer: LayerType) {
        if (this.currentLayer === layer) return;

        const config = REGION_DICT[this.currentRegionId];
        if (!config) return;

        // Remove existing layer tile layer if any
        if (this.layerTileLayer) {
            this.map.removeLayer(this.layerTileLayer);
            this.layerTileLayer = undefined;
        }

        // Update main tile layer visual
        if (this.mainTileLayer) {
            const container = this.mainTileLayer.getContainer();
            if (layer === 'M') {
                if (container) {
                    container.style.filter = 'brightness(1)';
                }
            } else {
                if (container) {
                    container.style.filter = 'brightness(0.5)';
                }

                // Add layer tile layer
                const suffix = getLayerTileSuffix(layer);
                const [[minPixelX, minPixelY], [maxPixelX, maxPixelY]] =
                    getRegionPixelBounds(config);
                const southWest = this.map.unproject(
                    [minPixelX, maxPixelY],
                    config.maxZoom,
                );
                const northEast = this.map.unproject(
                    [maxPixelX, minPixelY],
                    config.maxZoom,
                );
                const mapBounds = L.latLngBounds(southWest, northEast);
                const maxZoom =
                    config.maxZoom + getMaxZoomOffset(this.currentRegionId);

                this.layerTileLayer = new SmoothTileLayer(
                    getTileResourceUrl(
                        `/clips/${this.currentRegionId}/{z}/{x}_{y}${suffix}.webp`,
                    ),
                    {
                        tileSize: config.tileSize,
                        noWrap: true,
                        bounds: mapBounds,
                        pane: 'tilePane',
                        maxNativeZoom: config.maxZoom,
                        maxZoom: Math.ceil(maxZoom),
                        // Use 1x1 transparent webp to suppress 404 console errors for missing tiles
                        errorTileUrl:
                            'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAP8B/wE=',
                    },
                    getRegionTileCoverage(this.currentRegionId),
                    suffix,
                ).addTo(this.map);
            }
        }

        this.currentLayer = layer;
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
