# Stair routing implementation and validation

2026-11-04, SDK `0.1.0-alpha.22`. Validation uses the requested world snapshot
with all level tasks completed and teleport arrivals available. Game-data build
is `2954fa80-23c1-1579-2b22-4ecfd6d70418`, content hash
`23821a7611be5c0478dc4695d96fd74a`.

## Implemented behavior

Ground construction builds support connectivity directly through Recast compact
spans. Each connection requires an individually admissible step and shared
headroom. Radius erosion excludes space beside missing connections. Slope
selection, low-height filtering and the existing conservative voxel step margin
remain part of construction. This preserves continuous stair runs whose combined
neighbor height range exceeds one step. The same rule applies to all geometry.
Native intermediates are released on success, empty output and failure. The
higher-level generator dependency has been removed.

Tile transfers retain paired entry and exit intervals with direction and height
correspondence. Their admitted width is clipped against directional step limits.
Search, tracing and exposed-boundary discovery share interval validation. Tracing
reconstructs both heights at a step, and visibility is checked independently in
each direction. Legacy point-only transfers retain exact point crossings.

If obstacle checks disconnect polygon representatives, search also considers the
support corridor and checks every reconstructed continuous segment against all
exclusions. This recovers clear paths around blocked graph centres. Corridors
whose reconstructed path intersects an exclusion remain rejected.

The noclip importer resolves air walls under the completed-task policy using
explicit controller sources and consistent wall assignments across the analyzed
event paths. Conflicting writes and undecoded scripts retain unknown state.
This is a planning snapshot interpretation.
Actual runtime state and game execution require separate validation.
Empty mission rise/down lists represent no activation reason. They preserve the
initial false checker state, including when the authored list uses all semantics.
Level-script walls use an authored base switch after an explicit controller
scan. Additional runtime state requires separate snapshot input.

The subsequent control audit replaces the owner-only export interpretation with
`wall-controls-v2`. The level-script check type can be controlled by group id
even with a zero stored owner. Defaults now follow an explicit controller scan,
and conflicting writers remain unknown. Level briefs provide declared stage
limits and parameterized global targets. The completed snapshot selects the
maximum stage and clears explicit wall references of completion-disabled
encounter and fog-nest modules. Unknown branch guards cannot establish that a
write executes. The revised two-scene snapshot has 347 inactive, 43 active and
114 unresolved walls, down from 196 before module and brief resolution. These
stage and base-switch selections remain planning assumptions. The three
additional elevated examples retain complete physical walking routes under
these exclusions. Rechecking the fixed reference-positive population with the
revised wall states retains 31/31 walking routes, including all 13 measured
step-profile cases.

The physical command writes an atomic provisional walking result before airborne
indexing and optional shortcut discovery. Atlos displays it while continuing to
poll. Interrupted provisional caches remain resumable and preserve their marker
until a completed result is written.
Foreground ground construction and walking queries use a separate queue from
background action optimization. An unavailable walking query expands bounded
ground coverage before airborne discovery. With a complete walking baseline,
interactive shortcut discovery has a separate 512-candidate budget, compared
with 8000 for unresolved movement reachability. Truncation remains explicit.

## Regression validation

The staircase family has 12 risers of 0.2 m, tread depths 0.20, 0.25, 0.30 and
0.45 m, rotations of 0, 22.5 and 45 degrees, non-aligned grid offsets, and travel
in both directions. All 24 directed queries complete with walking alone at the
existing 0.15 m horizontal resolution.

Additional regressions cover tiled stairs, excessive rises, low ceilings,
directed widths, partial boundary coverage and intervals near polygon corners.
Existing gap, stacked-floor, obstacle, narrow-passage and unknown-exclusion
regressions also pass.

- Release packaging passed all 143 SDK tests.
- Focused noclip command, wall-state and ground-data validation passed 23 tests.
- Atlos walking-adapter and provisional-cache validation passed 5 tests.
- World type checking and changed extractor files' type-aware lint checks passed.

## Real-scene population and reference

Four cached physical build rectangles define the fixed population. A candidate
is a source-derived target inside its rectangle whose nearest same-level teleport
is also inside and differs in height by at least 1 m. This produces 71 candidates
across `map01_lv001`, `map01_lv005` and `map01_lv006`.

