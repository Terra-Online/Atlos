import { Layer, LayerGroup, Map, divIcon, icon } from "leaflet";
import { MARKER_TYPE_DICT } from "../../../data/marker"

import "./marker.scss"
import { getMarkerIconUrl } from "../../../utils/resource";

const DEFAULT_ICON = divIcon({
    iconSize: [50, 50],
    iconAnchor: [25, 25],
    popupAnchor: [0, 0],
    className: "custom-marker-icon",
    html: "<div class=\"default-marker-icon\"></div>"
})

/**
* @constant
* @type {Record<string, import("leaflet").Icon>}
*/
export const MARKER_ICON_DICT = Object.values(MARKER_TYPE_DICT).reduce((acc, type) => {
    // change this to remove default icon
    if (!type.key.endsWith("spot")) {
        acc[type.key] = DEFAULT_ICON
        return acc
    }
    const iconUrl = getMarkerIconUrl(type.key)
    if (type.noFrame) {
        acc[type.key] = icon({
            iconUrl,
            iconSize: [84, 84],
            iconAnchor: [42, 42],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
        })
    }
    else acc[type.key] = divIcon({
        // iconUrl,
        iconSize: [50, 50],
        iconAnchor: [25, 25],
        popupAnchor: [0, 0],
        tooltipAnchor: [0, 0],
        className: "custom-marker-icon",
        html: `<div class="marker-inner"><div class="custom-marker-icon-border"></div><div class="custom-marker-icon-bg" style="background-image: url(${iconUrl})"></div></div>`
    })
    return acc
}
    , {})




// renderer
/**
 * @constant
 * @type {Record<string, (markerData: import("./marker.type").IMarkerData) => Layer>}
 */
const RENDERER_DICT = {
    "__DEFAULT": (markerData) => {
        const layer = new L.Marker(markerData.position, { icon: MARKER_ICON_DICT[markerData.type], alt: markerData.type })
        return layer
    },
    "sub_icon": (markerData) => {
        const layer = new L.Marker(markerData.position, { icon: MARKER_ICON_DICT[markerData.type], alt: markerData.type })
        const sub = markerData.type.split("_")[0]
        layer.bindTooltip(
            `<div class="tooltip-inner"><div class="bg"></div><div class="image"  style="background-image:  url(${getMarkerIconUrl(`sub/${sub}`)})"></div></div>`,
            { permanent: true, className: "custom-tooltip", direction: "right" }
        ).openTooltip()

        return layer

    },
}


/**
 * 
 * @param {import("./marker.type").IMarkerData} markerData 
 */
export function getMarkerLayer(markerData) {
    // edit here to change renderer
    if (/^.*_spot$/.test(markerData.type)) {
        return RENDERER_DICT["sub_icon"](markerData)
    } else {
        return RENDERER_DICT["__DEFAULT"](markerData)
    }

}