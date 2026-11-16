# Real-scene mechanism acceptance inputs

This is a shared, frozen **acceptance specification** consumed by
`bench/mechanism-run.ts --mode physical-diagnostic`.
The user authorized sharing these case definitions and source bindings. Raw game
assets, collision/navigation snapshots, profiles and private configuration remain
local. `progress.json` and `progress.html` publish a frozen per-case progress
snapshot; they do not represent a successful same-source full-suite replay.

`pnpm benchmark:mechanisms` runs the prepared service benchmark through
`bench/mechanism-benchmark.ts` and `mechanism-service-worker.ts`. It requires a
source-bound `input-index.json`, trains/freezes/warms each scenario worker, then
measures and independently verifies its routes. Its default adapter is Rust;
`--adapter ganglia-v1-ts` selects TS. `--audit` records input-bound unrun cases
without preparing or solving. Service results keep their own acceptance contract.
`bench/mechanism-run.ts --mode physical-diagnostic` remains the explicit TS native
route diagnostic entry, retaining the original per-case setup, source snapshots,
first complete artifacts and terminal outcomes used by the progress table.

The main collection contains 266 distinct real entity/contact target positions
across map01/map02 and 16 authored levels. Six non-entity navigation queries are
retained separately as geometry probes. They include
113 retained regressions, 137 mechanism-selected cases, 12 multi-box cases and four
circular-waterwheel cases. Failures in the retained population remain included.
New mechanism selections are opportunities to exercise a feature, not proof that
the feature is necessary or that the target is reachable.

`selectionCapabilityGap` preserves the pre-prototype selection context. Current
implementation and probe results live in the canonical handoff/history records.
The specification's selection status is separate from the latest per-case results;
mechanism selection or implementation alone does not establish completion.

## Generate service benchmark inputs

Prerequisites: Node 26, pnpm, the game installation matching `suite.json.source`
(including `Endfield_Data`, its metadata and adjacent `GameAssembly.dll`), and a
local extractor configuration. The repository provides code and case definitions;
it does not provide the game installation or keys. A different game build requires
an explicit new workload binding, not editing the index to impersonate this build.

From the repository root, prepare the pinned extractor before installing its
workspace dependencies:

```sh
pnpm --dir talos noclip:prepare
pnpm --dir talos install --frozen-lockfile
mkdir -p .local/config
```

Reuse an existing validated private config by setting `GANGLIA_CONFIG` to its
absolute path. Otherwise generate one using your local installation and local
key-source checkouts (Endfield-map-extractor / AnimeStudio):

```sh
export GANGLIA_CONFIG="$PWD/.local/config/endfield.local.json"
node talos/.cache/noclip/packages/extractor/src/cli.ts init \
  --game /absolute/path/to/Endfield_Data \
  --keys-from /absolute/path/to/local-key-source-checkouts \
  --config "$GANGLIA_CONFIG"
```

The extractor's generated `docs/extraction.md#local-config-and-keys` describes
required key sources and validation. Keep this config local; it contains keys.
Then generate a **new** input directory, without copying the author's `.local/`:

```sh
export GANGLIA_INPUT_ROOT="$PWD/.local/data/mechanisms-266-generated"
export GANGLIA_EXTRACTOR="$PWD/talos/.cache/noclip"
pnpm --dir talos/packages/ganglia benchmark:prepare-mechanisms \
  --config "$GANGLIA_CONFIG" --extractor "$GANGLIA_EXTRACTOR" \
  --output "$GANGLIA_INPUT_ROOT"
```

Add `--plan` to inspect the 266 bindings and export plan without reading game data
or writing outputs. Actual preparation runs the existing movement, navigation,
air-wall, device and interaction exporters, then `groundData` and
`exportPhysicalRegion`; it never runs the route solver. It checks the exported
game source, capsule and locomotion against the suite. Navigation uses area 0 on
map01, areas 0/10 on map02, the exported assets and fully-enabled progression.
Frozen cases share only their declared region's physical window; expandable cases
share a scene directory. The service runner further partitions groups by resource
and following-box policy. Fixed region exports use terminal scene, scene state 0
and area 0, preserving their manifest bounds.

