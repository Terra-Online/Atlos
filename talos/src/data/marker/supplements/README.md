# Map supplements

Static reference geometry, loaded separately from selected-marker behaviors.
`data/Wuling.json` groups `[wallId, tier, [start, end]]` records by subregion.
Endpoints use the existing `[mapZ, mapX]` coordinate order. The client draws one
open dashed segment, filters by visible subregion, and dims other map layers.
At overview zoom, segments have a 6 CSS pixel minimum length around the same
midpoint and adaptive dash spacing to retain two visible dashes. Stroke width
increases with map zoom from 1.5 to 3 CSS pixels, independent of wall length.
This affects only presentation; the sidecar endpoints keep their map coordinates.

Geometry is supplied as a processed artifact. Floor assignment is already encoded
in each segment. Endpoints describe a projected reference centerline, not a mesh
silhouette or an exact collision boundary.

Old-region walls may depend on quest state; the overlay shows reference geometry
and does not infer destruction from collectible progress. This geometry does not
add collectible markers or affect collection counts.

Other floors remain visible at reduced opacity (0.25 versus 0.85 on the current
floor). Wall hover uses the shared Popover and a single rich game glossary entry.
