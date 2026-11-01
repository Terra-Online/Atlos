# 3D preview integration

The main site's detail general panel links to an optional immutable companion release produced by
endfield-noclip. Configure `VITE_NOCLIP_CATALOG_URL` to enable it and `VITE_NOCLIP_VIEWER_URL` to select
the viewer (default `https://oem-noclip.pages.dev/`). See `.env.noclip.example`; do not enable an
unpublished release. Missing configuration leaves the ordinary detail unchanged.

The viewer's `package-format/oem.ts` and `docs/oem-integration.md` own protocol v1. The main detail
contains only the preview link, using the existing detail divider and action styles.
Point prerequisites, runtime unknowns and preset controls belong to the preview site's noclip panel.
The main site does not load point companion partitions or control preview story state. Neither site
claims a user's quest state or changes collection records.

One named preview is reused per main-site tab. Its session identifier survives a page reload. Direct
links, blocked popups and closed preview windows retain a normal URL navigation path. Cross-window
messages require the exact configured origin, source window, version and session. No credentials
or user progress are sent. Camera movement updates only the preview's embedded minimap.

`apps/minimap` builds to `/minimap/` in the full `.cn` and `.org` artifacts. It uses the same coverage,
tile URL, coordinate transform and locator-marker utilities as the main map, without mounting the
main UI or game locator. It accepts only the production preview origin or localhost development,
locks the selected floor, centers the camera and rotates its cursor using projected forward
coordinates. It has no input controls or neighboring interactive markers.
The target uses its original OEM marker artwork, frame and sub-icon through the main map's canvas
renderer, with the existing pulse animation. It never reads collection state.
Camera messages may also include `view: { groundY, fovY, aspect }`. The minimap uses height above the
local ground plane, pitch, lens FOV and the scene's coordinate scale to approximate the visible area,
with continuous zoom clamped to 0–4. Without view metadata it keeps zoom 3; invalid metadata is
rejected. Missing or above-camera terrain uses the selected point's height. Floors remain fixed.
Camera following shares the main map's subpixel and continuous-view updates, retaining loaded and
pending tiles during fractional zoom. Cursor heading comes from unrounded transformed coordinates,
preserves the last planar heading during a vertical look, and crosses the angle wrap by the short arc.
Incoming camera samples coalesce to the latest sample per animation frame; the static target is
positioned only when selected. The cursor follows headings immediately and stops its initial pulse
after the first movement or turn. A validated `minimap-target` message can start tiles and target
artwork while the 3D package is still loading; the camera cursor appears after the first real pose.

For local testing, run the main map, `pnpm --filter @atlos/minimap dev`, and noclip's Vite server.
Point the two environment variables at that server and its `/oem/<release>/index.json` before starting
the main map. The main dev server proxies `/minimap/` to port 5176. The viewer serves immutable local
releases separately from its package picker.

Production data is hosted under `https://cdn.opendfieldmap.org/noclip/releases/<release>/`.
Build the minimap for both targets as part of the normal complete artifact; a Pages upload replaces
the project and must not contain only this app. Configure R2 read/range CORS and allow the minimap
route to be framed by `https://oem-noclip.pages.dev`. Retain the previous release for rollback.
