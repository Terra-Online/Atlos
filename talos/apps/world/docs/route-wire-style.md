# Emissive route cable

The visual target is the mobile game's simplified glowing ground cable. An almost opaque core and a restrained 1.5 CSS-pixel halo replace the woven material. Core whitening and moving highlights are deliberately subtle. A gentle travelling highlight runs over the core. The shader uses no material textures, scene lighting, contact-shadow approximation or bloom pass.

Connected action colours blend on either side of their shared boundary, over up to 8 CSS pixels per side, capped at half the projected run length. Both sides meet at the same midpoint colour. Disconnected runs retain their own colours. The depth rule uses 22 CSS-pixel strokes and 10-pixel gaps, with a continuous phase across route edges. Covered strokes use 50% opacity without a halo. Hide occluded still removes covered sections.

Render-only quadratic bends trim up to 25 cm, capped at one quarter of either neighbouring edge. Shared colour boundaries split the same curve at its midpoint. Planner points and playback data stay authoritative. Contact-box outlines bypass smoothing.

Cable radius is 4.5 cm at the default style width, projected using camera depth and field of view. A 0.45 CSS-pixel minimum radius preserves distant traces and a 1.5-times-style-width cap limits extreme close-ups. Width varies between projected endpoints.

The renderer caches rounded geometry when the overlay is created. Each display edge uses one quad and an 80-byte instance with neighbouring colours and projected run distances. The shader uses existing scene depth. It writes premultiplied colour and coverage to a reusable RGBA8 layer with maximum blending, then composites that layer once. This avoids accumulated halo brightness at segment caps and bends. The additional render target costs four bytes per output pixel per active route renderer and one fullscreen composite pass; it is resized and disposed with the renderer. Animated overlays advance under a stationary camera and respect the viewer animation pause setting.
