# Internal Canvas renderer

This is Atlos's internal Canvas renderer. `canvasMarkerStyle.ts` maps the official CSS class names. These modules are implementation details, not a public rendering or styling API.

- `markerModel`: explicit artwork (`SceneIcon`) and visual state, shared by both render backends.
- `markerViewport`: node-free Leaflet membership, positions, icon anchors and overlay ownership.
- `canvasMarkerSurface`: scene lifecycle, hit testing, visibility, display density and drawing coordination.
- `canvasMarkerPaint`: official artwork, typography and cached raster sprites. Settled opaque pulses reuse frame/foreground artwork and a shared ring clock; fades and geometry changes retain the original composite path. Sprite density is independent of viewport density; small sprites use at least 2× sampling, while the viewport uses `max(2, devicePixelRatio)`. Hit testing remains in CSS pixels.
- `canvasSpriteBatch`: instanced GPU composition into a stable scratch canvas sized to the viewport buffer. A small viewport/scissor renders each damaged rectangle at the bottom-left of that buffer; a cropped, clipped `copy` replaces the corresponding visible pixels, including transparency. Dirty rectangles never resize the drawing buffer. No CPU pixel readback is used in rendering. The surface owns the pure Canvas2D fallback.
- `canvasMarkerMotion`: shared animation channels without shared mutable marker state.
- `clusterGroup`, `spatialClusters`, `canvasMarkerCluster`: spatial grouping and expansion to authored positions.

Display changes invalidate cached poses without replacing marker identities or restarting animation channels.

Visual updates are compared against the current artwork, motion, opacity and stack
before invalidating pixels. No-op state writes must not turn retained pans into repaint loops.
Region retirement releases Leaflet render objects while the data loader retains raw data.
During a region transaction, old pixels retire before the camera changes and drawing
resumes when the complete new membership and stored layer are committed. Ordinary
camera moves still paint synchronously. Discrete zooms paint after all cluster
groups reconcile in the same event turn, using the previous rendered camera for
transition origins; continuous wheel/pinch updates retain their synchronous paint. An art-URL index scopes decoded-image
invalidation to its users; removal and icon replacement release those references.
Outgoing cluster poses are indexed by marker so rapid aggregate replacement does
not repeatedly scan every outgoing point.
After region transitions settle, unused decoded assets are dropped and live atlas slots
are repacked only when at least half the texture allocation can be released.

Points and aggregate representatives create no icon elements, including detached elements.
`ViewportMarker.getElement()` returns `undefined`; membership and visibility callers use
the map and cluster groups instead. `SceneIcon` retains Leaflet's icon anchor contract
without calling `createIcon()`. Ordinary markers, no-frame artwork, sub-icons, tier
labels and cluster counts all enter the painter directly. State lives with logical
markers while filtering or aggregation removes their visible representation. There is
no point DOM parser or MutationObserver synchronization channel.

The surface hit index dispatches the original input through Leaflet's Canvas event
adapter. Preserve its preclick, FeatureGroup propagation, coordinates and
`bubblingMouseEvents` behavior, and explicitly check Leaflet's drag suppression before
dispatching a click. Native map controls and separate DOM labels/locator markers retain
their own event paths.

A single clipped button under the map container provides a bounded keyboard proxy,
independent of point count. Arrow keys change its logical target, offscreen navigation
pans to that point, and native button activation uses the same marker event path. Its
focus survives camera moves; removing a target releases that reference. It is an initial
navigation representation, not a complete screen-reader catalogue. Pointer hit testing
and ordinary interaction do not create or focus proxies per point. Further accessibility
work must keep this bounded scene architecture.

Damage bounds include shadows and decorations. All intersecting points are drawn in their existing order, including static points behind/above a pulse. Layer splitting is restricted to group opacity 1 because independently fading overlapping parts would change their appearance. Per-part atlas bindings must be released on representation changes, visibility changes and removal.


The renderer uses shared immutable artwork and retained panning by default. A bounded
weak index reuses sprites still owned by entries after they leave the 512-item strong
cache; it does not share mutable animation state. The index is capped at 2048 keys and
cleared when display density changes or the map is destroyed.

The pan cache requests 128 CSS pixels of padding, capped at 150% of viewport backing
pixels. While the camera stays inside that coverage, Leaflet moves the retained image;
exhausted coverage triggers a synchronous repaint. Zooms retain that bounded backing
allocation to avoid driver stalls from shrinking and regrowing the drawing buffer.
Hit tests, viewport exit events and cluster transitions use the corresponding viewport
coordinates. There are no URL renderer switches or alternate experiment implementations.
The Canvas2D compatibility fallback remains available for unavailable/lost WebGL contexts.

Changes in this stage are Atlos-only. `scripts/bench-runtime.mjs` compares frozen production
builds and optionally records a long-session replay, GC snapshots and DOM/listener counts.
Its results and heap snapshots are local ignored files; runtime code has no dependency
on them. Renderer stats do not poll `getError()`.
