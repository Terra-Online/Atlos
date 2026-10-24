import L from 'leaflet';

interface BoundsAwareMap extends L.Map {
    _limitCenter(
        center: L.LatLng,
        zoom: number,
        bounds: L.LatLngBounds,
    ): L.LatLng;
}

export const toMapBounds = (
    bounds: L.Map['options']['maxBounds'],
): L.LatLngBounds | null => {
    if (!bounds) return null;
    if (bounds instanceof L.LatLngBounds) return bounds;

    return Array.isArray(bounds) && bounds.length === 2
        ? L.latLngBounds(bounds[0], bounds[1])
        : null;
};

/**
 * Use Leaflet's own center constraint instead of checking all view corners.
 * At low zoom a legal viewport can be larger than maxBounds.
 */
export const isMapOverdragged = (
    map: L.Map,
    bounds: L.LatLngBounds,
): boolean => {
    const constrainedMap = map as BoundsAwareMap;
    const center = map.getCenter();
    const constrainedCenter = constrainedMap._limitCenter(
        center,
        map.getZoom(),
        bounds,
    );
    return (
        map
            .project(center, map.getZoom())
            .distanceTo(map.project(constrainedCenter, map.getZoom())) > 1
    );
};
