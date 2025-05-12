import { Layer, LayerGroup, Map, divIcon, icon } from "leaflet";
import { MARKER_TYPE_DICT } from "../../../data/marker"

import "./marker.scss"
import { getMarkerIconUrl, getMarkerSubIconUrl } from "../../../utils/resource";
import LOGGER from "../../../utils/log";
import { useMarkerStore } from "./marker";

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
    // if (!type.key.endsWith("spot")) {
    //     acc[type.key] = DEFAULT_ICON
    //     return acc
    // }
    const iconUrl = getMarkerIconUrl(type.key)
    if (type.noFrame) {
        acc[type.key] = icon({
            iconUrl,
            iconSize: [60, 60],
            iconAnchor: [30, 30],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
        })
    }
    else acc[type.key] = divIcon({
        // iconUrl,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, 0],
        tooltipAnchor: [0, 0],
        className: "custom-marker-icon",
        html: `<div class="marker-inner"><div class="custom-marker-icon" style="background-image: url(${iconUrl})"></div></div>`
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
        layer.addEventListener("click", (e) => {
            e.originalEvent.stopPropagation()
            useMarkerStore.setState({currentActivePoint: markerData})
            LOGGER.debug("marker clicked", markerData)
        })
        return layer
    },
    "sub_icon": (markerData) => {
        const layer = new L.Marker(markerData.position, { icon: MARKER_ICON_DICT[markerData.type], alt: markerData.type })
        const sub = MARKER_TYPE_DICT[markerData.type].subIcon
        layer.bindTooltip(
            `<div class="tooltip-inner"><div class="bg"></div><div class="image"  style="background-image:  url(${getMarkerSubIconUrl(sub)})"></div></div>`,
            { permanent: true, className: "custom-tooltip", direction: "right" }
        ).openTooltip()
        layer.addEventListener("click", (e) => {
            e.originalEvent.stopPropagation()

            useMarkerStore.setState({currentActivePoint: markerData})
            LOGGER.debug("marker clicked", markerData)
        })

        return layer

    },
}


/**
 * 
 * @param {import("./marker.type").IMarkerData} markerData 
 */
export function getMarkerLayer(markerData) {
    const type = MARKER_TYPE_DICT[markerData.type]
    if (!type) {
        LOGGER.warn("marker type not found", markerData.type)
        return RENDERER_DICT["__DEFAULT"](markerData)
    }
    if (type.subIcon) {
        return RENDERER_DICT["sub_icon"](markerData)
    } else {
        return RENDERER_DICT["__DEFAULT"](markerData)
    }

}