Preparation refuses an existing output directory. On failure, keep the partial
output for diagnosis and use a new destination when retrying. `input-index.json`
is written only after all exports succeed; it includes all case bindings, exporter
identity and content hashes. Its candidate revision is newly computed, not the
historical author's revision. Generated inputs require a fresh baseline/candidate
comparison on the same directory; historical timing and coverage are not inherited.
Dynamic physical regions are added by the service during preparation using the
same config and exporter and are recorded in each run's input provenance.

Check bindings without solving, then use the full command in the package
[AGENTS.md](../../../AGENTS.md#primary-266-case-baseline-and-soft-merge-gates):

```sh
pnpm --dir talos/packages/ganglia benchmark:mechanisms \
  --adapter ganglia-v1-ts --data-root "$GANGLIA_INPUT_ROOT" \
  --extractor "$GANGLIA_EXTRACTOR" --prepare-config "$GANGLIA_CONFIG" \
  --audit --output "$GANGLIA_INPUT_ROOT/audit/report.json"
```

`--audit` validates the manifest/index binding and enumerates cases; it does not
prove physical validity, exporter correctness or route completion. A collaborator
without the matching game installation/config must obtain those prerequisites
or an explicitly shared matching dataset; a stored hash cannot generate assets.

## Files

- `suite.json`: authoritative queries, per-case setup, assertions, source bindings,
  physical window bounds, model scope and known capability gaps.
- `cases.csv`: human-readable case index.
- `coverage.json` / `coverage.csv`: intended mechanism-to-case mapping, all unrun.
- `multi-box.csv`: the eight two-box and four three-box cases.
- `legacy-id-map.csv`: old report IDs mapped to current IDs, including explicit
  query replacements and geometry-probe references.
- `geometry-probes.json`: six unchanged geometric queries that have no map token;
  they remain mechanism probes outside the main 266 entity/contact cases.
- `development-controls.json`: two source-ground waterwheel entry/exit controls
  retained after successful bounded physical replay. These are development
  regressions, separate from the 266-case population and not unseen holdouts.
- `negative-controls.json`: original unavailable-origin, capped-coverage and
  occupied-contact fixtures: seven controls retained outside the positive population.
- `progress.json` / `progress.html`: published results for all 266 IDs, including
  terminal outcomes, available complete native artifacts, first-candidate times,
  source bindings and remaining cases. This mixes retained and newer frozen runs.
  Relative `.local/` references identify local evidence that is not shipped here.

Main IDs use `001-{token}` through `266-{token}`, with the seven-character token
from the existing `encodePointIdToken` codec in
`talos/src/services/routing/pointToken.ts`. `tokenSourceId` and `tokenRole` identify
what the token represents. Conveyor cases use their real conveyor group actor ID;
this is a facility contact, not a collectible marker. Existing 113 regression
tokens are preserved exactly. Historical result filenames are not rewritten.

Revision 5 repairs six unrun targets that were navigation surfaces rather than
map entities. Their full original queries remain in `geometry-probes.json`. The
main replacements preserve starts and use source interaction goals/rules. Four
are within 30m horizontally and 1m vertically. Cases 236 and 242 instead select
new real navigation targets 50.153m and 185.241m away (height differences 0.151m
and 0.508m); these are explicitly not equivalent nearby replacements. None had
passed acceptance before this correction. Coverage lists separate main case IDs
and geometry-probe IDs so renaming does not erase the original portal/layer tests.

Preserve these IDs when adapting runners. Record changed query, setup, source or
scoring rules as a new workload revision, retaining the old comparison control.

Revision 7 replaces slots 228 and 229 with source-selected collectible targets.
The fixed-seed selection is recorded in each case and does not use solver results.
Teleport and campfire anchors serve as origins only. Cases 234 and 240 keep their
original goals and origins but permit normal source-window expansion. The four
original definitions remain in `negative-controls.json`; these input changes do
not establish same-input algorithm gains.

Revision 8 keeps case 185's conveyor entity but replaces contacts intersecting a
static overhead beam. The fixed-seed replacement uses two legal positions on one
source cap, 1.20717 m apart, and retains the static mesh and original player body.
The occupied original remains a separate input diagnostic.

Revision 9 corrects case 143's source center, which lies inside its exported mesh.
Its device and destination stay unchanged; the new starting feet are physically
supported inside the original source interaction volume. This input repair does
not change the solver's global height or collision rules.

Revision 10 restores `waypoints` to the established coarse-discovery contract.
They preserve input order as hints, without requiring the final trace to visit or
stop at every coordinate. Prior stop expectations for cases 216--219 remain in
their acceptance revision metadata; they are not claimed as passed. Completion
requires an end-to-end action route for the original source and destination.

Revision 11 corrects case 250's contacts on the same retained bridge actor and
exported pose. The original source intersects the bridge mesh throughout its
allowed same-XZ projection band; its sampled triangle also exceeds the existing
slope limit. The original query remains a negative control. Seed 20261115 ranks
source triangle centroids before native standing checks; the first legal source
and first legal target at least 3 m away are 5.74198 m apart. Player profile,
interaction size, identity and mechanism assertions remain unchanged. This is an
input correction, with no solver completion or same-input algorithm gain claimed.
The exported `state 0 away` label does not establish an open or closed bridge.

## Adaptation contract

The current `bench/workload.ts` custom-workload path expects a plain query array.
**Do not pass this manifest directly to `--workload`, or strip it down to queries
and call the result full mechanism acceptance.** The mechanism runner applies
the following contracts; full-population acceptance remains pending:

1. Partition by scene and physical input/setup. Resolve logical `exports/` and
   `retained/` resource names through explicitly configured local roots. The
   referenced assets are not shipped here. Match the recorded source build,
   movement/profile, exporter and progression assumptions. Current renderer
   package upgrades do not automatically rebind these older physics inputs.
   The new wheel-domain export and corrected following-box corner order require
   regenerated candidate facts and an explicit candidate input binding. Preserve
   the original selection provenance; do not overwrite or relabel old exports.
2. Preserve original goal position, interaction volume, facing/airborne rules,
   arrival states/costs and waypoint order. Start projection requires physical
   support evidence and must not replace the requested goal.
3. Honor `setup.physical` frozen windows, including `allowExpansion: false`.
   `physicalRegions` records their source bounds and export settings. Missing
   snapshots are input-unavailable, not successful tests. Regenerated geometry
   needs a new binding; matching coordinates alone do not recreate an old run.
4. Apply `setup.locomotion` before preparing the solver; it is the fully merged
   resource policy, while `locomotionPatch` records the intended change. Preserve
   device facts, following-box activity ranges and all other source collisions.
   Reject unsupported setup explicitly instead of silently ignoring it.
5. `requiredDevice`, `requiredSupport`, `followingPlacement` and assertions specify
   what must be exercised for mechanism credit. They do not authorize fabricated
   connections or removing alternative routes. A valid alternative can pass route
   feasibility while leaving the intended mechanism unexercised.
6. For multi-box credit, require one coherent jointly valid placement and actual
   route use of every counted box. Separate successful single-box trials cannot
   be combined as evidence. For conveyors, `expectedContactPose` supplies a feasible
   source-derived example: a different pose is acceptable if it supports the whole
   contact run. Display only the selected used box, not the swept envelope.
7. Waterwheels require the agreed traversable circular surface/domain, retaining
   source geometry, external obstacles and entry checks. Phase synchronization
   and waiting are explicitly excluded. Static terminal-pose collision does not
   satisfy circular-domain coverage.

For this 266-case flow, completion means a complete end-to-end timed route returned
by the solver, excluding partial target approaches. Physical checks constructing
actions remain active. The worker does not invoke independent whole-route replay;
route cost and solver time come from the solver. Input preparation and dispatch
time remain separate fields. Report mechanism exercise separately and retain
timeouts, partial results and changed-input provenance. Historical observations in
`previousObservation` are not expected answers. The separate service benchmark
retains its own preparation, timing and independent-evaluation contracts.

This suite supplements the configured full-population performance policy in
`AGENTS.md`; reuse retained TS controls, with stress treated as opt-in.
Use focused subsets while adapting the runner and fixing capabilities. Keep raw
results in `.local/`; close owned browser/profiling processes after each profile.
