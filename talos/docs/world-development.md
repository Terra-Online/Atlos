# Local World development

Use this guide to provision game inputs, run local previews and validate World
integration. Commands use the pinned noclip archive and patches. For solver
changes, follow the [Ganglia development rules](../packages/ganglia/AGENTS.md).

## Prepare the workspace

Use Node 26, the package manager pinned by `talos/package.json`, and a WebGPU-capable
browser for World. Run installation from `talos`: invoking pnpm inside generated
noclip can select its nested workspace and modify the cache's lockfile.

```sh
export TALOS=/absolute/path/Atlos/talos
export NOCLIP="$TALOS/.cache/noclip"
export LOCAL="$TALOS/../.local"
export DATA="$LOCAL/data"
export CLIENT="$DATA/client"
export GAME_CONFIG="$LOCAL/config/endfield.local.json"
mkdir -p "$DATA/packages" "$DATA/releases" "$DATA/routing" "$LOCAL/config"
cd "$TALOS"
test -e config/config.json || cp config/config.template.json config/config.json
test -e config/config.r2.json || cp config/config.r2.template.json config/config.r2.json
pnpm noclip:prepare
pnpm install --frozen-lockfile
pnpm data prepare
```

Provision the [local frontend assets](local-assets.md) for the Talos workspace.
Keep private configuration, game assets and evidence under ignored `.local/`,
or select verified external paths. Preserve dataset provenance and hard links
when relocating inputs.

For adapter or renderer edits, read the
[noclip integration workflow](../integrations/noclip/README.md).
Edit its committed patches and regenerate the cache before validating consumers.

## Prepare client inputs

Use one complete PC client build, including `GameAssembly.dll`,
`Endfield_Data/il2cpp_data/Metadata/global-metadata.dat` and VFS catalogs/chunks
under `StreamingAssets/VFS` (plus matching `Persistent/VFS` updates when present).
Retain the archive directory layout. Missing chunks are missing input.

For selective downloads from matching launcher metadata, follow the
[download instructions](../scripts/noclip-download.md). The exporter reads
VFS directly; a separate bundle dump is unnecessary.

Initialize the private config using compatible local key sources:

```sh
cd "$NOCLIP"
node packages/extractor/src/cli.ts init --game "$CLIENT" \
  --keys-from /absolute/path/Endfield-map-extractor \
  --keys-from /absolute/path/AnimeStudio \
  --config "$GAME_CONFIG"
```

Resolve key, file and build errors before exporting. For accepted key-source layouts,
read generated `talos/.cache/noclip/docs/extraction.md` after preparation.

## Export and verify a release

Use the patched CLI. A full OEM catalog requires all seven complete scenes;
`--level`, `--bounds` and `--no-assets` produce incomplete inputs for this workflow.

```sh
cd "$NOCLIP"
for scene in map01 map02 indie_dg005 indie_dg007 indie_dg016 base01_lv001 dung01_wrdg001; do
  node packages/extractor/src/cli.ts pack "$scene" --config "$GAME_CONFIG" \
    -o "$DATA/packages/$scene" || break
done
node packages/extractor/src/cli.ts oem --config "$GAME_CONFIG" --atlos "$TALOS" \
  --packages "$DATA/packages" -o "$DATA/releases"
```

Stop on a failed pack and fetch missing inputs before attempting `oem`. It emits
an immutable content-derived release directory. Set `RELEASE_ID` to that exact
directory name, then verify it:

```sh
export RELEASE_ID=REPLACE_WITH_EXPORTED_RELEASE_ID
node packages/extractor/src/cli.ts oem-check "$DATA/releases/$RELEASE_ID"
```

For preview alone, that verified release is enough. Route planning additionally
needs build-bound inputs in `DATA/routing`:

| File | Producer |
| --- | --- |
| `<scene>-ground-all.json` | `walk-routes --data` using verified scene-state/area selections |
| `travel-points.json` | `travel-points` |
| `movement-settings-current.json` | `movement-settings` |
| `<scene>-interaction-points.json` | `interaction-points` (needed to reproduce authored interaction goals) |

For each scene under investigation, export source inputs, then import the
selected navigation state:

```sh
node packages/extractor/src/cli.ts travel-points --config "$GAME_CONFIG" -o "$DATA/routing/travel-points.json"
node packages/extractor/src/cli.ts movement-settings --config "$GAME_CONFIG" -o "$DATA/routing/movement-settings-current.json"
export SCENE=map02
node packages/extractor/src/cli.ts navmesh "$SCENE" --config "$GAME_CONFIG" -o "$DATA/routing/$SCENE-navigation.json"
node packages/extractor/src/cli.ts air-walls "$SCENE" --config "$GAME_CONFIG" -o "$DATA/routing/$SCENE-walls.json"
node packages/extractor/src/cli.ts interaction-points "$SCENE" --config "$GAME_CONFIG" -o "$DATA/routing/$SCENE-interaction-points.json"
node packages/extractor/src/cli.ts walk-routes --navigation "$DATA/routing/$SCENE-navigation.json" \
  --walls "$DATA/routing/$SCENE-walls.json" \
  --travel-points "$DATA/routing/travel-points.json" \
  --movement-settings "$DATA/routing/movement-settings-current.json" \
  --request "$DATA/routing/$SCENE-request.json" \
  -o "$DATA/routing/$SCENE-routes.json" --data "$DATA/routing/$SCENE-ground-all.json"
```

The request is a required dataset input, not a generated default. Use the matching
request from the maintainer's dataset, or author it following the generated
`docs/navigation.md` section **reproducible route export**. It binds `release`,
`state`, explicit asset names and area whitelist, speed, vertical projection
tolerance, arrivals and targets; profile may come from the movement export.
Completed-world wall evaluation requires explicit `progression: "completed"`.
Do not merge incompatible state variants or invent player area masks. Every
source export must identify the same build. Retaining an already verified local
dataset is preferable to regenerating it with guessed settings.

World creates physical ground and route caches on demand with `WORLD_GAME_CONFIG`.
Offline `player-ground` and camera-view precomputation are optional; consult generated
`talos/.cache/noclip/docs/navigation.md` for those commands.

## Start and inspect World

In one terminal, serve the matching packages and release on 5199:

```sh
cd "$TALOS"
NOCLIP_PACKAGES="$DATA/packages" NOCLIP_RELEASES="$DATA/releases" \
  pnpm --filter @endfield-noclip/viewer dev --host 127.0.0.1 --port 5199 --strictPort
```

Verify `http://127.0.0.1:5199/oem/RELEASE_ID/index.json` is available. In a second
terminal, set the same path variables and exact exported `RELEASE_ID`, then start
both Atlos apps:

```sh
cd "$TALOS"
VITE_WORLD_CATALOG_URL="http://127.0.0.1:5199/oem/$RELEASE_ID/index.json" \
WORLD_ROUTING_DIRECTORY="$DATA/routing" WORLD_GAME_CONFIG="$GAME_CONFIG" \
WORLD_EXTRACTOR_NODE="$(command -v node)" pnpm dev:world
```

For standalone World development, use `pnpm --filter @atlos/world dev` with the
same environment. Map assets proxy through the main development server on 5173.
The [environment example](../.env.world.example) lists the frontend variables.

Open `http://localhost:5173/`, select a point in the catalog and choose **Route from
nearest teleport**. It opens `http://127.0.0.1:5176/POINT_TOKEN?planRoute=nearest`.
Use the encoded point token from the detail link. The route assumes an unlocked
origin.

If packages return 404, check the release ID and 5199 mounts. Missing detail actions
usually indicate a missing point/catalog binding. For route failures, check routing
filenames, source-build identities and private config. Restart dev processes after
replacing catalogs or route inputs.

## Validate the changed boundary

For World integration:

```sh
cd "$TALOS"
pnpm type-check --app world
pnpm test --app world
pnpm build --app world
```

World builds need the verified `VITE_WORLD_CATALOG_URL`. For extractor edits, run
affected generated extractor tests and verify a real export. For UI integration,
exercise **5173 detail → 5176 route** with the same release served on 5199. Record
actual checks, input bindings and unresolved failures with the change.
