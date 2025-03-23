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
    return acc
}
    , {})

/**
 * map mapKey to markerLayer
 * @type {Record<string, Record<string, import("leaflet").LayerGroup>>}
 */
export const GLOBAL_MARKER_LAYER_GROUP_DICT = Object.keys(MAP_CONFIGS).reduce((acc, regionId) => {
    acc[regionId] = {}
    // 当该区域存在子区域时，为所有子区域创建marker layer
    if (MAP_CONFIGS[regionId].subregions) {
        MAP_CONFIGS[regionId].subregions.forEach((subregion => { acc[regionId][subregion.id] = new L.LayerGroup([], { pane: "markerPane" }) }))
    }
    // 否则两层key均取regionId，创建一个marker layer 
    else {
        acc[regionId][regionId] = new L.LayerGroup([], { pane: "markerPane" })
    }
    return acc
}, {})


/**
 * @var {import("leaflet").LayerGroup}
 */
let currentLayerGroup = null

export function switchMarkerLayer(map, regionId, subRegionId) {
    if (currentLayerGroup) {
        currentLayerGroup.removeFrom(map)
    }
    currentLayerGroup = GLOBAL_MARKER_LAYER_GROUP_DICT[regionId][subRegionId]
    currentLayerGroup.addTo(map)
}



/**
 * Adds a marker to the map.
 *
 * @param {string} regionId - The key of the region.
 * @param {string} subRegionId - The key of the subRegion.
 * @param {string} type - The type of the marker.
 * @param {LatLng} latlng - The latitude and longitude of the marker.
 */
export function addMarker(regionId, subRegionId, type, latlng) {
    if (!type) {
        console.error(`Invalid marker type: ${type}`)
        return
    } else if (!latlng) {
        console.error(`Invalid latlng: ${latlng}`)
        return
    }
    const layerGroup = GLOBAL_MARKER_LAYER_GROUP_DICT[regionId][subRegionId]
    // 使用alt存储marker的type信息
    const marker = new L.Marker(latlng, { icon: MARKER_ICON_DICT[type], alt: type })
    marker.addTo(layerGroup)
    // 再次点击时删除
    marker.addEventListener("click", (e) => {
        e.originalEvent.stopPropagation()
        marker.removeFrom(layerGroup)
    })
}

/**
 * @param {string} regionId - The key of the map. empty string means all maps.
 * @param {string} subRegionId - The key of the subRegion.
 * @returns {import("./type").IMapMarkerData[]}  return marker currently set to the map
 */
export function collectMarkerData(regionId, subRegionId) {
    /**
     * @constant
     * @type {import("./type").IMapMarkerData[]}
     */
    const ret = []
    const handleLayer = (regionId, subRegionId, layerGroup) => {
        layerGroup.eachLayer((layer) => {
            if (layer instanceof L.Marker) {
                const { lat, lng } = layer.getLatLng()
                ret.push({
                    type: layer.options.alt,
                    regionId: regionId,
                    subRegionId: subRegionId,
                    pos: [lat, lng]
                })
            }
        })
    }
    if (!regionId || typeof regionId !== "string")
        Object.entries(GLOBAL_MARKER_LAYER_GROUP_DICT).
            forEach(([regionId, value]) => {
                Object.entries(value)
                    .forEach(([subRegionId, layerGroup]) => { handleLayer(regionId, subRegionId, layerGroup) })
            })
    else {
        handleLayer(regionId, subRegionId, GLOBAL_MARKER_LAYER_GROUP_DICT[regionId][subRegionId])
    }
    return ret
}

/**
 * 
 * @param {string} regionId - The regionId of the map. empty string means all maps.
 * @param {string} subRegionId - The key of the subRegion.
 */
export function clearMarker(regionId, subRegionId) {
    if (!regionId || typeof regionId !== "string")
        Object.values(GLOBAL_MARKER_LAYER_GROUP_DICT)
            .forEach((value) => Object.values(value).forEach((layerGroup) => layerGroup.clearLayers()))
    else GLOBAL_MARKER_LAYER_GROUP_DICT[regionId][subRegionId].clearLayers()
}