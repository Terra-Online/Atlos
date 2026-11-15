# Route solver handoff

## Prepared fine actions and indexed resource frontier, 2026-11-15

Fine boundary launch/continuous landing discovery now runs during configured
catalog preparation. It reserves up to `catalogLinks * 8` physical attempts from
the existing catalog candidate budget; neither training nor query budgets grow.
The frozen catalog retains proved actions rather than query answers. Runtime
keeps broad discovery and performs fresh whole-route resource scheduling.

Resource frontiers now index the existing energy/recovery-delay cells, following
TS's state-indexed resource search. Full continuation comparisons, quantization,
label caps and selection order remain unchanged. Rejected capped candidates enter
no index: an extended repeated-candidate regression caught an invalid recycled
arena ID in the first draft, before acceptance. The associated interrupted run
`native-indexed-frontier-50/report.json` is invalid and carries no performance claim.

The complete `native-indexed-frontier-final-50/report.json` under `.local/research/`
trains ten, freezes, warms two and scores fifty once on one worker/lane. All 50
physically pass, with no timeouts or recoveries. Mean serial service time is
1268.697836 ms/query. The unchanged cost gates pass over 46 valid retained TS
routes: geometric mean 0.932941408 and worst 1.015420947. Preparation reaches
readiness at 64.015427 s, including 57.279614 s catalog training; total end-to-end
is 139.879857 s. The 794.705 ms/query objective remains unmet. Source digest is
`b397e554c72cdf366955e0d3e99eccdb802be490c21c88fddd84377a0a89df20`;
native digest is
`03328e5dddd5acef8f006b976a8e789a79b3458401aeb29d89e8603e010014f4`.
All 150 Rust unit tests, two authored integration tests, feature-enabled Clippy,
Rust formatting and 26 common N-API physical/lifecycle fixtures pass. TS source
and verifier are unchanged. No TS baseline rerun or remote push occurred.

Training-only fine migration independently passed 50/50 and the cost gates at
1444.030975 ms/query (`native-prepared-fine-50/report.json`). An incumbent-only
replacement sampler was rejected: 50/50 physical but 1037.934899 ms/query, geometric
mean 1.012038282 and worst 1.614110871. Its changed premise was prepared fine
catalog actions plus TS-style incumbent samples; that still lost useful broad
coverage (`native-incumbent-guided-50/report.json`). Broad discovery is retained.
A flat-chord interval-proof trial passed all validation and quality, but offered
no full-population benefit: 1462.312784 ms/query, identical costs to preparation-only
(`native-planar-chord-50/report.json`). It was removed. Its broader first draft
failed existing nonlinear-support bend tests and was narrowed before measurement;
none of those physical checks were relaxed. Further work should profile the
remaining selected geometry/resource costs before changing discovery policy.

## Supplemental TS refinement and proof scheduling, 2026-11-15

Search preserves the broad departure pool and supplements it with body-scale
boundary insets, directed approach/departure ranking and continuous standing
landings. Both phases share the existing physical-attempt budget. The fine phase
retains its best proved actions and excludes walking-dominated flights, following
TS shortcut discovery. Immutable face metadata avoids repeated vertex scans.
Direct walking proofs currently share the lazy geometry queue with resource
labels; queued work is repriced when a cheaper source arrives. All directional
targets and live continuation states remain eligible.

The complete `native-ground-dominated-50/report.json` under `.local/research/`
trains ten requests, freezes, warms two and scores all fifty once. It physically
passes 50/50 with no timeouts/recoveries and passes unchanged cost gates: paired
geometric mean 0.917469599, worst 1.014946863 over the 46 valid retained TS routes.
Mean serial time is 1449.995361 ms/query, so the 794.705 ms/query objective remains
unmet. Source digest is
`d1f39ab95883b7c7ce6bc1f3804bfb32833970ca455afa9c722feee208b2aa65`;
native digest is
`a00430b9bebf1bd668e5e1fd1464973b4eed2a841245444ac7944f00ad739adc`.
Subsequent edits only restore the measured policy and format/test its diagnostics.
The preceding weighted-lazy run also passed quality at 1451.209901 ms/query;
walking-dominance filtering alone did not improve performance.

The batch-direct-proof trial is rejected: 1805.719139 ms/query, 50/50 physically
valid, paired geometric mean 0.907564138 and worst 0.996217709. Evidence is
`native-batched-direct-50/report.json`. A profiled representative under
`/tmp/ganglia-fine-profile-full.log` spent 1083.950418 ms on 617 direct proofs and
expanded 15739 resource states. Fine query-time discovery has not met the speed
objective. Next move reusable fine action discovery into configured catalog
training before optimizing the remaining resource frontier.

A separate schedule contract bug rejected an unchanged nearly collinear walk
after a gait split. Ordered arc-length comparison now checks the union of knots
instead of independently simplifying corners. The reproduced discrepancy was zero
geometric displacement; physical tolerances and nonwalking witness identity are
unchanged. The durable regression fails the old implementation and passes the
new comparison; the corner-shortcut rejection remains covered. One interrupted
trial retained 49 other results and continued on its existing worker; it is not a
complete benchmark. Final focused validation passes 150 Rust unit tests, two authored integration
tests, feature-enabled Clippy, formatting and 26 common N-API physical/lifecycle
fixtures. No TS baseline rerun or remote push occurred.

## Preserve broad coverage while refining, 2026-11-15

World now caches immutable exposed boundary intervals after directed portal
subtraction. Per-query bounds clip those cached intervals independently. The
existing sloped-clipping regression additionally checks that a wider second query
recovers geometry omitted by the first narrow window. Other support/flight rules
are unchanged. This reuses TS's prepared-geometry ownership; no isolated cache
speedup is claimed.

The complete competitive/fine replacement trial is rejected. It physically passed
50/50 with no timeouts or recoveries, but measured 820.069060 ms/query and lost a
useful connection at ground-jump-22-1: cost ratio 1.332071667. Paired geometric
mean was 0.931616735. The original 1.01/1.05 gates still fail. Its raw evidence is
`.local/research/native-shared-competitive-50/report.json` and adjacent events;
source digest `338d4a0785ab70211935c3302f22229837274c2960a0312955eaa084f5656472`,
native digest `8e301a810d0b5d66beb8f6111d3e9bb85452d1c1f391dcdd49d7d8ded6817605`.
It fixed the known case 15 gap but displaced another useful broad candidate.
Smaller allocation/fine/fine-cache probes remain diagnostic only, under
`.local/research/native-shared-{allocation,fine,fine-cache,competitive}-result.json`.

Search sampling and its budget split are restored to `e3d265e`. Only the independent
boundary cache remains from these trials. The latest complete retained-search
measurement is still the 766.565510 ms/query checkpoint with its case 15 cost
failure; the added cache has no new complete-population performance measurement.
All 149 Rust unit and two authored integration tests, feature-enabled Clippy,
release N-API build and 26 common physical/lifecycle fixtures pass. The extended
cache-window regression also passes. Source and verifier TS remain unchanged.

A direct World diagnostic proves the TS case 15 takeoff is reachable from both
implementations' initial feet: a 10.448013 m ground path, followed by the already
accepted flight. Evidence is `/tmp/ganglia-native-case15-approach.log`. The gap is
proposal coverage, rather than an unavailable physical path. Next preserve the
original broad pool and supplement it with fine competitive launch witnesses,
sharing the remaining physical-attempt budget instead of replacing the broad
pool. Avoid repeating replacement-only finer cells or budget redistribution.
Cache face metadata and bound neighbor work before adding more enumeration.
The full-population quality and 2x objective remain active; no remote push.

## TS-style bounded action refinement checkpoint, 2026-11-15

The native improvement pass now shares its existing 640 physical-attempt budget
between generated-landing discovery and a bounded landing/control queue. The
second pass sees proved endpoints from the first pass. It uses TS-style directed
approach/departure navigation fields, continuous face/envelope landing witnesses,
spatially interleaved launch/landing cells and a maxLinks admission limit. Landing
proposals are normalized to actual standing feet before flight proof. Navigation
costs rank proposals only; all retained motion still requires World proof and
common physical replay. Training and first-feasible policies are unchanged.

An unbounded first draft materialized about 2.65 million proposals in one captured
window. Bounding neighbor enumeration before projection reduced this to about
111 thousand; the measured proposal/queue preparation fell from about 876 to
277 ms in that diagnostic. Standalone globally ranked or shared-queue-only trials
lost useful actions and were rejected. The retained composition preserves the
first pass's generated landing sources before refining their continuous landings.
Evidence includes `native-shared-result.json`, `native-shared-continuous-result.json`,
`native-shared-bounded-result.json`, `native-shared-fields-result.json` and
`native-shared-standing-result.json` under `.local/research/`. Those small probes
are diagnostics, not accepted benchmark results.

The complete ordinary map02 run trains ten requests, freezes, warms two requests
and scores all fifty once on one worker/lane. All 50 routes independently pass
physical replay; no timeout or worker recovery occurs. Mean serial service time
is 766.565510 ms/query, readiness 68.829175 s and end-to-end 118.268789 s. Compared
with the retained 1589.409605 ms/query TS measurement, latency is below half, but
**the quality gate still fails**. Paired cost geometric mean is 0.926148732;
worst ratio is 1.126873081 on ground-jump-15-1 (6.982318 versus 6.196188 modeled
seconds). It is the only paired request above the unchanged 1.05 worst gate.
No accepted speedup or completed rewrite objective is claimed.

Raw evidence: `.local/research/native-shared-refinement-50/report.json` and its
adjacent events journal. Source digest:
`a844702d71ca258b20cf40ec6b68dbf2e58f5b9a8cef3a7de2c01d6addd7b909`;
native binary digest:
`fda5b73393c5a8ee1cef2a7c7a21d0036aef08c8f371b29470b5db3c5880906a`.
The compatible derived TS reference retains its original timing and the current
verifier audit, with 46 valid retained routes; four new valid completions are
reported separately. Readiness/end-to-end scopes retain those provenance limits.

Rust unit/authored tests (149 + 2), feature-enabled all-target Clippy with warnings
denied, Rustfmt, release N-API build, 26 common physical/lifecycle N-API fixtures
and diff checks pass. The next task is the
remaining generic candidate-coverage gap at case 15, preserving all fifty requests,
current physical policy, original quality gates and the latency goal. Rust remains
local until the user says ready.

## Fine-pool coverage and grouping diagnostic, 2026-11-15

Dumped the actual pre-action candidate pool after `2ddfba5` for case 18-1:
522 points, nearest critical takeoff about 1.48 m from the TS witness (previous
small graph about 5.4 m). Its intermediate landing is represented within 0.17 m;
the deep landing is still about 6.94 m away. Evidence:
`.local/research/native-pool-candidate-graph.json` and the retained TS event 34.

A body-diameter boundary-cell trial improved case 17 cost slightly but worsened
18 and 21 relative to the retained source. Removed. All six diagnostic requests
remained physically valid; no complete-population speedup or quality claim follows.
Evidence is `.local/research/native-body-cells-result.json`. Production source is
restored to `2ddfba5`; the temporary candidate dump instrumentation is removed.

Next migrate the TS active landing/control candidate lifecycle. Larger native
pools often allocate only one flight attempt to a source; a blocked first landing
then retires that source instead of allowing another landing/control witness.
Preserve unfinished candidates in a bounded shared work queue, with the same total
attempt pool. Do not repeat only source-cell refinement before fixing candidate
pair scheduling. The full 2x objective and path-cost gates remain unmet; no push.

## Separate geometric candidates from the resource graph, 2026-11-15

Improvement discovery now retains a larger bounded geometric pool (at most eight
maxLinks, still within maxCandidates), then compacts the resource graph to query
anchors and endpoints of proved actions/paths. Dense temporary node IDs are
remapped in starts, targets, ordered waypoints and supported-path keys before
resource scheduling. Unproved geometric proposals do not become expensive walking
or resource vertices. Training and first-feasible discovery keep their existing
sampling policy.

The first larger-pool diagnostic exposed a budget floor defect: a one-attempt
source received zero interior-landing proposals because integer division by three
rounded to zero. Improvement discovery now permits its existing single attempt
to generate a landing; no new attempts are granted. Both changes follow TS's
separation of geometric enumeration, physical action admission and final routing.

The six-request trained diagnostic physically accepts every route. Lower cases
17/18/19/21 measured about 563/523/480/441 ms, with modeled costs
7.367911/7.081703/6.511280/5.894853 s. Upper cases 4/12 measured 1663/2203 ms.
Cases 17/18 still exceed the retained TS cost gates; upper latency still prevents
an inference of 2x performance. Evidence is
`.local/research/native-pool-landings-result.json` and its probe log. This is a
focused diagnostic, not a complete-population benchmark or accepted speedup.
The larger pool without landing budget correction was worse
(`native-pool-result.json`); do not repeat it unchanged.

Validation passes 149 Rust unit tests, two authored integration tests, 26 N-API
common physical/lifecycle fixtures, release native build, Rustfmt, feature-enabled
all-target Clippy with warnings denied and diff checks. TS/verifier source is unchanged.

Continue migrating TS candidate pairing/control coverage and reducing resource
work, then run all 50 ordinary requests with training, freeze, warmup and one round.
The objective remains active and Rust commits remain local until ready.

## Exact-flight and boundary ownership diagnostic, 2026-11-15

Replayed saved TS jump witnesses from lower-floor cases 17/18/19 directly against
Rust World using the captured normalized physical window. All four TS jumps are
accepted both by native generation at their exact endpoints and native witness
replay. Most nearest native sampled takeoffs fail the corresponding exact landing.
This rules out a general motion-model inability for those successful witnesses.
The diagnostic tool/artifacts are `.local/research/roadmap-inspect/src/bin/flights.rs`
and `/tmp/ganglia-native-ts-flight-inspection.log`.

A local boundary inventory finds navigation boundaries only 0.14--0.56 m from
those TS takeoffs, and raw support boundaries 0.045--0.44 m away. The geometry
exists; bounded representative selection loses its useful neighborhoods. Evidence:
`/tmp/ganglia-native-ts-flight-boundaries.log`. A nearest-approach plus route-directed
representative trial retained valid routes but did not resolve 17/18 cost gates;
removed (`native-region-exits-result.json`). Production source remains `6571e5c`.

The next migration needs TS's separation of geometric candidate pool and final
resource graph. Native currently inserts sampled proposals directly into the graph
and gives each source a small flight quota; TS keeps finer seeds/pairs independently
and admits proved actions. Increasing graph samples would inflate all-pairs walking,
while rearranging the existing small sample graph cannot recover absent witnesses.
Implement a bounded separate candidate pool and admit only successful action
endpoints before retrying source or landing ranking. The objective remains unmet;
no remote push is authorized.

## Continuous landing diagnostics, 2026-11-15

Compared TS `motion/landings.ts` with native angular landing proposals. TS emits
nearest-source, nearest-goal, center and horizontal-envelope/edge intersections,
then tries control variants. Native finite angular/range seeds omit some continuous
landing neighborhoods. A trial prepended nearest-source/goal/center projections
for improvement queries; six requests remained physically valid, but 17/18 still
failed cost comparison and 19 lost its retained improvement. Removed. Evidence:
`.local/research/native-continuous-result.json` and its corresponding probe log.

