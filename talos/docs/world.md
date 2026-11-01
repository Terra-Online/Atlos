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
copied renderer. React is deduplicated in the World bundle. World uses TypeScript 7 to match the
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
