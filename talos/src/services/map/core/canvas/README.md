# Internal Canvas renderer

This is Atlos's internal Canvas renderer. `canvasMarkerStyle.ts` maps the official CSS class names. These modules are implementation details, not a public rendering or styling API.

- `markerViewport`: Leaflet membership and semantic event nodes.
- `canvasMarkerSurface`: scene lifecycle, hit testing, visibility, display density and drawing coordination.
- `canvasMarkerPaint`: official artwork, typography and cached raster sprites. Settled opaque pulses reuse frame/foreground artwork and a shared ring clock; fades and geometry changes retain the original composite path. Sprite density is independent of viewport density; small sprites use at least 2× sampling, while the viewport uses `max(2, devicePixelRatio)`. Hit testing remains in CSS pixels.
- `canvasSpriteBatch`: instanced GPU composition into a stable scratch canvas sized to the viewport buffer. A small viewport/scissor renders each damaged rectangle at the bottom-left of that buffer; a cropped, clipped `copy` replaces the corresponding visible pixels, including transparency. Dirty rectangles never resize the drawing buffer. No CPU pixel readback is used in rendering. The surface owns the pure Canvas2D fallback.
- `canvasMarkerMotion`: shared animation channels without shared mutable marker state.
- `clusterGroup`, `spatialClusters`, `canvasMarkerCluster`: spatial grouping and expansion to authored positions.

Display changes invalidate cached poses without replacing marker identities or restarting animation channels.

Semantic mutations are compared against the current artwork, motion, opacity and stack
before invalidating pixels. No-op class writes must not turn retained pans into repaint loops.
Region retirement releases Leaflet render objects while the data loader retains raw data.
After region transitions settle, unused decoded assets are dropped and live atlas slots
are repacked only when at least half the texture allocation can be released.

The connected semantic tree is clipped under the map's event container, outside the moving Leaflet pane. Both elements and their pseudo-elements have CSS animation/transition work disabled; visible animation belongs exclusively to the Canvas scene. Keep keyboard and delegated link events connected when changing this containment boundary.

Damage bounds include shadows and decorations. All intersecting points are drawn in their existing order, including static points behind/above a pulse. Layer splitting is restricted to group opacity 1 because independently fading overlapping parts would change their appearance. Per-part atlas bindings must be released on representation changes, visibility changes and removal.


The renderer uses shared immutable artwork and retained panning by default. A bounded
weak index reuses sprites still owned by entries after they leave the 512-item strong
cache; it does not share mutable animation state. The index is capped at 2048 keys and
cleared when display density changes or the map is destroyed.

The pan cache requests 128 CSS pixels of padding, capped at 150% of viewport backing
pixels. While the camera stays inside that coverage, Leaflet moves the retained image;
exhausted coverage triggers a synchronous repaint. Zooms temporarily remove the padding.
Hit tests, viewport exit events and cluster transitions use the corresponding viewport
coordinates. There are no URL renderer switches or alternate experiment implementations.
The Canvas2D compatibility fallback remains available for unavailable/lost WebGL contexts.

Changes in this stage are Atlos-only. `scripts/bench-runtime.mjs` compares frozen production
builds and optionally records a long-session replay, GC snapshots and DOM/listener counts.
Its results and heap snapshots are local ignored files; runtime code has no dependency
on them. Renderer stats do not poll `getError()`.