A separate raw-support-boundary stream near fresh origins, sharing the existing
sample quota, produced the same routes/costs as `6571e5c` on the six diagnostics.
Removed as unproductive (`native-raw-departure-result.json`). No performance claim
or full benchmark is derived from either diagnostic. Production source remains
`6571e5c`; the active goal and no-push instruction remain.

Further migration needs the complete TS landing/control handoff: reach-envelope
intersections and fair control variants for each candidate, rather than replacing
angular seeds with only nearest-point projections. Inspect attempted candidates
and rejection causes before another surface/sample allocation trial.

## Spatial launch coverage checkpoint, 2026-11-15

A diagnostic dump of the actual improvement graph for ground-jump-18-1 found
nearest native samples about 5.4 m from the TS critical takeoff and 6.9 m from its
landing. This confirms a candidate-coverage defect; ranking absent endpoints
cannot reproduce the TS route. Evidence is `.local/research/native-candidate-graph.json`
and `native-candidate-dump-result.json`, compared to saved TS report event 34.

Native improvement now follows TS's coarse-before-fine launch enumeration:
within the existing departure share, interleave spatial regions before consuming
adjacent body-scale points. Candidate and flight-attempt budgets are unchanged.
The focused six-request replay passes common physical validation. Request 19-1
improves to cost 6.215470 s (retained TS 6.998164 s), about 531 ms diagnostic service;
21-1 costs 5.901076 s, about 604 ms. Cases 17/18 remain over the original cost gate,
and upper diagnostics remain slow. This is partial improvement, not accepted full
population quality or speedup. Evidence: `.local/research/native-spread-result.json`.
Doubling the launch-region share displaced useful landing samples and worsened
19/21; removed (`native-spread-departures-result.json`).

The retained source passes 149 Rust unit tests, two authored-action integration
tests, 26 N-API common physical/lifecycle fixtures, Clippy with warnings denied,
Rustfmt and diff checks. No new full-population benchmark has been run.

Next inspect the TS landing projection/control generator against the missing
landing neighborhood, preserving the coarse spatial coverage and fixed budgets.
Do not retry departure-share expansion without changed landing coverage. The 2x
objective remains active; no remote push is authorized.

## Approach/departure ranking diagnostics, 2026-11-15

An optimistic approach/departure field trial ranked whole flight journeys over
sample nodes instead of per-source nearest-target quotas. It did not resolve the
lower-floor cost regressions. Replacing those fields with prepared directed
navigation-centroid distances plus existing-action overlays also failed the
focused quality comparison. All six physical replays completed validly; cases
17/18/19/21 still exceeded their retained TS costs. The directed-field trial passed
Clippy. It was removed rather than retaining new topology state without benefit.
Evidence is `.local/research/native-journey-result.json` and
`native-fields-result.json`, with corresponding probe logs under `/tmp`.

These trials change the next diagnostic: compare retained TS successful takeoff
and landing locations to the actual native candidate graph. Sorting cannot recover
an absent witness. Identify whether source or landing generation omits that local
neighborhood, then migrate the corresponding TS seed/projection/continuous-control
logic. Do not repeat distance-field ranking alone without changed candidate coverage.
Production source remains the full-population `947366c` checkpoint. No new accepted
speedup or complete-population quality pass exists; the 2x objective remains active.

## TS shortcut strategy migration diagnostics, 2026-11-15

Read TS `route-shortcuts.ts` and `search/shortcuts.ts` before retrying smaller
native improvement budgets. An experimental native incumbent sampler ranked
forward walking-sample pairs by possible time savings and proved up to 128 flight
candidates. With 128 broad attempts it still exceeded cost gates on lower-floor
starts 17/18/19/21; retaining 640 broad attempts did not resolve 17/18/19 and added
query work. Both implementations of this experiment were removed. Evidence is
`.local/research/native-incumbent-result.json` and
`native-incumbent-combined-result.json`. All six diagnostic routes passed physical
replay, which does not establish the required quality or speed improvement.

A separate TS-derived pullback trial added 1/2/3 m boundary launch offsets within
the existing node/attempt quotas. It worsened several diagnostic latencies and
retained the cost regressions; removed. Evidence is
`.local/research/native-pullback-result.json`. The trial passed 149 unit tests,
two authored integration tests, 26 common N-API fixtures and Clippy. Those results
validate that trial only, not a new accepted optimization. Production solver source
is restored to `947366c`; no new complete-population measurement is needed for
restoring identical source.

The changed premise for further work is TS's full ranking strategy: prepared
forward approach and reverse departure distance fields, existing-action overlays,
spatially diverse launch enumeration and candidate lower bounds. Native per-source
nearest-target quotas do not reproduce that strategy. Migrate the ranking before
retrying smaller budgets or additional body-scale offsets. The full-population
2x objective and original modeled-cost gates remain unmet; no push is authorized.

## Sparse scheduling full-population checkpoint, 2026-11-15

Commit `947366c` completes and independently physically verifies all 50 normal
map02 requests, with zero timeouts. Mean serial time is 1547.401 ms/query, against
retained TS 1589.410 ms/query. The 2x objective is unmet. Paired cost geometric mean
is 0.950314; worst ratio 1.121001 on ground-jump-18-1 fails the unchanged 1.05 limit.
Nearby lower-floor starts 17 and 19 also exceed that limit. No speedup is accepted.
Evidence is `.local/research/native-continuation-50/report.json` and its adjacent
journal, with configured training10, freeze, warmup2 and one measured round.

The user's current direction is to reuse TS's implemented optimizations. Next
migration target is `src/v1/route/route-shortcuts.ts`: sample walking portions of
the incumbent, rank feasible forward pairs by saved modeled time, physically
validate only the bounded best proposals, and jointly retime the accumulated graph.
Copying only TS's smaller budget before copying candidate ranking failed earlier.
Preserve the fast prepared-only resource pass and successful local attachments.
Do not push Rust work until the user explicitly says ready.

## Sparse prepared scheduling and fresh-start refinement, 2026-11-15

Search schedules the selected prepared graph before expanding direct walks and
full detours. A source-bound slow-case diagnostic dropped ground-jump-4-2 from
about 52 s to 0.30 s with common physical acceptance. Roadmap attachments now seek
physically successful neighbors within the finite neighborhood; if no direct link
exists, at most four nearby local ground-detour proposals can attach a fresh
endpoint. Query-selected spans are re-proved, retaining real geometry and resources.

TS source comparison identified its incumbent-guided departure refinement. Native
improvement now reserves spatial sampling for departure neighborhoods, including
cliffs away from the straight goal corridor, using the incumbent cost to bound
useful walking reach. The previous worst-cost request ground-jump-21-1 improved
from cost 8.792 s to 5.876 s, versus retained TS 6.651 s, with common physical replay.
The departure diagnostic completed the two slow upper cases in 2.63/2.72 s and the
worst-cost case in 0.90 s. These remain diagnostic observations, not accepted full
population speedup. Evidence: `.local/research/native-local-approach-result.json`
and `native-departure-result.json`.

A direct copy of TS's smaller catalog refinement budgets plus incumbent sample
hints lost useful departures under Rust's different candidate ordering; withdrawn.
Limiting improvement walking to nearest neighbors did not consistently reduce
latency; withdrawn. Faithful migration still requires TS's candidate ranking and
local incumbent refinement, rather than budget reduction alone. The retained
source passes 149 Rust unit tests, two authored integration tests and 26 N-API
physical/lifecycle fixtures; Clippy passes. Full 50-request validation remains
required and the 2x objective remains active. No remote push is authorized.

## Prepared graph full-population failure, 2026-11-15

Commit `894f9fa` completed and physically verified all 50 normal map02 requests
with zero timeouts, after configured training, freeze and warmup. It did not meet
the objective: mean serial time was 19805.902 ms/query, with long fallback searches
on several upper-floor starts. Paired modeled cost improved on average (geometric
mean ratio 0.975642) but the worst ratio remained 1.321836, on ground-jump-21-1.
The unchanged worst-cost gate failed. No speedup is accepted.

The source-bound report is `.local/research/native-roadmap-50/report.json` and its
adjacent event journal. This result supersedes extrapolation from the fast two-case
diagnostic. Followup separates missing roadmap attachments/connectivity from
physical admission and resource-search expansion, and first schedules the already
proved sparse graph before adding direct all-pairs walks or detours. Targeted
replays use cooperative deadlines; the next full run waits for representative
slow and worst-cost requests to show a worthwhile improvement.

## Prepared native connection graph, 2026-11-15

Catalog training now samples the coarse corridor as well as endpoint neighborhoods.
Freeze builds `engine/catalog/roadmap`: exact learned action endpoints plus nearby
walking links independently proved by World. Spatial representatives propose links
without merging endpoints. Queries attach supported starts, ordered waypoints and
goals, then pass selected actions and walking spans to the normal resource search.
Walking spans are rechecked against the current World, including placements; the
prepared graph proposes a corridor rather than certifying a resource-feasible route.
If it cannot connect a request, the existing catalog/discovery path remains.

World walking uses the shared model's 1 cm raw-mesh contact allowance while keeping
full-body coverage and explicit walls unchanged. Flight sweeps remain strict. A
N-API regression passes default common verification and fails zero-contact-tolerance
verification; it fails against the earlier native artifact. No TS/verifier code changed.

Navigation reuses static transfer candidates and their ranking, applies query
exclusions before taking alternatives, and skips unknown transfer enumeration when
a known corridor beats its lower bound. New Worlds/navigation inputs own fresh
prepared state; no complete-query answers or failed-query exclusions are cached.

The trained real-map diagnostic now physically accepts the upper route and the
previously worst-cost lower route. The earlier graph artifact measured about
1.28 s for each and 68.28 s readiness. This is diagnostic evidence, not full-population
speedup. Full 50-request validation of the final prepared artifact is next; the 2x
objective remains active and all Rust work remains local.

## Full normal-population native check, 2026-11-15

Commit `116bc4d` completed all 50 ordinary map02 requests in one scored round after
ten training requests, freeze and two warmups. All 50 passed independent physical
verification, with no timeout or worker recovery. The performance and modeled-cost
goals failed: mean serial time was 12613.794 ms/query; paired cost geometric mean
was 1.017768 and worst ratio 1.537557, exceeding unchanged limits 1.01 and 1.05.
Service readiness was 49.505 s; end-to-end time was 703.402 s. No speedup is accepted.

The lower/upper strata averaged 1876.070/23351.518 ms/query. The largest cost
regressions occur in later lower-floor starts, especially ground-jump-23-1.
The complete report and request journal are under
`.local/research/native-optimized-50/`. This full-population result supersedes any
inference from the earlier two-goal diagnostics. Further work must address both
repeated walking-proof failures and catalog/local-improvement route quality.

## Native walking/search optimization, 2026-11-15

The Rust search retains exact chosen resource states while merging nearby energy
and recovery-delay states for bounded approximate frontier search. Weighted goal
ordering uses separate, unweighted pruning bounds. Returned routes still undergo
independent physical replay and the unchanged modeled-cost comparison.

Walking proofs remove collinear sample knots after validation, permit supported
vertical representation error up to 2 cm, and reuse completed directed probes
inside each immutable World. Placement or coverage changes create fresh caches.
Triangle normals are prepared once, and BVH median partitioning avoids sorting
whole subtrees repeatedly. Catalog ranking reserves its existing bounded graph
for spatially distinct transfers, preserving all links of each admitted chain.

The trained two-goal diagnostic completes with valid physical replay, but the
upper query still spends substantial time rejecting full-window walking detours
before subdivision. This is not full-population acceptance or a speedup claim.
The 2x objective remains open. The next measurement uses all 50 ordinary map02
requests, ten configured training requests, two warmups and one scored round.
Rust changes remain local; stress and new TS timing runs are excluded.

Validation of the retained batch: 148 Rust unit tests, two authored-action
integration tests and 25 N-API common physical/lifecycle fixtures pass. Release
build, Rustfmt, all-target N-API Clippy with warnings denied and diff checks pass.
TS source and verifier are unchanged. Full-population measurement is next.

## Native capsule support coverage, 2026-11-15

The active local objective is at least 2x TS serial throughput on the full normal
50-request workload with training, freeze and warmup, physical acceptance and
comparable route cost. Rust commits remain local until explicit user approval.
Stress is excluded. No accepted speedup has been reached.

Profiling the navigation checkpoint identified 1802 completed detour proofs in a
trained two-goal diagnostic; roughly 99 of 102 cumulative proof seconds ended in
rejection. The Rust proof still required raw centerline triangle coverage, whereas
the shared physical model admits finite-radius face, edge and vertex support.
`world/support` now computes that continuous footprint/contact intersection with
fixed-size interval storage and merged feature intervals. It expands no horizontal
reach beyond the real capsule radius. Actual supported feet, collision, coverage
and resource checks remain. This fixes physical semantics rather than increasing
search work or changing the verifier.

Four old negative fixtures relied on rejecting gaps narrower than the capsule.
Their negative cases now use genuinely unsupported wide gaps; the positive
capsule-edge case remains explicit. A bent-navigation fixture moves its unsupported
crossing away from an adjacent floor that legitimately supports a rounded corner.
Both support and clearance failures count as physical rejection witnesses.

The frozen `support-stage.node` diagnostic keeps ten training requests, both
warmups and two ordinary map02 targets. Both target routes now complete and pass
independent physical replay, including the formerly timed-out upper target. This
is functional diagnostic evidence, not full-population acceptance or speedup.
Results/profile are `.local/research/native-support-result.json` and
`/tmp/ganglia-native-support-probe.log`; the preceding profile summary is
`.local/research/native-core-profile-summary.json`. Query time remains far above
the objective; unnecessary trajectory density and repeated local-search work are
next. Native N-API physical/lifecycle integration passes all 25 fixtures.

## Incremental Rust navigation module, 2026-11-15

Rust development resumes beside the retained TS implementation. This rewrite and
its related records remain local until the user explicitly says ready; do not
push these commits. Long-range stress is excluded from this work. Ordinary map02
requests and independent physical replay remain the functional reference; output
coordinates, tie order and route choices need not align byte-for-byte with TS.

The first replacement establishes these crate-private modules:

- `navigation` owns typed prepared mesh proposals, endpoint projection, lazy
  transfer materialization and query search. Its interface accepts typed arrivals
  and returns a proposed corridor; physical feasibility remains a separate proof.
- `navigation/topology` stores directed adjacency in CSR and computes strongly
  connected components with iterative linear-time traversals. One-way portals
  cannot imply mutual reachability or hide a required return transfer.
- `mesh` owns shared polygon projection and portal stitching. It consumes geometry
  and step limits without requiring a physical World or synthetic movement model.
- `geometry` owns triangle/BVH and capsule primitives, shared by mesh and World.

The native Engine calls the typed navigation interface, converting its current
protocol representation at that seam. Prepared navigation no longer constructs a
physical World, retains a duplicate JSON snapshot, or creates unused collision,
resource and movement state. Static edges occupy one contiguous arena; temporary
query edges occupy another. Predecessors contain edge IDs, so successful label
relaxation does not clone strings or path vectors. Only selected output edges are
materialized. TS source, external Solver seam, verifier and solver budgets remain
unchanged. Native `search`, resource scheduling and most Engine protocol state
still use the existing implementation and are subsequent replacement work.

