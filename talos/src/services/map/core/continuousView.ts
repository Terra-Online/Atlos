import L from 'leaflet';

interface ZoomData {
    pinch: true;
    round: false;
}
const ZOOM_DATA: ZoomData = { pinch: true, round: false };

export interface ContinuousMap extends L.Map {
    _animatingZoom?: boolean;
    _getMapPanePos(): L.Point;
    _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point;
    _latLngToNewLayerPoint(
        latLng: L.LatLng,
        zoom: number,
        center: L.LatLng,
    ): L.Point;
    _limitZoom(zoom: number): number;
    _move(center: L.LatLng, zoom: number, data?: ZoomData): this;
    _moveEnd(zoomChanged: boolean): this;
    _moveStart(zoomChanged: boolean, noMoveStart: boolean): this;
    _onZoomTransitionEnd?(): void;
    _rawPanBy(offset: L.Point): void;
    _stop(): this;
}

interface SubpixelMarker {
    _icon?: HTMLElement;
    _latlng: L.LatLng;
    _map?: ContinuousMap;
    _setPos(point: L.Point): void;
}

let markerPositioningInstalled = false;

/** Shared subpixel coordinates for user-driven maps and passive camera-following maps. */
export const prepareContinuousMap = (map: L.Map): ContinuousMap => {
    const continuous = map as ContinuousMap;
    // Tiles and overlays must share subpixel space instead of rounding independently.
    continuous._getNewPixelOrigin = function (center, zoom) {
        return this.project(center, zoom)
            .subtract(this.getSize().divideBy(2))
            .add(this._getMapPanePos());
    };
    continuous.latLngToLayerPoint = function (latLng) {
        return this.project(latLng, this.getZoom()).subtract(
            this.getPixelOrigin(),
        );
    };
    if (!markerPositioningInstalled) {
        markerPositioningInstalled = true;
        const prototype = L.Marker.prototype as unknown as SubpixelMarker & {
            _animateZoom(event: { center: L.LatLng; zoom: number }): void;
            update(): SubpixelMarker;
        };
        prototype.update = function () {
            if (this._icon && this._map) {
                this._setPos(this._map.latLngToLayerPoint(this._latlng));
            }
            return this;
        };
        prototype._animateZoom = function (event) {
            if (!this._map) return;
            this._setPos(
                this._map._latLngToNewLayerPoint(
                    this._latlng,
                    event.zoom,
                    event.center,
                ),
            );
        };
    }
    return continuous;
};

/** Use Leaflet's pinch signal to retain resident and in-flight tiles during a gesture. */
export const moveContinuousView = (
    map: ContinuousMap,
    center: L.LatLng,
    zoom: number,
): void => {
    map._move(center, zoom, ZOOM_DATA);
};

/** Apply a passive sample; repeated setView would invalidate the grid and cancel pending tiles. */
export const setContinuousView = (
    map: ContinuousMap,
    center: L.LatLng,
    zoom: number,
): void => {
    const previous = map.getZoom();
    if (!Number.isFinite(previous)) {
        map.setView(center, zoom, { animate: false });
        return;
    }
    if (previous === zoom && map.getCenter().equals(center)) return;
    const zoomChanged = previous !== zoom;
    map._moveStart(zoomChanged, false);
    moveContinuousView(map, center, zoom);
    map._moveEnd(zoomChanged);
};
