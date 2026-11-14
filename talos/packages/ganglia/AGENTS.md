# AGENTS.md

## Development

Historical measurements and passed checks do not verify changed code or inputs.
Run focused validation and broaden it only for a concrete unresolved concern.

Algorithm changes belong in this package. Noclip-specific adapter and renderer changes
belong in Atlos's maintained integration patches; generated
`talos/.cache/noclip` source is not an editing target.
Do not include unrelated workspace changes or push without explicit authorization.

## Solver benchmarks

Use focused cases while diagnosing a change. Publish performance from the complete
local `map02` population, currently 50 requests. Preserve the algorithm's service
preparation: train the catalog, freeze it, then warm the same prepared solver before
measuring. Report preparation and end-to-end cost alongside serial query latency.
Reuse retained TS baselines; run a new TS control only when the user requests it.
Long-distance stress is an opt-in investigation, outside routine acceptance.

From this directory, use Node 26 on PATH and verified local datasets. Build the
release native artifact with `pnpm rust:build`. A trained full-population command is:

```sh
pnpm --silent benchmark:full --adapter ganglia-v1-rust \
  --workload /tmp/training-and-scored.json --catalog-train 10 \
  --offset 10 --limit 50 --warmup-workload /tmp/warmup.json \
  --workers 1 --concurrency 1 --rounds 2 --json > /tmp/ganglia-rust.json
```

The workload array contains ten declared training cases followed by all fifty
unaltered scored cases from `bench/scenes/map02.ts`. Supply two separate warmup
queries. Training may share starts or queries with scoring when the implementation
retains reusable physical connections rather than complete-query answers; declare
that overlap and call the scored set a full population, not an unseen holdout.
Warmup must exclude scored queries. Check catalog population/freeze/persistence and
successful warmup before accepting the measured service as ready. A preparation
timeout that loses the worker's catalog must stop the run before scoring.

`bench/workload.ts` defines preset data roots. Use `--data-root`, `--extractor` and
`--config` for explicit datasets, adapters and policy. Verify game build, package
format and preparation provenance. Freeze source, inputs and native binary for a
run. Include `--reference <retained-report.json>` only for a compatible existing
control; missing baseline coverage does not require another TS run.

Retain raw JSON, commands, bindings and all request outcomes. Report completion,
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