The directed-connectivity correction has one new behavior-level regression:
a known downhill portal remains usable and the reverse journey still proposes
an unresolved uphill crossing. Existing Rust and N-API tests cover the retained
physical/action/resource and cancellation contracts. No byte-level route assertions
or implementation-mirroring test suite was added.

Validation: 150 Rust tests and 25 N-API integration fixtures pass, along with
release native build, Rustfmt and feature-enabled all-target Clippy with warnings
denied. Only the directional-navigation regression is new. TS implementation and
its tests are unchanged; its full test suite was not rerun for this Rust-only slice.

A frozen native functional diagnostic used the regular map02 dataset, ten catalog
training requests, catalog freeze and both configured warmups, on the same worker.
Lower-floor warmup and the lower-floor query pass independent physical replay.
Upper-floor warmup and the upper-floor query still reach the 60-second cooperative
deadline. The navigation change does not resolve the upper-floor bottleneck;
this is not a full-population acceptance or a speedup measurement. No stress input
was loaded. The worker remained usable after warmup cancellation.

The explicitly selected artifact is `.local/cache/ganglia-v1/navigation-stage.node`;
the default native artifact was not overwritten. Diagnostic source/results are
`.local/research/native-navigation-probe.ts` and `native-navigation-result.json`.
The current TS and verifier checkpoints remain available for comparison. Next
work should replace the local action/geometry search and its prepared state with
typed Rust modules, preserving training and shared physical verification rather
than increasing query budgets or changing the verifier to accommodate this port.

## Requested stress diagnostic at 60 seconds, 2026-11-14

Commit `2c99b6c2` attempted the 14-request `map02-stress` workload with the current
TS solver, one worker/lane and one measured round. The cooperative deadline was
60000 ms. The initial 6144 MiB process exhausted its JS heap during input loading.
A 12288 MiB retry loaded inputs but the packed stress dataset lacked the fixed
catalog-training region. A local combined dataset at
`.local/data/stress-with-preparation` hard-links unchanged stress and ordinary
map02 snapshots, retaining input source/profile checks and dataset provenance.

The combined-data attempt completed training request 1 in 55.140 s. Training
request 2 timed out and returned after 69.747 s, approximately 9.747 s beyond the
soft deadline. The worker was not killed or replaced. The CLI stopped because
catalog training was incomplete; warmup and all 14 scored requests were never
dispatched. This is a preparation failure, not 14 failed stress measurements, and
no stress latency, throughput or speedup is available. No timeout was extended and
no preparation was skipped. The processes have finished.

Artifacts are under `.local/research/ts-stress-60s/`, `ts-stress-60s-12g/` and
`ts-stress-60s-prepared/`; the last directory includes `invocation.json`, the
interrupted report and its per-request journal. The timeout configuration change
passed package formatting, lint, typecheck and all 461 TS tests.

## Configurable benchmark deadline, 2026-11-14

`GANGLIA_BENCHMARK_QUERY_SLO_MS` overrides the cooperative query deadline and
reported SLO together; the default remains 300000 ms. The stress diagnostic uses
60000 ms. Source preparation, warmup and scoring retain the same worker, and
cancellation waits for solver checkpoints. No hard worker timeout is introduced.

## Verifier walking approximation, 2026-11-14

Verification version 3 separates walking representation from flight precision.
`walkSnap` defaults to 0.35 m and bounds vertical navigation-height projection;
projection uses this policy rather than the world's narrower contact lookup.
`walkTraceTolerance` defaults to 0.025 m for walking polyline approximation.
`walkContactTolerance` defaults to 0.01 m of raw-mesh capsule skin overlap,
used only for walking. Full-body coverage, terrain support radius, explicit walls
and placement exclusions remain unchanged. Flight replay retains
`traceTolerance = 0.005 m` and strict collision. Humans can tune walking parameters
independently. Capsule collision sweeps, continuous support coverage,
resource replay and terminal-event checks remain active.

Continuous walks are checked across gait/control splits, so a legal raised step
corner does not need independent standing support. Sparse snapshots certify each
physical span. Collision-free feet can retain clearance from zero to 1 cm; the
existing 5 mm offset is not a mandatory minimum. Standing samples bound interior
walking approximation: a broad support envelope alone cannot authorize a floating
chord. A shallow-valley regression requires strict rejection or supported execution
with recomputed length and cost. No search, catalog, training or solver code changed
in this milestone; the experimental solver-side walk repair was withdrawn.

The frozen `2ba25713` full-population run completed 50 searches and accepted 12
physically, with all takeoff failures eliminated. Replaying those exact saved routes
under version 3 accepts 46/50. Four still fail walk endpoint support. This is verifier-only replay, not a
new search timing or speedup result. The source report remains under
`.local/research/ts-support-2ba2571/`; the replay and diagnostic input are under
`.local/research/current-physical-failures/verifier-audit.json` and
`verifier-audit.ts`. The original benchmark quality gate is not claimed to pass.

Package formatting, lint, typecheck and 461 TS tests pass. Standards and Spec
rechecks found no remaining required code findings after closing an intermediate
support-envelope bypass with the shallow-valley regression.

## Current-route support correction in progress, 2026-11-14

The failed `c316ac52` run exposed two geometric inconsistencies. A representative
walking span had a 3.744 mm gap in center-projection support intervals although
its radius-0.35 capsule had continuous nearby edge support and clear sweeps.
Continuous support now intersects the finite triangle's exact horizontal capsule
footprint with its 3D contact envelope, including edges/corners; the horizontal
reach is never expanded by projection tolerance. Standing and swept-body checks
still certify actual feet. Gaps wider than the capsule footprint remain rejected.

V1 `standingFoot` previously added infinite-plane slope lift to a radius-zero
projection. A real rejected takeoff was 7.527 mm above finite-triangle sphere
support. It now uses the collision model's radius-aware support directly, plus
existing clearance. Analytic edge-support and footprint-gap regressions pass;
package formatting, lint, typecheck and 457 TS tests pass. Verification identity
advances to version 2. The Rust negative-gap fixture now uses a gap wider than its
capsule footprint; no Rust implementation or binary was changed.

The subsequent frozen `2ba25713` run accepted 12/50; see the version 3
replay above. Saved-route replay is diagnostic only: it exposes additional real nearby steep-face collision
and unsupported endpoints. Those are not waived by these fixes. Local geometry
probes and extracted source facts live under `.local/research/current-physical-failures/`.

## Current-source TS full-population run, 2026-11-14

Clean commit `c316ac5210d32e00581f090442c4829b8365132c` completed the requested
single measured round with one worker/lane on all fifty map02 requests. Preparation
trained ten requests (79.844 s, 272 catalog actions), froze the catalog and ran two
warmups (5.191 s; one physically accepted). Service readiness was 86.190 s.

All fifty searches returned complete traces, but independent physical execution
accepted only six. Thirty-three failed supported walking and eleven failed takeoff
support. The completion/physical quality gate failed. This is current generation,
not replay of a historical journal, so the remaining problem is present in current
search output. No timeout, process replacement or recovery occurred; the run did
not exercise a real-data cancellation event.

Mean serial time across all attempts was 1518.433 ms, median 1165.540 ms, P95
4775.438 ms and maximum 6730.783 ms. Batch wall time was 75.940 s; end-to-end,
including preparation, validation and shutdown, was 162.983 s. One round provides
no repeatability measurement. No new speedup is accepted because quality failed.

The report and adjacent event journal are under
`.local/research/ts-current-soft-c316ac52/`. Source SHA-256 is
`1bf367cb463f246d629584a56661a5bc596c4c417b01a941e2e7c9066e5447fe`;
report SHA-256 is `8550684b114f3df8ffa648429eeb1bf0bee462a74c99b488193edd3d35e66c11`.
The run used Node v26.13.0 with a 6144 MiB heap and no native solver. Configured
training budgets were 32,000 candidates/256 links; serving retained 8,000/64.
Source stayed frozen throughout measurement and passed the CLI's final digest check.

## Configurable verification and bounded walk execution, 2026-11-14

`createPhysicalVerifier(snapshots, options)` accepts a partial `VerificationPolicy`;
`verificationDefaults` is exported from the evaluation entry. Default ordinary
point-goal tolerance is 0.05 m, replay trace tolerance 0.005 m, resource timestamp
comparison tolerance 0.001 s, and maximum vertical walk correction 0.2 m. Reporting
allows 0.01 s cost / 0.01 m length plus 0.001 relative error, while returned cost and
length are recomputed. Set `walkSnap: 0` to require submitted physical feet.

A failed direct execution can be interpreted as navigation-height walk intent only
after its controls, resource schedule, nonwalk geometry and terminal events pass.
The independent execution helper projects walk spans onto covered physical support,
retains their horizontal path, and recomputes the whole resource timeline. The
result then passes the complete physical verifier again. It adds no search, new
flight or horizontal detour. `Evaluation.execution` reports maximum walk correction
and cost/length deltas; input routes are unchanged. Flight origins, obstacles,
coverage, resources, explicit interactions, start identity and ordered waypoints
retain their physical checks. Ordinary goal tolerance requires a local supported
connection, so a nearby point behind an obstacle cannot satisfy the goal.

Benchmark metadata binds the verification version and default policy in `rules`;
reference comparison and worker input validation require matching rule identities.
The saved `1e942192` first-round traces now yield six valid executions, 33 unsupported
or obstructed walks and 11 unsupported takeoffs. This is an audit of unchanged saved
intent, not a new solver timing measurement. The prior historical benchmark remains
bound to its original rules. Package checks pass 458 TS tests.

## Physical regression followup, 2026-11-14

The shared world's continuous support proof now bounds capsule feet between the
vertical terrain height and the slope's tangent-sphere height. Finite-face edge
and corner contacts lie within this envelope, matching collision `groundAt`.
Using vertical terrain height alone rejected supported walks at small cell heights. Continuous raw support coverage, exact submitted feet,
swept collision and resource replay remain required.

TS window routing now projects final point goals vertically and rejects horizontal
endpoint drift above 1e-6 metres. The 0.5-metre support adjustment remains available
for intermediate coarse anchors; explicit final interactions retain their own
region semantics. This corrects an older solver behavior exposed by the independent
verifier, rather than relaxing the goal contract.

Analytic slope and prepared-window regressions fail before these fixes and pass
afterward. Package formatting, lint, typecheck and 453 TS tests pass. Replaying the
fifty saved historical submissions still rejects 25 unsupported/obstructed walks
and 25 old shifted endpoints. Saved trajectories are neither repaired nor replaced
by this audit. Navigation-space heights still need physical execution before these
routes can satisfy the newer contract. No new solver performance run was made;
the baseline below remains bound to its measured `1e942192` source.

## Historical pure-TS compatibility baseline, 2026-11-14

A usable historical TS solver/benchmark combination is retained.
Rust performance work is paused. The unfinished native-admission experiment is
preserved in the local stash named `paused-native-admission-investigation`.

`src/v1/solver/physical/prepared.ts` is restored to `d35e4997`, before the
physical-execution adapter was inserted into candidate emission. Existing witness
metadata and the independent physical verifier remain available. TS returns the
historical navigation-space candidate; evaluating that candidate is external to
search. No Rust prototype preload or N-API solver is used by this baseline.

`pnpm benchmark:history --output <report.json>` uses the frozen `4ec7b65f`
measurement core with the current worker lifecycle. It always trains ten map02
requests, freezes the catalog, warms two disjoint requests, and scores all fifty
normal requests once by default in one worker/lane (`--rounds` opts into repetition). Training retains the historical
8,000-candidate/64-link budget. `--reference <report.json>` optionally compares
modeled costs for identical requests and records input/adapter binding matches.
The historical gate covers reported completion, modeled cost, SLO and repeatability.
A separate post-shutdown physical audit replays the saved first-round submissions
against provider-normalized facts. Both outcomes are explicit in the report.

The maintained entry point passed on clean commit `1e942192`: 100/100 attempts
complete, zero timeouts/recoveries and identical outcomes/truncation across two
rounds. Mean serial service is 1359.696 ms; readiness is 80.284 s, measured batch
136.001 s and end-to-end 216.412 s (221.150 s including the separate audit).
Historical cost geometric mean/worst ratios are 0.952314/1.039298, within the
unchanged 1.01/1.05 gates. The physical audit rejects all fifty distinct routes:
twenty-five unsupported/obstructed walks and twenty-five endpoint mismatches.
Historical completion and modern physical acceptance remain distinct contracts.
The report and per-request journal are under
`.local/research/ts-history-final-1e942192/`; exploratory evidence is preserved under
`.local/research/ts-history-compat/`.

## Benchmark request lifecycle

The worker pool requests ID-bound cooperative cancellation after the soft query
threshold or caller abort. The slot remains busy until its execution returns from
a checkpoint; cancellation tail time is measured. No worker is killed, replaced or
retrained. A long synchronous stage may exceed the threshold before yielding.
Healthy peers continue serving; actual process failure invalidates the run.
Fatal protocol/input failures request cooperative cleanup rather than force exit.
Legacy recovery counters remain zero for report compatibility.

TS scene and physical stages yield to the event loop before checking AbortSignal.
Both forward windows and target-side approaches pass that signal through the scene
adapter into physical preparation. Aborts release the lane without poisoning input
identity. Native solvers retain their existing atomic cancellation checkpoints.
Warmup failures remain outcomes and scoring continues after cleanup; incomplete
training still prevents service readiness. The CLI journals each completed request.

Both `benchmark:full` and `benchmark:history` default to one measured round. `--rounds`
can request repetition; earlier two-round results record specific experiments, not
a standing user requirement. No new solver performance measurement accompanies this
lifecycle change. Report measurement identity names cooperative cancellation.

## Required V1 service preparation, 2026-11-14

`GangliaV1Config.preparation` requires positive training and warmup request counts,
defaulting to ten and two. The low-level solver factory constructs the kernel
used for startup; service hosts train reusable physical connections, freeze the
catalog and warm the same solver before declaring readiness. Prepared TS and
native configs snapshot the nested policy.

Native catalog training runs bounded physical discovery in one loaded window per
request. It retains proved nonterminal connections even when no complete route
exists, without resource-label search, ground-detour fallback or scene retries.
Training returns `catalog-trained`, not a fabricated completed route. Frozen
service queries still run ordinary route/resource search and independent replay.
Frozen catalog retrieval indexes directed navigation SCCs and selects connected
action chains, with bounded progress prefixes and intra-region crossings when
NAV connectivity hides physical cracks. Search still proves their ground joins. Authored
World actions remain available. Every selected catalog connection still passes
authority and full trajectory replay; omitted proposals mark search truncated,
and ordinary bounded fresh discovery remains available.

The built-in benchmark adapters bind this policy to tracked map02 preparation
requests independently of the scored workload. A normal full-population command
scores all fifty requests and always executes preparation. Training overlaps ten
scored requests; warmup uses separate goals. This is a trained full population,
not an unseen holdout. Optional CLI training/warmup switches have been removed.
Old flat policy files inherit required preparation from algorithm defaults.
Explicit missing/disabled policy, absent training records, unfrozen catalogs,
wrong warmup counts cannot enter V1 scoring. Warmup failures are recorded and
measurement continues after the worker is reusable. Training timeout still stops
incomplete preparation. Retained TS
baseline reports are reused; fresh TS and stress runs are excluded by the user.

