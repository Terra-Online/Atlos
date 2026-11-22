# Mechanism acceptance inputs

Use this contract when preparing mechanism inputs or changing the runner.
`suite.json` declares scenarios with shared world setup, ordered training case IDs, queries, source bindings and exercise assertions. Training selection is independent of measured ID filters; no runtime warmup precedes the first measured query. Keep raw
game assets, profiles and private config local.

## Choose the runner

Use `pnpm benchmark:mechanisms --adapter ganglia-v1-ts` for service measurements.
The runner opens one physical pack per selected scene, loads scenarios, trains/freezes their kernels,
then scores routes and independently replays complete results. The beta replay
result is reported separately and does not gate search completion or acceptance. The CLI defaults
to Rust, so select TS explicitly. Before starting workers, the runner checks the
required input paths for all selected scenarios and reports missing paths together.

`bench/mechanism-run.ts --mode physical-diagnostic` is an optional older per-case
TS diagnostic without service training or independent whole-route replay. Its
reports have a different preparation/timing contract and cannot substitute for
service acceptance.

`progress.json` and `progress.html` contain a mixed-revision historical census.

## Add a sample

Append a case to the scenario that shares its world setup. A case needs a unique
`id`, a `query`, and `expect` with a `kind` and an `assertions` array. Add
`requirements` for mechanism witnesses or start projection. Projected rope and
launch starts may also use `metadata.group`, `metadata.tags` and `metadata.evidence`
to select their source contact. Suite, scenario and case objects accept an
optional `note`. List the case ID in `training` only when its request should train
the scenario's kernel.

The [editor schema](suite.schema.json) is generated from the
[runtime schema](../../mechanisms/suite-schema.ts). After editing the runtime
schema, regenerate it with `pnpm benchmark:mechanism-schema`.

## Optional per-case diagnostic inputs

The diagnostic resolves `exports/` and `retained/` references through `--exports`
and `--retained`. Frozen cases require the exact ground/collision paths and retained
request files named in the suite. Expandable cases require
`<scene-data-root>/<caseId>/routing/` and matching scene inputs. Use `--device-exports`
only for an explicitly rebound device export; scene routing must resolve those
same files. `--prepare-config` enables physical-window generation during scene work.

Run `--audit` before solving. It checks required paths/setup, not complete asset
validity or route feasibility. Provision source-bound diagnostic inputs explicitly;
the service generator below does not create this retained/per-case layout.

## Generate service inputs

Use Node 26, a game installation matching `suite.json.requiredSource`, the pinned extractor
and a validated private config. From repository root:

```sh
export GANGLIA_CONFIG=/absolute/path/to/private-config.json
export GANGLIA_INPUT_ROOT="$PWD/.local/data/mechanisms-266-pack"
export GANGLIA_EXTRACTOR="$PWD/talos/.cache/noclip"
pnpm --dir talos/packages/ganglia benchmark:prepare-mechanisms \
  --config "$GANGLIA_CONFIG" --extractor "$GANGLIA_EXTRACTOR" \
  --output "$GANGLIA_INPUT_ROOT"
```

Add `--plan` to inspect the directories without game reads or output writes.
Preparation requires matching game files and keys and refuses existing destinations.
It publishes the Dataset’s `input-index.json` after all exports succeed.
Retain failed output for diagnosis and retry at a new destination. Reuse the
same dataset for baseline and candidate runs. Keep private configuration and raw
game content local.

Each scenario selects a dynamic corridor or a fixed window from its scene's
pack. The Suite defines fixed bounds in `sources[scene].regions`. The Dataset
registers one directory per scene under `inputs[scene].directory`, relative to
`--data-root`. Both selections use the same immutable ground and collision
blocks. The runner assembles windows in the worker and records the manifest
digest. Use `--memory-budget-mib` to set the total loader budget, shared among
scenario workers (2,048 MiB by default). The budget estimates memory held by
loaded blocks and assembled windows. Solver memory is sampled separately.
Rebuild the pack for the source and coverage being measured.

## Input files

- `suite.json`: authoritative scenarios and physical/source contracts.
- `cases.csv`, `coverage.json`, `coverage.csv`, `multi-box.csv`: case and intended
  mechanism indexes. Selection alone does not establish reachability or exercise.
- `legacy-id-map.csv`: mappings for replaced queries and geometry probes.
- `geometry-probes.json`: non-entity geometric queries outside the main population.
- `development-controls.json`: retained development regressions, separate from holdouts.
- `negative-controls.json`: unavailable/occupied source and bounded-coverage controls.
- `progress.json`, `progress.html`: retained outcomes with source/evidence bindings;
  referenced `.local/` artifacts are not shipped.

Preserve IDs and their existing point-token codec. `tokenSourceId` and `tokenRole`
distinguish collectibles from facility contacts. Query, setup, source or scoring
changes require a new workload revision and an explicit candidate binding. Retain
original controls and selection provenance; matching coordinates do not recreate
old geometry or constitute a same-input algorithm gain.

## Adaptation contract

Use the dedicated mechanism runner. `benchmark:full --workload` accepts a plain
query array and cannot preserve this manifest's acceptance semantics.

1. Resolve logical `exports/` and `retained/` resources through configured local
   roots. Match build, exporter, movement/profile and progression. Regenerated
   geometry needs a new binding; retain prior exports unchanged. Wheel-domain and
   following-box geometry corrections require regenerated candidate facts.
2. Preserve starts, arrival states/costs, original goal, interaction volume and
   facing/airborne rules. Prove support for projected starts. `waypoints` are ordered
   discovery hints; they impose no trace-visit or stopping requirement.
3. A `frozen-window` scenario uses the bounds declared for its window under
   `sources[scene].regions`. Dynamic corridors use the physical coverage exported in the scene pack.
4. Apply merged `setup.locomotion` before preparation. `locomotionPatch` records
   intent. Preserve device facts, following-box activity ranges and source
   collisions; reject unsupported setup explicitly.
5. `requiredDevice`, `requiredSupport`, `followingPlacement` and assertions govern
   mechanism credit. A valid alternative may pass route feasibility without
   exercising the selected mechanism. Retain legitimate alternative routes.
6. Multi-box credit requires a coherent jointly valid placement and route use of
   every counted box. Separate single-box successes do not compose into proof.
   Conveyor `expectedContactPose` is one feasible example; other poses are valid
   if they support the complete contact run. Display selected used boxes at their
   chosen placements.
7. Waterwheels require the agreed traversable circular domain with source geometry,
   external obstacles and entry checks. Phase synchronization and waiting are
   outside this model. A static terminal pose does not establish domain coverage.

Search success requires an end-to-end timed route to the original goal. Keep action
construction checks active and report partials, failures, timeouts, physical validity
and mechanism exercise separately. Separate input preparation and dispatch time
from solver time. A changed-input result retains its new provenance.