An independent alpha.21 build at 0.075 m resolution supplies the positive walking
reference. Alpha.22 uses the existing 0.15 m resolution. Both use matching collision
selection, body, interaction goals, completed-world exclusions and nearest
teleport. All queries use the ordinary SDK planning entry point.

| Region | Candidates | Reference walking positives | Alpha.21 at 0.15 m | Alpha.22 at 0.15 m |
| --- | ---: | ---: | ---: | ---: |
| Industrial area | 25 | 9 | 5 | 9 |
| Highlands | 9 | 8 | 8 | 8 |
| Settlement | 22 | 9 | 9 | 9 |
| Western area | 15 | 5 | 5 | 5 |
| Total | 71 | 31 | 27 | 31 |

All 31 reference-positive queries complete with walking alone. Thirteen have at least
four 0.1–0.4 m support-height changes detected by sampling source collision along
the reference route at horizontal spacing up to 0.1 m. This operational
step-profile subset improves from 10/13 to 13/13 and includes the supplied case.
The completed-world empty-condition correction enables the eight highlands
reference positives. Both geometry versions use the corrected snapshot here.

Newly connected targets are `3500030845`, `3500030883`, `3500090007` and
`3500090009`. The other 40 candidates lack a complete reference walking route
within these inputs and bounds. Their reachability remains unclassified.
Walking-positive acceptance uses a denominator of 31. Scene-wide coverage needs
broader source coverage and independent game validation.

Complete local evidence remains in noclip's `.research` directory as
`stairs-{region}-population.json`, `stairs-{region}-reference.json`,
`stairs-{region}-current.json` and `stairs-{region}-acceptance.json`.

## Normal Atlos entry

Point `3500030845`, token `100yS9e`, returns a physical-ground candidate from
`TpForMap_ent_3500031060`, with only `walk` segments and model duration
21.973707687614016 seconds. The normal `?planRoute=nearest` page displays the route
on the minimap and in 3D, with timed playback controls.

The completed-task policy selects stage 3 for the owning wall script in this
case, where the wall is inactive. Intermediate stage 2 can enable it on a trigger.
Task state therefore belongs in route applicability and cache inputs.

The inspected final query completes optimization and retains the walking route.
A subsequent cached HTTP query took about 0.086 seconds. Cold building and total
optional optimization have separate costs.

### Additional elevated targets and performance

`0loYRkm` (`2100020787`) and `14lAI8l` (`22800420034`) both return walking
candidates through the normal nearest-route endpoint. Their physical-ground
walking checks complete at model durations of 33.02 and 30.39 seconds respectively.
The viewer retains shorter authored-navmesh incumbents of 30.36 and 30.16 seconds.
The former target needs both the completed mission-gate correction and continuous
corridor verification around blocked graph representatives.

With collision-ground artifacts cached and route-query caches missing, the
foreground physical walking commands took about 7.9 and 8.4 seconds. These are
command timings including input loading. A simultaneous HTTP run produced the
authored-navmesh incumbents after about 0.54 and 4.00 seconds. Optional background
work finished later. A subsequent mixed-cache run completed both queries and
retained walking, with shortcut work and queueing still taking tens of seconds.
These observations do not measure cold collision extraction or in-game travel.

Stage timings are retained as `diagnostics.timingMs`. The two user examples show
that unresolved exclusions, representative-graph disconnection, queueing and
optional action comparisons can dominate latency. Additional height can increase
support-face count, but height alone does not determine the search workload.

`0165dV6` (`22800010057`) initially expanded repeatedly because an unowned,
unconditional, default-off wall remained unknown. Resolving that default in the
same completed snapshot produces a physical walking baseline of 31.87 model
seconds. Optional action comparison selects a 30.77-second route with three
jumps. The full command takes about 33.7 seconds with physical ground cached,
including a 7.7-second walking stage and 24.0-second shortcut stage. A polling
client joining the existing job receives the final route within 27.3 seconds.
The normal page displays the final route and playback controls.

## Remaining work

Support-region contraction and a shared regional hierarchy remain future work.
The global graph still contains detail support faces. Joint corridor/resource
search, broader dynamic-device semantics, complete collision coverage and
in-game execution calibration remain governed by the main architecture.
