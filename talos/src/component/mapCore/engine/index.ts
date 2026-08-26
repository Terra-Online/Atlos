import './talos-map.scss';

export { Point, point, toPoint } from './point';
export {
    LatLng,
    LatLngBounds,
    latLng,
    latLngBounds,
    toLatLng,
    toLatLngBounds,
    type LatLngExpression,
    type LatLngBoundsExpression,
} from './latlng';
export { DivIcon, ImageIcon, divIcon, icon, type CompatIcon } from './icon';
export {
    CompatEvented,
    CompatLayer,
    CompatMarker,
    CompatLayerGroup,
    CompatPolygon,
    CompatRectangle,
    CompatImageOverlay,
    layerGroup,
    polygon,
    rectangle,
    imageOverlay,
    type OverlayHost,
    type CompatMarkerOptions,
    type CompatLayerGroupOptions,
    type CompatPathOptions,
    type CompatImageOverlayOptions,
} from './overlay';
export { TalosMap, type TalosMapOptions, type TalosMouseEvent } from './talosMap';
export {
    SmoothGestures,
    enableSmoothGestures,
    type SmoothGesturesOptions,
} from './gestures';
export {
    TILE_ZOOM_OFFSET,
    createRegionTransform,
    projectPx,
    unprojectPx,
    gameToLngLat,
    lngLatToGame,
    type RegionTransform,
} from './coords';