The earlier configured-warmup diagnostic predates cooperative cancellation: its
lower-floor timeout restarted the worker and lost training. The corrected
`8eed53ee` full-population run retained its worker after an upper-floor warmup
timeout and continued scoring. It was stopped for solver optimization after 37
scored attempts; the journal contains 11 complete native traces, 20 candidate-budget
failures and six timeouts. Batch physical evaluation had not run, so those traces
are not accepted physical completions. Artifacts are in
`.local/research/rust-lifecycle-full50-8eed53ee/`.

Resource labels and lazy ground jobs now share goal-directed queue priorities.
The remaining horizontal distance is divided by the graph's maximum action or
walking speed, including boost allowances. Actual accumulated cost still governs
dominance and retained label caps. All resource/geometry proofs and budgets remain
unchanged. This addresses cheap-prefix expansion in trained action graphs;
full-population acceptance remains required.

Known-action lookup tries direct supported walks first. Positive catalog chains
also admit lazily ranked ground detours before fresh discovery. Stage-zero walking
retains full ground paths. Resource queues use reverse shortest-path potentials
through an optimistic complete walking graph, fixed device clocks and flight
speed bounds. Terminal actions keep a zero bound because boost replay can move
the first collection point. This
retains a lower bound without treating an unrelated fast device as the speed of
every part of the map. A feasible route bounds optional improvement.

Service preparation can spend separate `catalogCandidates` and `catalogLinks`
budgets; defaults are 32,000 and 256, while serving retains 8,000 and 64. Goal-side
training proposes incoming jumps across support regions and proves every retained
flight. World caches exact directed ground proofs within its immutable facts;
new coverage or placements construct separate caches. Continuous raw support can
certify physical walks across imported NAV gaps while explicit passage masks and
directions remain authoritative. Coarse scene planning tries exact endpoint
support before its broad projection fallback and orders work toward the goal.
Landing discovery queries the prepared support BVH within a conservative flight
envelope and evaluates four flight phases without heap allocation. Whole-route
resource labels share immutable output blocks, and a completed single prefix
reuses its already-composed route and continuation when no terminal is appended.
Full-population performance acceptance of these optimizations is pending.

## Rust rewrite integration, 2026-11-14

Native placement revalidation retains each piece's original local query and
replays its adaptive flight witness under the final joint poses. Collection
prefixes stop at the original interaction rather than requiring a safe unused
landing. Future terminal assets receive the same pose check; a bounded ordinary
window load supplies missing terminal coverage without running Search or changing
the witness. Failure retains the independently valid original-scene partial.

World separates physical standing from navigation admission. Search owns nav
tolerance and preserves supplied physical feet. Optional unavailable-space
witnesses are skipped with truncation through an exact coverage-error category;
invalid geometry and controls still fail. Computed native flight peak speed is
emitted and replay-checked, including run-off approaches. Both jump and drop gait
classification use this authority, so a fast drop requires an active sprint.

Bounded ground feedback exposes typed local direct-proof failures and one
optimistic directed NAV proposal. Weighted 3D proposal ranking and authorized
coalescing share a finite work allowance. Local physical failures can allocate raw
support-boundary samples from the existing sample budget. Feedback and flight
proofs share the existing candidate-attempt pool; unused feedback reserve returns
to flights. Neither a failed chord nor an exhausted NAV proposal excludes ground
detours. Complete retained NAV paths may be physically certified despite an
exhausted coalescing allowance, provided every leg and exact join passes.

The captured upper-floor first window remains a finite discovery miss. Its
85-point NAV proposal exposes 23 raw support failures and one clearance failure.
Lazy geometry jobs compete with resource labels through admissible lower bounds;
expensive full detours are proved only when selected. Supported generated interior
landings can become later flight sources and targets, within the existing total
attempt and graph-growth limits. World retains dense repair state and batched
adjacency/proof lookups without changing the directed graph or exact proofs.
Stage 2 searches directly proved walks and existing actions first, then restarts
resource labels with ordinary ground detours if necessary. Both passes share the
original expansion budget. An early completion is approximate when detours remain
unexplored and is marked truncated. The captured first window now finishes all
285 fallback jobs in 27.47 seconds without a route. Engine can respond with
expansion and subdivision rather than exhausting service time in that window.

The complete upper-floor Scene query finishes in 37.474 seconds through eight
window loads, with `complete`, `partial=false`, modeled cost 4.525145 seconds and
length 34.651996 metres. Independent physical replay passes with no issues.
Evidence is `.local/research/rust-solver-rewrite/parent-upper-scene/`. Expanded IO
requests returning the same facts reuse identical bounded failures only inside
the current query. Revision, coverage, continuation, joint poses, catalog or
stage changes require new work. Stage 1 is omitted when no known actions or boost
pickups distinguish it from stage 0. Subsequent queries always search afresh.
The frozen `102e323c` small regression run completes its requests with independent
physical replay valid and no timeouts. It omits training/warmup and predates the
noclip v106 update, so it supplies no current service-performance result. Routine
acceptance uses the configured full local population specified in `AGENTS.md`;
long-distance stress is opt-in.

Following-fact growth revalidates selected prefixes and retained partial/incumbent
proofs. Every known default body remains present in later sparse Worlds even when
not moved. Provider authority conflicts are fatal and cannot recover an older
incumbent. Native computation runs on libuv with task-scoped cooperative
cancellation, keeping the JavaScript event loop available for AbortSignal and IO.
Rejection resets suspended work and the host residency mirror; subsequent queries
can reuse the prepared solver.

The assembled checkpoint passes 140 Rust unit tests, two authored-action tests,
23 native integration fixtures and the retained 440 TypeScript tests. Release
N-API build, feature-enabled all-target Clippy, TypeScript checking, lint and
format checks pass. This validates the new contracts and focused fixtures; it
does not establish whole-map acceptance.

The six-request/two-round run at `2c3cdec2` was stopped before its final report
after the authority/cancellation audit found required fixes. Its incomplete record
is `.local/research/rust-solver-rewrite/six-query-2c3cdec2/incomplete.json`.
After the fixes, the full upper Scene diagnostic again passes physical replay at
the identical modeled cost, taking 37.697 seconds; evidence is
`.local/research/rust-solver-rewrite/parent-upper-async/`.

`crates/ganglia-v1` owns independent native world, search and engine modules.
The retained TypeScript implementation is selectable as `ganglia-v1-ts` (the
`ganglia-v1` default remains compatible); `ganglia-v1-rust` uses the same
`PreparedRouteSolver` interface. The native host serializes normalized facts and
fulfills asynchronous terminal/window load effects. It does not invoke
`SceneResources.solve` or the TypeScript ground builder. Build the feature-gated
N-API library with `pnpm rust:build`; `GANGLIA_V1_RUST_LIBRARY` selects an explicit
artifact. The crate also builds as an ordinary Rust library without N-API.

World owns raw facts, BVH capsule sweeps, sparse coverage, support projection,
triangle ground generation/refinement, directed portal traces, flight controls,
rope/launch/boost/moving actions and following placement. Ground generation uses
slope-admissible source triangles and runtime support/clearance rather than
Recast parity. Selected ground chords are validated lazily and immutable geometry
proofs are bounded. Portal masks and split collinear intervals constrain walking.
Flight witnesses preserve the complete controls for independent replay, including
collection before a later collision. Following placement uses conservative body
clearance and supported horizontal roofs.

Search owns bounded action discovery, multihop routes, available arrivals,
ordered waypoints, interactions, terminal actions, following placement alternatives
and continuous stamina/sprint/dash/boost state. It emits whole-route `schedule`
and `placements`. Engine owns coarse corridor proposals, arrival alternatives,
target-side partial approaches, window stages/expansion/subdivision, composition,
cancellation and catalog lifecycle. Prepared worlds use a four-entry LRU keyed by
complete revision and coverage identities. No completed-query result or persistent
query failure cache exists. Catalog banks bind the same identities and freeze
before measured service. Sampled discovery and finite labels can truncate search.

The hardened integration passes 106 Rust unit tests, two authored-action end-to-end
tests and twenty-one N-API fixtures. The fixtures use the independent common physical
evaluator for raw ground, multihop flights, launches, moving rides, following
placement, airborne collection and whole-route resources, including boost expiry
across several scene windows. The retained 438-test TypeScript suite also passes.
Authored surface endpoints and support IDs are preserved, and waypoints retain
their original height contract. Generated actions use content-derived identities
so catalog training does not replace unrelated actions at the same local index.

World exposes geometric support boundaries after outgoing portal apertures are
subtracted, and closest points on a specified support polygon. Search samples
boundaries and height strata separately from mesh interiors. Bounded continuous
landing proposals use these geometric operations, then require standing support
and full native flight proofs. They share the existing action-attempt budget.
Canonical walking refines actual three-dimensional spans against raw capsule
support before resource scheduling, retaining and charging support-height bends.
Supplied valid endpoints remain unchanged.

Matched map02 query `new-goal-near-lower-floor-ground-jump-6-1` now completes through
the full native scene host and passes unchanged independent physical replay. Its
modeled cost is 7.750350 seconds versus 7.684124 for retained TS. With one worker,
one lane, no training or warmup and one measured round, native batch time is
22.440 seconds versus 67.143 seconds, a 2.992x speedup; end-to-end speedup is
2.590x. Both routes are complete and the unchanged cost gate passes at cost ratio
1.008619. The report binds clean source `102e323c`; evidence is
`.local/research/rust-solver-rewrite/matched-102e323c/report.json`. Search is
truncated, and one round does not measure repeatability or broader reachability.
The preceding native watchdog failures remain historical failed experiments.

The native implementation covers the complete solver interface and action
families. Broader whole-map completion and route-quality work remain open. The
old Rust prototype and its TS injection hooks have been retired after independent
contract fixtures and complete Scene replay; the TS solver remains selectable
and is the default. Diagnostic reference routes are never production inputs.

The subsequent one-training/six-holdout/two-round replay at `a0796a09` fails the
physical gate. All six return native complete traces, but five fail common replay
with `Unsupported or obstructed walk` in both rounds. Only the lower-floor query
is physically accepted at that checkpoint. Training hits its 300-second watchdog; measured
requests have no timeouts. Results and truncation are stable across rounds. No
aggregate speedup is accepted. The resulting hardening adds raw centerline
support in addition to directed nav proofs and certifies walking clearance across
arbitrary resource cuts. Following bodies exist at their default spawn; joint
placements replace those bodies and obey supported box/exclusion contracts.
Moving support selection excludes ineligible static navigation before reduction.
Direct fixed launches derive height from canonical landing feet.

Scene continuation carries exact resource clocks and active boost facts from the
selected recomposed prefix. Following facts and placements survive sparse windows;
identical poses deduplicate and conflicting poses reject. Final completion checks
the original goal geometry, and bounded terminal alternatives retain their target
partials before coarse planning. Generated catalog admission binds native content
identity and physical authority, then replays the witness before granting generated
nav tolerance. Authored tolerances stay strict. Failed resumes clear the host's
snapshot residency mirror.

Broader route acceptance remains open: with stricter raw support, the formerly
fast upper-floor diagnostic spends most sampled time repairing ground proposals
and has no complete candidate before it is stopped. Discovery at raw support
interfaces inside imported nav and eager walking-detour work remain material.
Earlier-flight and future-terminal pose revalidation now use complete native
witness replay; broader route acceptance still requires assembled validation.

## Workspace migration checkpoint, 2026-11-14

Ganglia source and all tracked documentation were imported from standalone
commit `a2faa25` into Atlos's editable `talos/packages/ganglia` package. World and
the maintained noclip extractor resolve that workspace package directly; archive
preparation is no longer part of the local integration. The solver contracts,
algorithm and benchmark measurement policy are unchanged. Local development
resources live under the Atlos root `.local/`; the
[development guide](../contributing.md) defines the layout and relocation rules.
Benchmark defaults resolve data from that root independently of the working
directory. Historical sections below retain their original code and measurement
scope.

The `feat/3d-preview` integration at `162ca793` uses indexed open-traversal
state picks for offline point framing and validation, matching World's default
visibility. Moving-platform decode transfers and initial-pose framing are
maintained in the renderer patch. Noclip is now pinned to `ff48e1a7` (package
format v106). All nine integration patches apply unchanged, including the raw
normalized physical-input accessor. Existing v104 packages require repacking and
fresh companion/navigation/view bindings before changing the deployed catalog.
The local v106 map02 package passes manifest and 251-archive inventory checks,
including non-core archive sizes;
the complete seven-scene OEM release and GPU visual acceptance remain pending.
Solver and World routing source are unchanged by this upstream update.

## Shared TypeScript model and evaluation, 2026-11-14

`src/model/` owns collision and wall queries, support/interaction geometry,
execution of supplied flight controls and deterministic locomotion transitions.
`LocomotionModel` contains movement rules; `LocomotionOptions.search` adds V1
search budgets. Candidate enumeration, graph search, dominance pruning, resource
allocation and device discovery remain under `src/v1/`. Public `./model` and
`./evaluation` entries expose the shared boundary for another solver and a later
Rust migration.

`src/evaluation/route.ts` checks trace timing, continuity, available starts,
ordered waypoints and terminal query geometry, and independently recomputes time
and length. Benchmark scoring rejects inconsistent completed traces. Reports
identified this extraction checkpoint as `route-contract`. Physical certification
required world coverage and control witnesses for authored/device/airborne segments;
route samples alone do not certify resource feasibility or collision-free motion.
The subsequent physical-verification checkpoint below supplies that replay.

The process harness accepts an adapter module through `--adapter`; the default
V1 adapter owns scene preparation, exporter integration and catalog operations
under `bench/adapters/ganglia-v1/`. A separate-process fixture with its own
algorithm and no catalog exercises the same timing, SLO and scoring path.
`SolverSettings` describes the generic execution identity; the existing public
`SolverConfig` remains the V1 policy type for integration compatibility.
Schema 9 adds independent evaluation. Evaluation happens after each timed batch,
contributes to end-to-end time, and is outside per-query service time. Historical
schema-8 timing claims retain their original scope.

Validation: package formatting, lint, typecheck and all 424 tests pass. World
application and worker typechecks and seven integration tests pass. A native-backed map02 replay completes
all 12 measured attempts across six requests and two rounds, with six identical
reference route hashes, stable truncation and no timeouts or lost routes. Cost
recomputation differs only by floating-point summation, below 3e-15 seconds.
Native parity passes the seven transfer, collision, ground, goal and locomotion
cases. Five unrelated candidate-search cases fail because the retained native
artifact lacks `CandidateSearchIndex`; no Rust artifact was rebuilt. Evidence is
in `.local/research/ts-decoupling/accepted-serial.json` and its validation summary. These checks establish refactor behavior and
evaluation scope; full-map coverage remains open.

## Independent physical verification, 2026-11-14

`src/evaluation/physical.ts` verifies execution against provider-owned normalized
`PhysicalInput` snapshots. It imports shared model rules and public contracts,
with no V1 search dependency. `src/model/world.ts` owns sparse source coverage,
raw collision support, capsule sweeps and support-following walks. Navigation
polygons guide search; they do not establish physical support. Every submitted
walk must coincide with supported feet and charge its actual geometric length.
Flight controls are replayed with trusted movement/device parameters. Submitted
geometry also receives collision checks, so representation tolerance cannot
permit wall penetration. Equivalent segment splits and knot densities are
accepted through timed trajectory comparison.

