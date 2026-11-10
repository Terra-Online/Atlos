# Braided route ribbon

The visual reference is the dense, crossing yarn structure of [PET tight-weave cable sleeving](https://www.mj-ist.com/pet-tight-weave-expandable-braided-sleeving_p118.html). The route uses a flat ribbon with alternating over/under diagonal yarns, a gently crowned highlight and a dark edge. The selected action or validation state supplies the ribbon colour.

The fragment shader evaluates the weave procedurally. Derivative filtering softens fine yarn detail at low render resolution. A broad highlight moves along the route at 0.22 repeats per viewer-animation second, with one repeat every 96 CSS pixels. It adds light to the surface. Body opacity is 0.98, with antialiasing at the outer edge. The existing depth test opens the occlusion dashes, using 5 CSS-pixel strokes and 3-pixel gaps, and the Hide occluded option can discard covered fragments.

The braid has a 12 CSS-pixel pitch. Its phase accumulates independently from the shorter dash phase, continuing across movement/colour boundaries and polyline joins. Both phases follow the near-clipped, projected route and wrap at their own repeat lengths. CSS-pixel coordinates keep the weave legible across device pixel ratios. The viewer animation clock and animated-overlay registration provide movement under a stationary camera and pause with the viewer's animation setting.

The renderer uses one screen-space quad per segment and one overlay pass. Each instance occupies 48 bytes. The shader binds the viewport uniforms and existing scene-depth texture. The procedural material uses arithmetic surface shading within that pass.
