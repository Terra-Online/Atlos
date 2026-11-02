# World

World is the OEM subordinate app at `apps/world`, titled **World - Open Endfield Map**.
It has an independent Pages project (`oem-world`), intended for `world.opendfieldmap.org` and
`world.oem.re`. It is not bundled into either main-site Pages artifact.

## Ownership

Atlos owns the entry, short routes, opener bridge, point conditions, target marker, minimap and region
controls. The minimap and shared `UIOverlayLayer`/`RegionMenu` run directly in the World document;
there are no auxiliary iframes. Main-site region selection is never changed by the World camera.
The same map resource helpers, coordinate transforms, floor handling, background texture and font
preparation are reused. Scene controls retain the renderer's original panels.

`vendor/endfield-noclip` is a Git submodule pinned to an exact commit. Only its viewer and
package-format packages participate in the pnpm workspace. The extractor, game keys and raw/exported
game data remain outside the Atlos build. World consumes the viewer's exported host interface, not a
copied renderer. React is deduplicated in the World bundle; type checking resolves the same Atlos React types. World uses TypeScript 7 to match the
renderer's modern platform types without changing the main application's TypeScript version.

## Links and communication

- `/{token}` opens a point, using OEM's existing seven-character point codec.
- `/?region=DJ_1` opens a subregion overview and clears the point target.
- `/` opens the initial Valley overview.

The source catalog is fixed by `VITE_WORLD_CATALOG_URL`; release and package generations remain
validated internally. Share links intentionally resolve against the currently deployed catalog.
Invalid tokens and missing points produce an error. URLs carry no release, catalog, source origin or
session identifiers. Main-site detail links use `VITE_WORLD_URL` and the same short point codec.

Each main-site tab reuses one named World window. World sends a fresh challenge to its actual
opener, then accepts a session only from an explicitly allowed OEM origin and that exact opener.
Commands and acknowledgements check origin, source, protocol version, session and challenge. The handshake also carries the main site’s language and satellite preference; these are
applied only after sender validation. Pending
point clicks coalesce to the latest selection. Refresh establishes a fresh handshake; a shared link
or a closed opener works independently. The initial hello contains only the protocol and nonce.

## Local work

```sh
git submodule update --init talos/vendor/endfield-noclip
cd talos
pnpm install --frozen-lockfile
```

Set the two variables in `.env.world.example` using a local-only env file or shell environment.
Run noclip's existing data server on port 5199 against its retained `out/releases`, then run
`pnpm dev:world` for the main site and World together. World can also run alone with
`pnpm --filter @atlos/world dev`; map assets proxy through the main development server on 5173.
The frontend can be rebuilt without unpacking game data or clearing browser caches.

```sh
pnpm type-check --app world
pnpm test --app world
pnpm build --app world
```

The independent build writes `dist/world` and a receipt with the renderer pin, catalog and file
hashes. Main-site full builds exclude World. Its build checks the source pin and uses an immutable
catalog; local HTTP-catalog artifacts are reviewable but cannot be deployed by the release command.
To update the renderer, validate and commit its source repository, update the submodule checkout,
and commit the new pin with the Atlos integration. Local unpublished pins require the matching local
repository; publish that renderer commit before a future remote checkout or CI build can fetch it.

## Deployment

`pnpm world:deploy` explicitly uploads the verified World artifact to its own Pages project. It
checks the artifact hashes and renderer pin first. It never publishes the main site, game data,
DNS records or custom-domain bindings. Do not run it without release authorization.

Bind both domains to the World Pages project before setting their DNS records; see
[Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).
The project config is `apps/world/wrangler.toml`; see
[Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).
The static SPA fallback serves point-token paths. Keep opener communication enabled.

Scene archives, companions and baked views remain in the existing R2/CDN immutable release namespace.
Apply the renderer repository's R2 CORS configuration including the World origins when publishing
those data. Upload and verify the complete data release before changing either app's catalog.
The frontend receipt is independent of data publication; building and local testing do not deploy.

## Automatic roaming

World samples the free camera every 150 ms. OEM's existing subregion polygons resolve horizontal
ownership; `navigation.json` supplies explicit scene/level mappings, source seamless flags and
three-dimensional floor volumes from the same game build. Crossings must remain stable for 600 ms.
Initial positioning and point/overview flights suppress automatic switching; roaming arms after
one metre of user movement. Gaps retain the current context, and genuinely ambiguous overlapping
packages do not pick a scene by nearest marker.