For early airborne collection, uniform horizontal speed is measured over the
executed replay span. The nominal witness landing can lie beyond collection;
its full displacement must not be divided by the shorter collection duration.
Accelerating and steered flights use the replay model's peak speed for sprint
eligibility.

The replay checks whole-route stamina, sprint/dash choices, boost triggers and
expiry, directed device entry/exit, launch/rope motion, terminal first-goal events,
and placement geometry. Moving supports retain the exported phase-free swept
support assumption. Following placements retain the exported activity-range
assumption and flat-cuboid eligibility; their complete body must clear terrain,
other bodies and exclusions. An unused unsupported convex body remains an
obstacle and supplies no additional walkable roof.

Following facts are shared across the route's sparse snapshots, with conflicting
definitions of one ID rejected. Each selected placement needs a complete local
proof covering its bodies and, when moved, original collision ownership. A later
window need not contain that placement or repeat its exported facts. All known
following bodies still contribute geometry to every window configuration, so
omitting a local device entry cannot remove an obstacle. Placements without any
complete proving snapshot and globally unknown device IDs are rejected.

V1 publishes execution controls, selected placements and flight witnesses. Before
resource scheduling, `src/v1/solver/physical/execution.ts` constructs its actual
support-following walking geometry. This is solver-side candidate construction;
the independent verifier rejects inconsistent submissions rather than repairing
them. TS shared collision execution remains independent of native search.

Schema 10 adds a post-batch physical-verification RPC to the default adapter.
The adapter captures normalized facts before search and lazily builds separate
verifier indices outside query timing. Recovery can regenerate normalized facts
through the exporter using a no-search capture sink. Raw collision and declared
sparse tile coverage remain the authority. Verification contributes to observed
end-to-end time, while batch/service latency covers solving. Other adapters can
supply the same verification protocol; the harness always checks route/query
consistency independently.

Package formatting, lint, typecheck and all 438 tests pass; World application
and worker typechecks pass. Standards and Spec rechecks are clear. The finite
six-request/two-round real control failed the completion gate with a reduced
one-training-request recipe: one distinct request passed physical verification
in both rounds, while five returned `no-verified-route` in both rounds. There
were zero watchdog timeouts. Mean serial service time across all twelve attempts
was 120.353 s/attempt, including failed searches; readiness was 91.006 s and
end-to-end time was 1540.952 s. The original ten-training-request recipe was
canceled after 20 min 28 s before readiness. Candidate construction/search
completion and preparation cost therefore remain open integration work. The
matching history entry records the complete recipe, failed gate and source-bound
evidence. Full-map performance remains a separate workload.

## Benchmark lifecycle, 2026-11-14

Schema 8 measures one algorithm and preparation recipe for every deployment
interpretation. Input read/decode/hash cost is separated from adapter validation,
resource indexing and factory preparation. Declared catalog training is service
preparation: each worker sees the same training requests in order and freezes
before service readiness. Worker-ready and service-ready times, per-worker costs,
prepared memory and sampled peaks are reported. Per-worker phases overlap and
must not be summed into wall time. No production solver, search budget or
query-state cloning change is included.

V1 runtime warmup is required by its algorithm configuration and uses separately
declared requests. Scored queries never
serve as an excluded warm pass. Every measured round counts. Repeated rounds
compare outcome hashes and truncation to the first measured round; one round
does not establish repeatability. Existing caches and frozen catalog preparation
are reused by the same algorithm. Deferred V1 preparation remains in query time;
this refactor does not establish eager, query-independent preparation of all
scene indexes.

Per-query service time, queue time and response time are separate. The existing
300-second dispatch watchdog applies to training, warmup and measured requests.
Recovery remains in actual batch wall time. Observed end-to-end time spans Node
process origin through solver shutdown and includes loading, preparation,
training, warmup, all measured rounds and recovery. Final source re-verification
and report formatting follow that interval. Online service, browser offload and
offline throughput are interpretations of these measurements. Browser index
transfer, restoration and browser execution remain unmeasured.

Quality references retain their input/query bindings. Speed ratios require
matching schema-8 measurement recipes; earlier dated results retain their
original excluded-training/prewarm contracts.
The Markdown report keeps batch and end-to-end speedup visible, including
reference/current timings or the reason a matching ratio is unavailable.

Validation: format, lint, typecheck and 414 tests pass. The retained six-query
reference passes unchanged with ten training requests, two disjoint runtime
warmup queries and two measured rounds under both one-worker serial and two-worker
parallel scheduling. All 24 attempts complete, with identical route hashes,
modeled costs and truncation flags; each worker freezes 239 actions. Evidence and
exact code/input bindings are in the corresponding history entry and
`.local/research/benchmark-lifecycle/validation-summary.json`. No stable speedup,
full-map coverage or browser execution claim is made.

## Map-scale benchmark snapshot, 2026-11-13

The long-range workload uses full Wuling navigation and physically grounded
endpoints. It complements the historical 100 by 120 metre local-patch controls.
Maximum-span requests cover 3.56 to 4.41 kilometres directly; separate detour
requests exercise layered ground. A physically valid endpoint can be absent from
coarse navigation, so retain those coverage failures and distinguish them from
successful long-distance traversal when interpreting latency.

The headless benchmark applies a 300-second SLO to every dispatched query,
including training, prewarm and physical coverage preparation. A parent process
kills a timed-out solver process and its exporter descendants. A timeout is a
failed request with no complete route. Input loading and queueing are outside
the per-query deadline; globally idle replacement loading is reported separately
and excluded from measured batch time. Attempt throughput includes failures;
successful throughput counts only complete routes within the SLO. Compare gained
and lost solutions before latency and modeled route cost.

Physical coverage preparation repeats fresh whole batches until a complete pass
requests no new regions within that SLO. This establishes input availability for
that execution, rather than corridor traversability. An earlier unlimited
4.02-kilometre request exhausted search with a verified target-side fragment;
it counts as incomplete even though the fragment's own route status is complete.
The unlimited preparation was stopped when the SLO was introduced. A capped
whole-workload pass generated 27 more regions, and a frozen 119-region snapshot
now preserves those inputs. The 4.02-kilometre request times out after 300 seconds
in both prewarm and measurement, with zero complete routes. Full-workload input
closure remains unverified; further preparation is paused.

The integrated catalog optimization retains one topology and walking-reachability
cache per prepared graph, with action adjacency scoped separately to each bank.
On six local regression requests with a trained frozen catalog, three interleaved
fresh-process pairs of fifteen measured batches average 313.53 milliseconds per
query before the change and 303.62 afterward, a 3.16 percent reduction. All pairs
improve, and every route outcome and modeled cost matches. This result describes
the catalog-enabled local workload; the full-map request still times out. Format,
lint, typecheck and 411 tests pass. Optimization is paused after this change.

Large collision exports use optional local Node V8 snapshots with exact Float64
coordinates and Uint32 indices. JSON hits a single-string size limit in dense
windows; retaining all numeric arrays on the JS heap also exhausted a 12 GiB heap.
The binary representation keeps numeric buffers outside that heap. It is a local
cache, bound to its exporter/runtime and source/profile provenance. Original JSON
inputs remain preserved. Decoding and hashing remain setup work; benchmark input
errors invalidate a run even when the solver preserves a valid local fragment.

Preloaded raw faces outlive individual physical windows. WeakMap keys alone
therefore cannot retire their derived support geometry. Preparation owners now
release those pure lookup memos when retiring a region, while existing projectors
keep their own snapshots. Rebuilding derived geometry remains query preparation
work; decoded input files remain available throughout the batch.

These readiness statements expire when the workload, kernel, configuration,
adapter or inputs change. Repeat coverage preparation before measuring a changed
combination. Historical local-patch speedups describe their original requests.

## Earlier implementation checkpoints

The `misakavan` merge of upstream main `1a617c9` carries the alpha.77 kernel changes in the source-only TypeScript alpha.81 package. The benchmark contract remains the prepared full-scene batch described below. Earlier checkpoints retain their original source, input and validation scope.

Alpha.82 keeps the same solver behavior and uses native package-local `#@/` imports, defined once in `package.json`. Runtime consumers require no custom alias loader or duplicated TypeScript path mapping. Test coverage emphasizes results at the prepared solver, geometry and movement interfaces; implementation-copy and object-identity checks have been removed where behavior is already covered.

This handoff describes Ganglia `0.1.0-alpha.76` at local commit `917dfcd` and its Atlos integration at `9311d063`, as inspected on 2026-11-10. The companion [history and testing record](history.md) owns the chronological experiments, complete measurement tables, regression corpus and validation procedures. The source layout was subsequently reorganized on 2026-11-11, starting from `c8cc213`. The subsystem and composition sections below describe that source refactor. The alpha.76 performance measurements remain bound to their historical implementations.

The optimization priority is serial single-query latency while preserving supported
behavior, reachability and route quality. Compare fixed representative workloads
and inspect their containing requests so a local gain does not hide shifted work.
The pipeline includes terrain generation, support/portal/graph/index preparation,
corridor search, action discovery, collision validation and resource scheduling.
Improvement targets depend on each workload's starting cost and bottleneck.

The latest user acceptance gate (2026-11-11) permits route-cost deterioration up to 5% against the valid same-input control. Feasibility failures, timeouts and larger cost regressions require fixes within the new algorithm. The retained-corpus repair and bounded validation are described in the final delivery section below. Historical timings remain bound to their implementations.

## Repository ownership and entry points

Ganglia owns the geometry, directed passages, collision queries, movement candidates and search algorithms. Atlos owns upstream adaptation, data exports, resource/job scheduling, persistent storage and presentation. Ganglia owns physical-window selection, projection, subdivision and expansion, local goal refinement and continuous route composition. The separate `endfield-noclip` checkout supplies upstream source and local research evidence.

| Area | Owning source |
| --- | --- |
| Global corridor proposals | [`src/v1/search/candidate-planner.ts`](../../src/v1/search/candidate-planner.ts), [`src/v1/search/candidate-transfers.ts`](../../src/v1/search/candidate-transfers.ts) |
| Physical support generation | [`src/v1/geo/build.ts`](../../src/v1/geo/build.ts), [`src/v1/geo/support-field.ts`](../../src/v1/geo/support-field.ts) |
| Ground query and geometry preparation | [`src/v1/route/ground.ts`](../../src/v1/route/ground.ts), [`src/v1/geo/surfaces.ts`](../../src/v1/geo/surfaces.ts), [`src/v1/route/straighten.ts`](../../src/v1/route/straighten.ts), [`src/v1/route/movement-geometry.ts`](../../src/v1/route/movement-geometry.ts) |
| Movement search | [`src/v1/route/jump-planner.ts`](../../src/v1/route/jump-planner.ts), [`src/v1/search/traversal.ts`](../../src/v1/search/traversal.ts), [`src/v1/search/shortcuts.ts`](../../src/v1/search/shortcuts.ts), [`src/v1/route/route-shortcuts.ts`](../../src/v1/route/route-shortcuts.ts) |
| Dynamics and pruning | [`src/v1/motion/jumps.ts`](../../src/v1/motion/jumps.ts), [`src/v1/reach/reachability.ts`](../../src/v1/reach/reachability.ts), [`src/v1/reach/motion-bounds.ts`](../../src/v1/reach/motion-bounds.ts), [`src/v1/motion/flight-steering.ts`](../../src/v1/motion/flight-steering.ts), [`src/v1/search/candidate-bounds.ts`](../../src/v1/search/candidate-bounds.ts) |
| Airborne objectives and boosts | [`src/v1/route/airborne-goal.ts`](../../src/v1/route/airborne-goal.ts), [`src/v1/route/boosted-route.ts`](../../src/v1/route/boosted-route.ts), [`src/model/goals.ts`](../../src/model/goals.ts) |
| Collision and resources | [`src/model/collision.ts`](../../src/model/collision.ts), [`src/v1/resource/locomotion.ts`](../../src/v1/resource/locomotion.ts), [`src/v1/resource/resource-search.ts`](../../src/v1/resource/resource-search.ts) |
| Atlos ordinary request | [`dev-route-server.ts`](../../../../apps/world/dev-route-server.ts), [`travel-arrivals.ts`](../../../../apps/world/travel-arrivals.ts) |
| Atlos resource scheduling | [`physical-route-builder.ts`](../../../../apps/world/physical-route-builder.ts), [`route-worker.ts`](../../../../apps/world/route-worker.ts), [`window-route.ts`](../../../../apps/world/window-route.ts) |
| Atlos terminal assets | [`terminal-routes.ts`](../../../../apps/world/terminal-routes.ts) |

The authoritative noclip adaptation lives in Atlos
[`talos/integrations/noclip/`](../../../../integrations/noclip/source.json).
Its manifest binds the upstream archive and owning patches. The noclip cache is
generated source; maintain changes in the integration patches and inspect the
manifest for its version. Historical measurements retain their recorded source
bindings. Navigation and physical export revisions are separate data bindings.

## V1 source subsystems

The 2026-11-11 source reorganization uses these ownership boundaries. Public entry points separate playback, solver creation, host integration, build
and collision. Their shared data contracts live outside `src/v1/`. V1 consumers
import owning modules directly. Public build forwards to V1 support construction;
collision forwards to the shared model.

| Directory | Responsibility and modules |
| --- | --- |
| `geo` | Scene representation and support construction. `surfaces`, `build`, `clip-surface`, `support-field`, `support-projector` |
| `reach` | Directed connectivity and conservative reach information. `connectivity`, `distance-field`, `reachability`, `motion-bounds` |
| `motion` | Motion candidate controls, landing witnesses and graph conversion. `jumps`, `flight-steering`, `landings`, `motion` |
| `search` | Implicit successors, proposal search and discovery. `candidate-planner`, `candidate-transfers`, `candidate-bounds`, `lazy-route`, `shortcuts`, `traversal`, `boundary-order`, `heap` |
| `resource` | Continuation-state search and fixed-route scheduling. `resource-search`, `locomotion` |
| `route` | Route orchestration, prepared planning context and improvement. `routes`, `ground`, `jump-planner`, `airborne-goal`, `boosted-route`, `route-shortcuts`, `ground-detours`, `straighten`, `movement-geometry` |

The directories under `src/v1/` describe the ganglia-v1 implementation. Shared contracts live in the outer geometry, movement, route and solver modules. These directories describe current responsibilities. Cross-subsystem dependencies
remain explicit. `route/movement-geometry` assembles geometry with ground-planner
preparation and discovery boundaries. It retains the existing runtime dependency
cycle with `search/traversal`. `traversal` also owns `standingFoot` and discovery
validation shared by motion callers. `src/model/goals` owns support projection
and terminal flight clipping. The generic `search/heap` is used by distance and
resource searches. Future extraction of these mixed responsibilities must preserve
snapshot ownership and avoid a second implementation of support or goal semantics.

### Search-state ownership and composition contracts

