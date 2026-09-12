# Internal Canvas renderer

This directory mirrors OEM-SDK `packages/map/src/atlos/canvas`; only `canvasMarkerStyle.ts` adapts the official CSS class names. These modules are implementation details, not a public rendering or styling API.

- `markerViewport`: Leaflet membership and semantic event nodes.
- `canvasMarkerSurface`: scene lifecycle, hit testing, visibility, display density and drawing coordination.
- `canvasMarkerPaint`: official artwork, typography and cached raster sprites. Sprite density is independent of viewport density; small sprites use at least 2× sampling, while the viewport uses `max(2, devicePixelRatio)`. The minimum Canvas render ratio is an internal constant independent of display DPR; hit testing remains in CSS pixels.
- `canvasSpriteBatch`: instanced GPU composition of those sprites, with Canvas2D fallback owned by the surface.
- `canvasMarkerMotion`: shared animation channels without shared mutable marker state.
- `clusterGroup`, `spatialClusters`, `canvasMarkerCluster`: spatial grouping and expansion to authored positions.

Keep matching renderer changes synchronized between repositories. Display changes invalidate cached poses without replacing marker identities or restarting animation channels.

The connected semantic tree is clipped under the map's event container, outside the moving Leaflet pane. Both elements and their pseudo-elements have CSS animation/transition work disabled; visible animation belongs exclusively to the Canvas scene. Keep keyboard and delegated link events connected when changing this containment boundary.
