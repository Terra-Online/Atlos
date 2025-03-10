import L, { LatLng } from "leaflet"

/**
 * @constant
 * @type {Record<string, import("./type").IMapMarkerTypeData>}
 */
import MARKER_TYPE_DATA from "./markerType.json"
import { getAssetsUrl } from "../../../utils/resource"

/**
 * @constant
 * @type {Record<string, import("leaflet").Icon>}
 */
const MARKER_ICON_DICT = Object.values(MARKER_TYPE_DATA).reduce((acc, type) => {
    const { iconSize, iconAnchor, popupAnchor } = type.icon
    const iconUrl = getAssetsUrl(type.icon.iconUrl)

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

export const GLOBAL_MARKER_LAYER_GROUP = new L.LayerGroup([], { pane: "markerPane" })


/**
 * Adds a marker to the map.
 *
 * @param {string} type - The type of the marker.
 * @param {LatLng} latlng - The latitude and longitude of the marker.
 */
export function addMarker(type, latlng) {
    if (!type) {
        console.error(`Invalid marker type: ${type}`)
        return
    } else if (!latlng) {
        console.error(`Invalid latlng: ${latlng}`)
        return
    }
    const marker = new L.Marker(latlng, { icon: MARKER_ICON_DICT[type] })
    marker.addTo(GLOBAL_MARKER_LAYER_GROUP)
    // 再次点击时删除
    marker.addEventListener("click", (e) => {
        e.originalEvent.stopPropagation()
        marker.remove()
    })
}