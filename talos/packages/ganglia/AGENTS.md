# Ganglia development

Algorithm changes belong in this package. Maintain noclip adapters and renderer
extensions through `talos/integrations/noclip` patches; `.cache/noclip` is generated.

`feat/3d-preview` is the base branch. Unless specified otherwise, target it with
one independently reviewable strategy or fix per PR.

## Required validation

No CI currently covers solver acceptance on this branch. Before merging changes:

1. Lint, format and test: run `pnpm check` for TS solver changes;
   `pnpm rust:build`, `pnpm rust:test` and `pnpm rust:integration` for Rust changes.
2. Run the complete mechanism benchmark and apply the merge gates below (skip if no code is touched). Report benchmark results.

## Mechanism benchmark

Use Node 26. For input preparation, follow the
[mechanism input recipe](bench/scenes/mechanisms/README.md#generate-service-inputs).
Run from this package:

```sh
GANGLIA_BENCHMARK_HEAP_MB=6144 GANGLIA_BENCHMARK_QUERY_CUTOFF_MS=60000 \
  pnpm --silent benchmark:mechanisms --adapter ganglia-v1-ts \
  --data-root /absolute/path/to/mechanism-inputs \
  --extractor /absolute/path/to/talos/.cache/noclip \
  --prepare-config /absolute/path/to/private-config.json \
  --scenario-workers 1 --output /absolute/path/to/new-report.json
```

`GANGLIA_BENCHMARK_QUERY_CUTOFF_MS` is a cooperative benchmark runtime cutoff,
with a default of 60,000 ms. Local development may adjust it freely, for example
to give a search more time to converge. Baseline and candidate comparisons must
use the same cutoff and record it in both reports. Performance targets are
separate analyses of the observed request times.

Search status is `success`, `no-route`, `timeout` or `error`. Normal exhaustion
without a complete route is `no-route`, not proof of impossibility. Expected
rejections and mechanism exercise are assessed separately. Keep solver action
construction and physical feasibility checks active.

Independent whole-route verification is beta evidence. Report `valid`, `invalid`,
`error` and `not-run` separately from search status. Verification failures and
exceptions do not change completion, route-cost or timing comparisons, or merge
acceptance; retain their diagnostics and continue the benchmark.

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

Report source revisions, input bindings, commands, gained/lost cases, cost
regressions, timing comparisons, physical validity and mechanism exercise.
If benchmark reports, provenance notes or other research artifacts are saved,
place them in `.local/research/` and keep them untracked by Git. A separate
provenance document is optional.

`benchmark:full` and `mechanism-run.ts --mode physical-diagnostic` are optional.
