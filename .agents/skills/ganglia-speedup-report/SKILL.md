---
name: ganglia-speedup-report
description: Write GitHub-comment Markdown presenting Ganglia benchmark metrics and cumulative speedups in Atlos. Use for performance result comments and local comment prototypes.
---

# Ganglia speedup report

Write for a reader who wants to understand the latest measured performance and the cumulative improvement at a glance. Adapt wording, columns and detail to the evidence and the discussion's language. This skill defines presentation principles, not a fixed comment template.

## Information hierarchy

Give prominence to two things:

- The latest measured commit, branch or working commits and their benchmark results.
- A numeric speedup against a fixed original control, with enough context to understand what was compared.

Keep these results visible in the comment body. Use adjacent `<details>` blocks for supporting material. The reader should be able to understand the main results without opening them.

## Tables

Use a compact table for current results, with commit or branch identity in the first column. Distinguish execution configurations when they matter. Select useful columns from the actual benchmark output rather than exposing every field. Emphasize one or two core metrics, such as single-query serial time and successful end-to-end throughput. Show units and whether lower or higher is better. Include completion or quality information where needed to interpret speed.

Use a comparison table for speedup, making the candidate, original control, workload, before/after values and numeric ratio easy to find. Prefer a fixed original baseline for long-term cumulative gains. Label recent incremental gains separately. Historical results should identify their own measured versions and scope.

Keep tables narrow enough to scan. Explain unusual qualifications near the affected result. Make material failures and missing measurements visible; use a brief reason instead of an unexplained blank. A concurrent run's latency should not be presented as a serial measurement.

## Folding details

Fold benchmark commands and parameters, environment, map/input versions, request counts and characteristics, repetitions, worker configuration, training and warmup, phase breakdowns, memory, artifact links and detailed quality checks. Distinguish unique requests from repeated attempts.

Fold the longer explanation of baseline selection, workload pairing, aggregation and timing correspondence. Keep any qualification that materially changes the headline claim visible, such as partial coverage, approximate timing correspondence or a failed quality gate. Use descriptive summaries and blank lines around Markdown inside `<details>` so GitHub renders it correctly.

## Measurement and comparison

Use actual benchmark artifacts and identify the measured source. Distinguish measured working-tree changes from unmeasured commits. Consult the current benchmark implementation when metric meanings are unclear, and the canonical Ganglia handoff/history records when historical measurement contracts matter.

A numeric speedup is central to the report. Differences in report schemas or available stages should prompt an explanation of corresponding measurements. Prefer identical requests and inputs; otherwise explain a common subset or a defensibly similar workload, its coverage and limitations. For example, an old serial batch duration per request may support an approximate comparison with newer request timings when their scopes correspond. A shared map name alone does not establish equivalence.

Compute time speedup as old time divided by new time, and throughput speedup as new throughput divided by old throughput. Normalize units and repetitions. For a matched cohort, divide summed times rather than averaging individual ratios. Compare common measured phases when lifecycle stages differ; report end-to-end speedup only when actual wall-time evidence supports it. If evidence cannot support a ratio, state the missing evidence visibly. Keep quality changes, timeouts and selection effects attached to the claim.

Interpret deployment scenarios from the same measured algorithm and lifecycle. Startup training and freezing belong to service preparation. Online or offline interpretations should not introduce separate benchmark modes or algorithms into the report.

## Delivery

For a local draft, save a Markdown file and provide its path. Publishing follows the task's authorization; this skill grants no additional authorization. When publishing, follow repository GitHub conventions, including the AI attribution prefix, use shareable evidence links and update an existing benchmark comment in place where appropriate. Check arithmetic, source attribution and Markdown readability before delivery.