| Owner | Meaning of its state | Composition boundary |
| --- | --- | --- |
| `reach/reachability` | Necessary geometric/dynamic envelope predicates | An envelope intersection permits further validation. Rejection requires a conservative bound for the specific control family, support correction and objective |
| `reach/distance-field` | Shortest labels over the supplied retained base graph and action overlay | Root costs and edge costs must use one unit. Ground costs are scaled with `lengthScale`, action costs already use that field unit. Missing labels describe this graph's coverage |
| `search/candidate-planner` | SCC proposals, transfer materialization and proposal scores | Unknown transfers guide physical coverage. Penalties rank proposals and provide no physical time bound |
| `search/lazy-route` | Optimistic graph plus validated edge replacements | Unknown costs must be lower bounds in seconds. Accepted replacement cost must be at least the optimistic cost. Validation failure and an interrupted validation have different persistence |
| `search/shortcuts` | Query-bound cursors, witnesses, action revisions and discovery caches | Geometry-only results can survive query changes under their binding. Reachability-dependent cursors must follow query and action revisions |
| `route/jump-planner` | Per-solve verified action pool, per-arrival discovery and complete incumbent | Every arrival sees reusable actions locally. New-link quotas count its discoveries. Incumbents are compared after complete resource scheduling |
| `resource/resource-search` | Cost labels for exact continuation-state keys | Labels include energy, recovery delay, sprint activation, velocity, direction and dash state. Resource feasibility is specific to the entry state and scheduling policy |

The following rules govern changes across these owners.

1. **Bind immutable inputs at the query boundary.** Geometry, directed portals,
   collision world, body, walls, movement model and device state belong to the same
   snapshot. Existing identity-based caches require replacement objects when these
   inputs change. In-place mutation violates their current contract. Persistent or
   cross-worker sharing will require an explicit source/model revision binding.
   A common runtime snapshot/version object across all six subsystems remains open.
2. **Keep three cost roles explicit.** Proposal ranking, admissible lower bounds
   and executable resource-timed costs have different contracts. Candidate penalties
   must never be fed directly into lazy-route unknown costs or incumbent pruning.
   `distance-field` labels are exact for their supplied graph, which can omit future
   actions. Using such labels as a lower bound on an expanded graph requires an
   additional conservative argument. The current discovery uses them for retained
   connectivity and ordering under its finite coverage rules.
3. **Separate physical evidence from discovery coverage.** A swept, supported
   action establishes a particular motion under its bound inputs. A failed witness
   establishes only that witness's failure. An exhausted quota or an ungenerated
   successor leaves unresolved coverage. Avoid caching a whole region pair as
   impossible from either event. Resource rejection belongs to the continuation
   state, and terminal-only collection actions cannot become ordinary transfers.
4. **Invalidate by actual dependencies.** Appended action edges can incrementally
   relax distance fields. Changed roots, base graph, weights, direction or scale
   restart them. Discovery action revisions include motion content under stable IDs.
   Changed query endpoints, interaction, speed, `costBound` or `boundGoal` clear the
   relevant cursors/fields. Increasing work resumes a cursor, while a larger retained
   link quota can require rebuilding discarded representatives. A wider prefix bound
   retries a prior tighter-bound failure. Transfer keys remain snapshot-scoped.
5. **Preserve uncertainty through validation.** `lazy-route` keeps an edge unknown
   after cancellation or a thrown validator and closes it only when validation
   returns `null`. Callers must reserve `null` for rejection under the fixed validator
   context. Changing physics or resource-entry context requires a fresh planner.
   Discovery truncation must remain visible when composing route results.
6. **Keep pruning proofs local to their domain.** Complete-flight bounds do not
   apply to an earlier terminal hit. Immediate ballistic launch bounds do not cover
   supported uphill run-off. New speed devices can invalidate a time lower bound.
   More stamina alone does not justify resource dominance with automatic sprint
   restart. Existing bounded scheduling and retained DP dominance still have the
   model limits recorded below.

This reorganization preserves the existing algorithms and cache implementations.
It establishes module ownership and review contracts. A shared action-evidence
registry, a common query revision object, consistent resource transitions and full
incremental graph repair remain follow-up implementation work. Existing targeted
regressions cover lazy validation, distance-field updates, cursor continuation,
bound widening and per-arrival action reuse. They establish their fixture scope.

## Solver contracts and physical windows

Alpha.84 keeps implementation code under `src/v1/`. The root entry exports the primary solver factory/configuration, shared contracts and playback. The solver entry exports the factory/configuration and input/output/resource contracts. Host operations remain explicit in `solver/host`; build and collision retain separate resource-facing entries. No `v1/*` package subpath is exported. Shared contracts contain no implementation imports. Internal code imports its owning modules rather than the root or solver barrels.

The `./solver` entry point separates immutable scene facts from movement/search
configuration and per-query endpoints. Its prepared solver retains single and
whole-batch submission; adapters own batch scheduling. `createWindowRoute`
receives resource operations rather than filesystem paths. Window strategies and
whole-route composition stay in Ganglia so callers cannot accidentally change
feasibility through scheduling or presentation code. The Atlos adapter loads
physical inputs and executes jobs. Explicit traversal semantics travel with route
segments; renderers do not interpret connection identifiers.

Ganglia also owns the physical-query stage orchestration, feasible fixed-device
connections, moving-support baking and route annotations, and following-support
placement search. `prepareRouteSolver(config, input)` selects the algorithm and
prepares scene, physical or surface inputs behind the same single/whole-batch contract. The extractor adapter validates exported source/profile
bindings and normalizes game fields; its `player-route` command is a file/CLI entry.
Atlos runs an owned worker against that resource adapter instead of invoking the
extractor command for online solving. Browser resource and routing clients expose
transfer accounting separately from algorithm timing. The factory snapshots one immutable algorithm policy alongside immutable scene/movement inputs. The current policy is `GangliaV1Config` with `algorithm: ganglia-v1`; its explicit flat fields and fixed-policy constraints are documented in `src/solver/ganglia-v1.ts`. Queries carry starts, goal, interaction and waypoints, with no policy overrides. A prepared solver exposes the frozen policy as `config`. Per-query options carry typed progress/candidate events and cooperative cancellation; returned results retain grounded targets and display support boxes. Resource integration uses the separate `solver/host` seam: Ganglia selects serialized work and owns preparation-slot invalidation, while hosts consume its resource/scheduling plan. Coverage estimates and the active window strategy belong to Ganglia; unused legacy attempt/proposal helpers and their isolated tests have been removed. Online IPC carries a structured query. The game adapter prepares validated inputs and reports; CLI and worker adapters own atomic output. The owned noclip routing adaptation is maintained in `routing-adapter.patch`. Browser requests and results bind the catalog generation, source and fully-enabled state. Scene state changes invalidate the current request/result. The resource adapter shares preparation-slot invalidation with Ganglia, while retaining file identity and memory-budget policy.

The scene input supplies immutable `SceneNavigation` geometry. Ganglia-v1 creates
and retains its candidate planner during solver preparation; hosts do not select
a planner or provide a planning callback. `SceneResources` supplies physical
resources and optional terminal assets. The scene-level prepared solver owns
global candidate selection, query-scoped failed
transfer/arrival exclusions, physical-window retries, partial target-approach retention
and terminal-route composition. Atlos supplies normalized game facts and resource
operations, then formats solver events/results for display. HTTP polling reads ongoing
work; another request is not needed to advance the algorithm. Closing the scene solver
drains accepted single/batch work, and repeated close calls share the same completion.
Partial results carry an explicit marker and retain local discovery truncation.

Ganglia's only maintained benchmark entry is `benchmark:full`. Its CLI loads a scene input, calls the root-exported `prepareRouteSolver` directly, then passes the prepared solver to the batch timer. It submits the whole
scene-query batch once for unmeasured prewarming and again for measurement on the
same prepared solver. The file adapter reads/decodes all dataset inputs before either
pass and serves a fixed in-memory snapshot to lane-local physical preparation caches.
No frontend, resource HTTP process or completed-route cache participates. Timed work
includes query-specific normalization, search, physical windows, retries and any
remaining lazy computation. Preparation and prewarm durations are reported separately;
measured inclusive resource-adapter phase timers may overlap across concurrent lanes. The host-owned candidate timer is omitted; candidate search remains included in total batch wall time. JSON schema 5 adds deterministic modeled-travel-time quality summaries and optional fixed-reference comparisons. Complete non-partial routes contribute their total modeled seconds, including arrival overhead. A workload with missing/partial solutions has no total quality cost. Reference comparisons bind scene, source, consumed input content, game adapter and exact queries, while allowing different solver/configuration implementations. They report lost/gained solutions, per-query cost ratios, geometric mean ratio and worst ratio. Completion must be assessed before paired costs; a reference is not an optimality oracle. `--config` overrides algorithm defaults; required preparation remains present unless an explicitly invalid override is rejected. The report records the effective frozen policy. Warm/measured
outcomes and truncation flags are compared per input. The resolved game-adapter kernel
must match the benchmark checkout. Missing coverage requires offline preparation.

### Prepared execution and retained physical graphs

Alpha.88 retains one coarse ground planner alongside the one refined planner in
physical preparation. A goal-refinement patch no longer discards the coarse graph;
subsequent requests reuse it under the same generation/wall binding. Changed
bindings still invalidate dependants and moving preparation is released as before.
This is a bounded memory-for-preparation tradeoff, not completed-route caching.
Window routing also retains one resource-keyed projector and lazy ground planner.
A changed key replaces the slot. Final interaction handling only uses ground loaded
for that window, rather than borrowing a preceding window's preparation.

The Node-only benchmark worker adapter in `bench/workers.ts` implements the same
PreparedRouteSolver contract. Each worker loads and verifies an immutable scene,
then calls the root prepareRouteSolver; the complete query, global planner,
windows and physical preparation stay within that isolate. Only queries, requested
events and final results cross the worker seam. `--workers 1` retains inline
execution; larger values create persistent workers. An explicit config/concurrency
caps active queries. Otherwise worker count supplies the default concurrency.
Startup/loading/preparation and one complete prewarm batch remain outside timing.
The measured batch includes dispatch, queueing, IPC and remaining lazy work. Dynamic
assignment can change a query's worker between passes. Atomic cancellation flags
are checked cooperatively at solver events; close drains accepted work. Memory
fields are sampled RSS/heap peaks, not exact simultaneous or transient peaks.

The completed 20-query phase compares the original serial implementation against
two complete-query workers plus retained coarse/refined preparation. Measured
throughput increases from 0.059811 to 0.100077 queries/s (+67.32%), while every
ordered route outcome hash, modeled cost and truncation flag remains unchanged.
The experiment satisfies this phase's 50% throughput target on the selected map02
snapshot. It does not establish cross-map scaling or a stable percentage over
repeated runs. RSS sampled peak is about 10.10 GB for the final two-worker run.
Earlier physical-only and three-worker experiments did not reach that target;
Rust/native bindings were not introduced. Exact bindings and failed/inconclusive
strategies remain in the companion history.

## Current scene and movement assumptions

The working snapshot assumes completed tasks, enabled and powered facilities, and open doors. Geometry, body clearance, collision and applicable hazards still constrain passage. Factory region centres can serve as teleport arrivals under the fully traversable factory assumption. The fixed map02 snapshot uses daytime. Preserve these assumptions in result interpretation and source selection.

Moving rocks, lotus supports, conveyor boxes, elevators and seesaws use the user-approved phase-free model. Horizontal motion primarily supplies swept support. Vertical motion supplies directed transport connections. Periodic timing, boarding windows, waiting policies and selectable-floor control remain broader modeling work.

Following stepping boxes may be arranged within their authored activity region. The output records required placements. Activation, guidance and box-moving time are omitted from modeled travel cost. Current query success establishes the declared model and input coverage. Independent execution replay, perturbation tolerance and live-game timing remain separate acceptance work.

The default imported character snapshot uses a 9 m/s jump launch limit, 6.5 m/s sustained air-speed limit and 5 m/s² overspeed deceleration. These are source-bound model values. Read the selected movement file for a query's actual parameters.

The retained vortex interpretation comes from build `2954fa80-23c1-1579-2b22-4ecfd6d70418`. `InteractiveLogicAccelerateBuff.ReqAddBuff` forwards `accelerate_buff[0]` as the duration of `buff_common_speedup`. The authored `speed_multiplier` value 1.2 adds to the default speed scalar 1, capped at 2.2. The adapter uses a 2.2 multiplier. `ccs_duration` belongs to camera timing. The device's trigger volume and duration continue to come from exported data.

## Ordinary request flow

1. World resolves the marker, source-bound interaction rules and scene assumptions. `travelArrivals` creates eligible teleport/base arrivals, including source height ranges for centres requiring ground projection.
2. For matching airborne terminal assets, `selectTerminal` chooses a physically revalidated tail. The ordinary prefix then targets its grounded entry.
3. World loads `${scene}-ground-all.json` and passes its navigation facts into the scene solver factory. World reuses that prepared solver for the immutable scene snapshot. Ganglia-v1 constructs its candidate planner and searches across eligible origins; its points guide physical coverage selection. Candidate planning runs synchronously inside the solver, with cooperative cancellation at search checkpoints. Dedicated candidate-process isolation is no longer supplied by World.
4. `createWindowRoute` divides the corridor into bounded physical windows. Unknown/device transfer trajectories remain indivisible. Long straight ground spans receive intermediate coverage points.
5. `physicalRouteBuilder` obtains source-bound collision and ground inputs, constructs missing tiles, and schedules walking, known-device and full-action stages. Failures can widen coverage or shorten a window. Pending results retain explicit partial scope.
6. The World worker reads physical scene resources through the game adapter, which prepares Ganglia's physical solver. Ganglia projects endpoints, prepares collision and ground, compares walking/device/action candidates, refines missing goal support and applies following-support fallback under its declared model.
7. Accepted physical pieces propagate their actual exits. Window joining, ground-detour comparisons and terminal joining preserve exact endpoints and retime the complete motion sequence. World publishes the route with coverage, assumptions, physical progress and resource/event evidence.

A single `player-route` duration covers one physical request. Whole-task latency additionally includes queueing, process startup, origins, coverage attempts, ground construction, polling and optional improvement. A verified prefix or independent target-side approach retains its partial status until the ordinary connection completes.

Terminal reuse binds scene, game source, geometry generator, solver package, movement hash, target and interaction volume. `joinTerminal` requires exact positional continuity, carries goal-event indices and boost clocks, and reschedules resources. Solver upgrades can invalidate retained terminal assets through this binding. A complete `02gcZm4` teleport-to-airborne-target connection was recorded with alpha.67, while its asset eligibility under subsequent versions must satisfy the current bindings. See the Atlos [connection record](../../../../apps/world/docs/02gcZm4-connection-2026-11-10.md).

## Ground, support and collision contracts

Physical ground is generated from selected world-space collision triangles. Recast WASM performs slope classification, rasterization, low-height filtering, compact-span connectivity, body-radius erosion, regions, contours and detail meshes. Ordinary links use the smaller upward/downward step allowance with voxel margin. Larger drops and jumps require directed movement validation.

The support builder deliberately retains local climb/headroom semantics for stairs. The optional native ledge rule can erase stairs whose individual steps are legal. Existing staircase and seam evidence remains limited to its recorded fixtures and map samples. Padded tile builds share a world voxel grid, clip output to tile cores and reconstruct directed, step-limited seams. Missing tiles acquire no inferred connectivity. Excessive vertical ranges partition only at safe support-height gaps, with overlapping collision for clearance. Continuous support crossing an unsupported vertical partition fails explicitly.