Same-package transitions change visibility and stream around the camera without an overview flight.
Cross-package transitions reuse the existing shared-map transforms for position and heading, keeping
the authored Unity height, pitch projection, FOV and movement settings. A package is replaced on demand;
this is not simultaneous rendering of both packages, so cold package loads can show a loading gap.
The current point target and its URL remain selected, including its minimap edge icon; the condition
panel is read-only while its source level is not active. Explicit region selection still clears it.

Use `oem-navigation` in the renderer's extractor to add the optional, generation-bound navigation
sidecar to an existing baked release. It hard-links model archives and retains all baked views.
Authored tier volumes decide floors and independent-scene entry. For an independent scene without
a tier volume, only its verified gameplay-point footprint (expanded by 10 m) is used as conservative
entry evidence; other space remains unresolved. Current data was checked against AKEData and exported
from the matching local game build, not from an unversioned remote endpoint. Older releases without
this sidecar continue supporting manual navigation.

## Panels

`src/panel.tsx` owns World panel presentation. The renderer's `PanelProvider` supplies the same
shell to Preview, scene conditions, display settings and statistics through separate title,
action and body slots. Collapsing a panel hides its body without unmounting controls; Reset
remains a separate action. The styling follows OEM-SDK's `examples/basic/style.scss`: translucent
light panels, section headings, compact fields, orange accents and diamond toggles/slider thumbs.
World defines the reading and heading font roles once, using existing Atlos assets and font-shard
loading. Dynamic game labels register glyph demand with the shared font loader; controls inherit
the reading font. No new font files or external font requests are introduced.

The minimap composites imagery, the original target icon and the camera cursor through one 14 px
edge feather. Offscreen targets pin their artwork center to the rectangle boundary with no inset.
The pin is computed for the next map view before Leaflet moves, using the same camera sample as
the tiles. A small, static canvas reuses the main map artwork painter; camera movement only
translates it, without creating the main map WebGL marker surface or a perpetual target pulse.
Camera/map updates are coalesced per display frame, with no idle polling. Terrain height is
sampled at most every 100 ms (or immediately on scene/floor changes). Hidden tabs pause this
work and apply the latest pending sample on return. Local development proxies both
standard and satellite imagery through the main site's resource server.

Minimap zoom uses half-level bands (about 1.41× scale per step), bounded to 0–5. A 0.15-level
hysteresis beyond the usual rounding boundary prevents height/terrain/pitch jitter from switching
back and forth. Band changes ease over 240 ms, retargeting from the displayed scale without
jumping. Large changes select their destination band directly rather than visiting intermediate
bands. Scene/floor changes reset the band, while same-map point flights retain it. Position and
heading follow each display frame independently of the lower-frequency terrain sampling.

World persists one latest view in `localStorage["world-view"]`, with an internal `version: 1`.
It contains the public route, release/scene/level/floor, camera position/orientation/FOV, movement
speed and portable display options. It is separate from shared map preferences and the renderer's
`noclip-point-view-v3:*` algorithm cache; neither is migrated or overwritten. Scene environment
IDs and story overrides are intentionally excluded. Matching routes/releases resume the saved
camera after loading (including a scene reached by roaming); other links use their own target
framing while keeping lens, speed and display preferences. Release changes invalidate only the
saved position. Explicit incoming point/region requests take priority over restoration.
Writes are coalesced at 500 ms, deduplicated, and flushed on page hide; transient scene loads and
automatic flights do not overwrite the last stable view. Invalid/blocked storage is optional and
never blocks opening World. This is one last view per origin, not a per-point history.

Free-flight movement shares the minimap's cached ground sample (100 ms), falling back to the
selected floor elevation where terrain is unavailable. With the default speed trim, cruise eases
from 10 m/s within 5 m of ground to 50 m/s at 100 m clearance. Ctrl+wheel still adjusts the stored
speed trim; ordinary cruise stays capped at 50 m/s. Hold Tab/Alt for one-fifth speed or right mouse
for fivefold boost; slow takes priority when both are held. UI Tab focus navigation remains
available outside flight. Automatic point/overview flight timings are unchanged.

## Photography

The renderer's Photography panel uses the same World panel shell and inherited fonts. Aperture
(f/1.4–f/32), focus distance and the depth-of-field toggle are saved in the existing `world-view`
record alongside FOV; older records retain the defaults for these optional settings. Preview's
“Focus on target” action sets the focus plane through the selected point and enables depth of
field. A target behind the camera produces a message instead of changing focus. The scene must
be active before this action is available.

The v49 renderer includes physical foreground/background defocus and water depth, without adding
scene-package downloads. Moving-object motion and after-DoF transparent classification still
differ from the game; see the renderer's photography notes before claiming image parity.
