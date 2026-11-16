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

Provide at least training and held-out entries before evaluating learned policies.
Keep all windows of a level in one split; preferably reserve an entire map as test.
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

Sampling balances nine approximate distance/rise strata within retained windows.
Endpoints are uniform by projected triangle area within 6 m XZ / 3 m Y regions.
Sparse strata can produce fewer episodes than requested; reports retain those counts.
The control cycle is direct jump, supported run-off, then jump splits 0.25/0.5/0.75.
This omits waypoint, terminal, boost and relay composition. Region cells are sampling
domains; they grant no walking connectivity. All endpoints still use `standingFoot`.

The reference policy ranks a fixed random pool by nominal flight duration plus
horizontal span/air speed. It is a local comparator, **not** the current solver's
candidate generator. Learned scheduling uses standardized logistic features:
span/24, rise/15, absolute rise/15, nominal duration/5 (10 s for no nominal solution),
capped span/reach ratio, log1p source/target triangle areas, barycentric edge proxies,
run-off flag and horizontal split (-1 for no split). Normalization and weights fit
training witnesses only. No map, level, coordinates or collision labels are inputs.
Feature ablations refit geometry-only and control-only models on the same training
split. Geometry-only also excludes nominal duration and reach ratio, which encode
the selected control implicitly. They do not tune weights on test.

Basic diagonal CEM adapts four support-sampling coordinates in populations of eight.
Triangle-selection CDF boundaries make that chart piecewise continuous. Every fourth
proposal is uniform; standard deviation has a 0.08 floor. This is not an implementation
of [iCEM](https://proceedings.mlr.press/v155/pinneri21a.html). CEM and hybrid always
execute the entire reference fallback; its time and validations are recorded.
Learned ranking retains the complete fixed pool and only changes its order.

All four online arms revalidate their proposals. No offline result cache substitutes
for validation. Arm order rotates, while CEM and hybrid use the same random seed.
Times are warm geometry measurements in one process, not cold extractor or HTTP
latency. Candidate generation is shared and its measured cost is reported for each
arm; source loading/preparation and offline training are separate. The initial
reference labeling pass warms geometry before the online arms. First-hit timing
includes scheduling and the current CEM population generation; comparisons should
use paired successful episodes to avoid survivor bias. Full-pool times and fallback
cost must accompany early-prefix hit rates. Motion duration comparisons concern
different endpoint witnesses within fixed regions, not whole-route travel quality.

Production integration still needs region-pair selection, resource/goal/relay checks,
resumable fallback and complete-route comparisons under the canonical handoff standard.
