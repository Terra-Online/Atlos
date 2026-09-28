import { REGION_DICT, type IMapRegion } from '@/data/map';
import L from 'leaflet';
import { MarkerLayer } from './marker/markerLayer';
import { IMapView } from './type';
import { getTileResourceUrl } from '@/services/assets/resource';
import useViewState from '@/store/viewState';
import { IMarkerData } from '@/data/marker';
import { SubregionBoundaryManager } from '@/component/map/boundary';
import { useLayerStore, type LayerType } from '@/store/layer';
import { getRegionTileCoverage } from '@/services/map/tileCoverage';
import { enableSmoothWheelZoom } from './smoothWheelZoom';
import { SmoothTileLayer } from './smoothTileLayer';

export interface IMapOptions {
    onSwitchCurrentMarker?: (marker: IMarkerData) => void;
}

interface RegionSwitchWaiter {
    regionId: string;
    resolve: (applied: boolean) => void;
    reject: (error: unknown) => void;
}

// Helper to convert layer type to tile suffix
const getLayerTileSuffix = (layer: LayerType): string => {
    if (layer === 'M') return '';
    return `_${layer.toLowerCase()}`;
};

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
    private boundaryLayer?: L.Rectangle;
    private boundaryManager!: SubregionBoundaryManager;
    private mainTileLayer?: L.TileLayer;
    private layerTileLayer?: L.TileLayer;
    private currentLayer: LayerType = 'M';

    private transforming = false;
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

        enableSmoothWheelZoom(this.map, {
            enableInertia: ENABLE_ZOOM_INERTIA,
        });

        this.markerLayer = new MarkerLayer(
            this.map,
            options?.onSwitchCurrentMarker,
        );

        this.boundaryManager = new SubregionBoundaryManager(this.map);

        this.map.on('moveend', () => {
            if (!this.transforming) {
                useViewState
                    .getState()
                    .saveViewState(this.currentRegionId, this.map);
            }
        });

        this.map.on('zoomend', () => {
            if (!this.transforming) {
                useViewState
                    .getState()
                    .saveViewState(this.currentRegionId, this.map);
            }
        });
    }

    switchRegion(regionId: string): Promise<boolean> {
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

        if (!this.switchRegionPromise) {
            this.switchRegionPromise = this.processRegionSwitches().finally(() => {
                this.switchRegionPromise = null;
            });
        }

        return result;
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
                this.settleRegionWaiters(regionId, false, error);
                if (this.requestedRegionId) {
                    this.settleSupersededRegionWaiters(this.requestedRegionId);
                }
                continue;
            }

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
            this.map.fire('talos:regionSwitched', { regionId });
            this.settleRegionWaiters(regionId, true);
        }
    }

    private async performSwitchRegion(regionId: string): Promise<void> {
        this.currentRegionId = regionId;

        this.map.eachLayer((layer) => this.map.removeLayer(layer));

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

        const view = useViewState.getState().getViewState(regionId);
        const [[minPixelX, minPixelY], [maxPixelX, maxPixelY]] =
            getRegionPixelBounds(config);
        if (
            view &&
            view.lat !== undefined &&
            view.lng !== undefined &&
            view.zoom !== undefined
        ) {
            const clampedZoom = Math.min(view.zoom, maxZoom);
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

        if (this.boundaryLayer) {
            this.map.removeLayer(this.boundaryLayer);
        }

        // visualize region boundary (for debugging)
        // this.boundaryLayer = L.rectangle(mapBounds, {
        //     color: '#000000',
        //     weight: 5,
        //     fillOpacity: 0,
        //     interactive: false,
        // }).addTo(this.map);

        // A region is ready when its map state and marker data are committed. Tile
        // image downloads continue independently and expose Leaflet's loading events.
        await this.markerLayer.changeRegion(regionId);
    }
    setMapView(view: IMapView) {
        if (this.transforming) return;
        this.transforming = true;
        const onEnd = () => {
            this.transforming = false;
            this.map.off('moveend', onEnd);
            this.map.off('zoomend', onEnd);
        };
        this.map.on('moveend', onEnd);
        this.map.on('zoomend', onEnd);
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

    async switchLayer(layer: LayerType): Promise<void> {
        const requestId = ++this.layerRequestId;
        await this.switchRegionPromise;
        if (requestId !== this.layerRequestId) return;
        const targetLayer = this.getAvailableLayer(this.currentRegionId, layer);
        if (targetLayer !== layer) {
            useLayerStore.getState().setCurrentLayer(targetLayer);
        }
        this.applyLayer(targetLayer);
    }
}
