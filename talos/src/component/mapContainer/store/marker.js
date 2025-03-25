import { Layer, LayerGroup, Map } from "leaflet";
import TYPE_DICT from "../../../data/types.json"
import { MAP_CONFIGS } from "../map_config"

const MARKER_TYPE_KEY_ARRAY = Object.values(TYPE_DICT).map(v => Object.values(v).map(v1 => Object.keys(v1))).flat().flat();
/**
 * @type {string[]}
 */
const MAP_SUBREGION_KEY_ARRAY = Object.keys(MAP_CONFIGS).map(regionId => MAP_CONFIGS[regionId].subregions.map(subregion => subregion.key)).flat();

export class MarkerLayer {
    /**
     * @type {Map}
     */
    map
    /**
     * @type {Record<string, LayerGroup>}
     */
    layerSubregionDict = {}

    /**
     * marker唯一id到Layer映射
     * @type {Record<string, Layer>}
     */
    markerDict = {}

    /**
     * marker唯一id到markerData映射
     * @type {Record<string, import("./marker.type").IMarkerData>}
     */
    markerDataDict = {}

    /**
     * type唯一id到markerId映射
     * @type {Record<string, string[]>}
     */
    markerTypeMap = {}

    /**
     * 
     * @param {Map} map 
     */
    constructor(map) {
        this.map = map
        this.markerTypeMap = MARKER_TYPE_KEY_ARRAY.reduce((acc, key) => {
            acc[key] = [];
            return acc;
        }, {});

        this.layerSubregionDict = MAP_SUBREGION_KEY_ARRAY.reduce((acc, key) => {
            acc[key] = new LayerGroup([], { pane: "markerPane" });
            // acc[key].addTo(this.layer);
            return acc;
        }, {})
    }

    /**
     * 导入marker列表
     * @param {import("./marker.type").IMarkerData[]} markers 
     */
    importMarker(markers) {
        markers.forEach(marker => {
            const typeKey = marker.type.key;
            const layer = new L.Marker(marker.position, { icon: MARKER_ICON_DICT[typeKey], alt: typeKey }) // TODO fix icon
            this.markerDict[marker.id] = layer;
            this.markerDataDict[marker.id] = marker;
            this.markerTypeMap[typeKey].push(marker.id);
            // layer.addTo(this.layerSubregionDict[marker.region.sub]);
        });
    }

    changeRegion(regionId) {
        Object.values(this.layerSubregionDict).forEach(layer => {
            layer.remove();
        });
        MAP_CONFIGS[regionId].subregions.forEach(subregion => {
            this.layerSubregionDict[subregion.key].addTo(this.map)
        })
    }

    filterMarker(typeKeys) {
        const markerIds = typeKeys.flatMap(key => this.markerTypeMap[key]);
        Object.entries(this.markerDict).forEach(([id, layer]) => {
            if (markerIds.includes(id)) {
                layer.addTo(this.layerSubregionDict[this.markerDataDict[id].region.sub]);
            } else {
                layer.remove();
            }
        });
    }
}