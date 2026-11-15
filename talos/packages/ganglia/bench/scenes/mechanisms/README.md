# Real-scene mechanism acceptance inputs

This is a shared, frozen **acceptance specification** consumed by
`bench/mechanism-run.ts --mode physical-diagnostic`.
The user authorized sharing these case definitions and source bindings. Raw game
assets, collision/navigation snapshots, profiles and private configuration remain
local. `progress.json` and `progress.html` publish a frozen per-case progress
snapshot; they do not represent a successful same-source full-suite replay.

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
