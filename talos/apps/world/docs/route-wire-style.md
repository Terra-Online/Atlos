# Woven route ribbon

Two mirrored diagonal bands form a diamond mesh over a substantial backing. Strands have 98% opacity and the spaces between them retain 78% opacity. Derivative filtering suppresses subpixel shimmer. Broad moving light and narrower streaks travel over the surface, independently of the depth-driven occlusion dashes. Their phase follows the route across colour boundaries.

The flat surface and shallow bevel use the current environment sun direction, transformed to camera space. A small soft screen-space shadow is gated by scene depth within 45 cm of the route. This approximates ground contact; it is not a world-space shadow-map caster and does not reproduce the game cable's full material lighting or receive scene shadow maps. The overlay still runs after scene tonemapping.

Render-only quadratic bends trim up to 25 cm, capped at one quarter of either neighbouring edge. Four subdivisions soften each bend. Shared colour boundaries split the same curve at its midpoint; disconnected runs, straight edges and reversals remain separate. Planner points and playback data are untouched. Contact-box outlines bypass smoothing.

The renderer caches rounded geometry when the overlay is created. It uses one quad per display segment, 48 bytes per instance, and one overlay pass. The mesh, surface lighting and contact shadow use arithmetic and the existing depth texture without new material textures or shadow passes. Animated overlays keep the viewer clock advancing under a stationary camera and respect the animation pause setting.
