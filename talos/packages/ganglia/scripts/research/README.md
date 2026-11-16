# Local motion policy experiments

These offline tools collect supported jump/run-off witnesses and compare scheduling
and sampling policies. They do not change the package exports or production solver.
`valid` means that this particular proposal passes endpoint support/clearance,
walls, complete flight collision and the direct walking-dominance check. It is not
a whole-route or resource-feasibility label. `unresolved` means no useful witness
was found among the tested proposals, with untested motions still unknown.

Use a manifest with entries of this form (paths are relative to the manifest):

```json
{
  "version": 1,
  "entries": [{
    "id": "map01-level1-window1",
    "level": "map01_lv001",
    "split": "train",
    "levelBinding": { "method": "describe the actual level-label provenance" },
    "ground": "ground.json",
    "collision": "collision.json",
    "movement": "movement.json"
  }]
}
```

Provide training and held-out entries before evaluating learned policies.
Level tags from nearby markers describe sampling windows, not native surface ownership.
The tools reject mismatched source/scene/selection/body bindings. Output directories
and analysis/weight files must be new. A process per physical window limits retained
geometry memory. Input and resolved source hashes are recorded per window.

```sh
node --max-old-space-size=4096 scripts/research/collect.ts \
  --manifest /absolute/inputs.json --output /absolute/new-corpus \
  --episodes 180 --samples 40 --seed 20261111
node scripts/research/analyze.ts --input /absolute/new-corpus \
  --output /absolute/new-replay.json --train --weights /absolute/new-weights.json
node --max-old-space-size=4096 scripts/research/collect.ts \
  --manifest /absolute/heldout-inputs.json --output /absolute/new-ablation \
  --episodes 90 --samples 40 --seed 20261112 --weights /absolute/new-weights.json
node scripts/research/analyze.ts --input /absolute/new-ablation \
  --output /absolute/new-online.json --weights /absolute/new-weights.json
```

## Interpret results

Whole-route integration still needs resource, goal and relay checks.
Sampling regions grant no walking connectivity.
The reference ranks a local random pool and does not represent production candidate
generation. Consult `collect.ts` and `policy.ts` for sampling and feature definitions.

Fit normalization, weights and ablations on training data only. Keep all windows
of a level in one split; use independent held-out regions to assess generalization.
CEM/hybrid comparisons retain the full reference fallback and its validation cost.

Report paired success, full-pool/fallback work and timing. Geometry is warmed by
label collection, so these timings exclude cold extraction, source preparation,
HTTP latency and offline training. First-hit times include scheduling and current
population generation. Different endpoint witnesses do not measure whole-route
quality. Production performance claims follow [the benchmark policy](../../AGENTS.md).
