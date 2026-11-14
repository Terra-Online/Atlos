# Contributing to Ganglia

Read the custom [license](../LICENSE) before using or contributing. It excludes
the named services and related operators/projects defined there. Eligible recipients
must comply with the incorporated AGPL 3.0 obligations, including distribution and
modified-version network source requirements. Contributions
must be yours to license and submitted under the current project license;
third-party material must retain its own notices.

Ganglia owns the route-planning algorithms. Atlos owns the World UI, game-data
adapters and the patched noclip integration. You can develop the algorithm with
Node alone; reproducing real point queries also requires matching local game data
and the three services below.

## Repositories and tools

The solver is the editable `talos/packages/ganglia` workspace package in
Atlos. The standalone [Ganglia repository](https://github.com/Terra-Online/Ganglia)
retains its source history. Upstream extraction and rendering come from
[mary-ext/endfield-noclip](https://github.com/mary-ext/endfield-noclip).
[Endfield-map-extractor](https://github.com/An1X3R/Endfield-map-extractor) and
[AnimeStudio](https://github.com/Escartem/AnimeStudio) are supported key-import
sources when their local checkouts are needed.

The historical noclip `feat/3d-preview` branch is not the current integration
source. Atlos pins an upstream archive in `talos/integrations/noclip/source.json`
and applies the patches listed there into `talos/.cache/noclip`. Work on extraction
or renderer extensions through those committed patches. Generated cache source
is not an independent checkout. Read Atlos's
[integration instructions](https://github.com/Terra-Online/Atlos/blob/feat/3d-preview/talos/integrations/noclip/README.md)
before updating it. Do not fast-forward to a new upstream package format merely
to start development; the pinned renderer and local exports must agree.

Install Git, **Node 26** and Atlos's pinned **pnpm 10.5.0**. Ganglia itself supports
Node 24.12+, but the integrated noclip toolchain needs Node 26. Upstream's standalone
`mise.toml` currently specifies Node 26/pnpm 12; use Atlos's workspace pin for the
integrated workflow here. Python 3.10+ is needed only for selective downloads.
Use a WebGPU-capable browser/GPU and localhost. Allow substantial RAM and disk
space for source chunks, decoded assets, scene packages and route caches.

Clone Atlos wherever convenient. Commands below use these absolute
paths; set them in each terminal that needs them:

```sh
export TALOS=/absolute/path/Atlos/talos
export GANGLIA="$TALOS/packages/ganglia"
export NOCLIP="$TALOS/.cache/noclip"
export LOCAL="$TALOS/../.local"
export DATA="$LOCAL/data"
export CLIENT="$DATA/client"
export GAME_CONFIG="$LOCAL/config/endfield.local.json"
mkdir -p "$DATA/packages" "$DATA/releases" "$DATA/routing" "$LOCAL/config" "$LOCAL/downloads"
```

Keep game files, keys, local configs, download manifests and exports in the ignored
Atlos root `.local/`. Store benchmark evidence in `.local/research/`, dependency
checkouts in `.local/repos/`, and rebuildable artifacts in `.local/cache/`.
Explicit external paths are also supported. The generated noclip source stays in
`talos/.cache/noclip`.

When relocating existing resources, move the directories together and preserve
dataset names, hard links and provenance. Update private configuration, executable
paths and internal links to the new root. Keep historical reports and input hashes
unchanged; use explicit paths to select a frozen dataset for replay.

## Prepare the client files and extraction keys

Our local packing workflow fetched missing `.chk` files **directly from the
official CDN's split client ZIP using HTTP Range requests**. EndfieldStudio was
not the CHK downloader. The maintained helper now lives in Atlos at
`talos/scripts/noclip-download.py`; read its
[download instructions](https://github.com/Terra-Online/Atlos/blob/feat/3d-preview/talos/scripts/noclip-download.md).

Its prerequisite is a local launcher response for the **same PC client build**,
containing `proxy_rsps[0].get_latest_game_rsp.pkg.packs` with each part's `url` and
`package_size`, in order. Obtain the matching response from the official launcher's
download metadata or from the person supplying your development dataset. The
script does not discover releases or download hot updates. Expired URLs require
fresh metadata for that same build. A complete official client installation is
also supported and skips the selective-download step.

```sh
cd "$TALOS"
python3 scripts/noclip-download.py --links "$LOCAL/downloads/client-links.json" \
  --cache "$LOCAL/downloads/ranges" --list > "$LOCAL/downloads/client-files.txt"
# Copy required exact archive paths into required-files.txt, one per line.
python3 scripts/noclip-download.py --links "$LOCAL/downloads/client-links.json" \
  --cache "$LOCAL/downloads/ranges" --out "$CLIENT" \
  --file-list "$LOCAL/downloads/required-files.txt"
```

Initially select `GameAssembly.dll`,
`Endfield_Data/il2cpp_data/Metadata/global-metadata.dat`, and the VFS `.blc`
catalogs. `init` and scene packing will also need their referenced CHK chunks.
For a missing chunk, use its exact filename from the error, then rerun the failed
extractor command:

```sh
python3 scripts/noclip-download.py --links "$LOCAL/downloads/client-links.json" \
  --cache "$LOCAL/downloads/ranges" --out "$CLIENT" MISSING_HASH.chk
```

Unique suffixes are accepted; ambiguous names fail. For unattended export,
download the complete dependency set first or use a full installation. Keep the
archive directory structure; adjust `CLIENT` if extraction creates an enclosing
directory. The required layout is:

```text
client/
  GameAssembly.dll
  Endfield_Data/
    il2cpp_data/Metadata/global-metadata.dat
    StreamingAssets/VFS/<group>/<catalog>.blc
    StreamingAssets/VFS/<group>/<chunk>.chk
    Persistent/VFS/...  (when present in the matching installation)
```

Do not mix catalogs, chunks, DLLs or metadata from different builds. A directory
with only CHK files, or only a Table dump, is insufficient. Missing chunks are
missing input, not evidence that the scene has no geometry.

The exporter directly reads/decrypts VFS and game bundles. You do **not** need to
dump every bundle using EndfieldStudio first. The local
[EIHRTeam/EndfieldStudio](https://github.com/EIHRTeam/EndfieldStudio) fork is based
on AnimeStudio; `init --keys-from` recognizes specific source layouts, rather
than arbitrary exported JSON. Clone the key-source repositories above (or use
your already compatible checkouts). There is no .NET, Blender, Python-package or
EndfieldStudio GUI build prerequisite for noclip's own extraction path.

## Prepare Atlos and noclip

```sh
cd "$TALOS"
test -e config/config.json || cp config/config.template.json config/config.json
test -e config/config.r2.json || cp config/config.r2.template.json config/config.r2.json
pnpm noclip:prepare
pnpm install --frozen-lockfile
pnpm data prepare
```

Map clips, satellite tiles, fonts and other large assets are separate from Git.
Obtain the matching development assets as described in Atlos's `talos/README.md`
and configure local resource locations. Upload/deployment credentials are not
needed to run local extraction and preview. A source-only build does not provide
these assets or prove that a real detail page works.

```sh
cd "$NOCLIP"
node packages/extractor/src/cli.ts init --game "$CLIENT" \
  --keys-from /absolute/path/Endfield-map-extractor \
  --keys-from /absolute/path/AnimeStudio \
  --config "$GAME_CONFIG"
```

Run the generated CLI directly with Node as above. Invoking `pnpm` inside
`$NOCLIP` can select upstream's nested workspace and package-manager settings,
perform an independent install and rewrite its lockfile. Atlos then correctly
rejects that edited cache. Keep installation and workspace commands in `$TALOS`.

`init` derives supported keys from the client, imports the remaining material
from those local source checkouts, and validates it before saving the private
config. Resolve missing-key, missing-file and build errors before proceeding.
The generated noclip `docs/extraction.md` describes the precise contracts.

## Export scene packages, a catalog and route inputs

Use the generated patched CLI, not the standalone upstream CLI: OEM and player
routing commands are Atlos extensions. All seven complete scenes are needed for
the full OEM catalog. Do not pass `--level`, `--bounds` or `--no-assets` here.

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

With `WORLD_GAME_CONFIG` set, World creates collision-derived physical ground
and route caches on demand. A full offline `player-ground` build and `oem-views`
camera precomputation are not prerequisites for first startup. The generated
`docs/navigation.md` and Atlos's `apps/world/docs/route-inspection.md` describe
those optional workflows and the current route assumptions.

## Start 5199, 5173 and 5176

Use two terminals, with the path variables above available in both. First start
the patched noclip viewer and package/release service on **5199**:

```sh
cd "$TALOS"
NOCLIP_PACKAGES="$DATA/packages" NOCLIP_RELEASES="$DATA/releases" \
  pnpm --filter @endfield-noclip/viewer dev --host 127.0.0.1 --port 5199 --strictPort
```

This provides `/packages/` and `/oem/`; a generic static server without these
mounts is not equivalent. Check the catalog before starting World:

```sh
curl --fail "http://127.0.0.1:5199/oem/$RELEASE_ID/index.json"
```

Then start the main map on **5173** and World on **5176** together:

```sh
cd "$TALOS"
VITE_WORLD_CATALOG_URL="http://127.0.0.1:5199/oem/$RELEASE_ID/index.json" \
WORLD_ROUTING_DIRECTORY="$DATA/routing" WORLD_GAME_CONFIG="$GAME_CONFIG" \
WORLD_EXTRACTOR_NODE="$(command -v node)" pnpm dev:world
```

`dev:world` passes the catalog to both apps and directs detail-page links to the
local World server. Do not start a second map server with `pnpm dev`. Keep all
three ports free and verify the printed URLs; Vite may otherwise select another
port. `WORLD_EXTRACTOR_NODE` must resolve to Node 26 in this terminal.

1. Open [the local map](http://localhost:5173/). The main site redirects
   `127.0.0.1` to `localhost`.
2. Select a real map point included in the catalog to open its **detail panel**.
   The detail action offers 3D preview and, in development, **Route from nearest
   teleport**. A point absent from `pointIndex`, a missing catalog environment
   variable or a failed catalog request hides these actions.
3. Choose preview to open `http://127.0.0.1:5176/POINT_TOKEN`, or route to open
   `http://127.0.0.1:5176/POINT_TOKEN?planRoute=nearest`. `POINT_TOKEN` is the
   existing encoded point token produced by the detail link, not a raw entity ID.
4. Check the scene and target, then the route panel, minimap and playback. Route
   failure/truncation is not proof of in-game unreachability. The nearest-teleport
   workflow assumes its selected anchor is unlocked; it does not read an account.

For a dataset containing the retained sample `0kkQ3em`, direct entry URLs are
[map detail](http://localhost:5173/0kkQ3em),
[World preview](http://127.0.0.1:5176/0kkQ3em) and
[World route](http://127.0.0.1:5176/0kkQ3em?planRoute=nearest).
Use a token present in your own catalog if that sample is unavailable.

If World opens but packages 404, check the release ID and the 5199 mounts. If
routes fail, check the routing filenames, matching build identities and private
config before changing the solver. Restart both Atlos dev processes after
replacing the catalog, route exports, movement settings or Ganglia dependency.

## Develop and validate

```sh
cd "$GANGLIA"
pnpm install
pnpm check
```

World and the generated extractor consume this workspace package directly.
Edit the solver here, then validate the consumers. Install dependencies from
`$TALOS` so pnpm uses the workspace lockfile. Extraction changes belong in the
owned `integrations/noclip` patches; regenerate noclip before testing them.

Run the checks appropriate to the changed boundary:

```sh
cd "$TALOS"
pnpm type-check --app world
pnpm test --app world
pnpm build --app world
python3 scripts/noclip-download-test.py  # when changing the downloader
```

World builds require the verified `VITE_WORLD_CATALOG_URL` in the environment.
For extraction changes, also run the affected generated extractor tests and
verify a real export. For UI/planner integration, exercise the ordinary **5173
detail → 5176 route** flow with 5199 serving the same release. Record actual
commands, input identity, unresolved assumptions and failures. Synthetic tests
alone do not validate game movement or physical reachability.


## Interpret benchmark results

The benchmark measures one fixed algorithm, Config, scene snapshot, declared
training set and scored workload. Deployment scenarios are interpretations of the
same measurements and do not select execution modes or alter the algorithm.

Input read/decode/hash time is separate from adapter/source validation, resource
indexing and factory preparation. `GangliaV1Config.preparation` requires catalog
training and warmup, defaulting to ten and two requests. Built-in benchmark
adapters bind that policy to tracked preparation requests. Every worker sees the
same training requests in the same order, freezes its catalog and completes
warmup before service readiness. Preparation cost and prepared memory remain in
the report. Training may overlap scoring when the catalog retains reusable
physical connections rather than completed-query answers; report that overlap.
Query-dependent
search and refinement remain in query time; current V1 also performs some scene
preparation lazily there. Ready does not certify an eagerly built immutable index.

Warmup requests are part of the benchmark configuration and exclude scored
queries. Missing training, unfrozen catalogs and unsuccessful warmup prevent V1
scoring. No optional CLI flag disables preparation. All measured
rounds count toward throughput. With `--rounds 2` or more, outcomes and truncation
are compared against the first measured round. One round does not establish
repeatability.

Run with one worker and one lane for serial query latency. A separate invocation
with `--workers 2 --concurrency 2` measures parallel batch wall time, service
latency, queue time and response time using the same algorithm and preparation
recipe. Per-worker loading/preparation can overlap and must not be added into
wall time. Worker-ready and service-prepared memory, and sampled memory peaks,
are recorded separately. Actual parallel performance requires that execution;
it cannot be inferred from a serial run.

Interpret the results according to the intended deployment:

- Server online queries: use prepared-service query latency, response latency and
  successful throughput, alongside service readiness time and memory.
- Browser preparation: include preparation, query costs and memory. Serialized
  index size, compressed transfer, restoration and browser execution require
  corresponding measurements. `browserArtifacts: null` means unmeasured; Node
  input bytes are neither a serialized index size nor a compressed download size.
- Server offline batch processing: use `lifecycle.endToEndMs` and
  `endToEndSuccessfulQueriesPerSecond`, covering Node process origin through
  solver shutdown. This includes loading, preparation, training, runtime warmup,
  all measured rounds and recovery. Final source re-verification and report
  formatting follow the interval.

Recovery remains in actual batch wall time. The five-minute service SLO excludes
queueing and initial worker setup. References bind exact queries, game adapter
and all input content hashes. Quality and the SLO precede speed. Schema 10 reports
compare batch and end-to-end speed only when preparation/training, warmup, rounds,
workers and concurrency agree. Older reports can provide quality references,
with no speed ratio across the changed measurement contract.


The `--adapter <module-path>` option loads an exported `adapter` with solver
settings and a child-process entry implementing the benchmark IPC protocol.
The default adapter lives in `bench/adapters/ganglia-v1/`. Every adapter supplies
the dataset's projection tolerance in `metadata.rules`; the harness applies the
same query and trace checks to every scored solver. Schema 10 recomputes route
time and length and adds post-batch physical verification for the default adapter.
The physical verifier consumes provider-owned normalized `PhysicalInput` and
source coverage, never a search verdict. It replays whole-route resource choices,
flight controls and device actions against the shared TS model, and checks
supported walking, collision sweeps, placements and first-goal events. Solvers
submit `schedule`, flight witnesses and selected `placements`; representation may
use different knot density or equivalent segment splits. Source tile holes remain
unknown space. Moving and following support behavior follows the assumptions in
the exported snapshot.

Evaluation follows the timed batch and contributes to end-to-end time, outside
per-query service latency. The adapter captures normalized facts before search
and creates verifier indices lazily during evaluation. After worker recovery it
can normalize the same preloaded source through a no-search exporter sink.
`physical` identifies this replay scope; `route-contract` identifies query/trace
evaluation from an adapter without physical replay. Reports retain their actual
scope and schema when used as historical timing references.
