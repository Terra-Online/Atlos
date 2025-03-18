// Initialization store for map instance and basic configurations
import { create } from 'zustand';
import L from 'leaflet';
import { getTileResourceUrl } from "../../../utils/resource";
import { MAP_CONFIGS, DEFAULT_CONFIG } from '../map_config';

const useIni = create((set, get) => ({
    map: null,
    isInitialized: false,
    isChangingView: false,
    // initialize map
    initMap: (elementId, region, config) => {
        const initialMap = L.map(elementId, {
            crs: L.CRS.Simple,
            minZoom: 0,
            maxZoom: config.maxZoom,
            zoomControl: false,
            attributionControl: false,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            wheelPxPerZoomLevel: 10
        });
        // set boundary
        const southWest = initialMap.unproject([0, config.dimensions[1]], config.maxZoom);
        const northEast = initialMap.unproject([config.dimensions[0], 0], config.maxZoom);
        initialMap.setMaxBounds(new L.LatLngBounds(southWest, northEast));

        set({
            map: initialMap,
            isInitialized: true,
        });

        return initialMap;
    },
    // transfer tile layer
    addTileLayer: (region, config) => {
        const { map } = get();
        if (!map) return null;

        map.eachLayer(layer => map.removeLayer(layer));

        const southWest = map.unproject([0, config.dimensions[1]], config.maxZoom);
        const northEast = map.unproject([config.dimensions[0], 0], config.maxZoom);

        return L.tileLayer(getTileResourceUrl(`/clips/${region}/{z}/{x}_{y}.webp`), {
            tileSize: config.tileSize,
            noWrap: true,
            bounds: L.latLngBounds(southWest, northEast)
        }).addTo(map);
    },

    // orbit control
    setMapView: (center, zoom, options = {}) => {
        const { map } = get();
        if (!map) return;

        set({ isChangingView: true });
        map.setView(center, zoom, options);
        // delay to avoid conflict
        setTimeout(() => {
            set({ isChangingView: false });
        }, 100);
    },

    cleanup: () => {
        const { map } = get();
        if (map) {
            map.remove();
        }
        set({ map: null, isInitialized: false });
    }
}));

export default useIni;