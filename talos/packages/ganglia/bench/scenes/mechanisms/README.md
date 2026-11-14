# Real-scene mechanism acceptance inputs

This is a shared, frozen **acceptance specification requiring runner adaptation**.
The user authorized sharing these case definitions and source bindings. Raw game
assets, collision/navigation snapshots, profiles and private configuration remain
local. No solver implementation or successful full-suite replay is included.

The 266 distinct target positions span map01/map02 and 16 authored levels, plus
six navigation-derived contacts without an authored level assignment. They include
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

Case IDs retain their original `v250-` prefix after expansion to 266. Preserve IDs
when adapting runners. Record any changed query, setup, source or scoring rule as
a new workload revision rather than silently replacing the comparison control.

## Adaptation contract

The current `bench/workload.ts` custom-workload path expects a plain query array.
**Do not pass this manifest directly to `--workload`, or strip it down to queries
and call the result full mechanism acceptance.** It requires these adaptations:

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

This suite supplements the required local/stress TS/Rust workloads in `AGENTS.md`.
Use focused subsets while adapting the runner and fixing capabilities. Keep raw
results in `.local/`; close owned browser/profiling processes after each profile.
