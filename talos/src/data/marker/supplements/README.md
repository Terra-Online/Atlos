# Map supplements

Static reference geometry, loaded separately from selected-marker behaviors.
`data/Wuling.json` groups `[wallId, tier, [start, end]]` records by subregion.
Endpoints use the existing `[mapZ, mapX]` coordinate order. The client draws one
open dashed segment, filters by visible subregion, and dims other map layers.
At overview zoom, segments have a 6 CSS pixel minimum length around the same
midpoint and adaptive dash spacing to retain two visible dashes. Stroke width
increases with map zoom from 1.5 to 3 CSS pixels, independent of wall length.
This affects only presentation; the sidecar endpoints keep their map coordinates.

Regenerate from AKEData using the existing endfield-bots coordinate/tier tools:

```sh
python3 scripts/export-map-supplements.py \
  --source /path/to/AKEData --tools /path/to/endfield-bots/scene
```

The exporter verifies LevelData/WorldEntityRegistry IDs and records the source
commit in `data/index.json`. Floor assignment follows the existing tier resolver
with AKEData's MapRegionTable volumes: special floors override the main map.

Each segment passes through the transformed ModelRadiusTable box center along
its longest projected box axis. This indicates position and orientation, not a
mesh silhouette or exact collision boundary. Three template/model aliases are
recorded explicitly in the manifest. Mixed-axis transforms use Unity ZXY order;
the existing exporter's XYZ spline rotation is intentionally left untouched.
Old-region walls may depend on quest state; the overlay shows reference geometry
and does not infer destruction from collectible progress. This geometry does not
add collectible markers or affect collection counts.

Other floors remain visible at reduced opacity (0.25 versus 0.85 on the current
floor). Wall hover uses the shared Popover and a single rich game glossary entry.