The current `Surface` export consists of detail triangles. Native coarse polygon ownership has not been retained as a reusable hierarchy. Graph size therefore follows detail density. Adding a small local refinement can rebuild a much larger combined planner.

Local refinement is implemented by `src/v1/solver/ground-refinement.ts`; the patched extractor forwards to it. It selects inclusive collision-AABB candidates from the collision BVH, restores original triangle order and rebuilds bounded support at one third of the coarse cell size. Shared owned surface primitives avoid repeating some preparation, while global portals and graph relations are rebuilt for the combined support. These implemented local/native operations are part of the current pipeline. Persistent regional transfers and a complete coarse/detail ownership asset remain subsequent work.

Imported directed portal intervals remain authoritative through graph construction, exposed-boundary discovery and straightening. Point contacts, stacked surfaces and ambiguous overlaps do not establish passage. Ground straightening uses supported continuous traces, directed passages and wall checks. Same-height corner contraction and candidate-corridor straightening remove unnecessary tessellation turns under those constraints.

### Terrain and spatial preparation optimization

`buildGroundTiles` indexes the selected padded tile rectangles with the existing
`createBoundsIndex`, assigning source triangles once rather than scanning all
retained triangles again for every tile. XZ bounds remain inclusive, source order
within each tile stays unchanged, and each consumed tile releases its reference
list. Padded geometry, native Recast parameters, detail heights, clipping and
directed seam construction retain their previous semantics. This is input
partitioning, not a lower-resolution terrain model.

`surfaces` now uses scalar 3D calculations in portal interval tests and graph
distances, with the same arithmetic order/tolerances. Each face shares its rounded
vertex keys across adjacent edges. There is no persistent portal cache or changed
tie order, and geometry/mask changes are still validated by each preparation.

Atlos's owning `extractor.patch` now binds modular ground generator identities to
the public forwarding entry plus `geo/build`, `support-field`, `clip-surface` and
`bounds`. Legacy flat-package identities remain byte-for-byte unchanged. This
prevents a forwarder-only signature from omitting actual tile selection/build code.
The installed SDK and the main generated extractor have not been replaced by this
source/integration patch work.

On the retained 640,747-face input, portal plus graph preparation measured
4.509 s versus 3.425 s, with identical ordered hashes. In two complete candidate
cold/warm comparisons, preparation fell about 10% each time, but cold request
totals were 48.743→46.486 s and 45.149→45.230 s. The second total is effectively
unchanged/slightly worse, so no stable complete-request speedup is established.
Ground cold totals fell about 2% in two comparisons; warm differences were variable.
See [history](history.md) for exact bindings, memory, rejected native detail trials
and validation. Native detail construction, repeated large planner preparation,
serialization and lazy-transfer search remain open costs.

`createCollisionWorld` retains indexed source collision and broad-phase bounds. Ground support requires a suitable normal and permitted height correction. `standingFoot` verifies corrected foot support, stationary capsule clearance, wall state and reattachment to navigation support. A projected point alone provides insufficient action evidence.

Each accepted flight receives full-body capsule sweeps. Curved sample intervals are inflated to cover the quadratic deviation between chords, with interval refinement when conservative inflation contacts geometry. Collision indexing scope must cover the complete padded body and trajectory. Unknown walls and missing-cook bounds remain active conservative exclusions according to their exported state.

## Candidate graph and search

`createCandidatePlanner` builds known ground topology and SCC identities. It indexes endpoints spatially and restores original input order for stable support ties. `createTransferQuery` indexes source vertices once, then materializes unresolved transfers for expanded components. Duplicate coordinates share retrieval while original encounter ranks preserve bucket selection and ties. Candidate edges carry stable keys for Atlos failure exclusions.

Candidate penalties prioritize unresolved transfers and large ascents. They rank corridor proposals. Executable travel time is computed from the later physical solution. Corridor points retain exact endpoint positions and straighten known ground runs locally, preserving unknown/action boundaries. Transfer keys preserve identity across query, expansion and rejection histories within the same immutable input. Cross-scene/source/model reuse still requires the outer snapshot binding. The separate lazy planner can update validated edges without copying the entire proposal graph on each retry.

`planJumpRoute` compares the base route and available boost branches. `solveJumpRoute` retains known actions and a feasible incumbent, explores unresolved region proposals and alternating forward/reverse frontiers, then optionally searches broad and incumbent-local shortcuts. Accepted alternatives require complete resource-timed improvement. Directed coarse waypoints guide discovery and never grant physical passage.

Discovery budgets bound seeds, neighbour visits, endpoint checks, trajectory attempts and retained links. `maxShortcutCandidates` controls optional improvement. Reaching a computational limit leaves unresolved coverage and propagates `truncated`. Valid partial action evidence survives failed discovery. The retained finite candidate graph and control families define the current search scope.

Prepared movement geometry reuses immutable support, portals, graph, SCCs, projectors and spatial indices under matching wall/body conditions. Forward and reverse distance fields incrementally propagate appended action edges. Changed roots, base graphs, ordering or edge costs restart the affected field. These per-query fields and their reset/expansion diagnostics remain distinct from persistent physical assets.

Within one `solveJumpRoute` query, verified nonterminal actions remain available to later arrivals without consuming their discovery allowance again. This is a query-local pool, not a cross-goal or persistent global action cache. Origins retain their own link allowances, connection identities remain unique, and partial connections are deduplicated on unsuccessful multi-origin results. Failed prefix-cache entries record the cost bound under which they were searched and can be retried when that bound widens.

The patched extractor's `route-cache.ts` retains one physical input region, with a default 512 MiB serialized-input admission threshold and one entry per prepared slot. Input-file identity changes clear the generation. Replacing `ground` invalidates refinement, device and moving preparation, and moving replacement invalidates refinement. Ground, round-occupancy and refined variants can therefore displace each other. Source/content-bound tile caching and bounded endpoint projection reuse already exist, while multi-region prepared action assets remain open. `bounds.mjs` also already uses packed build columns and parallel nearest-heap columns, and `jumpDuration` avoids phase-object allocation during candidate retrieval.

## Dynamics, inverse constraints and candidate pruning

`jumpDuration` shares the vertical model with `jumpConnection`. The model contains authored ascent, apex hold, gravity, falling gravity and terminal-speed descent. `jumpTravel` integrates launch overspeed decay and optional speed expiry. Current controls include direct jump/drop, supported run-off, steering variants, horizontal split and waypoint motions. Each family retains its original physical validation.

`createJumpEnvelope` is a necessary candidate-domain predicate used during BVH traversal. It accounts for permitted height correction, maximum drop, horizontal range and launch-speed bounds. A shared 0.25 m relative-drop table rounds toward longer flight, providing an optimistic reach upper bound. Extreme ranges use the shared analytic fallback. Boundary inset and vertical-projection padding preserve witnesses outside a raw boundary box. This envelope covers the existing discovery prefilter contract. Arbitrary supported approaches beyond that contract still require a separate approach envelope.

`createJumpPredecessor` tests a source region against a target region before projection and spatial enumeration. It uses relative height intervals, optimistic maximum flight reach and minimum horizontal AABB separation. Its optional `.domain(sourceBox)` returns necessary nominal source/target heights, ballistic flight-time, horizontal-displacement and launch-speed intervals. Those intervals describe a necessary domain. A supported run-off can travel uphill before leaving support, so its complete duration requires the supported-prefix model.

The inverse region predicate currently applies to **reverse frontier** boundary streams whose landings must reach the goal-connected ground set. It also constrains projected reverse takeoffs. Excluded boundary seeds retain their original budget slots, preserving the budgeted seed prefix while avoiding projection and query work. Forward frontier can discover intermediate relay regions and therefore retains broader coverage. The full reverse control-domain API exists, while comprehensive region-pair/control-domain propagation remains open.

`createMotionBounds` supplies lower durations for complete supported transfers. The jump bound includes full ascent and apex hold and an inverse horizontal-travel bound. A terminal flight clipped by an airborne pickup has its own objective treatment. Supported run-off uses a weaker whole-motion horizontal bound until a verified approach supplies its actual launch and supported distance.

A completed outer airborne route can bound the cost of another prefix. `costBound` and `boundGoal` preserve the original bounded endpoint through direction/entry subqueries. Spatial tests combine optimistic approach, transfer and departure costs using the applicable speed bounds. A control-family bound can exclude jump variants that cannot improve that incumbent. Drop/run-off variants retain their applicable checks.

`flight-steering.mjs::mayReachGoal` solves an inverse horizontal hit-time interval for constant-horizontal direct jumps, then checks the vertical flight range over that interval before constructing a sampled arc. Chord-deviation and floating-point padding preserve the existing sampled-trajectory hit semantics. The caller also allows for the goal-refinement search radius. Drop, overspeed, split, waypoint and expiring-speed families conservatively retain their complete trajectory checks rather than using an unsupported inverse model.

Two alpha.76 optimizations apply specifically to **non-frontier improvement** enumeration.

- Stable top-K insertion admits competitive witnesses without sorting the full bucket after every insertion. Certain/uncertain ordering and ties retain their prior semantics.
- `createCandidateBounds` skips face witness construction only after every potentially occupied destination cell has a full, certain top-K bucket and a conservative score lower bound strictly exceeds each bucket tail. Floating-point padding protects cell boundaries and near ties. The face still consumes its original neighbour-budget slot. Large/unsafe cell ranges and uncertain tails retain ordinary enumeration.

Frontier enumeration keeps its original pair-coordinate and pool bookkeeping. Face/bucket pruning is deliberately excluded from frontier because discarded-witness history participates in later cursor batches; skipping that history could change resumed enumeration. The goal-projection cache and incremental bucket insertion were trialed on frontier, then withdrawn after direction measurements showed no stable benefit. `dominatedFaces` is a query diagnostic, distinct from resource-label dominance.

`landings.mjs` retains static face metadata and centre witnesses. A per-query `createLandingGoalCache` reuses only the goal-dependent face projection, returns fresh positions and bypasses reuse when goal coordinates change. Start-dependent projections and reach witnesses remain query-specific. Witness order remains start, goal, centre and reach-boundary intersections.

Frontier cursors retain boundary-seed streams, nearest streams, pending variants, rejected pairs and accepted representatives under the exact query/action binding. Changed geometry, collision world, constraints, model, endpoints, interaction, speed, `costBound`, `boundGoal` or action revision invalidates the corresponding state. Updating an authored action under the same ID still changes its revision. Enlarging the link quota rebuilds pools because an earlier smaller quota can discard representatives. Enlarging the work budget resumes. This cursor mechanism is frontier-specific. Repeated non-frontier searches for different airborne prefix endpoints still rebuild substantial candidate work.

## Subsequent conservative search experiments

The 2026-11-11 experiments start from `634ed45`. Their frozen source manifests,
request hashes and trials are under the local research directory
`algorithm-combinations-20261111/`. The package resolver points the maintained Atlos
measurement harness at an immutable source copy for each trial. Installed Atlos
alpha.76 and generated extractor source are unchanged by this experiment setup.
See [history.md](history.md) for the actual timing and acceptance scope.

The retained candidate implementation applies horizontal incumbent/prefix bounds
before seed projection. Conservative boundary-plus-inset boxes skip entire seed
regions using outward padding and strict cost slack. Each excluded sample consumes
its original seed slot. Remaining seeds receive the existing horizontal point tests
before support projection, which preserves XZ exactly. `seedProjections` counts
actual seed projection requests separately from charged `seedChecks`.

Four additional mechanisms were implemented experimentally and removed from the
final source after comparison. They include numeric vertical-model constants,
dependency-checked distance-field retention across goal changes, adjacent duplicate
face evaluation reuse, and geometry-owned numeric caching of boundary projections
at fractions 0, 0.5 and 1. Some combinations reduced helper work or projection
requests, but their end-to-end results did not establish a preferable retained
combination across the selected cases. The companion history preserves each trial,
including the faster heavy-only combination and its failed-window regression.

The selected bounds-only cold/warm totals were 89.654/88.752 s for heavy action
(control 93.855/93.787), 41.342/39.109 s for direction (44.804/43.405), and
23.468/21.612 s for the failed window (22.927/21.299). Exact case status, route and
connection arrays were retained. Failed-window time is slightly worse. The heavy
cold result still uses 56.6% of alpha.70's original command cost, above the 20%
target. These are individual sequential observations, with scope and instrumentation
bindings detailed in history. No uniform or map-wide speedup is established.

Across the heavy cold/warm pair, seed projection calls fell from a derived 3,584,000
to 102,856. Charged neighbors, bucket candidate counts and shortcut trajectory
attempts remained 14,336,000, 9,258,772 and 12,476 respectively. Projection calls
alone therefore do not explain the remaining cost or establish smaller spatial
node traversal. Source ownership, optimistic-edge interpretation and existing
cache invalidation behavior retain their earlier contracts.

This pruning preserves the existing finite discovery scope. A region-pair reachable
domain combined with search-directed implicit successors remains the main structural
candidate for reducing neighbor and witness generation. L-GLS-style repair and
validation-effort ordering would then address repeated edge work. Complete GCS
trajectory optimization, learned ranking and kinodynamic tree sampling still need
separate implementations and acceptance evidence.

## Further non-learning structural comparisons

The subsequent 2026-11-11 batch compared 11 structural heavy-query variants plus
regional-index and canonical-order query microbenchmarks. Every new prototype was
removed after failing to demonstrate a stable benefit. At that checkpoint runtime
source remained `66dbd52`; later terrain/preparation changes are described above.
Atlos still uses the previously installed alpha.76 artifact.
The [history](history.md) records the exact variants, source/input bindings, timings,
checks and retry premises. Raw local evidence is `structural-ablation-20261111/`.

The candidates included regional BVH views, tighter candidate-span and triangle
hull domains, canonical nearest ordering, exact-SCC-mask successor prefixes,
target-independent landing witnesses with global/local quotas, and jump/run-off
family cost domains. Candidate-span filtering measured 89.701/90.182 s cold/warm,
against the reused 89.654/88.752 s control. All 22 heavy physical outputs retained
the exact route and connection arrays. No cross-map benefit was established.

Every variant still charged 14,336,000 neighbors over its cold/warm pair.
Family-entry filtering reduced retained candidate representatives by 2.7% while
increasing uncached shortcut trajectory attempts by 4.8%. Shared geometric prefixes
lost goal-aware indexed pruning, and reuse did not repay sorting/filtering overhead.
These are measured local strategies, not a completed search-driven physical graph.

The main open structural work remains owned coarse/detail support regions and
route-search-directed physical successors. Support-aware run-off launch domains
and certified walking alternatives can distinguish useful transfers from reachable
but unhelpful local motions. Same-SCC membership alone permits detours and holes,
so it cannot serve as a walking-dominance certificate. Preserve the existing
snapshot, cost, uncertainty and finite-budget contracts when replacing generation.
The remaining-cost target of at most 20% is still open.

## Updated next-phase algorithm scope

After the non-learning ablation, the user broadened the next phase to include
reinforcement learning and evolutionary optimization. The previous round's exclusion
of learned methods applies to that historical batch. Further structural refactoring
is one option alongside algorithm changes. It is not a prerequisite for comparing
new candidate-generation policies against the current solver.

