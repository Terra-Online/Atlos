import { REGION_DICT, type IMapRegion } from '@/data/map';
import { MarkerLayer } from './marker/markerLayer';
import { IMapView } from './type';
import { getTileResourceUrl } from '@/utils/resource';
import useViewState from '@/store/viewState';
import { IMarkerData } from '@/data/marker';
import { SubregionBoundaryManager } from '@/component/map/boundary';
import type { LayerType } from '@/store/layer';
import { enableSmoothGestures } from './engine/gestures';
import { TalosMap, unprojectPx } from './engine';
import { latLngBounds } from './engine/latlng';

export interface IMapOptions {
    onSwitchCurrentMarker?: (marker: IMarkerData) => void;
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

const toBoundsPx = (bounds: [[number, number], [number, number]]) => ({
    min: bounds[0],
    max: bounds[1],
});

export class MapCore {
    markerLayer!: MarkerLayer;
    map!: TalosMap;

    currentRegionId!: string;
    private boundaryManager!: SubregionBoundaryManager;
    private currentLayer: LayerType = 'M';

    private transforming = false;
    private switchingRegionId: string | null = null;
    private switchRegionPromise: Promise<void> | null = null;

    constructor(ele: HTMLDivElement, options?: IMapOptions) {
        this.map = new TalosMap(ele, {
            minZoom: 0,
            maxZoom: 3,
        });

        // Register every region up front so tile URL rewriting works for any
        // region and coordinate math is available before the first switch.
        Object.entries(REGION_DICT).forEach(([regionId, config]) => {
            this.map.registerRegion(regionId, config);
        });

        enableSmoothGestures(this.map, {
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

        // Dev tooling handle (loadDevTool declares this field on __TALOS_DEV__).
        if (typeof window !== 'undefined') {
            const devWindow = window as {
                __TALOS_DEV__?: { map?: TalosMap; mapCore?: unknown };
            };
            devWindow.__TALOS_DEV__ ??= {};
            devWindow.__TALOS_DEV__.mapCore = this;
        }
    }

    async switchRegion(regionId: string): Promise<void> {
        if (this.switchRegionPromise) {
            if (this.switchingRegionId === regionId) {
                return this.switchRegionPromise;
            }
            await this.switchRegionPromise;
        }

        if (this.currentRegionId === regionId) return;

        const promise = this.performSwitchRegion(regionId);
        this.switchingRegionId = regionId;
        this.switchRegionPromise = promise;

        try {
            await promise;
        } finally {
            if (this.switchRegionPromise === promise) {
                this.switchRegionPromise = null;
                this.switchingRegionId = null;
            }
        }
    }

    private async performSwitchRegion(regionId: string): Promise<void> {
        this.currentRegionId = regionId;

        this.map.eachLayer((layer) => this.map.removeLayer(layer));

        const config = REGION_DICT[regionId];

        // fallback for missing region config
        if (!config) {
            throw new Error(`Region config not found for: ${regionId}`);
        }

        if (config.maxZoom === undefined) {
            throw new Error(
                `Invalid region config for: ${regionId}. Missing maxZoom.`,
            );
        }

        this.map.activateRegion(regionId);

        // Keep zoom constraints in sync with region config.
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
            const center = unprojectPx(
                minPixelX + config.dimensions[0] / 2 + config.initialOffset.x,
                minPixelY + config.dimensions[1] / 2 + config.initialOffset.y,
                config.maxZoom,
            );
            const clampedZoom = Math.min(config.initialZoom, maxZoom);
            this.map.setView([center.lat, center.lng], clampedZoom, {
                animate: false,
            });
        }

        const southWest = unprojectPx(minPixelX, maxPixelY, config.maxZoom);
        const northEast = unprojectPx(maxPixelX, minPixelY, config.maxZoom);

        const mapBounds = latLngBounds(
            [southWest.lat, southWest.lng],
            [northEast.lat, northEast.lng],
        );

        // set map bounds to restrict panning
        this.map.setMaxBounds(mapBounds);

        this.map.setTiles({
            mainUrlTemplate: getTileResourceUrl(
                `/clips/${regionId}/{z}/{x}_{y}.webp`,
            ),
            layerUrlTemplate: null,
            boundsPx: toBoundsPx([
                [minPixelX, minPixelY],
                [maxPixelX, maxPixelY],
            ]),
        });
        this.currentLayer = 'M';

        const markerReady = this.markerLayer.changeRegion(regionId);

        // Resolve when base tiles finish initial load to signal readiness
        await Promise.all([markerReady, this.map.waitForTilesLoaded()]);

        // Notify external layers/tools that region switch finished.
        // MapCore clears all layers at the start of switchRegion, so any custom overlays
        // must re-attach after this point.
        this.map.fire('talos:regionSwitched', { regionId });
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

    async switchLayer(layer: LayerType): Promise<void> {
        if (this.currentLayer === layer) return;

        const config = REGION_DICT[this.currentRegionId];
        if (!config) return;

        this.map.setMainTilesDimmed(layer !== 'M');

        if (layer === 'M') {
            this.map.setLayerTiles(null, { min: [0, 0], max: [0, 0] });
        } else {
            const suffix = getLayerTileSuffix(layer);
            const [[minPixelX, minPixelY], [maxPixelX, maxPixelY]] =
                getRegionPixelBounds(config);
            this.map.setLayerTiles(
                getTileResourceUrl(
                    `/clips/${this.currentRegionId}/{z}/{x}_{y}${suffix}.webp`,
                ),
                toBoundsPx([
                    [minPixelX, minPixelY],
                    [maxPixelX, maxPixelY],
                ]),
            );
            await this.map.waitForTilesLoaded();
        }

        this.currentLayer = layer;
        this.markerLayer.updateLayerTier(layer);
        this.map.fire('talos:layerSwitched', { layer });
    }
}
