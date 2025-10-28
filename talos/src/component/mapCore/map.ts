import { REGION_DICT } from '@/data/map';
import L from 'leaflet';
import { MarkerLayer } from './marker/markerLayer';
import { IMapView } from './type';
import { getTileResourceUrl } from '@/utils/resource';
import useViewState from '@/store/viewState';
import { IMarkerData } from '@/data/marker';

export interface IMapOptions {
    onSwitchCurrentMarker?: (marker: IMarkerData) => void;
}

export class MapCore {
    markerLayer!: MarkerLayer;
    map!: L.Map;

    currentRegionId!: string;

    private transforming = false;

    constructor(ele: HTMLDivElement, options?: IMapOptions) {
        this.map = L.map(ele, {
            crs: L.CRS.Simple,
            minZoom: 0,
            maxZoom: 3,
            zoomControl: false,
            attributionControl: false,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            wheelPxPerZoomLevel: 50,
            wheelDebounceTime:0,
        });

        this.markerLayer = new MarkerLayer(
            this.map,
            options?.onSwitchCurrentMarker,
        );

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

    switchRegion(regionId: string) {
        this.currentRegionId = regionId;

        this.map.eachLayer((layer) => this.map.removeLayer(layer));

        const config = REGION_DICT[regionId];

        // 验证配置存在
        if (!config) {
            throw new Error(`Region config not found for: ${regionId}`);
        }

        const view = useViewState.getState().getViewState(regionId);
        if (
            view &&
            view.lat !== undefined &&
            view.lng !== undefined &&
            view.zoom !== undefined
        ) {
            this.map.setView([view.lat, view.lng], view.zoom, {
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
                    config.dimensions[0] / 2 + config.initialOffset.x,
                    config.dimensions[1] / 2 + config.initialOffset.y,
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
            this.map.setView([center.lat, center.lng], config.initialZoom, {
                animate: false,
            });
        }

        const southWest = this.map.unproject(
            [0, config.dimensions[1]],
            config.maxZoom,
        );
        const northEast = this.map.unproject(
            [config.dimensions[0], 0],
            config.maxZoom,
        );

        const mapBounds = L.latLngBounds(southWest, northEast);
        
        L.tileLayer(getTileResourceUrl(`/clips/${regionId}/{z}/{x}_{y}.webp`), {
            tileSize: config.tileSize,
            noWrap: true,
            bounds: mapBounds,
            pane: 'tilePane',
        }).addTo(this.map);

        this.markerLayer.changeRegion(regionId);
    }

    setMapView(view: IMapView) {
        if (this.transforming) return;
        this.transforming = true;
        this.map.setView([view.lat, view.lng], view.zoom);
        setTimeout(() => {
            this.transforming = false;
        }, 100);
    }
}