The proposed comparison uses the existing analytic model and physical verifier.
CMA-ES and iCEM can search continuous takeoff/landing and steering/run-off parameters
within proposed region/control families. A learned search policy can select region
pairs, control families and work allocation before detailed candidates are built.
A hybrid can combine learned proposals with continuous stochastic optimization.
Quality-diversity methods such as CMA-MAE are another candidate when retaining
multiple landing regions or motion families proves important. The production solver
does not enable these policies. Research-only local CEM and learned witness scheduling
now live in `scripts/research/`; their limited scope is described below.

Start with four comparable arms: the current solver, evolutionary/sampling-based
local generation, learned high-level selection with the current local generator,
and their combination. Use held-out regions/scenes and count all inference,
generation, physical validation and fallback time. Report training/precomputation
cost separately. Existing regression scenes supply environments and evaluation
inputs; decision-level traces still need to be collected for learning. A bounded
unsuccessful solve remains an unresolved episode, with no physical-impossibility
label inferred for untested actions.

Model proposals retain the existing support, wall, complete trajectory, goal-event
and resource checks. Predictive scores guide proposals and scheduling. Certified
lower bounds continue to govern safe pruning. Exploration and resumable fallback
remain part of the comparison, with their actual runtime included. Fixed-budget
coverage and route quality require independent validation; the 20% objective has
no demonstrated learning/evolutionary result yet.

### Random-window data and local policy experiments

The research tools [`collect.mjs`](../../scripts/research/collect.mjs),
[`policy.mjs`](../../scripts/research/policy.mjs) and
[`analyze.mjs`](../../scripts/research/analyze.mjs) collect individual motion decisions,
fit logistic scheduling weights and compare a fixed random-pool heuristic, basic
diagonal CEM, learned ordering and their combination. Their
[usage and measurement contracts](../../scripts/research/README.md) are separate
from the production API. Runtime source under `src/`, package alpha.76 and the Atlos
installation remain unchanged by this experiment.

Sampling uses occupied 6 m XZ / 3 m Y support regions, projected-area endpoint
sampling, and nine distance/height strata. A region is a sampling domain; it grants
no support continuity or walking passage. Each tested witness still uses
`standingFoot`, the existing direct jump/split or supported run-off implementation,
wall checks and complete swept-body collision. An actual continuous ground trace
can reject a walking-dominated motion. Labels concern those individual witnesses.
An exhausted sample pool is unresolved, not a negative region-pair label.

Training normalization and weights use training witnesses only. Whole levels stay
in one split and map02 is held out from training. Window level tags come from
unanimous exported marker labels inside each build rectangle; native per-surface
level ownership is unavailable. Input hashes, model/body/selection, source hashes,
coverage and random seeds are retained per window. The local artifacts are under
`endfield-noclip/.research/stage123/learned-search-20261111/`; an ordinary clone does
not contain them.

CEM proposes endpoint witnesses before detailed surface-pair enumeration, but
region-pair selection is supplied by the experiment. Its support chart is piecewise
continuous at triangle-CDF boundaries, with uniform exploration and a variance floor.
The learned score only changes scheduling. All original reference witnesses remain
available. CEM/hybrid execute and charge their complete reference fallback. The
fixed random-pool heuristic is a local comparator, not the current solver's candidate
generator. Local discovery counts and warm geometry timings cannot establish an
end-to-end solver speedup. Whole-route resource/goal/boost/relay validation, route
quality, resumable production integration and the 20% objective remain open.

The completed corpus contains 4,666 region pairs and 186,640 individually tested
witnesses across 26 windows, with 2,414 useful local motions. The full learned
model found useful motions in 429/2,506 map02 test pairs within eight validations,
versus 204 for its local heuristic; control-only learning reached 424. Geometry-only
features do not show a stable gain across budgets. A strong fixed control-priority
comparison is needed before attributing the benefit to geometric learning.

Two physical execution repeats on 711 new map02 pairs retained exact witness
outcomes. Learned first-hit work on 149 common successes used 30.8%/29.5% of the
local reference time, but full-pool time stayed essentially unchanged. CEM/hybrid
with full fallback roughly doubled work and found 21 additional pairs. Extra random
sampling at the same enlarged budget was not compared. No policy is promoted into
the default solver; the [history](history.md) retains the detailed table, corrected
feature ablation, timing scope and actual checks.

## Action objectives and device coverage

Airborne collection uses the source-derived interaction volume. `findGoalFlights` samples supported takeoffs and nominal flight families. `planAirborneGoal` solves exact grounded approaches and clips the final flight at the first valid collection event. Prefix collision and boost validity remain required. World enables this behavior for `int_collection_coin*` rules. `sampleJourney` interpolates an existing timed route for playback. Independent forward propagation of fixed controls remains open.

The boost planner compares one reachable pickup and its accelerated tail. Ground speed, sustained air speed and launch speed scale with the imported multiplier. A final jump can cross expiry by re-solving its ordinary-speed continuation, sweeping the changed motion and rescheduling the joined route. Earlier expiry or failed validation rejects that candidate. Prefix solving starts from the current bounded planner conventions, so globally resource-optimal boost composition remains future work.

| Device family | Current model and remaining boundary |
| --- | --- |
| Fixed ropes/ziplines and bounce devices | Exported identities, directed endpoints, supported attachment and model-based swept motion. Authored state/timing still defines applicability. |
| Moving rocks, lotus supports, conveyor boxes and elevators | Phase-free swept support and directed vertical transport. Exact periodic phase, waiting and selectable-floor semantics remain open. |
| Seesaws | Exported moving support. Angular timing and phase remain open. |
| Forklifts | Actual lifting-rack subtree and endpoint control poses. Vehicle-body collision remains static. Retained export audit covers 18 map01 and 5 map02 objects. Real-point and visual acceptance remain limited. |
| Following stepping boxes | Placement sampling inside the authored activity sphere, supported/collision-checked placement, reconstructed box-top support and used-position output. Retained audit covers 23 map01 and 9 map02 boxes. |
| Steam and other hazards | Applicable exported exclusions participate in planning. Complete map-wide hazard coverage remains an audit item. |

Following-box search currently runs after ordinary planning fails, moves one source box per trial and retains other source collisions. It supports horizontal box tops and handled BoxCollider geometry, emits diagnostics for unsupported/missing ownership and spends a finite placement budget. Multi-box coordination, box shortcuts to an already complete route, continuous placement completeness and moving time remain open. Placement search and moving-support algorithms live in Ganglia `src/solver/physical/`; game-specific geometry export remains in the extractor adapter.

The later traversal export audit also identified incomplete motion relationships for five `InteractiveMovingPlatform` objects, fifteen water-level-driven waterdrone platforms, one waterbody floating support and the separate box-game elevator controller. Existing static/current-pose collision remains useful, while complete transport semantics require the missing control bindings. Actual bridge geometry and bridge-end access are separate investigations. See the Atlos [traversal audit](../../../../apps/world/docs/traversal-data-audit-2026-11-10.md).

## Resource planning and route quality boundaries

`retimeGroundRoute` runs a bounded label DP over the selected route's ground decision blocks. It carries stamina, recovery delay, sprint state, activation history, velocity, direction and dash state. Dash and sustained sprint share stamina. Pulses continue over collinear seams, terminate at turns/air entry, and preserve cooldown/recovery progression. Non-ground required-gait checks constrain departure state.

The current ground dash uses an approximate 3 m / 0.3 s scale and 0.8 s input interval. Input timing and stamina recovery have source evidence, while the ordinary animation-driven displacement curve remains unverified. `_dashSkillDistance` and `_dashDuration` provide the current approximation. Ground resource state resets at authored non-ground exits according to the existing scheduling policy. Actual airborne exit velocity needs an independent propagation contract.

`ground.mjs` selects a static fastest corridor, straightens and retimes it. When resource scheduling fails, it invokes bounded resource-state graph search to recover another feasible corridor. A feasible static choice currently avoids a complete resource-optimal comparison across all corridors. `searchResources` uses exact continuation-state keys and explicit label/expansion limits. Its defaults are 256 labels per node and 100,000 expansions.

Existing locomotion DP and graph-resource search provide reusable transitions. A unified forward dynamics kernel, complete augmented-state action graph, LGLS-style integration and universally justified Pareto dominance remain unfinished. In particular, more stamina can change automatic sprint restart and a later required entry gait. The retained DP energy/delay dominance rule still warrants review under those control semantics. This is a subsequent correctness/modeling work item, separate from the current region/action-query optimization priority.

Ground-detour pruning compares action excursions against supported walking under the same geometry and exclusions, then retimes the whole route. It preserves collection events and exact endpoints. Routes carrying boost evidence bypass that pass until replacement can propagate boost clocks correctly. Window joining can compare an excursion spanning the previous accepted fragment. These bounded improvements provide feasible alternatives, while global shortest-path and continuous-control optimality remain unresolved.

World renders separate movement modes and reports dash count, remaining stamina and route-local legend. The retained palette uses blue for running, yellow for sustained sprint, orange for dash, purple for jump/drop, green for ropes, pink for launch devices and cyan for moving support. New color visuals, moving-support rectangles and live motion timing retain their recorded acceptance scope.

## Performance checkpoint and unresolved work

The heavy action baseline under alpha.70 was 158.363 s total with 153.896 s in search. The earlier comparable alpha.67 baseline was 154.793 s. The retained `bounded-topk` checkpoint measured 102.562 s total and 98.042 s search with selected modeled cost `8.94138859157342` retained. This is approximately 64.8% of the alpha.70 total. The 20% thresholds are about 31.673 s against alpha.70 and 30.959 s against alpha.67. The performance objective remains unmet.

That heavy measurement belongs to the non-frontier pruning checkpoint. The final frontier-restoration change preserves the branch used by its fourteen non-frontier calls, but the record still has the checkpoint's source scope. A complete final-binary replay of every case has not been established by that observation.

The final retained direction replay after restoring frontier behavior measured **61.049 s total and 34.476 s search**, with modeled route cost `51.802466186195744` preserved. The preceding release76-direction run measured 49.142 s total and 28.078 s search. Both observations remain in the record. The final direction time is slower than the older 44.407 s alpha.70 sample. These single runs also vary in input, ground preparation and other stage timings, so causal attribution requires a controlled follow-up.

Raw evidence is in the local noclip research root, under `.research/stage123/action-search-20261110/`, particularly `bounded-topk/`, `release76-direction/` and `release76-frontier-restored/`. The companion [history](history.md) records other cases, rejected cache/cluster experiments and measurement caveats. Exact nearest-prefix caching and local-cube query experiments failed their measured benefit/acceptance goals and were removed from production use.

The read-only topology inventory of the heavy ground input contains 121,081 support faces and 61,264 exposed boundaries; prepared/refined discovery geometry can have different counts. Strict same-SCC, continuous collinear chains reduce this input's boundary count by only about 1.07%. Spatial 4 m XZ / 2 m height groups within SCCs yield 4,784 indexing clusters while retaining every original edge. Those counts identify a possible structure for batched region-pair work. A production dual-tree region/action search and its acceptance evidence remain to be implemented.

The next agent should concentrate on these outstanding boundaries.

1. Reduce repeated region state and action-query generation across airborne prefix targets. Share genuinely target-independent work while preserving required witness/control coverage and physical acceptance. When claiming equivalent bounded enumeration, preserve its budgets and tie behavior. An intentional strategy replacement needs explicit coverage, stopping and quality evidence under the companion testing standard.
2. Develop directed region/entry/exit assets and conservative region-pair/control-domain refinement. Preserve original surfaces, holes, one-way passages and internal witness coverage. A cluster centre provides insufficient passage evidence.
3. Separate first-feasible latency, optional improvement and whole-request retries. Ground, device/refinement preparation and renewed window budgets still contribute substantial work. A persistent worker alone leaves cache-slot replacement and planner rebuild costs.
4. After the spatial/action reduction work, address resource-state composition, dominance and exact prefix exit state, together with independent fixed-control forward replay and perturbation validation.
5. Complete moving-controller bindings, multi-box handling, source-bound map coverage, ordinary entry acceptance and the full south-to-north physical connection. Earlier base-collision prefixes and independent tails retain their original coverage scope.

Older [architecture](../architecture.md), [roadmap](../roadmap.md), [ground topology](../ground-topology.md), [solver performance](../solver-performance.md) and [prebuilt navigation](../prebuilt-navigation.md) documents retain useful assumptions and historical acceptance definitions. Their alpha.21/alpha.58 milestones and earlier ordering need to be read alongside this current handoff and [history](history.md). Persistent regional transfers, shared validated action assets, state-preserving contraction, complete release manifests, robust recommended-route evaluation and the original time-reduction goal remain open.

## Retained-point repair checkpoint, 2026-11-11

The current working tree adds fair region-boundary sampling, direction-chain
proposals, small component-diverse frontier batches and geometrically ranked
causal-entry trials. Entry trials share one additional `maxCandidates` quota;
unused trial quota can refine the final jointly resource-timed route. Scores only
rank bounded coverage. Envelope, collision, support and resource checks remain
active. Terminal grounded goal evidence survives walk scheduling and detour edits.

One complete 113-request replay has no incomplete routes or resource/goal evidence
failures. One route exceeds the accepted 5% cost tolerance. Its current-incumbent
local-refinement experiment and subsequent dual comparison are recorded in the
final validation section below. The user stopped further full-corpus repetition.
See the companion history for precise experiment status and evidence paths.


### Final bounded validation and delivery

The current-incumbent-only experiment completed another 113-request replay with
no route/evidence failures but introduced a >5% cost regression on case 006. The
retained implementation compares the pre-broad incumbent locally and additionally
compares the improved incumbent using remaining overall candidate budget. Focused
final cases 006/038 cost 1.875152/15.480632 seconds. All 282 SDK tests pass. The
third full replay was stopped at the user's request after 12 completed cases; its
interrupted request is not a solver-failure claim. No complete final-source corpus
pass is claimed. Final instrumented heavy-query cold/warm times are 95.514/98.558 s.
CPU sample aggregation was empty, so function timers supply hotspot evidence.
The Chinese requested benefit report is `docs/reports/2026-11-11-solver-optimization.md`.
The solver source was committed and pushed as `51ef6b3`. The subsequent alpha.77
Atlos package upgrade is recorded below. The 20%-remaining-time target stays open.


## Alpha.77 packaged Atlos integration, 2026-11-11

The user authorized upgrading Atlos and pushing all local changes. Ganglia
`0.1.0-alpha.77` packages the solver implementation at `51ef6b3`, including the
subsystem reorganization, terrain preparation improvements and retained-point
repair. Only package metadata changed during this release step. Atlos World and
the maintained noclip extractor patch both reference the alpha.77 vendored archive.
The workspace lockfile and generated extractor were refreshed through the owning
preparation script, and the replaced alpha.76 archive was removed.

Archive SHA-256 is `9dd60b4b237dedbdcc7ba4e8c3baddd53a82ca83005a015b270f1a6cfadddeee`.
All packaged source files match the checkout. Both World and extractor resolve
the same alpha.77 package and source bytes. Package prepack passes 282 SDK tests.
The prepared integration passes 13 route worker/server, route cache and source
preparation tests, plus 59 World tests. World type checking, production build and
frozen-lockfile installation pass. The build reports its existing large-chunk
warning. No additional corpus replay was run for this packaging-only upgrade.
The earlier final-source corpus limitation and performance conclusions still apply.
