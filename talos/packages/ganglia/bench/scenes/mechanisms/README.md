# Mechanism acceptance inputs

Use this contract when preparing mechanism inputs or changing the runner.
`suite.json` declares scenarios with shared world setup, ordered training case IDs, queries, source bindings and exercise assertions. Training selection is independent of measured ID filters; no runtime warmup precedes the first measured query. Keep raw
game assets, profiles and private config local.

## Choose the runner

Use `pnpm benchmark:mechanisms --adapter ganglia-v1-ts` for service measurements.
This service runner reads `input-index.json`, loads explicit scenarios, trains/freezes their kernels,
then scores routes and independently replays complete results. The beta replay
result is reported separately and does not gate search completion or acceptance. The CLI defaults
to Rust, so select TS explicitly. `--audit` checks the suite/index binding without
solving.

`bench/mechanism-run.ts --mode physical-diagnostic` is an optional older per-case
TS diagnostic without service training or independent whole-route replay. Its
reports have a different preparation/timing contract and cannot substitute for
service acceptance.

`progress.json` and `progress.html` contain a mixed-revision historical census.
`previousObservation` and `selectionCapabilityGap` record selection provenance,
not expected answers or current capability guarantees.

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
export GANGLIA_INPUT_ROOT="$PWD/.local/data/mechanisms-266-generated"
export GANGLIA_EXTRACTOR="$PWD/talos/.cache/noclip"
pnpm --dir talos/packages/ganglia benchmark:prepare-mechanisms \
  --config "$GANGLIA_CONFIG" --extractor "$GANGLIA_EXTRACTOR" \
  --output "$GANGLIA_INPUT_ROOT"
```

Add `--plan` to inspect the bindings without game reads or output writes. Actual
preparation requires matching game files/keys, refuses existing destinations and
publishes `input-index.json` only after exports succeed. Retain failed output for
diagnosis and retry at a new destination. Generated inputs have a new revision;
freeze the same dataset for baseline/candidate runs rather than inheriting historical
scores. Keep private configuration and raw game content local.

Check the service binding without solving:

```sh
pnpm --dir talos/packages/ganglia benchmark:mechanisms \
  --adapter ganglia-v1-ts --data-root "$GANGLIA_INPUT_ROOT" \
  --extractor "$GANGLIA_EXTRACTOR" --prepare-config "$GANGLIA_CONFIG" \
  --audit --output /absolute/path/to/new-service-audit.json
```

The service uses the index to locate each Case's input directory. Existing inputs
can be reused when their source, profiles and case bindings still match. The
report records the suite and the input index digests separately.

The per-case
diagnostic instead consumes manifest paths and `<scene-data-root>/<caseId>`;
it does not read this index. Converting between layouts needs explicit source
bindings, including retained request/wall facts, rather than a renamed directory.

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
3. Honor frozen physical windows and `allowExpansion: false`. `physicalRegions`
   binds source bounds/settings. Report missing snapshots as input-unavailable.
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
