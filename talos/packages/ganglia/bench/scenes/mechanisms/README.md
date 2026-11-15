# Real-scene mechanism benchmark

The frozen revision-10 specification comes from `chan/algo-progression` at
`352c62b9397a9e738a041c4dce9426bdc7933509`. Its 266 entity/contact goals cover
map01/map02 and 16 authored levels. The original queries, setup, IDs, source
bindings and assertions are retained in `suite.json`. Selection uses source facts
and includes retained failures; a selected target is not a promise of reachability.

The groups include 113 retained regressions, ropes, launch devices, boosts, moving
supports, following boxes, resource/composition scenarios, navigation boundaries,
12 multi-box layouts and four circular-waterwheel targets. Six geometry probes
and the negative/development controls remain separate from the main population.
`cases.csv`, `coverage.json` and `multi-box.csv` index the selection. Historical
`previousObservation` fields describe the selecting branch, not results here.

## Running

From the Ganglia package, with Node 26 and a release native artifact:

```sh
GANGLIA_V1_RUST_LIBRARY=/absolute/path/ganglia-v1.node \
pnpm --silent benchmark:mechanisms --adapter ganglia-v1-rust \
  --data-root /absolute/path/candidate-inputs \
  --prepare-config /absolute/path/private-game-config.json \
  --output /tmp/mechanisms-rust.json
```

Use `--ids id,id` for focused diagnostics or `--audit` to inspect input bindings
without solving. Omit `--ids` for all 266 cases. One measured round is run.
`GANGLIA_BENCHMARK_QUERY_SLO_MS` selects the cooperative deadline, with the existing
300-second default. Cancellation retains the worker and its prepared state.
The report and adjacent event journal preserve failures, partial routes, timeouts,
unsupported setup and every selected ID. Full routes and physical evaluations are
saved in the report's `.artifacts` directory.

Each scenario group retains one prepared solver. `--scenario-workers` defaults to one;
independent groups can run concurrently when memory permits. Timings from a parallel
coverage run include resource contention and do not establish a serial speedup.
Each scenario config caps the default ten training queries at its case count,
then requires catalog freeze and two warmup queries before scoring. The effective
config is recorded for each preparation. Training selects evenly across the group.
Its overlap with scoring is explicit. Warmup makes separate zero-leg
queries at source positions. Preparation outcomes and readiness costs are recorded;
failed warmup does not erase the catalog or prevent subsequent requests.

Cases run through the current `PreparedRouteSolver` Scene seam. Frozen cases keep
their specified physical window and disable expansion. The selecting branch ran
untrained diagnostics and directly called its physical solver for those cases;
the imported workload is shared while the service lifecycle follows this branch.
Scenario locomotion configures both the Scene resource clock and physical windows.

The Node adapter includes the `352c62b9` solver and circular-support facts. Reports
count `nativeComplete` separately from independently verified completion. Rust
continues to report circular-waterwheel setup as unsupported.

Route completion, independent whole-route physical validity and mechanism exercise
are separate results. An alternative valid route can complete a case without using
its intended mechanism. Multi-box credit requires actual support use of all counted
placements in one joint layout. The current branch does not implement circular
waterwheel domains in Rust and reports those cases as unsupported setup for that adapter.

## Candidate inputs

Game assets and private configuration stay outside Git. `input-index.json` binds
the exact suite SHA-256 and a candidate-input revision to a directory for every ID:

```json
{
  "suiteSha256": "<sha256 of suite.json>",
  "revision": "<candidate provenance digest>",
  "source": { "buildGuid": "<selected build>", "contentHash": "<selected content>" },
  "profiles": {
    "map01": { "radius": 0.3499999940395355, "height": 1.659999966621399 },
    "map02": { "radius": 0.3499999940395355, "height": 1.659999966621399 }
  },
  "cases": { "001-05f0PbU": { "directory": "frozen/map01_lv001" } }
}
```

The root's `routing/` contains source-bound interaction and traversal exports.
Each case directory follows the existing scene benchmark layout, with navigation,
movement and traversal files in `routing/` and physical snapshots in `scene-<scene>/`.
Fixed-window cases load only their specified window, with expansion disabled.
Other cases can use `--prepare-config` to export missing source collision windows.
Apply resource and following-placement policies before both solving and verifying.
Preserve the complete source body/collision inventory. Starts that request projection
use the selecting branch's source-volume witness procedure; the requested goal is
retained exactly, and original/resolved queries are recorded separately.

Fresh geometry exports need a new candidate revision and generator/source hashes.
They do not recreate the selecting branch's retained snapshots or historical
request-wall selection. Record that distinction in provenance. The local v119
candidate retains the selected game build, queries, profiles and fixed bounds,
while regenerating geometry and source air walls. It establishes current-input
coverage, not a historical timing or speedup comparison.
