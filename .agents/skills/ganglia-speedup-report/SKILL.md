---
name: ganglia-speedup-report
description: Write GitHub-comment Markdown for Ganglia benchmark results and cumulative speedups, including local drafts.
---

# Ganglia speedup report

- Show current measured commits or branches in a compact table, identity first. Select useful benchmark columns and bold one or two core metrics, usually serial query time. Include units and relevant quality results.
- Show numeric cumulative speedup against a fixed original control in a comparison table, with before/after values and workload scope. Label incremental gains separately.
- Fold commands, environment, map/request characteristics, preparation, secondary metrics, evidence links and detailed comparison rationale into `<details>`.
- Explain timing correspondence when benchmark versions differ. Calculate speedup as old/new time or new/old throughput, using consistent units and cohorts.
- Attribute measurements to their actual source. Interpret one measured algorithm across deployment scenarios; training belongs to preparation.

See [example.md](example.md) for an illustration.
