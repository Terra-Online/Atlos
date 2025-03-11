import L, { LatLng } from "leaflet"

/**
 * @constant
 * @type {Record<string, import("./type").IMapMarkerTypeData>}
 */
import MARKER_TYPE_DATA from "./markerType.json"
import { getMarkerIconUrl } from "../../../utils/resource"
import { MAP_CONFIGS } from "../map_config"

/**
 * @constant
 * @type {Record<string, import("leaflet").Icon>}
 */
const MARKER_ICON_DICT = Object.values(MARKER_TYPE_DATA).reduce((acc, type) => {
    const { iconSize, iconAnchor, popupAnchor } = type.icon
    const iconUrl = getMarkerIconUrl(type.key)

    acc[type.key] = L.icon({
        iconUrl,
        iconSize,
        iconAnchor,
        popupAnchor,
    })
    console.log(iconUrl)
    return acc
}
    , {})

/**
 * map mapKey to markerLayer
 * @type {Record<string, import("leaflet").LayerGroup>}
 */
export const GLOBAL_MARKER_LAYER_GROUP_DICT = Object.keys(MAP_CONFIGS).reduce((acc, mapKey) => {
    // 为每个区域地图生成一个LayerGroup以存储Marker
    acc[mapKey] = new L.LayerGroup([], { pane: "markerPane" })
    return acc
}, {})



/**
 * Adds a marker to the map.
 *
 * @param {string} mapKey - The key of the map.
 * @param {string} type - The type of the marker.
 * @param {LatLng} latlng - The latitude and longitude of the marker.
 */
export function addMarker(mapKey, type, latlng) {
    if (!type) {
        console.error(`Invalid marker type: ${type}`)
        return
    } else if (!latlng) {
        console.error(`Invalid latlng: ${latlng}`)
        return
    }
    // 使用alt存储marker的type信息
    const marker = new L.Marker(latlng, { icon: MARKER_ICON_DICT[type], alt: type })
    marker.addTo(GLOBAL_MARKER_LAYER_GROUP_DICT[mapKey])
    // 再次点击时删除
    marker.addEventListener("click", (e) => {
        e.originalEvent.stopPropagation()
        marker.removeFrom(GLOBAL_MARKER_LAYER_GROUP_DICT[mapKey])
    })
}

/**
 * @param {string} mapKey - The key of the map. empty string means all maps.
 * @returns {import("./type").IMapMarkerData[]}  return marker currently set to the map
 */
export function collectMarkerData(mapKey) {
    /**
     * @constant
     * @type {import("./type").IMapMarkerData[]}
     */
    const ret = []
    const handleLayer = ([key, layerGroup]) => {
        layerGroup.eachLayer((layer) => {
            if (layer instanceof L.Marker) {
                const { lat, lng } = layer.getLatLng()
                ret.push({
                    type: layer.options.alt,
                    mapKey: key,
                    pos: [lat, lng]
                })
            }
        })
    }
    if (!mapKey || typeof mapKey !== "string") Object.entries(GLOBAL_MARKER_LAYER_GROUP_DICT).map(handleLayer)
    else {
        handleLayer([mapKey, GLOBAL_MARKER_LAYER_GROUP_DICT[mapKey]])
    }
    return ret
}

/**
 * 
 * @param {string} mapKey - The key of the map. empty string means all maps.
 */
export function clearMarker(mapKey) {
    if (!mapKey || typeof mapKey !== "string") Object.values(GLOBAL_MARKER_LAYER_GROUP_DICT).forEach((layerGroup) => layerGroup.clearLayers())
    else GLOBAL_MARKER_LAYER_GROUP_DICT[mapKey].clearLayers()
}