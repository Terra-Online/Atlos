# AGENTS.md

## Development

Historical measurements and passed checks do not verify changed code or inputs.
Run focused validation and broaden it only for a concrete unresolved concern.

Algorithm changes belong in this package. Noclip-specific adapter and renderer changes
belong in Atlos's maintained integration patches; generated
`talos/.cache/noclip` source is not an editing target.
Do not include unrelated workspace changes or push without explicit authorization.

## Primary 266-case baseline and soft merge gates

The primary development benchmark is the Node/TS **mechanism service benchmark**:
`bench/mechanism-benchmark.ts`, exposed as `pnpm benchmark:mechanisms`, with the
revision-11 `bench/scenes/mechanisms/suite.json` population of 266 fixed IDs.
The integration source baseline is `0c4d5dfb` (algorithm equivalent to `9e1a7906`).
This is a coordination checkpoint with known failures, not a passing release.
Its 6144 MiB service run OOMed at case 017 after 16 returned measurements. The
published 222/266 direct-diagnostic census mixes source revisions and is not this
service baseline's completion score. Consult the canonical handoff/history for
the retained evidence and the unresolved replay discrepancies.

Use Node 26 and prepare inputs from a matching local game installation using the
[collaborator setup recipe](bench/scenes/mechanisms/README.md#generate-service-benchmark-inputs).
Run `pnpm benchmark:prepare-mechanisms` as documented there; it creates routing
exports, frozen physical windows and `input-index.json`. No author-local dataset
or historical candidate hash is required. Run the command below from this package
with the generated directory, prepared extractor and a fresh report destination.

```sh
export GANGLIA_INPUT_ROOT=/absolute/path/to/generated-mechanisms-266
export GANGLIA_EXTRACTOR=/absolute/path/to/talos/.cache/noclip
export GANGLIA_CONFIG=/absolute/path/to/endfield.local.json
export GANGLIA_REPORT=/absolute/path/to/new-run/report.json
GANGLIA_BENCHMARK_HEAP_MB=6144 GANGLIA_BENCHMARK_QUERY_SLO_MS=60000 \
  pnpm --silent benchmark:mechanisms \
  --adapter ganglia-v1-ts \
  --suite bench/scenes/mechanisms/suite.json \
  --data-root "$GANGLIA_INPUT_ROOT" --extractor "$GANGLIA_EXTRACTOR" \
  --prepare-config "$GANGLIA_CONFIG" \
  --scenario-workers 1 --output "$GANGLIA_REPORT"
```

The runner verifies the index against the checked-out suite, game source and
player profiles. Regeneration creates a new candidate revision; the historical
`a81d74f68cddd9d14ebc363474e8ec17d0e500776e59113cbe454017f5be9ce2`
is provenance only, not a value to copy into new inputs. Freeze one generated
input directory for both baseline and candidate measurements. The checked-in
recipe is a new input binding, not a byte-identical reconstruction of missing
historical exports. Always supply `--prepare-config` for expandable scene cases.

The benchmark uses one scenario worker and one serial lane, trains
`min(10, scenario case count)` queries, freezes the catalog, performs two warmups
on that same worker, and measures one round. Training overlaps scored queries;
this is the complete population, not an unseen holdout. The 60000 ms deadline
requests cooperative cancellation; cancellation tails count in service time.
Keep the worker alive between requests; crashes invalidate the run. Independent
physical replay occurs after timing. Report native completion, replay validity
and mechanism exercise separately. Keep construction-time physical/resource/goal
checks active, and investigate replay disagreements without silently redefining
success. Raising the heap, changing deadlines or using `--ids` produces diagnostic
or different-configuration evidence, not the fixed full-population comparison.

### Agreed numerical objectives

- Reach **266/266 complete native end-to-end routes** to the original interaction
  goals on one frozen source/input revision; continue reducing the unfinished set.
  Partial approaches do not count. Preserve all seven negative controls and report
  required mechanism exercise and independent physical replay separately.
- First eliminate OOM under the **6144 MiB** heap and finish a same-source full
  service run. Freeze that first operationally complete run as the numerical
  performance reference; the interrupted run cannot supply a population mean.
- Reduce full-population mean serial service latency by **at least 50%** against
  that compatible reference. Include all attempts and cancellation tails, and
  report completion changes, matched-case timing and preparation/end-to-end time
  so early failures cannot masquerade as speedups.
- On comparable completed routes, keep candidate/reference modeled-cost geometric
  mean **<=1.01** and worst per-case ratio **<=1.05**. Preserve paired coverage and
  list unpaired cases; missing results cannot pass a cost gate.

Preserve existing completion coverage in every algorithm PR. Aim for **at least
one newly reproducible complete case**, or **>=10% improvement** in paired route cost,
mean serial latency or consistently sampled peak memory. Report all three metrics
and regressions, not just the winning metric; retain the cost limits above.
These are soft review gates, not a requirement to achieve 266/266 or 50% in every
PR. Correctness repairs, benchmark fixes or justified smaller gains may merge with
an explicit explanation and human agreement. Do not relax inputs, remove failures,
change physical semantics or increase resource budgets to manufacture a pass.

Use focused existing regressions and directly affected real cases for each small
PR. Run a full population when establishing/comparing population performance or
when the changed shared behavior warrants it; do not rerun solved full cases for
every experiment. Preserve immutable raw reports, journals, invocation parameters,
source/input hashes and previous failures. A full benchmark must finish before
claiming full-population acceptance. Post-merge continuation should start from the
updated `feat/3d-preview` and contain one strategy/fix per PR.

## Secondary map02 performance benchmark

Use focused cases while diagnosing a change. Publish map02-specific performance from the complete
local `map02` population, currently 50 requests; it supplements the primary
266-case mechanism benchmark and cannot replace its coverage target. Preserve the algorithm's service
preparation: train the catalog, freeze it, then warm the same prepared solver before
measuring. Report preparation and end-to-end cost alongside serial query latency.
Reuse retained TS baselines; run a new TS control only when the user requests it.
Long-distance stress is an opt-in investigation, outside routine acceptance.

For mechanism coverage, use `pnpm benchmark:mechanisms` and read its
[input preparation and commands](bench/scenes/mechanisms/README.md). The 266-case
suite is a scenario manifest with per-case rules and exercise assertions; preserve
those through its dedicated runner when testing devices, resources or box layouts.

From this directory, use Node 26 on PATH and verified local datasets. Build the
release native artifact with `pnpm rust:build`, then run the configured benchmark:

```sh
pnpm --silent benchmark:full --adapter ganglia-v1-rust --workload map02 \
  --workers 1 --concurrency 1 --json > /tmp/ganglia-rust.json
```

`GangliaV1Config.preparation` is required and defaults to ten catalog-training
requests and two warmup requests. The built-in benchmark adapter binds those
counts to tracked requests in `bench/scenes/map02.ts`, independently of the scored
workload. Omitting command-line options preserves preparation. Optional training
and warmup flags are not supported. The V1 scoring entry rejects missing training
records, an unfrozen catalog or wrong warmup counts. Warmup outcomes, including
timeouts and invalid routes, are reported separately and do not block scoring.

All fifty requests from `bench/scenes/map02.ts` remain scored. Training can overlap
scoring because catalogs retain physical connections rather than complete-query
answers; report that overlap and call this the full population, not an unseen
holdout. Warmup uses separate goals and excludes scored queries. Service startup
must use the configured training, freeze and warmup order on the same prepared
solver. `benchmark:full` defaults to one measured round; use `--rounds`
only when repetition is explicitly desired. No two-round convention is implied.
Timeouts request cooperative cancellation. Wait for the current solver stage to
reach a checkpoint before reusing the same worker. Never kill or replace workers
on a deadline, cancellation grace period or failed request. Actual process crashes
invalidate the run. Cancellation tail time stays in the measured service latency.

`bench/workload.ts` defines preset data roots. Use `--data-root`, `--extractor` and
`--config` for explicit datasets, adapters and policy. Verify game build, package
format and preparation provenance. Freeze source, inputs and native binary for a
run. Include `--reference <retained-report.json>` only for a compatible existing
control; missing baseline coverage does not require another TS run.

Use `--output /absolute/path/report.json` to select the report destination; without
it the CLI creates a fresh temporary directory and prints its path. Each request
is appended to the adjacent `.events.jsonl` journal as it finishes. Aborted runs
retain their journal and an interrupted summary. Retain raw JSON, commands,
bindings and all request outcomes. Report completion,
physical validity, partial results, failures, timeouts, modeled cost and serial
latency distribution for the complete population. Use the independent verifier
and unchanged quality gates. A small regression subset is diagnostic evidence;
repeated rounds measure repeatability rather than broader coverage. Write public
performance comments using `ganglia-speedup-report` and full-population results.

### Adding workloads

Put reusable workloads in `bench/scenes/` and register named presets in
`bench/workload.ts`. `--workload /absolute/path/cases.json` also accepts an array
of `{ id, query, horizontalDistance? }`; `query` follows `RouteQuery`, including
`starts` and `goal`. Keep private game-derived datasets and provenance in `.local/`.

Choose requests from provider facts or a reproducible sampling procedure before
inspecting solver results. Record the seed, selection criteria, game build,
exporter, state/profile and coverage. Resolve endpoints against physical support;
expected reachability and quality come from independent validation, not a selected
solver's answer. Preserve failed and timed-out cases in the scored population.

Expand independent regions/scenes, elevation changes, both travel directions,
distance ranges and relevant mechanics such as devices, resources, waypoints and
sparse window transitions. Nearby coordinate variations alone add little coverage.
Keep development regressions and held-out requests distinct. Once a holdout has
guided tuning, retain it as a regression and add fresh unseen coverage. Generalize
fixes through world facts and algorithm rules; keep map coordinates, witness routes
and case-specific budgets out of production search. Freeze the acceptance workload
and thresholds before comparing implementations, then report each stratum and the
complete population.

## Local development resources

Keep dependency clones, downloaded data, generated datasets, caches and private
configuration under `.local/` in the Atlos repository root, or use explicitly configured
external data directories. Resolve the resource root independently of the package
working directory so package-local commands can reuse verified datasets.
Keep `.local/` excluded from Git.

Inspect local files and repository instructions to determine available resources
and their current setup. Record dataset provenance alongside the data, including
its game build, exporter version and state/profile settings. Preserve verified
inputs when generating a new dataset version.
