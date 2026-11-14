# Real-scene mechanism acceptance inputs

This is a shared, frozen **acceptance specification** consumed by
`bench/mechanism-run.ts --mode physical-diagnostic`.
The user authorized sharing these case definitions and source bindings. Raw game
assets, collision/navigation snapshots, profiles and private configuration remain
local. No solver implementation or successful full-suite replay is included.

The main collection contains 266 distinct real entity/contact target positions
across map01/map02 and 16 authored levels. Six non-entity navigation queries are
retained separately as geometry probes. They include
113 retained regressions, 137 mechanism-selected cases, 12 multi-box cases and four
circular-waterwheel cases. Failures in the retained population remain included.
New mechanism selections are opportunities to exercise a feature, not proof that
the feature is necessary or that the target is reachable.

`selectionCapabilityGap` preserves the pre-prototype selection context. Current
implementation and probe results live in the canonical handoff/history records.
The circular and joint-box TS prototypes do not turn these unrun cases into passes.

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

Before performance comparison, independently replay complete routes with the
original physical inputs, goal events and whole-route resource accounting. Report
feasibility and mechanism exercise separately, retain timeouts and partial results,
and report each scene/mechanism group as well as the full population. A local
source-reference audit is not physical acceptance. Historical observations in
`previousObservation` are not expected answers or current verifier results.

This suite supplements the configured full-population performance policy in
`AGENTS.md`; reuse retained TS controls, with stress treated as opt-in.
Use focused subsets while adapting the runner and fixing capabilities. Keep raw
results in `.local/`; close owned browser/profiling processes after each profile.
