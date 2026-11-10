# Emissive route cable

The visual target is the mobile game's simplified glowing ground cable. An almost opaque bright core and a narrow coloured halo replace the woven material. A gentle travelling highlight runs over the core. The shader uses no material textures, scene lighting, contact-shadow approximation or bloom pass.

Connected action colours blend on either side of their shared boundary, over up to 8 CSS pixels per side, capped at half the projected run length. Both sides meet at the same midpoint colour. Disconnected runs retain their own colours. The depth rule uses 22 CSS-pixel strokes and 10-pixel gaps, with a continuous phase across route edges. Hide occluded still removes covered sections.

Render-only quadratic bends trim up to 25 cm, capped at one quarter of either neighbouring edge. Shared colour boundaries split the same curve at its midpoint. Planner points and playback data stay authoritative. Contact-box outlines bypass smoothing.

The renderer caches rounded geometry when the overlay is created. Each display edge uses one quad and an 80-byte instance with neighbouring colours and projected run distances. The shader uses the existing scene depth in one overlay pass. Animated overlays advance under a stationary camera and respect the viewer animation pause setting.
