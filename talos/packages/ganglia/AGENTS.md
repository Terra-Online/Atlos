# Ganglia development

Algorithm changes belong in this package. Maintain noclip adapters and renderer
extensions through `talos/integrations/noclip` patches; `.cache/noclip` is generated.

`feat/3d-preview` is the base branch. Unless specified otherwise, target it with
one independently reviewable strategy or fix per PR.

Use Ganglia v1 TypeScript for v1 work and comparisons. Use Ganglia v2 for
Rust solver work. Ignore the existing v1 Rust implementation
(`crates/ganglia-v1`, the `ganglia-v1-rust` adapter, and its results) unless
the task explicitly targets it.

## Required validation

No CI currently covers solver acceptance on this branch. Before merging code
changes in this package:

1. Run `pnpm check` for TypeScript solver changes. For v2 Rust changes, run
   `pnpm rust:v2:build`, `pnpm rust:v2:test` and
   `node --test test/rust/v2*.test.ts`.
2. Run the complete mechanism benchmark and apply the merge gates below.
   Report benchmark results.

## Benchmark operation and interpretation

`GANGLIA_BENCHMARK_QUERY_CUTOFF_MS` is a cooperative benchmark runtime cutoff,
with a default of 60,000 ms. Local development may adjust it freely, for example
to give a search more time to converge. Baseline and candidate comparisons must
use the same cutoff and record it in both reports. Performance targets are
separate analyses of the observed request times.

Each request has one search status:

- `success`: the solver returned a complete route within the benchmark cutoff.
- `no-route`: the search finished within the cutoff without a complete route;
  any partial route is recorded separately.
- `timeout`: the request reached the benchmark cutoff and cooperative cancellation
  was requested. Its measured time includes the cancellation tail.
- `error`: input preparation or solver execution failed, or the request was
  interrupted externally. The report records the failure or interruption reason.

When maintaining benchmark output types, use algebraic data types (ADTs) to
express valid state combinations. Represent mutually exclusive states with a
tagged union or an enum in a single field. Otherwise, prefer orthogonal fields
for independently combinable dimensions, such as search outcome and verification,
to keep the output model maintainable.

Use search status to decide whether a request completed. Ignore the current
independent whole-route verifier and its results in routine Ganglia work,
including case triage, route-cost and timing comparisons, and merge acceptance.
Investigate verifier output only when the task explicitly concerns the verifier.
Keep solver action construction and physical feasibility checks active. Assess
expected rejections and mechanism exercise separately from search status.

## Mechanism benchmark

For quick visualization or route debugging, use the [Ganglia v2 case viewer](bench/scenes/mechanisms/README.md#visualize-a-case).

Use Node 26. For input preparation, follow the
[mechanism input recipe](bench/scenes/mechanisms/README.md#generate-service-inputs).
For v2 benchmarks, use `--adapter ganglia-v2`. For v1 benchmarks, run from this
package with the TypeScript adapter:

```sh
GANGLIA_BENCHMARK_QUERY_CUTOFF_MS=60000 \
  pnpm --silent benchmark:mechanisms --adapter ganglia-v1-ts \
  --data-root /absolute/path/to/mechanism-inputs \
  --extractor /absolute/path/to/talos/.cache/noclip \
  --scenario-workers 1 --output /absolute/path/to/new-report.json
```

## Merge gates

Compare against the latest `feat/3d-preview` revision on which the PR is based.
Use the same machine, inputs, configuration, resource budgets and cache conditions
for baseline and candidate. Reuse reports with matching conditions.

- **Completion:** preserve every baseline success and the negative controls.
- **Route quality:** on common successful cases, candidate/baseline modeled-cost
  ratios must have geometric mean **<=1.01** and maximum **<=1.05**.
- **Solve time:** run three interleaved baseline/candidate pairs. Expand suspected
  regressions to five pairs with same-version noise controls. Fix confirmed
  per-case slowdowns or obtain explicit human acceptance.

When sharing a baseline/candidate comparison in Markdown, generate the per-case
table from this package with `pnpm --silent benchmark:report baseline.json candidate.json`.
Use the JSON files written with `--output` by `benchmark:mechanisms` or
`benchmark:full`. Resolve any strict comparison mismatch before presenting a
like-for-like comparison. For exploratory comparisons with custom pairings,
see the SQL options in `pnpm benchmark:report --help`.

Report source revisions, input bindings, commands, gained/lost cases, cost
regressions, timing comparisons and mechanism exercise.
If benchmark reports, provenance notes or other research artifacts are saved,
place them in `.local/research/` and keep them untracked by Git. A separate
provenance document is optional.

`benchmark:full` is optional.
