# 3D preview integration

The main site's detail general panel reads an optional immutable companion release produced by
endfield-noclip. Configure `VITE_NOCLIP_CATALOG_URL` to enable it and `VITE_NOCLIP_VIEWER_URL` to select
the viewer (default `https://oem-noclip.pages.dev/`). See `.env.noclip.example`; do not enable an
unpublished release. Missing configuration leaves the ordinary detail unchanged.

The viewer's `package-format/oem.ts` and `docs/oem-integration.md` own protocol v1. OEM only presents
conditions and requests authored presets; it does not evaluate gameplay conditions, claim a user's
quest state, or change collection records. Localized game labels fall back to English and then ids.
Unknown spawn, script and interaction conditions remain visible.

One named preview is reused per main-site tab. Its session identifier survives a page reload. Direct
links, blocked popups and closed preview windows retain a normal URL navigation path. Cross-window
messages require the exact configured origin, source window, version and session. No credentials
or user progress are sent. Camera movement updates only the preview's embedded minimap.

`apps/minimap` builds to `/minimap/` in the full `.cn` and `.org` artifacts. It uses the same coverage,
tile URL, coordinate transform and locator-marker utilities as the main map, without mounting the
main UI or game locator. It accepts only the production preview origin or localhost development,
locks the selected floor, centers the camera and rotates its cursor using projected forward
coordinates. It has no input controls or neighboring interactive markers.

For local testing, run the main map, `pnpm --filter @atlos/minimap dev`, and noclip's Vite server.
Point the two environment variables at that server and its `/oem/<release>/index.json` before starting
the main map. The main dev server proxies `/minimap/` to port 5176. The viewer serves immutable local
releases separately from its package picker.

Production data is hosted under `https://cdn.opendfieldmap.org/noclip/releases/<release>/`.
Build the minimap for both targets as part of the normal complete artifact; a Pages upload replaces
the project and must not contain only this app. Configure R2 read/range CORS and allow the minimap
route to be framed by `https://oem-noclip.pages.dev`. Retain the previous release for rollback.
