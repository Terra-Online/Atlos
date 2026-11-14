# AGENTS.md

## Development

Historical measurements and passed checks do not verify changed code or inputs.
Run focused validation and broaden it only for a concrete unresolved concern.

Algorithm changes belong in this package. Noclip-specific adapter and renderer changes
belong in Atlos's maintained integration patches; generated
`talos/.cache/noclip` source is not an editing target.
Do not include unrelated workspace changes or push without explicit authorization.

## Solver benchmarks

Use focused cases while diagnosing a change. Before accepting solver correctness
or performance changes, run the complete `map02` and `map02-stress` workloads with
both `ganglia-v1-ts` and `ganglia-v1-rust`. `map02` currently covers 50 local
requests from 25 starts to two goals; `map02-stress` covers 14 directional requests
including long-distance travel and detours. Report them separately: the local
requests share a small region. A six-request subset is a regression check;
additional rounds measure repeatability, not geographic coverage.

From this directory, with Node 26 on PATH and verified local datasets available:

```sh
pnpm rust:build
pnpm --silent benchmark:full --adapter ganglia-v1-ts --workload map02 \
  --workers 1 --concurrency 1 --rounds 2 --json > /tmp/ganglia-ts-local.json
pnpm --silent benchmark:full --adapter ganglia-v1-rust --workload map02 \
  --workers 1 --concurrency 1 --rounds 2 \
  --reference /tmp/ganglia-ts-local.json --json > /tmp/ganglia-rust-local.json
```

Repeat the pair with `--workload map02-stress` and distinct output filenames.
`bench/workload.ts` defines each preset's default data root. Use `--data-root`,
`--extractor` and `--config` for explicitly selected datasets, normalized-input
adapters and solver settings; keep those inputs identical within each pair.
Verify package format, game build and preparation provenance before running.
Run the implementations sequentially, with frozen source and native binary.

These commands use no catalog training or runtime warmup. When evaluating catalog
training, use the same positive `--catalog-train` count and disjoint holdout
`--offset` in both runs; record training as service preparation. Keep warmup
requests disjoint too. Use the same algorithm and lifecycle for each comparison.

Retain raw JSON, commands, input/source/binary bindings and every request outcome.
Report physical validity, completion, partial results, failures, timeouts, modeled
cost, serial service-time distribution, readiness and end-to-end time. Accept
speedup only with the common independent verifier and unchanged completion/cost
gates. A missing compatible reference still permits coverage measurement; report
that result without a paired speedup. Consult `bench/cli.ts --help` for options
and the repository's `ganglia-speedup-report` skill when writing GitHub results.

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
