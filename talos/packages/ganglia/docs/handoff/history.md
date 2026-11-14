# Route solver history and validation evidence

## Matched final-source native query, 2026-11-14

Commit `102e323c` completes the matched lower-floor-6 request with independent
physical replay valid and no issues. Native serial service time is 22.439546
seconds, batch wall time is 22.439649 seconds and end-to-end time is 28.316523
seconds. The retained TS reference measures 67.143217 seconds of service,
67.143351 seconds of batch wall time and 73.353018 seconds end to end. Batch
speedup is 2.992175x; end-to-end speedup is 2.590467x.

Both use map02, resource-relocation offset 10/limit 1, one worker/lane, one round,
Node v26.13.0 with a 6144 MiB old-space limit and no training or warmup. Omitting
`--catalog-train` disables training; an explicitly supplied zero is invalid. The
original cost gate passes: native modeled cost 7.750349963873002 versus TS
7.68412422083312, ratio 1.0086185154139402. The native route is truncated and has
length 94.09861001457595 metres. This is one matched request and measured round.

Evidence is `.local/research/rust-solver-rewrite/matched-102e323c/report.json`.
It records a clean working tree and source SHA-256
`3f134e46dbbc510cda4c1b937beae8d56ee5b1744711fb28ec0266b32dc9a58a`.
Native binary SHA-256 is
`c5cf3a88d25a6d4cfa413e1c851a0a52a749abf0f05f685517c57b5ee4d247c2`;
the TS reference SHA-256 is
`0f7cc681726998b45c043bab068f947ad28015d3f831941c4ed3fa93502c3cbf`.
The earlier 3.987x native checkpoint keeps its original source and workload scope.

## Retire the old native prototype, 2026-11-14

Removed the old `prototype/rust-kernel` crate, preloaders, binding adapters,
prototype-only parity/benchmark tooling and their injection hooks. The retained
TS solver uses its ordinary TS implementations directly. Its public Solver
interface and behavior remain available beside the new `ganglia-v1-rust` adapter.
The detour regression retains its geometric, scheduling and device-witness
assertions through the ordinary scheduling interface instead of an injected
prototype chooser. Historical prototype measurements keep their original scope.

All 440 retained TS tests and 23 native integration fixtures pass after retirement.
Package formatting, lint and typecheck also pass. The new crate has no dependency
on the retired implementation. World application/worker typechecks and all seven
route-worker/server integration tests pass.
Its complete action/Scene contract fixtures and
independent representative Scene replay are recorded below; finite broader map
discovery remains an optimization/coverage concern.

## Native authority growth and responsive cancellation, 2026-11-14

Independent audit found that later sparse Worlds could lose an already known
default following body when no placement was selected. Newly discovered default
bodies could also invalidate earlier pieces or a retained incumbent without
replay. Query-local Worlds now include all known following facts; fact growth
replays active prefixes and retained partial/incumbent proofs under the full
union. Following/boost authority conflicts are fatal instead of recovering an
older incumbent. Three Engine regressions cover omitted default bodies, late
authority invalidation and conflicting facts after a complete candidate.

Synchronous N-API start/resume blocked timer aborts during native computation.
They now return AsyncTasks running on libuv. Each task owns the engine mutex,
with a cooperative atomic cancellation token installed only on its compute
thread. Coarse planning, discovery, resource expansion, ground repair and BVH
construction check that token. Abort sets it without waiting for the mutex;
compute and promise resolution both reject canceled work. Host callbacks are
followed by signal checks, and abort listeners are removed after each solve.
The timer-abort/prepared-reuse regression fails on the retained synchronous binary
with `Missing expected rejection` and passes with the new native implementation.

The earlier six-request run at `2c3cdec2` was stopped during its measured batch
before a final report, after these audit findings. Source remained frozen; no
aggregate quality or speedup result is inferred from the incomplete run. Its
local directory retains the log and `incomplete.json`.

The corrected full upper Scene diagnostic again returns a complete, nonpartial
route with physical replay valid, no issues and identical cost
4.525145145919718 seconds. Solve time is 37.697 seconds; total process wall time
is 43.568 seconds. Evidence and unchanged-source bindings are in
`.local/research/rust-solver-rewrite/parent-upper-async/`; native binary SHA-256 is
`c5cf3a88d25a6d4cfa413e1c851a0a52a749abf0f05f685517c57b5ee4d247c2`.
All 140 Rust unit tests, two authored-action tests, 23 N-API fixtures and 440 TS
tests pass, along with release N-API build, feature-enabled all-target Clippy,
package formatting/lint/typecheck and Rustfmt. Scoped correctness and Standards
rechecks found no remaining required issues after callback abort checks.

## Finite native geometry jobs and Scene retries, 2026-11-14

Ground-path fallback jobs are selected lazily against active resource labels using
admissible time lower bounds. Directed target coverage is retained, and each
active resource label receives a newly proved edge independently. The dominant
cost was World ground search, not queue bookkeeping. Dense repair arrays and
once-per-source adjacency/proof lookup preserve the exact ground graph and reduce
the matched negative-pair proof from 2361 to 892 ms.

Generated supported interior landings now join a bounded source/target worklist.
The synthetic multihop regression fails under the earlier policy and passes when
a second flight can depart from an unsampled generated landing. The original
attempt budget and graph-growth cap remain unchanged. The captured upper first
window finishes all 285 fallback jobs in 27.467 seconds without completion.

Expanded Engine requests can resolve to the same physical revision and coverage.
Repeating the identical local query, poses, catalog and stage cannot add candidates
to the same bounded algorithm. Failed searches are therefore reused only inside
that query. New source revisions and subsequent queries redo the work. Stage 1
is skipped if no known actions or boost pickups distinguish it from stage 0.
An Engine regression checks repeated loads, source revision changes and fresh
queries through the ordinary load/resume interface.

The upper-floor full Scene diagnostic completes in 37.474 seconds through eight
window loads. Its route is complete and not partial, with modeled cost
4.525145145919718 seconds and length 34.651995641781866 metres. Shared independent
physical replay is valid with no issues. Wall time including loading and replay
is 43.381 seconds under a hard 180-second watchdog. Rust source hashes remained
unchanged; binary SHA-256 is
`d3682aeb8b7328e9d5836dfd76624985527f7ac6ef1203b58ca68a9dd10ac877`.
Raw log, result and source bindings are in
`.local/research/rust-solver-rewrite/parent-upper-scene/`. This diagnostic establishes
the complete Scene path, not six-query acceptance or a new speedup.

Validation passes 136 Rust unit tests, two authored-action tests, all 22 N-API
fixtures and feature-enabled all-target Clippy with warnings denied.
Package format, lint, typecheck and all 440 retained TypeScript tests pass.
Cargo build outputs are excluded from formatting; generated artifacts live in
the repository's `.local/cache/` resource store.

## Bounded native ground feedback and replay hardening, 2026-11-14

Placement changes can remove a previously used takeoff or intersect a curved
flight between submitted samples. Earlier pieces now replay native flight/run-off
witnesses under the selected poses and their original local query. A collected
prefix does not require its unused future to remain safe. Future terminal assets
also require proof under merged poses, using retained coverage or one bounded
normal window load for replay only. Focused removed-roof and collection-prefix
regressions distinguish this from the prior chord-only check.

An unrelated uncovered nav face could abort an otherwise covered query during
optional sampling. The synthetic case completes in 0.5 seconds with discovery
disabled and throws a coverage error with discovery enabled on the old code.
World now categorizes only its three unavailable-space errors; Search drops those
optional witnesses with truncation while retaining invalid-input failures.
Physical standing no longer carries a hidden tighter nav tolerance. A radius-0.1,
nav-offset-0.4, maxVertical-0.5 case protects the separation.

Fast run-off omitted the sprint requirement. Native World now emits authoritative
computed peak horizontal speed for every flight family, and replay rejects forged
supplied values. Search applies the common gait threshold to drops as well as
jumps. Unchanged common replay accepts the sprint-approach/run-off fixture at
1.2622251366249724 seconds and rejects it after removing the sprint approach.
Evidence is `/tmp/ganglia-fast-drop-common-replay.json`.

The upper-floor direct corridor proof returns Navigation in 0.277 ms, so direct
raw-gap feedback alone cannot expose its interior failures. A single bounded
directed NAV proposal was added. Horizontal and then 3D Euclidean ranking both
exhaust the 4096 work allowance without a path. Weighted `g + 2*h` ranking finds an
85-point proposal; directed visibility coalescing shares that allowance and can
exhaust it before reaching later turns. This is an optimistic proposal only.

The original seven remaining physical prefix units prove seven legs but reach no
failure. Feedback now reserves at most `min(maxCandidates / 8, maxLinks * 4)`
units from the same total candidate pool. The approved World-only probe with 255
remaining units proves all 84 legs individually: 60 supported, 23 raw-support
failures and one clearance failure. It takes 4.783 seconds including 4.666 seconds
preparing World and 114 ms feedback. Exact spans are in
`/tmp/ganglia-nav-weighted-255-result.json`. This is not a joined physical route.

The subsequent single frozen Search diagnostic still times out after 45.02
seconds. It has 24 repair regions, 130 nodes and exactly 8000 attempts, comprising
85 feedback proofs and 7915 flights. Action discovery finishes 1.350 seconds after
Search starts. No result exists for physical replay. Summary, source bindings and
raw log are `/tmp/ganglia-search-shared-budget-core-summary.json`,
`/tmp/ganglia-search-shared-budget-source-binding.json` and the adjacent `.log`.
No budget increase or second run follows from this evidence. Eager full ground
detours during resource expansion are the next structural issue, rather than
another candidate-placement adjustment.

Coalescing exhaustion alone previously suppressed a fully physically proved
retained proposal. A focused finite-work regression now permits `supported` with
`truncated=true` only when every retained leg and exact canonical join passes.
Missing paths, failed legs and incomplete physical proofs remain uncertified.

Stage 2 now tries directly proved canonical walks and existing action edges before
full ground detours. If that graph cannot complete, it restarts arrival resource
labels against the expanded graph; dominance from the first pass cannot suppress
new paths. Expansions remain cumulative and static action blocks are reused.
Stages 0/1 retain full walking behavior. Obstacle and expansion-limit regressions
protect the mandatory fallback. A direct-pass result with unexamined detours is
explicitly approximate and truncated.

The single frozen two-phase upper-core run also times out at 45.03 seconds. The
direct pass finishes at 1.568 seconds of Search time with 8320 resource expansions,
99 direct ground proofs and 80 rejected targets left for detour exploration.
Fallback starts but does not finish. The result distinguishes graph-connectivity
failure from the eager detour cost; neither phase yields a route for replay.
Artifacts are `/tmp/ganglia-search-two-phase-core-summary.json`, the adjacent log
and `/tmp/ganglia-search-two-phase-source-binding.json`. Subsequent inspection
must identify the missing graph connection before another sampler change.

Assembled validation after these changes passes 133 Rust unit tests, two authored
action tests, all 22 N-API fixtures and all 440 retained TypeScript tests. The
new durable fast-drop fixture solves naturally, passes common replay and rejects
the unchanged flight after its sprint approach is removed. The four scene
continuation fixtures also pass with parent sparse-placement verifier commit
`0a8254c8`, integrated locally as `85d2f9b1`. Release N-API build, all-target Clippy
with N-API enabled and warnings denied, TypeScript checking, lint, Rustfmt and
focused formatting checks pass. The package-manager wrapper rejects the installed
pnpm version; checks run through the package's existing local binaries instead.

## Native physical contracts and scene continuation, 2026-11-14

The broad failure at `a0796a09` exposes two walking defects. Native radius-aware
standing support can bridge a raw crack that directed imported navigation also
spans. Physical walking now additionally unions eligible raw centerline support
intervals. A durable N-API regression with a 0.1 m raw gap and continuous nav is
red before this fix and green afterward; common endpoints stand, while common
walking rejects the gap. Separately, resource cuts can interpolate feet below
the standing clearance range. A continuous lower clearance sweep and a common
supporting-face upper bound now certify retained chords; failing chords refine
before scheduling. The captured source chord passes 514 arbitrary common subcut
checks. Supplied valid endpoints and authored actions remain unchanged.

World hardening materializes default following bodies, validates supported box
placements jointly, replaces selected default poses and retains raw static facts.
Source exclusions remain separate from generated walls. Physical moving support
uses eligible source winding before hit reduction. Fixed-pad direct height uses
canonical landing feet. Three durable common replay fixtures cover default box
collision/roof support, moving support under higher imported nav and a pad whose
height is determined by aim clearance. Earlier device fixtures remain intact.

Search now replays authority-bound generated catalog witnesses before using
generated nav tolerance. Authored IDs keep their endpoint contract. Per-arrival
continuation carries stamina, gait, delay, dash and boost state, including sparse
boost facts and expired pickup identity. Engine supplies this state from the
selected recomposed prefix, retains following facts across sparse windows,
deduplicates placements and checks earlier pieces under new placements. Final
goals use original query geometry; terminal approaches retain bounded alternatives
and useful partials before coarse prefix planning. Host cache recovery is committed
as `3824b16`; its regression fails with a native cache miss on the old host and
passes after clearing residency on errors.

Consolidated validation passes 106 Rust unit tests, two authored-action tests,
eighteen N-API fixtures plus the three new device regressions, release N-API build,
all-target Clippy with warnings denied, TypeScript checking, lint, formatting and
diff checks. The former following-search fixture supplied `geometryKind:convex`,
an unsupported `movable` assumption and noncanonical corner order. Common
placement rejects those facts; it now supplies a canonical box and supported
assumption while retaining the reachability and placement assertions.

The post-fix upper-floor diagnostic does not complete after five local stages and
is stopped. A one-second stack sample, `/tmp/ganglia-upper-contract.sample`, puts
740 of 741 main-stack samples under Search geometry paths, mostly LazySP ground
repair. Its log is `/tmp/ganglia-native-upper-contract-debug.log`; the original
invalid trace is retained as `/tmp/ganglia-native-upper-before-contract-result.json`.
No runtime or speedup claim follows. Direct physical-failure feedback and bounded
raw-boundary discovery are subsequent work. Earlier-flight support and adaptive
witness replay after a later placement also remain under review.

## Native boundary discovery and supported walking, 2026-11-14

The subsequent broader replay at committed `a0796a09` retains that source digest
and binary. `/tmp/ganglia-native-supported-train1.json` records one training
request, six holdouts at offset 10, two rounds and one worker/lane. The older
`serial-train1.json` reference is correctly rejected before dispatch because its
game-adapter digest differs. The replay then runs without a comparison reference.
Catalog training hits its 300-second watchdog; readiness is 302.728 seconds. The
measured rounds take 121.344 and 113.875 seconds, 235.219 seconds total. None of
the twelve measured attempts time out. All six native traces claim completion,
but five fail common physical replay with `Unsupported or obstructed walk` in
both rounds. Only lower-floor-6 passes. Outcomes and truncation match across
rounds. End-to-end time is 546.851 seconds. No aggregate speedup is accepted.

The fastest failing upper-floor-12 trace is captured in
`/tmp/ganglia-native-upper-result.json`, with exact raw snapshot under
`/tmp/ganglia-native-upper-windows/`. Its diagnostic finds ten failing walking
segments. An interpolated scheduling cut needs an 0.089 mm standing correction;
other short spans have valid common endpoints but fail common `walkTrace`.
These failures require geometry/scheduling fixes, without relaxing independent
verification. The following paragraphs retain the earlier one-request success
with its narrower measurement scope.

The changed premise after `a9388c7` is that native World accepts the independent
TS descent witness and nearby natural takeoffs, while sampled graph coverage
misses the useful landing interior. Diagnostic flight replay agrees to numerical
precision; these reference coordinates never enter production sampling. Search
now ranks the horizontal corridor, interleaves height strata and samples exposed
support intervals after subtracting outgoing portal apertures. Boundary sampling
alone admits a 36.13 m descent but does not complete the captured window. Bounded
source-relative continuous landing proposals through World polygon projection
complete it, sharing the existing 8,000-attempt budget. A synthetic lower platform
with obstructed center/radials and distant perimeter reproduces the previous
failure and protects the interior landing behavior.

The first complete native trace fails unchanged common physical replay because
four walking chords omit capsule-support height bends. Merely validating their
endpoints is insufficient. World now subdivides actual 3D spans to 90% of
`max(0.025, radius / 4)`, queries raw support for inserted feet and sweeps every
resulting span. Canonicalization can increase length, so bounded refinement
rechecks the resulting spans. Exhaustion rejects the proposal. Length and cost
include these bends before scheduling. A slope-to-floor regression and a local
60-triangle fixture cover the failure. The four original spans and the complete
rescheduled route pass unchanged common replay.

Full-scene matched evidence is `/tmp/ganglia-native-supported-comparison.json`,
with retained TS reference `/tmp/ganglia-ts-native-comparison.json`. The workload
is resource-relocation offset 10, limit 1, map02, one worker/lane, one round, no
training or warmup. Native completes in 16,839.317 ms, batch 16,839.434 ms and
end-to-end 22,966.766 ms. TS service is 67,143.217 ms, batch 67,143.351 ms and
end-to-end 73,353.018 ms. Batch speedup is 3.987269x and end-to-end speedup is
3.193877x. Physical replay passes without issues; cost ratio is 0.943722, native
cost 7.251676835146807 versus 7.68412422083312. Both routes complete, native uses
two jumps, and native diagnostics mark truncation. One round leaves repeatability
unmeasured. This is one-request acceptance, not whole-map or complete-rewrite
acceptance.

The measured source is `a9388c7` plus this checkpoint's dirty changes, digest
`30db13378d63d5077795c89b9247032b1dc80f28b1d625de1308632cde6c1461`.
Loaded native binary SHA-256 is
`ac3ed500f5d31b9f90352f9e7249127949a32f85b34379e32f0213f22d354a69`.
The report binds dataset and game-adapter hashes; common verification runs after
the timed batch. Captured core result and verdict are
`/tmp/ganglia-native-supported-window-result.json` and its `.evaluation.json`.

Consolidated validation passes 92 Rust unit tests, two authored-action integration
tests, twelve N-API fixtures, all-target Clippy with warnings denied, release N-API
build, Rust formatting, TypeScript checking, lint, matched-source formatting and
diff checks. The new scene-partial fixture checks native terminal publication,
approach-only certification and cancellation before prefix IO. No shared verifier
source changed. The retained TypeScript suite's prior 438-pass result remains
bound to its earlier checkpoint; it was not rerun for these native-only changes.

## Rust world integration, 2026-11-14

The native rewrite begins at Atlos `d35e4997`, retaining the TypeScript solver and
the prototype until full native replacement acceptance. World/model/scaffold work
was committed as `f1208fb083bb09ebc2731fa6cb6072670b787bcb`, integrated as `a1aeac74`.
It owns raw facts, spatial/collision/support calculations, flight controls, device
actions and moving/following support operations without a prototype dependency.

Integration found missing portal-mask enforcement and a ground fast path that
accepted support unions without checking directed passages. Optional masks now
retain the difference between absent and explicitly empty masks. Ground tracing
propagates through the actual directed portal intervals. Split collinear edges
join only over positive shared intervals. Obstacle visibility proposals address a
thin-wall detour within broad ground faces, and every resulting chord receives
support and capsule checks. Interaction spheres use their radius for height unless
the query supplies an independent vertical limit. Facing validation follows the
common model's paired forward vector and angle in `(0, 90]` degrees.

Validation: `cargo test --offline` passes 16 tests; `cargo clippy --offline
--all-targets -- -D warnings` passes; `git diff --check` passes. The regression
cases protect masked/reverse passage rejection, split-edge connectivity,
interaction height semantics and obstacle detours. The previous thin-wall test
expected no route despite open supported space around the wall; it now requires a
longer route and independently checks every returned capsule chord. Cargo uses
`/tmp/ganglia-v1-target` in this worktree. No map dataset, benchmark or independent
TypeScript physical verifier was run for this geometry integration checkpoint.
This is partial implementation evidence, with no speedup or complete-rewrite claim.

## Native engine and host integration, 2026-11-14

Integrated native search `edfebc68` as `3f424c6b` and engine `d3768eea` as
`a554e7a0`. The independent common TypeScript verifier `48e6e791` is included as
`f3f58f07`; verifier source remains independent of the native and retained V1
solvers. The N-API host fulfills async effects and exposes the existing prepared
solver seam. Scene normalization now exposes raw input separately from its lazy
TypeScript solve closure. Native scene tests throw if TS solve or ground
preparation is called. Benchmark aliases use the same scene worker, workload,
policy and independent post-batch verifier. Native source, Cargo bindings and
loaded binary identity are recorded. Existing quality gates govern speedups.

Integration corrected stage policy consumers, catalog action reuse, work versus
sample budgets, redundant portal graph materialization, endpoint-region sampling,
lazy walking successors, collision-valid airborne prefixes, and completed-arrival
comparison. A ground mesh repair now requires missing endpoint coverage during
full action work, instead of rebuilding raw ground after every failed stage.
Ground search validates candidate chords lazily and caches only immutable proofs.
Exact resource continuations protect against unsafe stamina dominance when
sprint restart and recovery delay make extra energy non-monotone.

Validation at this checkpoint: 48 assembled Rust tests passed; six N-API fixtures
passed common physical replay for multihop flight, ordered waypoints/arrivals,
raw scene IO, empty supplied ground generation, airborne collection before later
collision, and whole-route stamina/dash replay. All 438 retained TypeScript tests
passed. These results establish focused integration behavior, not map quality.

Real-map diagnostics bind the local resource-relocation workload, map02 data,
maintained extractor patch, one worker/lane and no catalog training. Offset 10,
`new-goal-near-lower-floor-ground-jump-6-1`, timed out at the 300,000 ms SLO in
`/tmp/ganglia-rust-single-v2.json` and `-v3.json`. A walking-only diagnostic with
zero action/placement budgets returned no verified route after 248,441 ms.
The native stack sample places most initial time in coarse transfer projection;
a later sample finds resource transitions and frontier management. One full
physical search generated about 7,457 attempts in 2.14 seconds and expanded
18,240 resource labels by 34.76 seconds. These are diagnostic phase observations,
not an accepted latency or speedup result. Prototype removal and full native
acceptance remain pending real-route completion and independent verification.

## Native route contract hardening and bounded planning, 2026-11-14

The native host integration checkpoint is `16503fce`. Independent physical replay
then exposed fixed-launch witnesses retaining character steering fields and
fixed moving rides retaining expired character boosts. Launch witnesses now bind
only pad authority; fixed device trajectories keep their authored geometry and
clocks. Character boost lifetime still advances through them. Scene composition
replays supplied controls from one continuous resource state, retains them as a
feasible incumbent, and checks expiry before selecting the winner. Pickup clocks
come from the retimed trace's first trigger intersection. Every motion consumes
elapsed lifetime, walks split at expiry, and receipts reflect the completed trace.
A later alternative error preserves an already completed route. Canonical feet
no longer force a duplicate whole-query tail solve, while explicit ground ranges
retain their forward projection pass.

Support hardening preserves 5–10 mm physical feet and authoritative surface-only
mesh feet without changing authored actions. Physical snapshots retain raw static
support authority. Refinement preserves authored portal direction and masks.
Known actions enforce declared support IDs, including matching non-nearest
projections. Ordered waypoint tests use the original query height and continuous
XZ cylinders of radius 1e-6 with the configured vertical tolerance. Generated
action identities bind motion, witness and entry conditions, rather than local
node order, and are deduplicated against the admitted catalog.

Performance changes retain exact energy/recovery-delay continuation dominance.
Edge spans compile once, ordinary label transitions omit playback/JSON allocation,
and only the winning chain is replayed. Two resource-rich differential cases
preserve full result JSON, including clocks, geometry, cost and truncation.
Coarse transfer proposals use bounded spatial representatives. Stage 2 walking
proposes every essential anchor plus at most eight sampled neighbors; stages 0
and 1 retain their full anchor graphs. Omitted sample choices mark truncation.
Ground repair validates all selected chords, repairs increased validated costs,
uses generation-tagged dense arrays and shares cached traces with numeric lengths.
Loaded body coverage filters proposals before proof; every retained chord still
needs support, directed passage and capsule validation.

Ground diagnostics do not prove a real-map speedup. A synthetic blocked-chord
case changed 239 repairs/95.65 ms to four repairs/11.00 ms at identical length and
point count. A matched supported map pair preserved length 60.16626729712284 and
636 points but increased 233.82 ms to 731.55 ms before the final shared-trace
representation change. An unavailable pair now returns conservative None after
finite repair instead of throwing on an unloaded detour seed. This motivated
reducing the number of sampled ground proposals, rather than claiming a faster
individual path search.

The matched one-query TS baseline uses map02, resource-relocation workload offset
10, one worker/lane, one round and no catalog training. It passes independent
physical replay at cost 7.68412422083312, query time 67,143.217 ms and end-to-end
73,353.018 ms (`/tmp/ganglia-ts-native-comparison.json`). Native diagnostic reports
v4 and v5 still time out at 300,000 ms; comparison correctly withholds speedup.
V5 performed 66 local action searches before the watchdog. A captured first window
contains 202,311 surfaces, 514,520 derived portals and 4,167,671 collision triangles.
After ranked actions, the isolated native core takes about 3,033 ms and generates
1,845 actions but remains unavailable, with no descent larger than 1.28 m.

A bounded sample of 600 corridor face centers found 596 supported clear feet;
568 (95.3%) had nav offsets above 2 cm, all within the 0.5 m contract. Median was
7.94 cm and maximum 19.17 cm. Generated source/landing admission now uses the
contract tolerance and validates original physical feet. Candidate ordering
excludes zero displacement, applies necessary free-flight reach bounds, and
retains run-off/collection exceptions. A separate valid TS diagnostic flight
falls 42.59 m; Rust World accepts its default control and four nearby takeoffs,
with trajectory agreement around 3.2e-13 m. That diagnostic reference is never
used by production solving. Boundary and height-stratified proposal coverage
remain open work, so this checkpoint makes no complete-rewrite claim.

Validation of this hardened checkpoint: 79 Rust unit tests plus two authored-action
end-to-end tests pass; eleven N-API fixtures pass, including common physical replay
and abort/close lifecycle; Clippy with warnings denied, N-API release build,
TypeScript checking, lint, formatting and diff checks pass. The retained 438-test
suite passed during host integration and its implementation is unchanged here.

## Atlos base integration, 2026-11-14

Merged `feat/3d-preview` at `162ca793` into the editable workspace integration.
Kept workspace Ganglia dependencies and solver-owned planning instead of the
base branch's alpha.77 archive and World-owned candidate/window implementation.
Retained the newer `978acf5` noclip pin. Imported open-traversal offline framing
and validation, plus initial moving-platform pose framing. Removed the duplicate
moving-row transfer patch because the renderer patch now carries that fix.
Frozen-lockfile installation and source regeneration pass. World passes 56 UI
and adapter tests, 8 server/worker/network tests, type checks, lint and its
source-only production build. Related noclip tests pass 16 cases; script tests
pass 45 cases with loopback access. Full font packaging and visual acceptance
were not performed. Solver and World routing source are unchanged; no new
performance measurement is claimed.

Updated 2026-11-11. Read this with [the current handoff](handoff.md) before changing the solver. This file records what was implemented, measured, rejected or only proposed; the companion file owns the current architecture, model and next actions. Update both when a change alters their conclusions. Historical test passes and timings below apply to their named versions and inputs, not to a future checkout.

The current objective is to reduce candidate-space and action-search cost to **at most 20% of the original cost**, while preserving feasibility and route quality. It is **not achieved**. For the retained heavy-action alpha.70 baseline, the latest bounded-top-K trial leaves 64.8% of command time and 63.7% of search time. The final installed direction replay is slower than its baseline. No map-wide speedup, continuous-space optimum or complete independent forward-replay acceptance is established.

## Evidence and provenance

The durable history is [solver-performance.md](../solver-performance.md), [the per-point table](../per-point-performance.md), its [CSV](../per-point-performance.csv), [stairs validation](../stairs-validation.md) and [prebuilt navigation](../prebuilt-navigation.md). This file also migrates the still-relevant history from the retired `docs/Handoff01.md`, whose last recorded revision was `9b75ecc9278f670cecde52be3fb1c05833b8f6f7`. Its historical text can be recovered with `git show 9b75ecc:docs/Handoff01.md`.

Raw local evidence is under `/Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/`. That repository ignores `.research`; these artifacts are not delivered by an ordinary clone. Preserve or explicitly archive the inputs and results needed for any future comparison. Useful entry points are:

| Local evidence | What it establishes |
| --- | --- |
| [jump-space-alpha70/comparison.json](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/jump-space-alpha70/comparison.json>) and its `summary.md`, `candidate-check.mjs`, `route-check.mjs` | Alpha.70 checkpoint, candidate preparation/search split, warm result and memory readings; physical control runs |
| [action-clusters/comparison.json](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/action-clusters/comparison.json>) and each experiment's `timing.json`, `result.json`, `query-work.json` | Exact-reuse, cost-bound, mixed dynamic/global-pool experiments and alpha.71–73 comparisons |
| [action-search-20261110/comparison.json](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/action-search-20261110/comparison.json>) and its experiment subdirectories | Local-cluster prototype, bounded top-K trials and the later final installed direction replay |
| [detailed-profile-20261110/profile-analysis-final.md](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/profile-analysis-final.md>), matching JSON, `all-stages.md`, ledgers, per-run stages/CPU profiles and search-attempt tables | Earlier instrumented cold/warm attribution and instrumentation controls, bound to alpha.67-era inputs |
| [complex-regression-alpha67/reviewed-summary.json](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/complex-regression-alpha67/reviewed-summary.json>) and `diagnosis-20261110.md/json` | Historical 113-request regression classifications and diagnosis, not an alpha.76 full-corpus certification |

The source hashes and input manifests in the raw records take precedence over directory names or package version labels. The final source checkpoints for this work are Ganglia `066dc1d` (alpha.70), `3edbe40` (alpha.73), and `917dfcd` (alpha.76). Atlos adopted alpha.76 in `9311d063`. These identify the recorded checkpoints, not a promise that later working trees remain unchanged.

## Earlier implementation and acceptance history

The older architecture/roadmap described an alpha.21 modeling baseline. Later features did not complete every phase in those documents. Preserve the following distinctions when using that history.

| Checkpoint | Implemented strategy and evidence | Limit that remains relevant |
| --- | --- | --- |
| Alpha.22 ground work | Compact-span stair connectivity, paired directed entry/exit intervals and step checks; 24 directed synthetic stair queries completed by walking, and 31/31 recorded real positives included 13 stair profiles | These are the tested parameter families and samples, not arbitrary staircase or whole-map acceptance |
| Alpha.30–31 reuse | Reused exact goal-distance estimates while accounting for faster and zero-cost actions; five retained physical requests had identical complete routes and connection arrays; 155 SDK tests passed | A narrower terrain binding made a separate query unavailable in both versions; coverage failure was kept separate from the five successes |
| Alpha.39 cold preparation | Exact median collision/support BVH work, indexed refinement with original triangle order, owned support primitives, shared static wall-filtered topology and consumed boundary-order prefixes | Cross-planner portal graphs were still rebuilt; no regional contraction or cross-process reuse was established. Derived edge-string retention and a lazy-straightener experiment were excluded after lacking useful total-time gains |
| Alpha.47 graph work | Reused the validated topology; resumed query-owned forward/reverse distance fields when actions were appended; restarted on changed roots, graph or action weights; reduced repeated tracing allocations | A face kinematic prefilter and an in-place field-reset experiment were excluded. Fewer expansions did not establish smaller peak RSS |
| Alpha.53 lookup | Packed build columns, allocation-light nearest heaps, analytic duration without phase-object allocation, unchanged goal-probe handoff | Candidate prefixes, tie order and physical checks were preserved. A combined serial worker experiment had no useful consistent gain and was removed |
| Alpha.56 moving-support integration | Rejected endpoint comparisons across different weak ground components, retained successful traces, avoided retaining failed serialized pairs | A fresh device preflight was 61.06 s before / 55.04 s after, both unavailable. Heap was about 3.716 / 3.744 GB; this was not route reachability or memory-reduction evidence |
| Alpha.57–58 action chains | Alpha.57 let coarse action chains change primary search coverage early, worsening one model route by 0.630 s. Alpha.58 retained the original main search and added verified-action/coarse-chain continuation only after failure | Alpha.58 restored the 38-point selected-cost baseline. This is a precedent against allowing a new heuristic to consume or reorder the established main search silently |
| Alpha.61 capability work | Resource-infeasible corridors received a bounded multi-label alternative search; airborne collection ended at the first target-volume hit; one boost pickup and a tail were compared, including a revalidated final-jump expiry continuation; ground corners were shortened under support/collision checks | 215 SDK tests passed, with specific packaged Atlos examples. This did not complete global resource-optimal routing, independent control replay, regional action assets or whole-map acceptance |
| Alpha.62 dash/display | Added bounded dash allocation in fixed-route resource DP, shared stamina/cooldown progression and preservation of airborne event indexing; exposed gait, dash count and resource output in World | 220 SDK, 26 extractor and 44 World tests passed, with World type/build and headless GPU checks. Real-map color inspection and the actual animation-driven dash displacement curve remained unverified |
| Alpha.63 entry search | Retained valid fixed-device endpoint traces, invalidated moved/removed endpoints, screened entries lazily and divided discovery across directed ground regions | Local successful jumps and a roof/boost tail did not prove the missing earlier teleport-to-street connection |
| Alpha.64 candidate/windows | Added reusable candidate planning, query-local exclusions, lazy edge replacement, terminal navigation assets and bounded physical windows carrying actual exits through whole-route retiming | 228 SDK tests plus an exclusion check passed. South-to-north terminal-physics acceptance remained open; earlier base-streaming prefix/tail evidence could not be relabeled as terminal-physics acceptance |

The 38-request cold-replay series used retained pre-v74 success inputs, with 36 distinct physical input bindings. Fourteen requests had original CLI logs; 24 had explicitly frozen recovered selections. Alpha.39/47/53 each preserved all 38 complete route, connection and limit objects against alpha.31. The respective recorded SDK counts were 180, 188 and 190.

| Historical batch | Command total (s) | Search total (s) | Interpretation |
| --- | ---: | ---: | --- |
| Alpha.31 | 554.891 | 202.690 | Integrated frozen baseline |
| Alpha.39 | 452.624 | 152.695 | Same frozen population |
| Alpha.47 | 417.453 | 140.154 | Same frozen population; incremental fields expanded 1,960,025 nodes versus 5,953,562 reachable nodes across corresponding complete passes |
| Alpha.53 | 398.647 | 129.342 | Separate full replay; eight requests were 12–475 ms slower than alpha.47 |
| Alpha.55 / .56 / .58 | 467.518 / 457.298 / 463.199 | See per-point CSV | Separate moving-support integration batches; not interleaved or load-isolated |

Alpha.58 retained 38/38 complete results at the frozen selected cost, with 37 identical route objects and 36 identical full action sets. Ten frozen routes still had shorter historical alternatives. Preserving a frozen baseline did not close those historical quality gaps. The alpha.55/.56/.58 totals are distinct batches, as the [per-point integration record](../per-point-performance.md) documents; they are not conflicting estimates of one run. Original mesh construction, HTTP scheduling and other origin attempts were outside those command totals.

### Historical cases and device assumptions worth retaining

These are dated observations migrated from the old handoff. The companion handoff owns the current model and current verification status.

| Historical case | Recorded evidence | What it did not prove |
| --- | --- | --- |
| `10YLgUg`, alpha.58 | 9.975 s command, 8.199 s model trip; older retained trip 6.154 s | Historical best quality was not recovered |
| `17nac6U`, alpha.58 | 19.262 s command, 22.634 s model trip; older retained trip 15.238 s | Same quality gap distinction |
| `0bzZEM3` / `0nQJhsI`, alpha.58 | 35.092 / 20.122 s command and 50.812 / 32.514 s model trips | Current-data first-task latency was not measured by these old successes |
| `0DUKUgc`, audit through 11-05 | 17 retained results were unavailable; six complete-search commands were truncated, taking 46.526–165.917 s | Bounded failure was not physical impossibility or a statement about a later version |
| `02lUaTb`, map02_lv009 | 51.90 s command, 55.686 s model trip, 184.83 m anchor distance, two ropes and seven jumps | It did not use moving swept support, so success was not proof that moving devices were necessary |
| Arbitrary target at a lily-pad end | 25.12 s command, 33.170 s model trip; 74/583 walking samples supported only by moving surfaces | This supplied local swept-support evidence, not full map02_lv009/010 coverage |
| `0YnbG6f` | Small-domain run 52.51 s, including 12.61 s device preparation, unavailable; larger domains exposed native height and JSON limits | No current reachability result followed from that audit |
| `02gcZm4` local tail | Packaged alpha.63 reproduced the lower-rope-to-north-roof/boost/airborne tail at 8.068946 s; 15 local jump collision checks succeeded | The TP30005-to-street prefix was still missing then; a later full HTTP route used another origin and a different complete path |
| `0kkQ3em` / `19Nzh29`, alpha.61 | Packaged airborne-goal and teleport/boost/collection examples were exercised | Later event-contract checks still had to evaluate precise geometry and timing |
| `0DPyejn`, `0T264e6`, `0mmXi4a` | Listed user problem cases, not remeasured in that handoff | Their then-current reachability, required devices and anchor quality remained unestablished |

The 2026-11-09 snapshot used Ganglia alpha.59 / `a9507ae`, Atlos `c7a28dca`, noclip upstream `30f73f46`, AKEDataMining `ae33f49ff` and noclip integration packageVersion 98. Its branch/remote observations were local tracking-reference observations, not a new fetch. Atlos `fef4898c` had added forklift/range-limited box modeling and `c7a28dca` restored preview/routing entry. These are historical markers only.

That snapshot explicitly assumed completed tasks, powered facilities/open doors, and phase-free moving support. Horizontal movers supplied swept support, vertical movers supplied transport; angular seesaw timing, waiting and platform phase were not completed. Following boxes were arranged within authored activity bounds, with placement output but no activation/guidance or carrying time. Only one source box moved per trial; other boxes retained their collision. Box fallback ran after failure, so box shortcuts improving an already complete route and coordinated multi-box placement remained open. Unsupported collider ownership/geometry was diagnosed. Finite defaults of 8,000 candidates / 64 links did not cover continuous placement completely.

The export audit recorded 65 synthetic tests, moving-support counts 87→105 on map01 and 139→144 on map02, preserving the prior 226 objects and other catalogue fields. It added 23 forklift sources (18/5) and 32 following-box sources (23/9). Real-point forklift/box routing, end-to-end latency and GPU support-rectangle display were still pending. The temporary `/tmp/placement-final-tests.log` and `/tmp/placement-export-audit.json` were local evidence; the durable summary is [Atlos route inspection](../../../Atlos/talos/apps/world/docs/route-inspection.md).

The historical movement source used build `2954fa80-23c1-1579-2b22-4ecfd6d70418`: boost duration came from `ReqAddBuff`, the 1.2 increment yielded the modeled 2.2 multiplier, and `ccs_duration` was camera time. The recorded ordinary launch/sustained air speeds were 9 / 6.5 m/s with 5 m/s² overspeed deceleration. Dash used an approximate 3 m / 0.3 s displacement and 0.8 s input interval; animation displacement remained unverified. These source-derived/approximate distinctions must survive future model updates.

G3 state-preserving regional entry/exit contraction, persistent action assets, full resource-optimal routing, independent control propagation and complete-map acceptance remained open. The native detail-triangle/polygon ownership was not preserved, so graph scale followed detail density. Prebuilt experiments measured a `0bzZEM3` local payload of 60.10 MiB raw / 16.70 MiB gzip, without a complete manifest, collision BVH and action evidence. A C/WASM BVH kernel prototype measured 151.8→86.1 ms, but 138.2 ms including setup/packing/JS rebuilding; it was not integrated route acceptance. See [prebuilt navigation](../prebuilt-navigation.md) for those component experiments rather than treating their kernel gains as command speedups.

## Regression and profiling before the current optimization baseline

The historical alpha.67 review finished 113 retained requests: 63 passed, 33 improved, 14 regressed, two failed the event-evidence contract and one baseline was invalid. Those classifications include older baseline/model/search-budget differences. They are a backlog and provenance record, not proof that the later alpha.76 optimization regressed 14 requests.

The `0kkQ3em` old event was approximately 75.874 mm outside the trigger and 9.145 ms early; an invalid old event must not be the quality target. The two `missing-goal-event` cases (`035-06IsDPb`, `047-0cauQ22`) had valid grounded endpoints inside their goal volumes in both old and new results, but lacked the explicit event evidence required by the reviewed contract. Keep feasibility and event-contract failure as separate dimensions; they were not new reachability failures. Earlier `17nac6U` / `10YLgUg` quality differences also involved substantially different discovery budgets. Do not relabel these as isolated regressions from a later performance patch.

The detailed profiling series contained 26 cold/warm trials. It instrumented stages/functions and sampled V8 CPU stacks. Cold heavy action took 173.348 s with insertion hooks versus 154.793 s in its uninstrumented control; the latter still had CPU sampling enabled. The recorded inclusive hierarchy contained about 167.031 s in airborne-goal planning, 154.675 s in the boosted branch, 149.755 s in 21 entry-approach calls and 143.974 s in 14 shortcut searches. These nested times cannot be added. Disjoint deepest-frame categories attributed 55.282 sampled seconds to bounds and 40.421 to shortcuts, with 24.740 to GC. They indicated where to investigate, not isolated speedup potential.

Ground-detail profiling was 18.148 / 3.984 s cold/warm versus 16.395 / 3.936 s control, including I/O/JSON in the revised harness. Candidate profiling was 103.178 / 1.556 s. A high-frequency `scheduleBlock` hook had 3,853,372 calls and was removed from the low-overhead detour harness. That harness measured 65.509 / 60.528 s against 61.459 / 57.692 s control, with equal routes/connections. Sequential single trials cannot isolate the amount saved by removing one hook, and profiler overhead itself was not independently quantified.

A separate ordinary HTTP check used a fresh Vite server/worker on an isolated port, existing disk/input/terminal assets and uncontrolled OS caches. It completed in 97.689 s excluding server setup; an identical warm request was 7.610 ms and returned the same route. That warm result was reuse of a completed task, not fresh action-search performance. Its complete trip cost was 96.075256 s from `TpForMap_ent_22800030004`, distinct from the earlier local 8.068946 s roof tail.

## Alpha.70: retained envelopes, resumable frontiers and lazy candidate transfers

**Implemented and retained:** `066dc1d` introduced conservative reachability predicates in spatial queries, reverse-frontier predecessor constraints, resumable seed/landing/control queues, indexed candidate endpoint matching and lazy unresolved transfers for expanded ground components. Stable transfer keys reached query-local exclusion handling. The envelope retained the existing finite control/candidate coverage; it did not solve an unrestricted supported-run-off reachable set.

| Alpha.70 candidate experiment | Before | After | Scope |
| --- | ---: | ---: | --- |
| Preparation | 65.673 s | 8.480 s | Work moved out of eager graph construction |
| Search | 9.040 s | 38.425 s | Lazy generation moved substantial work into the query |
| Cold total | 74.713 s | 46.905 s | 37.2% lower; candidate points and score matched |
| Same-planner warm query | 1.342 s | 1.313 s | Near the existing warm baseline |
| End-of-experiment RSS | 1.93 GB | 3.23 GB | Higher, not a demonstrated memory improvement |

The heap-used readings also rose, about 2.293→3.072 GB. These were end readings with unreclaimed objects and V8 heap capacity effects, not isolated retained-index memory or process peaks. Candidate route equality alone did not prove physical feasibility.

The three physical controls were 154.793→158.363 s (action), 23.012→23.190 s (failed window), and 43.431→44.407 s (direction). Final routes matched; only the action case also retained identical complete connections. Alpha.70 therefore established a candidate-cold benefit, not an action-search benefit. Its recorded checks were 249 SDK tests at the initial package checkpoint, then 45 focused and five Atlos entry checks after fixes. World type checking at that checkpoint failed on the recorded TypeScript/noclip viewer API types; that historical failure is not a claim about the current checkout.

For subsequent physical optimization comparisons, use **alpha.70's new retained baseline**, not alpha.67's instrumented or differently configured results: action 158.363 s, failed window 23.190 s, direction 44.407 s. Alpha.70 is a checkpoint after prior optimization, not the earliest unoptimized implementation. The candidate's pre-`066dc1d` 74.713 s control is another measurement family. The 173.348 s instrumented profile must not replace the lower-overhead physical denominator. A fresh alpha.70 device-entry control was 17.452 s with trip cost 14.88124591890099. The earlier profile's 14.316685 device trip is a different historical baseline and must not be presented as a regression caused by this round. The ≤20% target remains unmet under both the 158.363 s and earlier 154.793 s heavy-action controls.

## Later attempts and decisions

The table separates implementation status from a promising name or a one-off timing. Experiment combinations were not a controlled ablation study.

| Attempt | Classification and disposition | Recorded outcome / reason |
| --- | --- | --- |
| Exact cross-prefix nearest-result/witness reuse, canonical component views and serialized keys | **Implemented experimentally, then removed** | `exact-reuse`: 184.803 s total / 180.491 s search versus alpha.70's 158.363 / 153.896 s, same selected trip cost 8.94138859157342. Key, admission and retention overhead outweighed reuse. Do not restore the discarded general nearest/witness factory on cache-hit counts alone |
| Global verified-action pool shared across different approach goals | **Implemented experimentally, then restricted back to one solve query** | `alpha71/action`: 134.488 s / 129.733 s, trip cost changed to 8.919162661604151; direction was 51.003 s / 27.588 s, above the alpha.70 control. A faster or lower-cost sample did not establish a uniform benefit or preserve the established finite-search comparison. Pool contents changed later discovery/ordering. Current local pooling is narrower |
| Incumbent prefix cost bound | **Implemented and retained as part of `3edbe40`** | `cost-bound`: 130.577 / 126.304 s, original trip cost retained. It bounds each approach by incumbent total minus the fixed terminal-flight duration; the relative discovery budget subtracts the actual arrival cost once, and direction subqueries retain the real final bound goal |
| Motion domains, reverse predecessor bounds and terminal-flight steering | **Implemented and retained in `3edbe40`; mixed trial attribution only** | `dynamic-steering`: 136.757 / 132.308 s, trip cost 8.919162661604151. This trial also contained action-pool/bound changes; neither its difference from 130.577 s nor its gain from baseline isolates steering or a single formula |
| Per-solve canonical action deduplication | **Implemented and retained after global-pool rollback** | Later arrivals merge the current solve's actions and recompute their incumbent; IDs remain unique, failed partial sets are deduplicated, and inherited actions do not consume another arrival's new-link quota. Alpha.72 action: 121.101 / 116.645 s, original exact route restored |
| Shared local spatial-tree prototype | **Implemented, measured, then removed** | `clustered`: 125.974 / 121.221 s, exact original route, slower than the preceding 121.101 s total. Almost every local iterator still started global traversal, so the extra structure did not remove the expensive fallback |
| Exact collinear boundary merging | **Investigated/count experiment, not adopted** | 61,264→60,610 boundaries, only 1.07% fewer. No end-to-end speedup claim; no approximate face merge was enabled |
| Larger spatial/kinodynamic clusters and physical blocked-region certificates | **Investigated, not implemented** | A certificate would need actual collision-triangle coverage and a conservative reachable section; a navmesh seam or apparent floor interior is insufficient. Supported uphill run-off prevents treating every seed as an immediate ballistic launch |
| Conservative face/top-K bound, one-goal projection cache, stable bounded insertion and cell reuse | **Implemented and retained in `917dfcd`, restricted to improvement discovery** | The heavy bounded-top-K trial was 102.562 / 98.042 s with the exact original selected route; final frontier processing retained its prior witness generation and sort/pop behavior. Details below |

The removed exact-reuse prototype is archived under `action-clusters/exact-reuse/`; the removed local-tree prototype is under `action-search-20261110/clustered/`. The initially measured local-tree prototype could change equal-distance ordering despite preserving distance order and the complete candidate multiset. A later helper revision falls back to the original global iterator before emitting ties; sequence/prefix tests passed, but that revision was not the source of the 125.974 s timing. The archived helper includes that later revision. These archives are experimental code, not maintained production modules. Static landing metadata and the later one-goal projection cache are narrower retained mechanisms, not evidence that the failed broad cache was re-enabled.

Review during the cost-bound/pool work found real correctness hazards: a second cheaper arrival could lose a globally deduplicated edge absent from its local connection set (6.4663396 s selected instead of 1.4663396 s in a two-floor reproduction), and widening a cost bound could reuse an exhausted tighter-bound cursor and miss a fresh-cache success. Focused regressions now protect local action availability, duplicate IDs and cost-bound/`boundGoal` cursor invalidation. Do not remove those distinctions when attempting wider sharing.

## Alpha.76 measurements and remaining target

These are fresh-process retained-input command measurements on Node v26.13.0 with a 4 GiB heap limit. Values are **command elapsed / extractor search stage**, in seconds; search is included in total. The named heavy and failed-window artifacts were collected before the final frontier-restoration replay. Preserve those trial identities rather than treating the table as a synchronized whole-release benchmark.

| Case and trial | Alpha.70 baseline | Previous retained comparison | Latest recorded trial | Result |
| --- | ---: | ---: | ---: | --- |
| Heavy action, `bounded-topk` | 158.363 / 153.896 | Alpha.72: 121.101 / 116.645 | 102.562 / 98.042 | Exact original selected route, cost 8.94138859157342 |
| Failed window, pre-restoration `bounded-topk-failed` | 23.190 / 16.019 | Alpha.73: 24.977 / 17.101 | 24.396 / 16.657 | Same unavailable outcome; slower than original, not physical-impossibility proof |
| Direction, final installed `release76-frontier-restored` | 44.407 / 24.379 | Alpha.73: 48.129 / 24.627 | **61.049 / 34.476** | Exact original route, but this final measured run was worse |
| Device entry, alpha.73 checkpoint only | 17.452 / 11.709 | — | 16.739 / 11.227 | Exact alpha.70 route, trip cost 14.88124591890099; not a fresh alpha.76 result |

Earlier direction trials were 47.992 / 26.177 s and 49.142 / 28.078 s. The later 61.049 / 34.476 s must not be replaced by the best earlier trial or hidden behind the heavy-action improvement. These sequential single observations have uncontrolled JIT/GC/load variation; they establish no direction benefit and do not isolate a causal regression factor.

The heavy search still charged fourteen full improvement batches: 1,792,000 seed slots and 7,168,000 neighbor slots. It skipped landing generation for 708,159 faces, 9.88% of charged neighbors, retained 4,629,386 bucket candidates across queries and made 6,238 uncached shortcut trajectory attempts. These counts exclude airborne-terminal trajectory attempts. They do not show fewer spatial-node visits, all witness generation costs, or a new full function profile.

Against alpha.70, heavy total/search remaining fractions are 64.8% / 63.7%, not ≤20%. Against the preceding retained algorithm they are 84.7% / 84.1%. The alpha.70 heavy targets would be about 31.673 s total and 30.779 s search. Candidate generation and repeated approach queries remain structural work; the existing measurements cannot predict whether a future regional or implicit-action algorithm will reach those targets.

## Investigated or proposed directions that are not completed implementations

The user's pasted roadmap (local attachment ID `d0f295e0-6175-4592-9d6e-b0ab913b377e`) and [the roadmap](../roadmap.md) supplied the following directions. This is a project-status record, not a new literature review or a transfer of external correctness/speed guarantees.

| Direction | Status at handoff |
| --- | --- |
| Reachability-informed kinodynamic sampling, including the Ding et al. jumping-robot reference | Analytic conservative envelopes and restricted inverse steering were implemented using the existing character motion model. A precomputed robot reachability map, kinodynamic RRT sampler and contact-dynamics optimizer were not implemented |
| L-GLS / incremental lazy validation and search repair | Proposed; no complete L-GLS engine or acceptance result |
| Full RCSP/label setting, Pareto state dominance, unified resource-transition kernel and reusable DP prefixes | Source investigation/planning only for the proposed cross-layer redesign. Existing bounded resource-alternative search and fixed-route DP predate it and do not establish the complete redesign |
| Nonmonotonic stamina counterexample | The attached source investigation reported that more energy can cause an earlier automatic sprint and leave a later required-sprint entry infeasible. Its 1.25-versus-1-energy example motivated safer dominance conditions. This is not a fresh alpha.76 reproduction, a general monotonicity theorem or a completed kernel fix |
| AIT*/EIT*-inspired ordering by route cost versus validation effort | Proposed as separate ordering signals; no production implementation or measured benefit |
| Search-directed implicit physical-action graph / IxG-inspired successors and local trajectory optimization | Proposed; alpha.70 lazy unresolved candidate transfers implement only a narrower piece. There is no complete graph-of-convex-sets cover or associated local optimization engine |
| Learned ranking/validation-budget allocation | Proposed; no trained model, independent holdout result or enabled learned pruning |
| Kinodynamic RRT-Connect / HyRRT-Connect, or direct replacement with SST / RRT* | Proposed alternatives; no implemented production solver, verified reverse dynamics or project benchmark. A planner-family replacement has not been shown to remove this project's expensive successor-generation cost |
| State-preserving regional action assets and complete independent forward replay | Open structural work, not completed by caches, conservative local bounds or a few successful windows |

The attachment originally placed resource work at P0, requested five interleaved cold/warm groups for every representative family, and used “at least 20% improvement.” Later user instructions superseded that order and acceptance regime: prioritize candidate-space/action retrieval, target **remaining cost ≤20%**, and use bounded, relevant validation. Do not revive the earlier priority or launch every expensive replay on each iteration by treating the old attachment as current authorization.

## Finite validation standard for the next change

1. **Bind the comparison before measuring.** Record request/input hashes, geometry and game build, movement/body/wall/device settings, search limits, selected origin/coverage, source commit, package and actually resolved installed source, Node/heap settings, instrumentation and cache state. Use the alpha.70 physical controls above for this optimization lineage unless an explicitly reviewed new baseline is established. Keep input changes, invalid historical goals and earlier resource/model changes separate.
2. **Validate the claimed candidate contract.** For an optimization claiming equivalent finite enumeration, compare old and new retained representatives under unchanged seed/neighbor/endpoint/trajectory budgets. Preserve stable ties, uncertainty ordering, source/intermediate fairness, insertion order and truncation; the current dominated-face optimization still consumes its original neighbor slot. An intentional replacement of the generation/search strategy must instead state its coverage, fairness, stopping and budget semantics, and validate feasibility and route quality against the established controls. Do not silently call reordered or reduced sampling equivalent, or obtain a speedup solely by weakening the quality/coverage requirement. Unknown controls or unsupported/numerically unsafe bounds retain a conservative fallback.
3. **Exercise cache/cursor changes where relevant.** Larger work budgets resume; changed endpoints, final bound goal, cost bound, geometry/world/body/model/walls or action revision invalidate the dependent state. Increasing a representative/link quota rebuilds when needed. An earlier incomplete solve under a tighter bound cannot block a later wider-bound search. Reusable geometry failures and changed reachability are different dependencies. Check new/removed/faster/zero-cost actions, moved endpoints and multiple arrivals without duplicate IDs or lost local edges.
4. **Retain complete physical acceptance.** Candidate scores and polygon-center heuristics organize a finite search; they do not prove executable route optimality. Accepted motions still need real support, body clearance, walls, complete trajectory sweeps, directed device conditions, whole-route resource scheduling, boost expiry and the required terminal goal event. Supported run-off may walk uphill before actual takeoff. Terminal collection edges cannot become ordinary intermediate transfers. Preserve far/away-from-goal, interior/narrow landings and multi-hop alternatives in the affected fixtures.
5. **Check feasibility and quality independently.** The 2026-11-11 user acceptance gate permits complete-route cost deterioration up to 5% against the valid same-input control. Fix failures, timeouts and larger cost regressions by improving the new algorithm. Legacy enumeration remains a diagnostic control, not the requested production remedy. A route that remains complete can still be slower or use a changed finite candidate set. Compare selected origin, points, segments, times, gait, resources, goal event, boost annotations and connection identities where equality is promised. If differences are intentional, explain and validate them rather than silently moving the baseline. A bounded unavailable result remains inconclusive about physical impossibility; existing contract failures remain visible.
6. **Use a finite verification pass.** Once edits stabilize, run directly affected tests and the established checks required for that change, then only the representative solver/HTTP cases needed to resolve its actual risk. Add a focused regression for a real failure, not a mirror of internal structure. Broaden or repeat after a new failure/change or unresolved concern; stop when sufficient evidence exists. Neither indefinite profiling nor a full cold/warm corpus on every small edit is required. A cross-map or release-wide claim still needs evidence covering that claim.
7. **Keep timing meanings separate.** Process/application cold does not mean flushed OS pages; warm prepared planning differs from finished-route cache reuse. Exact instrumented inclusive/self timers, sampled deepest-frame attribution, CPU usage and stage progress intervals have different meanings. Nested function/stage durations overlap. Original phase timestamps may mark completion, not start; use paired attempt start/end events for per-attempt durations. Record profiler/hook overhead and use an appropriate low-overhead control before claiming elapsed-time gains. Report regressions and memory costs as well as wins.
8. **Keep learned-data scope explicit.** Collect random support regions across maps and level-tagged windows before fitting scheduling weights. Split by whole level/map, bind labels to the tested witness and preserve budget-exhausted episodes as unresolved. Fit normalization on training data only. Compare geometry-only and control-only features, charge generation/inference/validation/fallback separately from offline training, and report early-budget losses as well as aggregate discovery gains. A local primitive-policy benchmark does not replace complete-route quality/resource/goal validation or establish production solver speed.

At the alpha.76 checkpoint, **271 SDK tests and 10 Atlos route worker/server tests were recorded as passing**, and checkout, tarball and installed SDK source files matched byte for byte. This history migration ran no new solver or tests. Those old passes do not certify a subsequent edit, package or environment.

Local repeated repacking of the same file tarball had allowed pnpm to resolve stale source despite the apparent version/lock entry. Final verification used the frozen offline forced installation and compared actual resolved source bytes. Prefer a new immutable version/artifact next time, verify the resolved installed code, and review precise package-entry lock changes; broad multiline regular-expression edits had risked consuming unrelated entries. A matching version string alone is insufficient provenance.

The next report should state what changed, its implementation/experiment status, the finite tests and cases actually completed, exact input/version/timing bindings, route-quality differences, remaining uncertainty and whether the ≤20% target was reached. Keep [handoff.md](handoff.md) consistent with that record; do not infer completion from a successful package build, a cache hit or a proposal name.

### Maintained measurement entry point

Use Atlos's versioned [profile-route-stages.mjs](../../../../scripts/profile-route-stages.mjs) and its loader rather than treating `/tmp` trial scripts/hooks as maintained tools. The [noclip integration README](../../../../integrations/noclip/README.md) requires Node 26. With Node 26 selected, an existing parent output directory, and a **new, nonexistent** run directory, the minimal low-overhead template from the Atlos root is:

```sh
node --max-old-space-size=4096 talos/scripts/profile-route-stages.mjs \
  --command player-route \
  --args /absolute/path/to/retained-args.json \
  --extractor talos/.cache/noclip \
  --output /absolute/path/to/existing-parent/new-run \
  --baseline
```

`retained-args.json` is the original extractor CLI argument array of strings. The harness redirects result outputs and records input identities. It **always executes cold then warm in the same process**; `player-route` shares its `RouteCache` between those two trials. `--baseline` disables function insertion hooks. CPU sampling is off unless `--cpu` is added; use that option for attribution and label its overhead. Module import/parse/transform setup is reported separately. The script also supports `player-ground` and `candidate-worker`, with different argument/cache semantics visible in its source. Do not launch the template as an automatic prerequisite for every documentation or small implementation change.


## 2026-11-11 subsystem organization and composition review

Starting from Ganglia `c8cc213` and Atlos `9a82bfb0`, moved 37 implementation
modules into `geo`, `reach`, `motion`, `search`, `resource` and `route`. Updated
internal imports, test imports and current handoff links. The three public package
entry paths and declarations remain stable. Build and collision use root forwarding
exports. Historical source paths in earlier records retain their original version
context. Package version remains alpha.76 in this source checkout. This change has
no new packaged artifact or installed Atlos solver binding.

Updated the maintained Atlos profiling loader to recognize all six directory names
while retaining historical module labels and flat alpha.76 package support. Its
change starts from Atlos `9a82bfb0`. The loader is part of this refactor's integration
scope. Atlos's existing solver tarball remains bound to the prior implementation.

The handoff now records ownership of envelopes, distance fields, candidate scores,
lazy validation, query cursors, per-solve actions and resource continuation labels.
It also records immutable snapshot requirements, cost units and admissibility,
witness-scoped rejection, retryable uncertainty, content-based action revisions,
budget semantics and unsafe dominance domains. AGENTS.md requires consulting these
contracts before sharing state or introducing pruning.

A centralized runtime revision object, shared action-evidence registry and unified
resource-transition kernel remain open. Existing mixed responsibilities and the
movement-geometry/traversal dependency cycle are documented for subsequent targeted
extraction. This directory refactor changes import locations and public forwarding
only. It introduces no new search pruning, state sharing or performance claim.

Completed checks on the reorganized source

- Node v25.9.0 `npm test` passed all 271 tests, including the existing lazy-route,
  distance-field, cursor, bound-widening and multi-arrival regressions.
- A source comparison against `c8cc213` confirmed all 37 moved implementation
  modules and all existing test bodies match after relative import-path normalization.
- Package self-import checks resolved `.`, `./build` and `./collision`, with the
  expected build and collision exports and `planJumpRoute` available.
- On Node v26.13.0, the actual Atlos `transformSource` function produced identical
  transformed source and profiler labels for old and new paths across six selected
  modules, one from each subsystem. Each module generated instrumentation labels.
- `git diff --check` passed in both repositories.

The source-layout validation uses existing small regression fixtures. No additional
heavy map replay or performance measurement was run for this import-only change.
The previous remaining-cost target and unresolved model/quality gaps still apply.


## 2026-11-11 conservative algorithm combinations

The user requested combinations of the remaining algorithm directions. This round
implemented conservative reuse and earlier domain pruning, screened structural
combinations, and measured a finite set of retained physical inputs. The complete
set of planner families listed below has not been implemented or benchmarked.

The control is the reorganized `634ed45` source. Each variant is frozen under
`algorithm-combinations-20261111/<variant>/node_modules/@opendfieldmap/ganglia/`
in the local research root. A resolver hook selects these immutable source copies
for Atlos's maintained `profile-route-stages.mjs` harness. Each source manifest
records SHA-256 hashes. Reports include request input hashes, actual resolved SDK
path, Node v26.13.0, 4 GiB heap, source loading and cold/warm cache semantics.
The package version string is alpha.76 throughout these experimental source copies.
The installed Atlos solver artifact is unchanged. Source hashes identify the trials.

| Combination | Implementation and decision |
| --- | --- |
| Numeric motion constants + dependency-checked distance fields | Implemented experimentally, then removed from the final source. A five-value cache reuses ascent/terminal constants across fresh option spreads. Field dependency checks can preserve approach labels across target changes while resetting changed departure roots |
| Above + adjacent duplicate face evaluation reuse | Implemented experimentally, then removed. A takeoff retained only its latest face and replayed all original duplicate admissions. Heavy cold/warm time increased, with unchanged route and complete connection set. The earlier broad exact cache failure therefore also has this narrower failed trial |
| Constants + distance fields + preprojection boundary/point cost bounds | Implemented and measured, then narrowed to the preprojection bounds. Conservative boundary-plus-inset boxes skip projection work. Every seed still consumes its original slot, and point tests use projection's exact XZ invariance. `seedProjections` reports actual projection requests |
| Preprojection bounds only | Retained. Removes support projection before an unchanged horizontal rejection, preserves original seed slots and fallback behavior, and adds one bound-widening regression |
| Constants + fields + bounds + numeric canonical projection cache | Implemented experimentally, then removed. Geometry-owned numeric slots covered fractions exactly 0, 0.5 and 1, bound maxVertical/body radius, returned fresh positions, and admitted at most 65,536 entries. It reduced projection requests again but showed no stable end-to-end advantage over the preceding bounds combination |
| Dual-tree region domains + implicit physical successors + cost/effort ordering | Proposed structural combination. It directly targets region pairs, neighbors and witnesses. Requires coverage-preserving domain refinement, cursor fairness, evidence scope and acceptance for changed finite ordering. No production implementation or timing result |
| Implicit physical graph + L-GLS repair/effort-aware lazy validation | Proposed subsequent combination. Existing incremental fields and lazy proposal replacement are narrower mechanisms. The previous heavy workload had millions of neighbors but 6,238 shortcut trajectory attempts, so full graph repair alone has no demonstrated way to remove the dominant generation work |
| Convex regional decomposition + inverse steering + GCS local optimization | Proposed. Needs a conservative free-space cover, supported run-off semantics and a compatible local dynamics optimizer. Existing triangle geometry and scalar envelopes do not establish those prerequisites |
| Conservative implicit successors + learned feasibility ranking | Proposed. Needs representative labels, independent evaluation and fallback coverage. No trained ranker or learned pruning was added |
| Region guidance + kinodynamic RRT-Connect/SST/RRT* exploration | Proposed. Requires a supported propagation/connection contract and handling of nonreversible dynamics. No implementation or benchmark demonstrates lower candidate-generation cost here |

The experimental constant cache preserved the phase summation order and complete sweep
validation. A five-million-call helper experiment reported approximately 124–126 ms
to 83 ms for mixed jump/drop calls under one model. This is helper timing, with no
isolated end-to-end attribution. Ten thousand varied-height/model comparisons
against the control matched, including invalid-model sequences. Its trial regression
checked numeric model changes, fresh spreads and rejection after a valid cached call.

The experimental field change delegated invalidation to `advanceDistanceField`'s exact
base/root/direction/scale/ordered-weight checks. Changing the scene/model binding
still clears all discovery caches. Its trial regression checked reuse of unchanged
approach roots, reset of changed departure roots and fresh-query connection parity.

The boundary bound includes the entire authored inset range and outward floating
padding. It sums independent lower distances to source/target boxes, uses strict
comparison with additional cost slack, and yields the original excluded-seed
placeholders. Point pruning runs the existing horizontal tests before projection.
A tight-bound regression performs zero seed projections and a later wider bound
recovers the same connections as a fresh query. Seventy-two deterministic rotated
gap/ramp comparisons varied body radius, height, gap, coordinate offset through
1e6, cost bounds including zero, and shortcut/frontier mode. All old output and
finite-enumeration diagnostics matched after omitting the new projection counter.

The initial combined branch passed 274 SDK tests. Trial-only model/field tests were
removed with their corresponding experiments, retaining the bound-widening test.
The canonical cache trial also passed 36 repeated-query/changed-height cases and
72 small-scene control comparisons before removal. The final retained branch's
validation and physical measurements are recorded below. Historical tests do not
certify a later source change.

### Physical measurements and final disposition

These are sequential single cold/warm pairs with uncontrolled OS/JIT/GC/load
variation. Search is included in total. The model/field, failed-window and direction
trials used an identical narrow load-hook wrapper that clones discovery diagnostics
once per call. It performs no per-witness timing. Earlier heavy control/combined/
bounded-fields measurements omitted that wrapper. This difference is recorded
instead of attributing every timing delta to one algorithm.

| Combination | Case | Cold total / search (s) | Warm total / search (s) |
| --- | --- | ---: | ---: |
| Control | action | 93.855 / 89.781 | 93.787 / 90.084 |
| Constants + fields | action | 103.137 / 99.135 | 97.077 / 93.169 |
| Constants + fields + face reuse | action | 102.916 / 98.929 | 105.331 / 101.623 |
| Constants + fields + bounds | action | 86.422 / 82.411 | 87.584 / 84.043 |
| Bounds only, retained | action | 89.654 / 85.569 | 88.752 / 85.024 |
| Constants + fields + bounds + canonical projection cache | action | 87.921 / 83.838 | 88.313 / 84.602 |
| Control | failed-window | 22.927 / 15.720 | 21.299 / 15.646 |
| Constants + fields + bounds | failed-window | 24.811 / 16.812 | 23.360 / 17.346 |
| Bounds only, retained | failed-window | 23.468 / 16.030 | 21.612 / 15.798 |
| Control | direction | 44.804 / 22.770 | 43.405 / 25.747 |
| Constants + fields + bounds | direction | 43.890 / 22.643 | 42.490 / 23.865 |
| Bounds only, retained | direction | 41.342 / 21.613 | 39.109 / 21.984 |

All 24 physical trial results retained the control's exact status, full route and
complete connection array for their case. The failed-window result stayed
unavailable. This establishes the selected input scope. It does not prove general
physical impossibility, continuous completeness or map-wide quality equality.

Final selection is **bounds only**. Heavy total fell by 4.5% cold and 5.4% warm;
direction fell by 7.7% and 9.9%. Failed-window total rose by 2.4% and 1.5%, so a
uniform benefit was not established. The three-mechanism combination was faster
on the heavy input but regressed failed-window total by 8.2% cold and 9.7% warm.
Its individual model/field mechanisms were removed from production with their
trial-only tests. This comparison is not a complete independent ablation of each
mechanism and provides no causal attribution for their interaction.

Work counters below aggregate cold and warm, including all repeated discovery
calls. The heavy control's projection count is derived from its 28 non-frontier
`searched` calls and original implementation, which projects every charged seed.
Older diagnostics lack `seedProjections`, so a missing field in their raw record
must not be read as zero calls.

| Work across the heavy cold/warm pair | Control / no preprojection bounds | Bounds only | Bounds + canonical projection cache trial |
| --- | ---: | ---: | ---: |
| Charged seeds | 3,584,000 | 3,584,000 | 3,584,000 |
| Seed projection calls | 3,584,000, derived | 102,856 | 16,662 |
| Canonical projection hits | — | — | 86,194 |
| Charged neighbors | 14,336,000 | 14,336,000 | 14,336,000 |
| Retained bucket candidates across calls | 9,258,772 | 9,258,772 | 9,258,772 |
| Uncached shortcut trajectory attempts | 12,476 | 12,476 | 12,476 |

The 97.1% reduction in seed projection calls produced only about 5% heavy total
reduction. Even the canonical cache's further projection reduction did not improve
the preceding combination's total time. Candidate generation and nearest traversal
remain substantial. These counters measure projection requests and existing
neighbor/candidate/trajectory work. No BVH node-visit count was collected, and the
trajectory count excludes airborne-terminal attempts.

The retained heavy cold total is 56.6% of the alpha.70 158.363 s original control;
its search is 55.6% of the 153.896 s search control. The required remaining cost
of at most 20% remains unmet. No equivalent claim can be made for all planner
families or most production queries from these three inputs.

The final source retains only the preprojection bound and optional declaration of
`seedProjections`, preserving older diagnostic object compatibility. Its runtime
module equals the frozen `bounds-only` trial after removing two obsolete comments.
The installed package remains the previous alpha.76 artifact. Final SDK checks
and source/diff verification are recorded at the end of this entry.


Final verification on Node v26.13.0 passed all **272 SDK tests**, including the
new tight-bound/no-projection and widened-bound recovery regression. The final
runtime source comparison to the measured bounds-only snapshot passed after
removing the obsolete experimental field comments. `git diff --check` passed.
No installed package replacement, remote push or broad 113-request replay was
part of this experiment batch. Atlos's working tree remained clean.


## 2026-11-11 non-learning structural ablation

The next user request prioritized invalid-candidate reduction and structural
comparisons, excluding learned algorithms. This round implemented and compared
regional index views, candidate-domain filtering, canonical successor ordering,
reusable geometric prefixes, target-independent witness decomposition, local
cache quotas, and complete-motion-family cost domains. Every new prototype was
removed after failing to show a stable benefit on the heavy input. The retained
solver source is still `66dbd52`; this record adds no runtime optimization.

### Source and input binding

Frozen variants, SHA-256 manifests, helper checks, full extractor reports and the
comparison are in the local ignored research directory
`structural-ablation-20261111/` under the previously recorded research root.
Region-view and canonical-heap microbenchmarks additionally reside in
`algorithm-combinations-20261111/`, with `region-aabb/`, `region-envelope-source/`,
`region-envelope-query.mjs/json` and `canonical-heap-overhead.json`.
`prototype-working-source/` preserves the final composite prototype and its tests.
These local archives are not distributed by an ordinary Git clone.

The physical control is the preceding round's `bounds-only-action` cold/warm pair,
whose runtime matches `66dbd52`. This control was reused, with identical retained
`action-args.json` input files. All 22 new physical trial reports matched its input
SHA-256 identities and resolved their named frozen SDK source paths. The maintained
Atlos harness ran on Node v26.13.0 with a 4 GiB heap and function timing hooks off.
A narrow research load wrapper collected discovery counters once per call. Later
catalogue variants additionally collected private cache counters through that
wrapper. Source hashes identify the variants, whose package strings remain
alpha.76. The installed Atlos SDK artifact and generated extractor were untouched.

These are sequential single cold/warm pairs with uncontrolled OS/JIT/GC/load
variation. Small differences do not establish causal regressions or broad speedups.
Since every variant failed the heavy performance screen, the batch stopped before
additional failed-window/direction or cross-map replay. This follows the finite
validation standard instead of multiplying unsuccessful full-corpus runs.

| Structural variant | Cold total / search (s) | Warm total / search (s) |
| --- | ---: | ---: |
| Reused `66dbd52` control | 89.654 / 85.569 | 88.752 / 85.024 |
| Candidate-span domain + same-surface exclusion after nearest yield (`span-entry`) | 89.701 / 85.398 | 90.182 / 86.316 |
| Above + projected triangle-hull domain (`hull-entry`) | 93.472 / 89.045 | 94.684 / 90.826 |
| Above + candidate-span BVH predicate (`hull-node`) | 101.683 / 96.833 | 92.763 / 88.954 |
| Canonical nearest order + exact SCC-mask partition reuse (`canonical-direct`) | 90.448 / 86.248 | 89.640 / 85.943 |
| Goal-independent geometric streams + indexed fallback, uncached (`catalog-uncached`) | 94.834 / 90.728 | 97.289 / 93.546 |
| Above + shared canonical source prefixes (`catalog-shared`) | 95.308 / 91.183 | 95.244 / 91.531 |
| Target-independent landing witnesses, original nearest order (`witness-only`) | 91.009 / 86.760 | 90.481 / 86.775 |
| Shared source prefixes + landing witness catalogue (`catalog-witnesses`) | 96.495 / 92.370 | 97.050 / 93.280 |
| Landing witnesses with per-source FIFO quotas (`local-witness`) | 95.136 / 90.893 | 95.469 / 91.576 |
| Jump/run-off union cost domain after nearest yield (`family-entry`) | 90.071 / 85.828 | 90.141 / 86.485 |
| Jump/run-off union cost domain inside BVH traversal (`family-node`) | 95.334 / 91.211 | 92.953 / 88.919 |

All 22 physical results preserved the control's exact status, complete route and
connection array, including modeled cost `8.94138859157342`. Canonical ordering and
node-level pruning still changed some finite candidate sets and work counts.
Equality of these selected outputs provides the stated input scope.

### Implemented structures and failure mechanisms

**Regional views.** `bounds.region(domain)` retained original node bounds, unary
ancestors, empty overlapping ancestors and heap events. Queries outside the view
fell back to the complete tree. A second view used a conservative cell-wide motion
envelope. Exact tied prefixes and filtering behavior passed focused tests. On
121,081 faces, 3,000 queries and 64-result prefixes, AABB-view preparation took
4.495 ms; original traversal measured 39.335/38.694 ms and regional traversal
39.216/38.667 ms. The motion-envelope view took 11.691 ms to prepare, reduced
predicate calls only 557,411 to 556,038 (0.25%), and measured 59.992/60.110 ms
against 60.626/59.364 ms. It preserved all 192,000 outputs. Keeping the accepted
heap work while removing a few cheap exclusions left no useful gain. Retry needs
a changed representation or a certificate that removes substantial accepted work.

**Candidate-span and triangle domains.** A shortcut-specific rounded-up table
bounded `jumpDuration * maxHorizontalSpeed`, matching the later candidate span
prerequisite. Generic launch-overspeed reach stayed separate. Post-yield filtering
charged each old neighbor slot. A projected triangle-hull test excluded empty AABB
corners before constructing witnesses, with numeric padding and polygon fallback.
The first stage also skipped same-surface witnesses already rejected downstream.
Across both trials, 112,722 faces were excluded by the first stage and 113,534 by
the hull stage. The extra hull test removed only 812 of 14,336,000 charged faces,
while adding per-face work. Node-level filtering changed finite prefixes and
increased aggregate retained candidates. Retry needs a more selective domain or
coarser representation; this detail-triangle workload did not justify these tests.

**Canonical successor ordering and prefixes.** An opt-in `.ordered` query used
lexicographic priority `(squared box distance, original input ordinal)`, including
minimum descendant ordinal in node priorities. This allowed a goal-independent
sequence to be filtered without historical heap tie effects. The original `.nearest`
body stayed intact. Query-only attribution measured about 27–31% more CPU for the
new ordering (77.677/77.748 ms versus 59.273/61.081 ms), with a 19.737 ms initial
metadata pass. This ordering intentionally replaces the old finite tie strategy.

The geometric catalogue interned exact SCC-eligibility masks, retained canonical
boundary identities at fractions 0, 0.5 and 1, verified source targets/bounds, and
bound the owner to geometry/model/range/body/projection settings. Limits of 64
partitions, 8,192 streams and 256 cached entries per stream fell back to complete
canonical traversal. Interleaved readers and capped tails were tested. Goal-cost
filtering ran again for each read. After 32 rejected geometric leaves, an indexed
goal-aware query resumed the same emitted canonical prefix. This relies on the
current box predicates being monotone under containment and the goal predicate
refining the geometric envelope. Cache metrics remained private to the experiment.

Across the heavy cold/warm pair, direct canonical queries emitted 14,336,000
geometric entries. Goal-independent uncached queries emitted 17,033,524. Sharing
prefixes reduced that to 14,761,190, with 28,832 stream hits and 44,230 indexed
fallbacks. The shared catalogue recovered some duplicated work but still exceeded
direct query emissions and paid canonical-ordering overhead. Preserving goal-aware
indexed rejection is a prerequisite for revisiting this structure. This prototype
reused successor retrieval; it did not implement route-search-directed expansion
or a complete incremental lazy physical planner.

**Target-independent witness decomposition.** A separate catalogue reused source
projections, centre witnesses and reach-boundary witnesses. The goal witness stayed
second and was recomputed under the current query. Exact source coordinates,
model snapshots, geometry ownership and fresh result positions protected reuse.
The original six-argument `landingCandidates` generator remained intact. The flat
65,536 source/face quota recorded 1,706,032 hits, 131,072 creations and 11,082,578
uncached calls across cold/warm. Most requests bypassed the full catalogue after
admission filled. Combining it with shared prefixes did not improve total time.

A fairer cache admitted 4,096 sources with 16 FIFO faces each, keeping the same
maximum retained pair count. It recorded 1,250,664 hits, 10,091,798 creations and
1,577,220 uncached calls. Broader admission produced more materialization churn
and fewer hits than the flat catalogue. Retry requires evidence of materially
better source/face locality or reusable regional primitives; neither admission
counts nor nominal cache coverage established a speedup.

**Union of complete-motion-family cost domains.** For finite prefix bounds, the
prototypes enclosed corrected feet and boundary projection in padded boxes, then
used `min(jumpLowerBound, wholeRunOffLowerBound)` plus source/goal travel bounds.
They reused `createMotionBounds`, included witness-rounding padding and preserved
the supported-uphill-run-off fallback. They apply to complete nonterminal motions.
No bound for a full jump was applied to an earlier airborne terminal hit.

Entry-level filtering charged each neighbor and excluded 564,716 bounding faces
before the existing bucket test. Some would also have failed the older bucket
bound. Aggregate retained candidates fell 9,258,772 to 9,005,418 (2.7%), while
uncached shortcut trajectory attempts rose 12,476 to 13,076 (4.8%). Removing
representatives let other witnesses reach validation without improving the result.
The node-level variant retained 9,429,814 candidates and attempted 12,898 uncached
trajectories. All variants still charged 14,336,000 neighbors. Local elimination
therefore did not translate into less total search under the current refill and
ranking policy. Stronger run-off bounds require a supported launch-prefix domain;
a seed-height ballistic restriction would repeat the previously rejected error.

### Validation and retained state

Focused checks included eight bounds tests, seven reachability tests, candidate
and triangle-domain enclosure cases, 24 small-scene query comparisons, and the
existing frontier resume/bound-widening/action-revision tests. Witness catalogue
checks covered 576 deterministic cases, source/goal/model changes, FIFO eviction,
admission caps and returned-position mutation. Family bounds were checked against
80 accepted jump/steering/overspeed/uphill-run-off motions and 24 small scenes.
Scripts, logs and source manifests retain their individual scopes.

One experimental full SDK run passed 274/275 tests. The failure was the existing
reused-versus-fresh complete-result comparison, because newly returned cache-work
counters depended on prior preparation. The implementation moved those counters
to the research hook. The unchanged regression then passed in the focused 21-test
jump-planner/catalogue run. No post-fix full-suite pass is claimed for that discarded
prototype. Final runtime and test files were restored byte-for-byte to `66dbd52`;
only these English records change in the final checkout.

The 20% remaining-cost objective is still unmet. The retained heavy cold total
remains 89.654 s, 56.6% of alpha.70's original control. The next structural gap is
search-driven physical successor generation over owned support regions, including
support-aware run-off domains and walking-dominance evidence. It must preserve
nonlocal/relay/interior/backward possibilities, directed passages, holes and exact
entry state. SCC identity alone cannot certify a cheap walking replacement.
Complete coarse/detail ownership, route-driven physical expansion and L-GLS repair
remain unimplemented; these failed retrieval/decomposition experiments do not close
them. Learned ranking and resource-planning redesign were outside this round.


## 2026-11-11 broadened algorithm proposals after structural ablation

The user subsequently invited reinforcement learning and evolutionary algorithms
for the next phase. This supersedes the historical restriction to non-learning
structural trials. The implementation remains `66dbd52`, with no new solver run,
training result or accepted algorithm in this research/update pass.

Primary references were checked for the following proposed roles. Project-specific
adaptations and their expected usefulness are hypotheses, without transferred
speedups or convergence guarantees from the source domains.

- [Hansen's CMA-ES tutorial](https://arxiv.org/abs/1604.00772) describes stochastic
  optimization of nonlinear, nonconvex continuous objectives. Proposed use is a
  bounded optimizer over supported endpoint coordinates and existing continuous
  steering/run-off parameters, with discrete region/control choices handled at the
  proposal level.
- [Sample-efficient Cross-Entropy Method for Real-time Planning](https://proceedings.mlr.press/v155/pinneri21a.html)
  supplies an iCEM comparison for sample-based trajectory optimization. It is a
  neighboring black-box optimization method in this comparison. Its published
  sample reductions do not predict this project's end-to-end runtime.
- [Leveraging Experience in Lazy Search](https://arxiv.org/abs/2110.04669) learns
  edge selection through imitation of oracles in a search MDP. It motivates an
  imitation warm start for learning search decisions. The proposed project policy
  targets region-pair/control generation and budget allocation earlier than its
  edge-evaluation setting.
- [HOLO-MPPI](https://arxiv.org/abs/2606.16480), a 2026 preprint evaluated in driving,
  combines learned high-level proposals with online stochastic control refinement.
  It supplies a hybrid design reference. Our existing analytic motion model can
  supply evaluation without adopting that paper's learned dynamics.
- [CMA-MAE](https://arxiv.org/abs/2205.10752) studies quality-diversity optimization.
  It motivates retaining diverse motion proposals across landing/control niches
  if a single search distribution collapses to one unhelpful route family.

The first proposed ablation is current solver versus continuous black-box local
search versus learned high-level selection versus their combination. Parameters
and policies must act before mass surface-pair enumeration. Reward/evaluation
should account for completed-route quality and actual computation, with enough
credit for relay and temporarily away-from-goal motion. Existing failure logs need
scope-aware labels and decision-level traces. Training and online inference costs
must be reported under their distinct measurement scopes.

Every accepted route retains exact physical/model/resource validation. Learned
predictions do not supply certified admissible bounds or permanent rejection of
unknown region connections. Resumable exploration/fallback must be charged to the
runtime objective. Feasible output, coverage under a finite budget, and preservation
of reference route quality remain separate checks. No current evidence establishes
that these new families will reach 20% remaining cost.

## 2026-11-11 solver contract extraction, alpha.77

Ganglia now owns physical-window strategies, goal-local support refinement and
continuous route composition. Atlos retains resource execution and game-specific
adaptation. The prepared solver separates scene facts, movement/search config and
query data; same-scene batches remain whole submissions with adapter-owned
scheduling. Moving-support display semantics are explicit route data.

The fixed 50 ground-query workload was run in three fresh Node v26.13.0 processes
per implementation. Before batch throughput: 5.682, 5.631, 5.814 queries/s; after:
5.854, 5.790, 5.903 queries/s. Medians were 5.682 and 5.854 queries/s. All six runs
preserved input hashes, complete route/connection result hashes and truncation
flags across single and batch modes. Preparation and input I/O were excluded;
there was no completed-route cache. The throughput difference is not claimed as
an optimization. This workload excludes physical-window scheduling and goal
refinement; their behavioral regressions are covered separately.


## 2026-11-11: physical-query orchestration and browser transfer seams

The alpha.78 physical solver accepts normalized geometry, movement and device
facts. Stage policy, device feasibility, moving support, placement fallback and
route annotations moved out of the extractor adapter. Existing behavior fixtures
moved with their owning algorithms. World uses its own IPC worker and keeps game
source validation and file loading in the resource adapter. The CLI delegates to
the same adapter and prepared solver.

The fixed 50 map02 ground-query workload ran five times before and after on Node
v26.13.0. Batch throughput medians were 6.012610 and 6.117068 queries/s respectively
(+1.737%). All single and batch outcome hashes, costs, movement counts and
truncation flags matched the baseline. Final source SHA-256:
`b5f4d5d4bdcb188046819f9afe017c31d45a05840fa40e8d7b7250ecebe4b6ae`.
Reports are retained under `.local/research/atlos-service-seams/` as
`before-1..5.json`, `final-1..5.json` and `solver-summary.json`. Preparation and I/O
are excluded and no completed-route cache is used. This corpus measures the
surface-action adapter; physical orchestration and special supports have separate
behavioral coverage, so these numbers do not establish their throughput.

Ganglia checks passed 320 tests. World checks passed 59 browser-module tests and
11 Node server/worker/network tests. The extractor's physical-query and device-adaptation
fixtures passed 23 tests after the prepared-solver migration. These counts bind
the inspected implementation; further changes require focused revalidation.

The browser workload fixes scene/package binding, targets, camera poses and display
configuration. It measures scene and routing clients across cold/warm browser
caches. Backend prewarming is recorded outside the measured browser session so
route-cache state does not silently change the stream-loading observation window.
HTTP Range fallback counts the full received response. Network visibility gaps
remain unknown rather than zero. Logical blob categories retain mixed/coalesced
request overhead rather than attributing it arbitrarily to geometry or textures.

Review additionally bound browser queries and responses to the catalog generation,
source and supported fully-enabled state. The physical prepared solver preserves
following-placement truncation in its top-level diagnostics. Preparation-slot
invalidation has one Ganglia owner; the extractor retains decoded-file identity
and budget policy. Online IPC carries validated resource fields instead of CLI
arguments. Cancelled CDP reads retain observed response headers and compressed body
bytes; unavailable measurements remain unknown. The fixed corpus does not exercise
following-placement truncation; a focused behavior test verifies it independently.

The final browser replay completed five cold and five warm sessions with the same
route cost (2.316174 s), no streaming failures and empty work queues on completion.
Median observed CDP network bytes were 499,887,177 cold and 492,342,284 warm;
median client-observed decoded response bytes were 508,292,043 and 498,960,719.
Every session contains one aborted catalogue read without a complete CDP length,
so total network transfer stays unknown and observed network bytes are a lower
bound. Query plus repeat-query responses total 30,460 decoded bytes per session.
Backend preparation took 64.409 s outside the measured browser sessions; both route
reads report completed-result cache hits. These latencies do not measure fresh
solver throughput. Browser/source binding:
`06a41a04f1a89793f884f8035d077778c69dd3dcb14da3d8ce2681524768e66e`.
The full Atlos test command passed 1,237 tests; World browser/worker and extractor
type checks and source-only World build passed. New client, worker, binding and
measurement modules pass lint. Full Atlos lint remains blocked by existing unsafe
JSON, old test and configuration-project diagnostics; old-source comparison found
no added diagnostics for the changed modules. Full Atlos check is not reported as
passing. The local spec retains that unresolved acceptance item.

## 2026-11-12: prepared solver and resource-host separation, alpha.79

The ordinary physical factory no longer accepts effort, cache slots, raw result
callbacks or diagnostic maps. Per-query events share `RouteResult` with the final
return and expose cooperative cancellation. Grounded targets and support boxes
survive that seam. Resource hosts use a dedicated integration entry point with an
opaque preparation and Ganglia-selected serialized work. The host consumes a plan
for resource loading and foreground/background scheduling; it does not select the
algorithm phase. Whole-workload batch submission and its implementation-owned
scheduling contract remain unchanged.

The game adapter prepares scene resources and a structured query, retaining source,
profile and selection checks. CLI request-file reading and atomic output are
outside it. Online IPC no longer writes a request JSON file. Coverage calculation moved from World into Ganglia. Call-site inspection found
that the legacy proposal-ranking and cross-origin attempt helpers were used only
by isolated tests; those dead implementations and tests were removed. The active
window strategy remains in Ganglia.
Resource jobs, worker ownership, memory policy and persistent result files remain
in World. The routing adaptation and its fixtures have their own owned patch.

Review consolidated result normalization in the prepared implementation, removed
a historical comment, and found that walking early returns bypassed waypoint
validation. A failing CLI behavior test reproduced malformed waypoints being
accepted. One shared validator now checks those inputs before work selection.
The existing interruption fixture uses an independent completion barrier so it
continues to detect early candidate publication, interruption and cached resume
without depending on the solver's private output path.

Final core validation passed 320 tests plus formatting, lint and type checking.
World's full suite passed 1,235 tests, excluding two deleted tests of unused helpers;
its browser/worker and extractor type checks and source-only build passed. Physical
CLI/device/cache fixtures passed 24 tests, including the malformed-waypoint case.
New worker/task adapters pass focused lint; pre-existing Atlos lint failures remain
outside this change and full Atlos check is not reported as passing.

The same 50-query map02 ground/jump corpus ran five times against alpha.78
(source `b5f4d5d4bdcb188046819f9afe017c31d45a05840fa40e8d7b7250ecebe4b6ae`) and five against final alpha.79
(source `c666cc58700f61d6d201756e2d7dcb27b7f70549eed4ffc7b8ff15c2952dd055`), on Node v26.13.0. Median batch throughput was
6.135274 and 6.151580 queries/s (+0.266%). All ten runs
preserve single and batch outcome hashes and truncation flags with identical input
hashes. Input I/O and scene preparation are excluded, without completed-route
caching. These figures measure the surface-action adapter; separate physical
behavior fixtures cover host preparation and window orchestration. This difference
is not claimed as an optimization. Reports are retained under the local
`atlos-service-seams/alpha79/` evidence directory. Pre-cleanup measurements have
their own filenames and are not included in the final median.

The final integration replay passed five cold and five warm browser sessions, with
route cost 2.316174 s retained, no resource failures and empty stream queues.
Browser/source binding: `afe000d3d79c1b5fbd5cd4753e4c5d1536fbfa524f67473ed5a401c702f73b4d`. Median observed CDP bytes were
500,393,313 cold and 491,734,579 warm. Each session retains one aborted
catalogue request with an unknown complete length, so those network figures are
lower bounds. Backend prewarming is recorded separately (58.430 s); it does
not measure fresh-query throughput. The input-cache adapter releases opaque
preparation after oversized/non-retained queries, preserving its memory policy.


## 2026-11-12: Atlos lint acceptance

World's backend, candidate worker and Vite/Vitest configurations now share type-check
coverage. Exporter JSON boundaries use declared artifact types; progress/cache objects
are narrowed before use. Async test fixtures and closure-owned renderer cleanup retain
their behavior. Lint also exposed stale font-scope ownership during ref replacement;
a behavior test reproduced the failure and passes with the current scope captured.
No lint rules were disabled and no Ganglia algorithm or dependency version changed.

Full Atlos `check --source-only --skip-subset` passed 1,236 tests, browser/worker,
extractor and other workspace type checks, ESLint (747 files, zero errors/warnings)
and Stylelint (97 files). Source-only World build passed. One cold and one warm
map02 browser replay completed with route cost 2.3161737031566245, no failed streamed
resources and drained stream queues. This checks integration, not fresh-query throughput.
Source binding: `04f43d8c58c4098a157526c344318e473980c41766548e0d253e248f5704e268`.
Local evidence: `atlos-lint-check.log`, `atlos-lint-build.log`, `atlos-lint-world.json`
and paired screenshots under `.local/research/`. Full private-font packaging remains
outside source-only validation. This resolves the earlier full-lint acceptance gap.
The implementation and ownership record remains accurate without a behavior update.


## 2026-11-12: headless scene-query orchestration, alpha.80

The scene prepared module now owns global proposal/physical-window orchestration,
query-local transfer and arrival exclusions, retry budgets, retained target approaches,
and terminal selection/composition. World supplies resource operations and display
formatting. HTTP polling observes independently progressing work. Removed World window
wrappers and their isolated tests; their behavior is exercised at the Ganglia scene seam.
The game adapter forwards per-query search configuration through its owned patch.

Dual-axis review found and corrected lost local-discovery truncation, repeated close
returning before work drained, partial/full outcome comparison, and missing provenance
for the game adapter's resolved Ganglia copy. The file adapter now refuses mismatched
kernel source before measurement. Proposal results use discriminated variants.
Focused regressions cover query-local rejection, partial retention, terminal composition,
cooperative cancellation, concurrent batch ordering, draining close and truncation.

Final checks passed 328 Ganglia tests with formatting/lint/type checks, 1,234 Atlos tests
with full source-only check (ESLint 745 files, zero errors/warnings; Stylelint 97 files),
source-only World build, and 21 physical CLI/cache tests. Private-font release packaging
is outside source-only validation. Atlos HTTP behavior tests retain candidate publication,
physical failure, alternative arrivals and terminal result caching.

The original 50-query surface-action corpus ran five times on the pre-change source
`c666cc58700f61d6d201756e2d7dcb27b7f70549eed4ffc7b8ff15c2952dd055`
and five on final source `d536200c8a671a46f0e138cf57b1a5fd770eb0678f0eee27d3fa7a3ccc09627a`,
on Node v26.13.0 with a 6 GiB heap. Input hashes, route outcome hashes and truncation
flags match across all ten runs. Median batch throughput is 6.170057 before and
6.063405 queries/s after (-1.729%); the observed ranges overlap. This is a small measured
slowdown, not evidence of an improvement; the surface-action algorithm is unchanged.
Reports are `scene-core-before-1..5.json`, `scene-core-after-1..5.json` and
`scene-core-summary.json` under `.local/research/`.

The full scene file-adapter workload used the same 50 ground start/goal pairs with a
separate, larger physical snapshot (bounds [-1408,-1696] to [-1280,-1536], 202,311
surfaces) so rounded windows do not exceed retained coverage. Existing verified data
was preserved. Dataset provenance is stored beside `.local/data/scene-map02/`.
The game build remains `2954fa80-23c1-1579-2b22-4ecfd6d70418`, content
`23821a7611be5c0478dc4695d96fd74a`; no device file is available for this workload.
World and resource HTTP processes were stopped and neither port listened during the
run. All 50 singles and 50 batch results are complete, including 81 jump segments
per pass, with identical outcomes and truncation flags. Single median is 16.964741 s,
P95 33.892929 s; total single time is 978.266221 s. The serial batch took 996.037343 s,
0.0501989 queries/s. This establishes a new full-query baseline; it is not directly
comparable to the surface-action timing because it includes global candidate expansion,
lazy resource preparation, target-side validation, windows and retries.

Full-query kernel binding: `ed1986c9706bee12b956686cbaea513b4166847368374e8c74e93c0add3199b8`;
game adapter binding: `d6f70ecb86f70a96f56849ae1ff4bc851b33041b49286bf4dd86c14871781f2c`.
`scene-final-50.json` retains input/code hashes, actual resolved kernel path, per-query
results and inclusive phase timers. Single/batch own independent preparation; completed
routes are never cached. Batch accepts bounded parallel lanes with independently leased
cache owners; real-data acceptance here used one lane, while concurrency behavior is
covered by the scene seam fixture. The interrupted pre-restart run produced no report
and is excluded from these measurements.


## 2026-11-12: one prewarmed full-scene batch benchmark

The maintained benchmark is now only `pnpm benchmark:full`. Core benchmark loading,
the separate scene command and individual-query timing were removed; the 50-query
ground corpus and whole-batch scheduling contract remain. The file adapter eagerly
reads and decodes a fixed memory snapshot, supplies it directly to the game adapter,
and retains lane-local physical preparation. Timed queries perform no dataset file
reads, stat checks or JSON decoding. Query-specific normalization and any remaining
lazy computation remain timed. One unmeasured full batch prewarms the same solver;
measurement recomputes the whole workload without completed-route caching.

Benchmark seam tests cover whole-batch warm/measured submission, result ordering,
cleanup on failure and partial/full outcome differences. Full Ganglia check passed
328 tests plus formatting, lint and type checking. Dual-axis review had no required
findings. The actual game adapter was inspected to confirm that its contextual input
reads exclusively use the supplied in-memory begin/read/preparation implementation.
No solver source, algorithm or Atlos integration code changed.

The 50-query real-data run on Node v26.13.0 and a 6 GiB heap passed: all routes are
complete, including 81 jump segments; warm/measured outcome hashes and truncation
flags agree for all 50 inputs and match the retained alpha.80 full-scene results.
Input loading/decoding/verification took 0.534376 s and initial candidate preparation
0.710712 s; the full prewarm batch took 892.563280 s. Those durations are excluded.
Measured batch wall time is 849.194857 s, throughput 0.0588793 queries/s. This is a
warm-prepared baseline with different timing/cache semantics from the earlier run;
it does not establish an algorithm speedup.

Report: `.local/research/full-batch-50.json`; source binding
`0a65ce00c10b0d878c0283aad10e431544bf625a2490a083f68479e0101819cb`.
Kernel and dataset bindings are unchanged from the alpha.80 scene run. The report
records all consumed file hashes, adapter/source identities, prewarm duration,
measured inclusive phase timers and per-query outcome/truncation comparisons.
The real-data acceptance uses one execution lane; configured batch concurrency remains
available. A one-query batch validated the memory adapter before the full run.


## 2026-11-11 random-window collection and local policy ablation

The user requested the next algorithm experiments and emphasized broad random
map/level data before learning weights. This pass adds maintained research tools in
`scripts/research/`, with five contract tests, without changing `src/`, package
exports, alpha.76, the Atlos installed artifact or generated extractor. The runtime
remains `66dbd52`. These tools implement basic diagonal CEM and logistic witness
scheduling for supplied local region pairs. They do not implement a full learned
route planner, reinforcement learning or iCEM.

### Data and source binding

Local artifacts are under
`/Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/learned-search-20261111/`.
`broad-inputs.json` names the 26 retained ground/collision/movement windows;
`broad-corpus/` retains per-window metadata and individual JSONL decisions.
`source/` and `source-manifest.json` archive source/tests from base `3c2b666` plus
the research implementation. Each window records all input SHA-256 hashes and the
resolved `.mjs` source manifest. Collection and online validation use source digest
`b07ab9a8429acf1b602cc856408ed84249948d0dcecd96103f8958acbad4a01c`.
The final analyzer subsequently removes implicit control proxies from its
geometry-only feature ablation; the archived collection/runtime source remains
the actual measured version. These ignored local inputs/results are not delivered
by an ordinary clone.

The physical source is build `2954fa80-23c1-1579-2b22-4ecfd6d70418`, content
`23821a7611be5c0478dc4695d96fd74a`, with default movement input
`eeedcd2afd4b0ca250a63cc77e293a6920efe301e3d83f45a41e1089bdaa8bf6.json`.
The collector checks equality of scene, source, selection and body profile between
inputs. The windows retain their actual scene selections and incomplete coverage;
they do not acquire complete-map evidence from sampling.

The 26 windows carry 14 distinct level tags: map01 levels 001, 002, 003, 005, 006,
007 and map02 levels 001, 002, 003, 004, 005, 006, 009, 010. Tags come from unanimous
exported point labels within each ground build rectangle, using point release
`cf47053cc507555d`. They describe the sampling window, not native per-face level
ownership. Two windows per tag were preferred when their centers were at least
96 m apart; only one eligible window was found for some tags. No inferred level
ownership is used for physical passage.

| Split | Region pairs | Tested witnesses | Useful witnesses | Pairs with a useful witness |
| --- | ---: | ---: | ---: | ---: |
| Train: ten map01 windows, excluding level 002 | 1,800 | 72,000 | 855 | 293 |
| Validation: both map01 level 002 windows | 360 | 14,400 | 174 | 62 |
| Test: all fourteen map02 windows | 2,506 | 100,240 | 1,385 | 457 |
| Total | 4,666 | 186,640 | 2,414 | 812 |

Seed `20261111`, 180 requested episodes per window and 40 proposals per episode
were fixed before the broad run. Nine approximate distance/rise strata limit
flat-adjacent bias. One sparse window supplied 166 rather than 180 pairs; the
shortfall is retained, not filled by duplicate easy cases. Source/target regions
are 6 m XZ / 3 m Y support sampling cells. Triangle-area sampling avoids weighting
small detail triangles equally with large support. The continuous CEM chart crosses
triangle-selection CDF boundaries and is therefore piecewise continuous.

Every candidate uses the existing `standingFoot`, direct jump/split or supported
run-off, wall and complete trajectory checks. Actual ground tracing can reject a
slower flight as walking-dominated. `valid` means a useful local primitive under
these checks; it does not label a whole route or establish resource feasibility.
All five control classes remain sampled. No unsuccessful episode labels an
untested control or region connection impossible. Regions grant no ground
connectivity. Terminal hits, boosts, waypoint controls and relay composition are
outside this initial corpus.

The earlier eight-window pilot remains in `corpus/`, `replay.json` and
`weights.json`. The broad corpus supersedes its sample-size conclusions rather
than deleting that evidence. Summed broad collection wall time was 160.832 s,
including input loading/preparation; maximum per-process RSS was 1,755,584 KiB
(about 1.67 GiB). Node v26.13.0 and a 4 GiB heap were used, without function timing
hooks or CPU sampling. Initial SDK verification briefly overlapped collection;
this collection duration is an acquisition-cost observation, not a solver benchmark.

### Learned scheduling and feature controls

Training standardization and logistic weights use only the 72,000 map01 training
witnesses. Map/level IDs, absolute coordinates and validation outcomes are not
features. The full model took 0.833 s to fit in the first broad analysis; analysis,
data acquisition and later diagnostic model fits are separate costs. Fixed model
and CEM settings were not tuned against map02. Training positives are sparse
(855/72,000); ranking evidence must not be read as calibrated physical probabilities.

The full learned order found a useful primitive in 429/2,506 test pairs within
eight validations, versus 204 for the local reference heuristic. Control-only
learning reached 424. Paired full-model changes at that prefix were 248 gains and
23 losses. At four validations, full/control-only/reference counts were
362/360/118; at sixteen they were 453/451/359. All forty original witnesses remain
available, so a finite-prefix loss is not cached as a rejected region connection.

The training controls explain most of the gain: out of 14,400 trials per control,
direct jumps supplied 709 useful witnesses, run-off 101, and splits 0.25/0.5/0.75
supplied 14/12/19. A strong control-priority baseline is necessary before attributing
the benefit to geometric learning. The first diagnostic geometry-only model removed
explicit drop/split features but retained nominal duration/reach ratio, which still
encode the control. Its initial table in `broad-replay.json` is superseded by the
corrected feature analysis that also excludes those two proxies. The full trained
model and measured online policies are unaffected by that diagnostic correction.

The corrected `corrected-replay.json` gives geometry-only test discovery counts
139/228/354 at 4/8/16 validations, versus reference 118/204/359. At sixteen, its
27 gains and 32 losses are a small net regression. Re-fitting the full model during
that correction reproduced its weights, normalization and bias exactly. The
geometry-only model supplies no stable independent improvement across these budgets.

### Four-arm physical execution and repeated timing

`heldout-inputs.json` selects the first available window for each of the eight map02
level tags, independently of its success count. Both `ablation-a/` and `ablation-b/`
use seed `20261112`, 90 requested episodes/window and 40 proposals/arm. A sparse
window supplies 81 episodes, giving 711 pairs per run. Each arm physically executes
its proposals again, without replacing validation with recorded labels. Execution
order rotates by episode. Source, inputs and model hashes match across both runs;
all repeated candidate identities, validity, durations and accepted motion hashes
match exactly. `comparison.json` records the aggregate and paired comparisons.

| Arm | Pairs found in first 8 / full 40 | Found including fallback | Full warm work, runs A / B (s) | First-hit work on 149 common reference successes, A / B (s) |
| --- | ---: | ---: | ---: | ---: |
| Fixed random pool + nominal local heuristic | 72 / 149 | 149 | 16.355 / 16.592 | 1.196 / 1.262 |
| Basic diagonal CEM | 61 / 141 | 170 | 32.604 / 33.007 | 2.015 / 2.028 |
| Learned ordering of the same fixed pool | 135 / 149 | 149 | 16.396 / 16.633 | 0.368 / 0.372 |
| CEM + learned ordering within populations | 61 / 141 | 170 | 32.596 / 33.090 | 1.830 / 1.851 |

Full work includes measured generation, scheduling, physical validation and the
complete reference fallback. CEM/hybrid validate 80 witnesses per pair including
fallback, while reference/learned validate 40. The first-hit column includes
generation and uses the same 149 reference-successful pairs for every arm. CEM's
fallback is charged before a late hit. This avoids comparing different survivor
sets. The unpaired additional CEM successes are represented in the coverage column.

These are warm geometry experiment times. Source/input reads and preparation,
training, JSON output and the initial per-episode reference labeling pass are
outside the timed policy columns. The initial labeling pass warms geometry; no
finished-result cache is used. These columns are not cold extractor, whole-query
or HTTP timings, and their denominator is not alpha.70's 158.363 s heavy command.
Arm order and the two sequential repeats reduce some systematic bias but do not
isolate OS/JIT/GC variation or establish scene-wide performance.

Learned scheduling reduced common-pair first-hit work to 30.8%/29.5% of this local
reference while leaving full-pool work essentially unchanged. That scope does not
reach the production 20% objective. The feature controls above show that most of
the early advantage is control selection, not learned geometry. Retain the full
pool and compare a strong non-learning control-priority policy before considering
production learned scheduling or smaller budgets.

CEM's own 40-proposal pass finds fewer pairs than the fixed reference, and complete
fallback roughly doubles work. Its union gains 21 pairs without losing the original
primitive best-duration evidence. Those additional successes do not isolate an
evolutionary benefit from simply spending forty extra random proposals; an equal
80-proposal random control was not run. The hybrid does not improve full coverage
over CEM here. No new default is promoted from these trials. Best primitive duration
and preserved local coverage are not complete-route quality/resource evidence.

### Validation and limits

All **277 SDK tests** passed on Node v26.13.0, including five new research contract
tests for projected-area sampling, witness-only labels, finite CEM/fallback coverage,
snapshot/profile matching and level-split leakage. Subsequent analyzer-only feature
mask and paired-summary changes were exercised against the recorded data; the final
maintained paired sums matched an independent calculation. No further full SDK run
is claimed. No Atlos files changed, no artifact was replaced or published, and no
remote push or 113-request replay was performed.

The 20% remaining-cost target is still unmet. A local fixed-random-pool heuristic
is not the current solver baseline, and primitive validation counts do not quantify
its dominant spatial enumeration cost. Production use still requires a region-pair
policy before broad face enumeration, entry/resource/goal/boost/relay composition,
resumable exploration and complete-route comparisons. The useful result of this
pass is reproducible data and bounded policy evidence, not a promoted solver speedup.


## 2026-11-11 terrain and spatial preparation pass

The user clarified that optimization covers the complete pipeline, including
terrain/support preparation, rather than only action search. The retained changes
start from Ganglia `9f9699b` and Atlos `d7ca0b63`. This pass does not replace the
installed alpha.76 artifact. The source integration manifest currently binds noclip
`b54b1dcb7d01a36910c7ced1b0206e6b0b06249b`, protocol 102; older profile results
retain their original source/protocol bindings.

### Original costs and scope

The original candidate control spent 65.673 s preparing and 9.040 s searching
(74.713 s total). Alpha.70's lazy-transfer change reduced preparation to 8.480 s
but raised search to 38.425 s, totaling 46.905 s and increasing retained memory.
Those historical results illustrate shifted work, not an untouched current control.
The separate ground command took 16.395/3.936 s cold/warm in its historical
lower-overhead control. The detailed ground profile measured 9.041 s in native
`buildPolyMeshDetail` within 18.148 s total; WASM accounted for 58.73% of sampled
ground-detail wall time. These are different containing commands, not slices of
one global total. In the heavy action profile, spatial-query work remains dominant.

Local inputs, frozen sources, reports and manifests for this pass reside in
`endfield-noclip/.research/stage123/terrain-space-20261111/`.
`source-manifests.json` binds every frozen SDK variant and `comparison.json`
retains the actual command reports. The maintained Atlos
`profile-route-stages.mjs` harness executed `--baseline` without function hooks or
CPU sampling, on Node v26.13.0 with a 4 GiB heap. Cold/warm retain that harness's
existing fresh-input/tile-cache or shared-candidate-planner semantics. OS pages,
JIT/GC and system load remain uncontrolled; module setup is reported separately.

Ground uses the retained `detailed-profile-20261110/ground-args.json`: map02,
bounds `[-1376,0,-1152,128]`, 0.15 m cells, 256-cell tiles, terminal scene selection,
the source-bound movement/static-support inputs and local game configuration.
Candidate uses the retained `candidate-input.json`, 640,747 navigation faces and
85 arrivals. Reports record input identities and resolved module source hashes.
Raw records are ignored local artifacts, not included in an ordinary clone.

### Native detail experiments that were not retained

| Variant | Ground cold / warm (s) | Decision |
| --- | ---: | --- |
| Fresh source control | 15.569 / 3.889 | Control |
| Generate native detail output in batches of 64 coarse polygons | 15.246 / 3.547 | No stable native-stage benefit; remove |
| Certified flat height patches with sample distance zero | Failed at the first native tile with a WASM out-of-bounds trap | Remove; not a terrain-impossibility result |
| Same certificate with a large positive sampling distance for flat patches | 16.832 / 3.936 | Output preserved, command slower; remove |

The batching hypothesis targeted repeated native output-buffer growth/copying,
motivated by inspection of upstream
[RecastMeshDetail.cpp](https://github.com/recastnavigation/recastnavigation/blob/main/Recast/Source/RecastMeshDetail.cpp).
It was not a proof that copying dominates the installed 0.44.0 binary. Warm trials
load tile caches and execute no native detail rebuild, so their timing differences
cannot be attributed to native batching. A 256-polygon snapshot was prepared but
not run after the 64-polygon screen failed to establish a useful benefit.

The flat-patch prototype required every compact cell in a polygon's complete
height-patch rectangle and halo to have exactly one span at the same height as
every polygon vertex. Missing/multilayer/different-height cells retained ordinary
sampling. Prefix sums certified the rectangles. The zero-distance attempt trapped
in WASM; the positive-distance retry initialized the outline path and completed.
Only 1,206 of 27,095 coarse polygons were certified flat. Checking and splitting
these limited regions did not amortize its overhead. Both completed native variants
preserved ground/collision content after excluding generator identity strings.
No sampling/coarsening/native-mesh mutation from these prototypes enters `src/`.
Native detail construction remains an open large cost.

### Retained preparation changes and measurements

`geo/build` reuses `createBoundsIndex` to assign source triangles once to selected
padded tile rectangles. It preserves exact inclusive AABB tests and original
triangle order per tile, including padding-only contacts. Each consumed tile drops
its reference list. Native rasterization, detail sampling, height partitions,
clipping and seam semantics remain unchanged. The representation retains a shared
flat coordinate array per assigned source triangle rather than nested triangle
objects re-flattened by every tile.

`geo/surfaces` removes temporary coordinate arrays from 3D portal predicates and
graph distances, preserving the accumulation order, tolerance and traversal order.
Each face computes a rounded vertex key once per used vertex. This is local reuse,
not a persistent topology cache or a changed quantization scheme.

On the global map02 input, an isolated component pass measured portals
2.665→2.267 s and graph construction 1.844→1.158 s, summing 4.509→3.425 s.
Ordered portal and graph hashes matched. That component sample is not a complete
request claim.

| Command / repeat | Control cold / warm (s) | Changed cold / warm (s) |
| --- | ---: | ---: |
| Ground, tile-index-only screen | 15.569 / 3.889 | 15.213 / 3.282 |
| Ground, final source + compatible generator hashing | 15.557 / 3.653 | 15.239 / 3.600 |
| Candidate, first pair | 48.743 / 1.376 | 46.486 / 1.207 |
| Candidate, repeated pair | 45.149 / 1.106 | 45.230 / 1.304 |

Both cold ground comparisons improve about 2%; warm observations vary. The final
tile code additionally releases consumed input lists. Native detail settings and
all ground/collision bytes other than the expected `generator` signature match.

Candidate preparation measured 7.921→7.093 s and 7.778→6.984 s, about 10% lower
in both comparisons. Search measured 39.987→38.576 s and 36.599→37.406 s. Complete
cold time improves 4.6% in one pair and is 0.18% worse in the other; warm candidate
time also changes sign. There is no stable complete-candidate-request speedup.
Unlike the old eager-to-lazy redesign, the new code does not move enumeration into
search; source inspection and identical result/graph evidence support that limited
mechanism, while elapsed search variation remains visible.

Cold candidate RSS snapshots were 2.443→3.016 GB and 3.377→3.162 GB; heap-used
snapshots were 3.035→2.617 GB and 2.601→2.558 GB. These are final snapshots, not
isolated allocation or peak-memory measurements. They do not establish a uniform
RSS benefit. All cold/warm candidate outputs match after removing timing/memory
diagnostics, including origin, score, path, points, transfer keys and unresolved edges.

### Generator signature integration and checks

The first modular-source ground replay stopped before a valid build because the
Atlos generator signer still looked for flat `src/support-field.mjs`. Initial
isolated SDK variants supplied research-only flat-path links; fresh run directories
prevented cross-variant cache reuse. That compatibility workaround did not hash
`geo/build` itself, so its old signer is not a safe production solution. Actual loaded
source manifests, independent output comparisons and fresh caches bind those screens.

Atlos's owning `extractor.patch` now recognizes the stable public build forwarder
and hashes it plus `geo/build.mjs`, `geo/support-field.mjs`, `geo/clip-surface.mjs`
and `geo/bounds.mjs`. The new tile selector is a physical generator dependency.
Flat installed packages keep their existing identity byte-for-byte, independently
verified as `24db3a5799f71793059c23664787c62cef7eec9a903b69eb9f8dcb67c42b9e8a`.
No route-only implementation is added to the physical generator signature.

The final ground pair uses this integration fix through an isolated load hook.
The main generated extractor is not edited. The maintained `noclip.mjs prepare`
also successfully reapplied all five owning patches to the verified upstream
archive in a separate scratch tree. Tests and lint use that real prepared tree
with existing dependencies linked, rather than weakening module mocks.

All **278 SDK tests** pass, including the new tile-cache input-order/inclusive-
padding regression and existing slope, stairs, gaps, ceilings, stacked floors,
directed intervals and sparse-tile checks. Three actual prepared ground-cache tests
pass, including modular implementation/bounds invalidation. The existing source-
preparation/tamper test also passes. Oxfmt checks pass for the changed integration
files. Focused type-aware oxlint reports no errors and one existing no-shadow warning
at the old test's line 25. Initial lint against detached source files could not
resolve workspace types; the properly prepared tree resolved those environment
errors. `git diff --check` passes in both repositories.

No SDK artifact was repacked or installed, no ordinary physical-action/HTTP or
113-request corpus replay is claimed, and no remote push occurred. The retained
changes reduce preparation work with unchanged tested outputs; the 20% objective
is still unmet. Next work should prioritize the unresolved native detail cost and
region representation/ownership, then measure candidate transfer materialization,
action spatial enumeration, collision and resource costs under their containing
requests. Existing prepared caches, serialization and repeated window setup remain
part of that pipeline rather than disappearing from the accounting.

## 2026-11-11 retained-point repair in progress

The retained `retained-replay-20261111/verified-replay` research run completed all
113 unchanged requests against the alpha.67 control. All resulting routes pass
resource and goal-event checks. The comparison contains 69 equal-cost routes,
29 improvements, 12 increases within the user-approved 5% tolerance, two repaired
terminal-event contracts and one larger regression (`0frHUCx`, 18.919→20.966 s).
The old invalid terminal reference remains separately classified.

The working implementation retains envelope pruning and resumable frontiers. It
interleaves region boundary seeds, gives direction queries region-chain proposals,
returns up to four distinct frontier components per batch, and prioritizes causal
entries by geometric approach score under one shared fallback quota. Remaining
entry quota can improve the complete final route. Grounded airborne-goal completion
now records an exact terminal event and preserves it through scheduling and detours.
The four previously unavailable requests and the 180-second timeout all complete.
Cases 004/005 cost 30.082/14.149 s, 025 costs 19.200 s, and 052/061 cost 17.591 s
(+3.54% versus alpha.67). The first implementation passed all 282 SDK tests.

The larger quality regression comes from local refinement targeting the incumbent
before broad shortcut improvement. A focused current-incumbent refinement trial
reduces `0frHUCx` to 15.692 s. That adjustment subsequently completed the run in
`retained-replay-20261111/refined-replay`; the final validation section records
its remaining quality regression and the retained correction. Diagnostic legacy-enumeration variants were not adopted.
Source variants, requests and intermediate failures remain in the research root.


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


## Main integration into the TypeScript scene solver, 2026-11-12

Main through `1a617c9` contributes cross-map research tools, terrain preparation
optimizations and retained-route search repairs. The merge ports their executable
changes into the owning TypeScript modules and research scripts; it retains pnpm,
source-only package exports and the single full-scene batch benchmark. Research
scripts are included in type checking and lint. The integration package is alpha.81.

The old following-box footprint fixture admitted a fully supported placement at
`[12, 0, -0.2]`; richer search now finds a valid route through it. The corrected
fixture cuts a 0.1 m hole across the target-side floor under the candidate box
footprints. It retains the incomplete-route and unsupported-placement assertions.
Temporarily removing the footprint support guard makes the corrected test fail;
the guard remains unchanged in the delivered implementation.

Ganglia format, lint, type checking and all 338 tests pass. The six directly
affected suites pass 81 tests. Both code-review axes found no required behavior
or ownership fixes. Atlos source-only checks and World production build pass
with the pinned alpha.81 source. The initial sandboxed Atlos test run failed to
listen on loopback with EPERM; the permitted loopback rerun passed. The World
build retains its existing large-chunk warning. A synthetic research-policy
analysis also completed. Raw integration evidence is under
`.local/research/main-merge-*`; benchmark results must be read with their recorded
source hashes and input bindings.

The fixed map02 50-query full-scene batch completed with 50 complete routes and
87 jumps. Every measured outcome and truncation flag matches its prewarm result.
Against the pre-merge alpha.80 run, 31 route outcome hashes are unchanged,
17 routes have lower modeled cost, and two have slightly higher cost
(at most 0.041%). Inputs remain
the verified map02 scene export bound to build
`23821a7611be5c0478dc4695d96fd74a`. Input loading took 0.545 s and the unmeasured
whole-batch prewarm took 899.411 s. Measured batch time was 929.906 s, or
0.053769 queries/s. The previous identical workload recorded 849.195 s and
0.058879 queries/s; this single comparison observes an 8.68% throughput decrease,
without establishing whether it is strategy cost or runtime variation. No claim
of a performance improvement is made. Every query retains a bounded-search
truncation flag; route completeness does not establish optimality.

Measured source SHA-256 is
`7b1bd14b6956ca9a02920fe40dbea716ee6a09bbd290b09b9020a7c858b47fa0`
and resolved kernel SHA-256 is
`c9443708b4d7498ae5eb8179465007dcd3fad3f0a4156fa019c7fa1fe7d0af5e`.
Raw report: `.local/research/main-merge-full-50.json`.


## Interface-focused tests and native imports, 2026-11-12

Alpha.82 replaces relative module specifiers with the package-local `#@/` alias.
Node and TypeScript resolve it through `package.json#imports`; Atlos consumes the
same mapping from the pinned source archive. Public exports remain unchanged.
A structural AST comparison of all 60 source modules found no non-import syntax
changes. Source-reading URLs retain their filesystem-relative meaning.

Test cleanup removes cloned tree/projection implementations, graph/cache object
identity assertions, a fixed floating-point candidate list and a redundant direct
solver comparison. Existing route, collision, resource, cancellation and batch
contracts remain covered. Analytic triangle projections, indexed collision
coverage and bounded spatial diversity replace implementation-specific oracles.
Prepared solver tests now exercise returned-result mutation isolation and explicitly
distinguish unmapped from disconnected goals. Ganglia check passes 329 tests.
Atlos World and extractor type checks, World production build and all 10 worker/HTTP
integration tests pass with alpha.82. The existing large-chunk build warning remains.
The focused verification artifacts use `.local/research/test-alias-*`.

A three-query full-scene batch replay passed through native Node and the packaged
Atlos game adapter. All three results are complete, match their prewarm outcomes
and truncation flags, and retain the corresponding alpha.81 outcome hashes. This
run validates import/packaging integration, not a 50-query throughput comparison.
Data loading and the full prewarm batch remain outside the measurement.


## Fixed ganglia-v1 solver policy, 2026-11-12

Alpha.83 introduces the algorithm-discriminated prepareRouteSolver factory for
scene, physical and surface inputs. GangliaV1Config explicitly declares the current
search, corridor, coverage and scheduling settings without nested search objects
or Pick/Omit-derived policy types. The factory copies, validates and freezes the
policy; the solver exposes it as a read-only property. Queries cannot override
policy. Movement models remain immutable input facts, including PhysicalMovement
in place of the ambiguously named PhysicalConfig.

Scene orchestration carries its fixed solverConfig into resource jobs, and Atlos's
maintained game adapter passes it to physical preparation outside the query.
Atlos and the headless benchmark use the same public factory. The benchmark can
load a complete configuration from --config and records the effective policy.
This does not introduce an alternative algorithm or make v1's phase order,
ranking and internal budget sharing configurable. Its default full-scene settings
retain their existing values. A surface-only solver now uses the same explicit
policy as other adapters, rather than separate implicit defaults.

Ganglia format, lint, type checks and 331 tests pass. Regression coverage includes
caller-config mutation isolation, different fixed budgets across solvers, absence
of query policy fields, and policy propagation through scene resource requests.
Atlos source-only checks and World production build pass; the final archive also
passes all 10 worker/HTTP integration tests. Generated noclip source was refreshed
through its owning patch and preparation command. Evidence uses
.local/research/v1-*; no full 50-query throughput comparison is implied.

The final default-policy three-query full-scene batch returns three complete
routes. Every outcome and truncation flag matches prewarm, and all three outcome
hashes match the corresponding alpha.82 control. The report records the full
fixed ganglia-v1 policy. This is a correctness/integration replay rather than a
50-query throughput comparison. Source SHA-256 is
9a7d3f6d1cf861a67c5365e64a65f8dbf8b0d00b4efb79fc54bf825343ed4041 and resolved kernel SHA-256 is
34ba655ae890945174ccdd6ad20095f86b04c471412625659c3b7114018ac29e.

A second replay loads an explicit JSON policy with zero discovery/improvement
candidates and one global attempt. The effective settings are recorded in
.local/research/v1-no-discovery-result.json; this run is a budget-propagation
check, not a quality-preserving speed comparison.
The zero-budget query returns no-verified-route with truncation, while the default
policy completes the same jumping query. Its measured outcome and truncation flag
also match prewarm. Geometry preparation and walking work still run at zero
discovery budget.


## V1 implementation locality and public contracts, 2026-11-12

Alpha.84 moves the existing algorithm subsystems under src/v1 without an extra
internal directory. Geometry, movement, route and physical/resource contracts
are owned by the outer modules, not inferred from a v1 implementation. The outer
factory dispatches to v1 preparation. Root runtime exports are playback only;
solver runtime exports are the factory and defaults. Resource operations used by
Atlos's adapters are explicit in solver/host, with build/collision kept separate.
There is no public v1 subpath. The benchmark adapter uses the same package exports
as Atlos. Internal runtime imports do not depend on public root/solver barrels.

A structural comparison preserves 283 executable bodies/initializers across the
move and playback extraction. groundBuildIdentity intentionally resolves the
package manifest through the package-local import map; checkout and packaged
identities agree at d5fbc4f1285aa611846e94b7504e20804a9338e7f6b18ed1a2922011aa707b6d.
Unused imports from type extraction were removed. Ganglia checks pass 331 tests
and an additional noUnusedLocals type check passes. Atlos's maintained patches
and source imports are migrated through the host seam; generated cache is rebuilt
from its owning patch. Validation artifacts use .local/research/v1-layout-*.

The final three-query full-scene batch completes all routes, matches all prewarm
outcomes/truncation flags, and retains every corresponding alpha.83 outcome hash.
The adapter loads only public package interfaces. Data loading and full prewarm
remain outside the measurement; this is not a full 50-query throughput comparison.
Atlos source-only checks and World production build pass. Final source SHA-256:
178c4b292358a6ab9dd9f82bd2a6968ff79ae1ddffe5fbfc5a3ff1ed037c4a2d; resolved packaged kernel: 28eccd2b0220bf957d9cf11092f7175179df5870f60a913838672fc23a7d60dc.


## Root solver entry and direct benchmark setup, 2026-11-12

Alpha.85 exposes prepareRouteSolver, gangliaV1Defaults and their caller contracts
from the package root. The solver-focused subpath remains supported for adapters
and existing consumers. The public type-contract check imports the root entry.

The benchmark CLI calls loadScene, prepareRouteSolver and runBenchmark directly.
loadScene in bench/scene.ts returns scene input/resources and metadata; it does
not return a solver-creation callback. The batch timer receives a prepared solver
and owns its closure even on failure. The single-solver timing record is an object
rather than a one-element array. JSON schema 3 records inputLoadMs and total
setupMs separately from unmeasured whole-batch prewarm and measured solve work.
The in-memory dataset snapshot, lane-local preparation, source verification and
whole-batch submission are retained.

Ganglia checks pass 331 tests. Atlos World/worker type checks, all 56 World tests
and 10 HTTP/worker tests pass. World production build passes with the existing
large-chunk warning. Validation artifacts use .local/research/bench-setup-*.

The final three-query full-scene replay completes all routes, matches prewarm
outcomes/truncation flags, and retains the corresponding alpha.84 outcome hashes.
The CLI uses the root factory directly and schema 3 contains the effective policy,
setup timing and a single timing object. This validates setup/integration and
correctness; no full 50-query throughput comparison is claimed. Source SHA-256:
d837cfe58abbc37c76835a265ff0e3a23d98d62c0421bd783f302975ceb34d30; resolved kernel SHA-256:
4e055a26ddd595ea8354a96a3ad5de1f3c20b885c04339baecec44f35f47a6f0.


## Solver-owned global candidate planning, 2026-11-12

Alpha.86 moves candidate-planner creation and invocation behind the prepared scene
solver. Immutable SceneNavigation facts replace SceneResources.plan; SceneProposal
and the host createCandidatePlanner export are removed. Atlos caches a prepared
solver per immutable scene snapshot and closes it on server shutdown. Its separate
candidate process and candidate-job plumbing are removed. Candidate search now runs
synchronously in the solver's execution context; cancellation remains cooperative
at search checkpoints. Dedicated candidate-process isolation is not retained.
Physical jobs continue through the existing worker/resource adapter.

Scene behavior tests use real navigation geometry, with concurrency gated at the
resource seam rather than an injected algorithm callback. The two Atlos tests that
only exercised the removed candidate worker are removed; candidate reachability
and rejection remain covered by Ganglia's navigation/scene tests. The maintained
stage profiler drops the removed command and recognizes v1 source locations.
Benchmark schema 4 removes the host candidate timer while total measured batch
wall time still includes global candidate planning. setupMs includes preparation;
input loading and one complete prewarm batch remain excluded from measurement.

The user limited validation to 10 fixed ground queries. On Node v26.13.0, with
identical input hashes, game adapter SHA-256 and fixed policy, before/after measured
batches take 180512.988167/172458.109833 ms and deliver
0.055397675821/0.057985095683 queries/s. Both complete all 10 requests with 19 jumps
and 10 truncated discovery flags. Every ordered outcome hash and truncation flag
matches the control and each run's prewarm. A complete route does not establish
exhaustive discovery. The observed throughput difference is +4.67%; this single
paired measurement establishes no stable speedup. Evidence:
.local/research/planner-owner-{before,after}-10.json. Before source/kernel hashes:
d837cfe58abbc37c76835a265ff0e3a23d98d62c0421bd783f302975ceb34d30 /
4e055a26ddd595ea8354a96a3ad5de1f3c20b885c04339baecec44f35f47a6f0.
After source/kernel hashes:
0243acfa5c45517b06d80c92c6b034ef193a4929c32ab9923d13cc8ae1632154 /
79ab2d3a6964a11555e33a41a46594ec2d3b3e8f556a82b45ed111d0eb453978.
Game adapter SHA-256:
2c932f2ca8e668f8f4ee6937633d9c77e240986241e2a530f908fbb2cc88c623.

Ganglia checks pass all 331 tests. Atlos type checks and lint pass; World passes
56 UI/behavior tests, 8 HTTP/worker/network tests and its source-only production
build, with the existing large-chunk warning. Five stage-profiler tests pass.
The broad Atlos source-only check stopped at a filter test because a sequential
shell command used the system Node lacking Uint8Array.fromBase64; the complete
World suite and worker integration pass when rerun with Node 26. Other app suites
following World in the broad check were not executed by that interrupted command.


## Deterministic benchmark route quality, 2026-11-12

Benchmark schema 5 keeps solver throughput and adds modeled travel time in seconds
as a route-quality objective. route.cost includes arrival overhead and resource-timed
motion. Only complete, non-partial solutions contribute; an incomplete workload has
no total cost, preventing cheap failures from improving that aggregate. Mean completed
cost is accompanied by explicit completion coverage.

The optional --reference flag reads a fixed report before solver preparation.
Comparison binds scene, source, all consumed content hashes, game adapter and exact
queries. It permits solver/config changes and relocated input files. It reports lost
and gained solutions separately from paired cost ratios, their geometric mean and
worst ratio; zero-reference regressions remain explicit rather than becoming JSON
Infinity or silently disappearing. The exact reference file SHA-256 is recorded.
These ratios compare measured feasible routes and are not optimality certificates.
Reference input compatibility does not independently certify route physics or game
execution. Quality reporting remains outside the measured batch interval.

This follows the usual motion-planning separation of solve success and objective
cost; OMPL supports custom objectives and Moving AI publishes optimal lengths for
its discrete-grid scenarios. Ganglia has no optimal oracle for its complete movement
model, so geometric distance or grid-optimal length cannot supply that certificate.

Ganglia format/lint/type checks and all 335 tests pass. Four focused quality tests
cover missing/partial solutions, paired aggregation and worst-case regressions,
zero reference costs, and input binding. A fresh 10-query CLI run uses
.local/research/benchmark-quality-reference-10.json and writes
.local/research/benchmark-quality-10.json. All requests complete, all warm outcome
and truncation checks match, and every ordered outcome hash matches the fixed
reference. Total/mean modeled time is 96.74069268315841/9.674069268315842 seconds;
geometric mean and worst cost ratios are both 1, with no lost/gained solutions.
Measured batch wall time is 204509.976834 ms, throughput 0.048897369971 queries/s.
This harness-only change makes no algorithm speedup claim. The kernel SHA-256 stays
79ab2d3a6964a11555e33a41a46594ec2d3b3e8f556a82b45ed111d0eb453978.
The new source/benchmark SHA-256 is
ba0e84cff9f59f52ccafb52e7340cdb67775671ddc9891815c621a9821460cff.
No packaged solver source or Atlos dependency changes are needed.


## Prepared graph reuse and complete-query parallelism, 2026-11-13

This phase targets at least 50% more full-scene batch throughput while retaining
complete solutions and the existing per-query modeled-cost acceptance. The user
allowed expanding beyond the 10-query iteration set. Inputs, movement, source and
search budgets are fixed; only execution concurrency differs between comparisons.
No work is removed by weakening discovery/validation budgets, and no complete-route
cache is introduced. The larger 20-query comparison includes ten additional queries.

A control snapshot of source and adapter is preserved under
.local/research/throughput-control. A sampled cold-plus-warm one-query profile
shows candidate-transfer expansion concentrated in prewarm. A separate measured-only
profile identifies physical search/collision and window ground preparation; cold
transfer cost is not presented as a steady-state bottleneck. Profiles are under
.local/research/throughput-profile; profiling runs are not throughput controls.

The retained window change uses one immutable resource-keyed projector and lazy
planner across stages/windows. Its initial serial 10-query replay is inconclusive:
187565.545334 ms control versus 192265.306875 ms after reuse. Costs and outcomes
match. A physical-job-only two-worker prototype measures 140777.069083 ms on the
same ten queries (+33.24% throughput), leaving scene/window work on the main thread.
That prototype was replaced and is not a supported execution mode.

Complete-query workers keep root factory, global planner, windows, physical
normalization and caches inside each isolate. The main thread owns ordered task
scheduling and event/result transport. Ready means inputs are loaded, decoded,
hashed and source-verified and the root solver is prepared. Early failures clean
up all workers; close drains accepted work. Shared atomic flags carry cooperative
abort through synchronous CPU phases. Schema 6 adds execution settings, sampled
memory peaks and final-report-only physical stage/cache statistics; inclusive worker
timers may overlap. All such reporting and quality scoring remain outside the
batch wall timer. Worker startup is reported separately from query work.

The original 20-query serial control takes 334387.401791 ms, or
0.059810865759 queries/s. Three complete-query workers with the window change take
249229.376334 ms, or 0.080247362065 queries/s (+34.17%). Their cumulative physical
solve time grows from the control's 223880.981744 ms to 468215.388122 ms, so adding
workers alone does not produce linear scaling on this machine. Twenty coarse-ground
misses remain. This result does not establish whether CPU frequency, GC or memory
contention causes each part of that slowdown.

The retained physical change keeps one coarse graph beside the single refinement
graph instead of releasing it when goal refinement adds supports. It retains the
existing generation/wall keys, dependent invalidation and moving-slot release. This
revisits an earlier memory-saving release under a different measured batch/memory
tradeoff; it does not restore rejected cross-prefix action/witness caches. Tests
exercise actual added support faces and changed goals, walls and collision bindings.

With two complete-query workers and that bounded retention, the same 20-query batch
takes 199846.969209 ms and delivers 0.100076573986 queries/s: +67.32% throughput and
40.23% less batch wall time than the serial control. This is one paired unprofiled
comparison, not a stable cross-machine percentage. All 20 routes complete. Every
ordered outcome hash, modeled cost and truncation flag matches the control and
prewarm; total modeled time stays 188.3246181141014 s. All 20 discovery-truncated
flags remain, so no exhaustive-search claim is made. The measured physical calls
report 120 coarse hits and zero misses, 24 refinement hits and 16 misses. Coarse
stage work is 17.58 ms, refinement 17643.43 ms, search 133931.98 ms and detours
68967.84 ms, inclusive across workers. The sampled process RSS peak is
10098655232 bytes; isolate heap-used sampled peaks are 4913394176/4945439376 bytes.
Those sampled maxima are not simultaneous heap sums or exact transient peaks.

Evidence: .local/research/throughput-{control-20,query-workers-20,coarse-workers-20}.json.
The cancelled first 20-query attempt has no completed report and is excluded.
Control source/kernel SHA-256:
ba0e84cff9f59f52ccafb52e7340cdb67775671ddc9891815c621a9821460cff /
79ab2d3a6964a11555e33a41a46594ec2d3b3e8f556a82b45ed111d0eb453978.
Final source/kernel SHA-256:
1ecc88acac23b279fa4176df9d1e2d958fa1f8848d731c6e27b92c65ca622c8e /
89180d0b99e2ec19b0ba3db6ea18b25fc78602df86725e1d7657de1523d2feed.
All use adapter SHA-256
2c932f2ca8e668f8f4ee6937633d9c77e240986241e2a530f908fbb2cc88c623,
Node v26.13.0 and the existing 6144 MB old-space setting. Detailed per-file input
hashes and fixed config are in each report. Alpha.86/87 controls are retained locally;
Atlos pins final alpha.88. The sampled profiles do not enter these wall comparisons.

Ganglia format/lint/type checks and 343 tests pass. Atlos World/worker type checks,
56 UI/behavior tests, 8 HTTP/worker/network tests and source-only production build
pass; its existing large-chunk warning remains. No browser acceptance or cross-map
replay is claimed. Rust/native bindings were deferred in this phase after reaching
the throughput target using preparation reuse and Node workers.

## Map-scale workload and collision cache limits, 2026-11-13

The workload expands from a 100 by 120 metre physical patch to full Wuling
navigation over a 3.712 by 3.712 kilometre gameplay footprint. Fourteen fixed
requests combine five bidirectional maximum-span pairs with two bidirectional
layered-ground detours. Endpoint selection precedes route measurements; all
fourteen distinct endpoints pass standing, stationary capsule and wall checks.
Coarse-navigation misses remain visible as coverage cases.

The first grounded 4.017 kilometre request reaches real physical search and returns
a budget-truncated target-side fragment. A repeated native-backed preparation pass
requests no additional regions. This is an incomplete route, with no complete-route
cost ratio or successful long-distance speedup established. Profiled preparation
includes setup work and is separate from a prewarmed latency measurement. Its
827.439 second CPU profile places 61.95% of inclusive samples in findConnections;
nearest enumeration, enqueue filtering and GC are concrete follow-up targets.

A full fourteen-request preparation then exceeds a 12 GiB JS heap after exporting
22 regions. A dense-window collision export separately fails at JSON.stringify's
single-string limit. The failed process exits 134 without a final workload report;
its completed immutable region files are retained. Optional local V8 collision
snapshots address both representation limits without changing coordinates or
indices. Every scalar and metadata field in the converted 22 regions is checked:
collision payloads shrink from 5,400,832,548 to 2,649,148,691 bytes. Loading all 22
packed regions succeeds with a 6 GiB heap cap; after forced GC that diagnostic
reports 1,777,371,248 heap bytes and 5,863,325,696 RSS bytes. These are input-load
diagnostics, not search speedups or transient memory maxima.

The changed Ganglia harness passes format, lint, typecheck and 391 tests. Atlos's
two owning integration patches pass 23 extraction/physical-adapter tests, extractor
typecheck and full archive/patch replay. The generated noclip cache is unchanged.
The binary full-workload preparation remains in progress; no complete fourteen-
request performance result is claimed by these checks.

The concurrent Atlos upstream update to package v104 is merged and pushed. The
follow-up preserves typed index storage during walkability classification instead
of recreating ordinary JS arrays. JSON and typed fixtures retain the same support
and body-collision behavior with unchanged source indices: 38 focused tests,
extractor typecheck and complete v104 patch replay pass. Focused upstream lint
cannot start because its custom rule plugin is missing. Frozen v102 and v104
adapter snapshots keep separate execution bindings. The full v104 attempt also
ends with heap exhaustion after approximately 2,995 seconds, preserving 29 regions
and no complete workload report.

A focused retention diagnostic keeps all 29 decoded regions alive and prepares the
three densest support meshes, totaling 1,101,646 faces. After forced GC, retaining
their pure geometry memos uses 4,281,781,296 heap bytes; owner-driven retirement
uses 2,570,417,024 bytes. This is 1,711,364,272 fewer retained heap bytes in that
diagnostic. It does not establish a lower process RSS or a whole-solver peak.
Retirement removes raw-input lookup memos while active projectors retain their
owned snapshots. The isolated prototype passes 42 focused tests with default and
native hooks, and six existing real-scene requests retain all six exact route
outcome hashes, stable prewarm results and the modeled-cost gate. Full-workload
coverage validation with owner-driven retirement remains outstanding.


## Five-minute SLO and catalog graph reuse, 2026-11-13

Headless training, prewarm, measured batches and physical coverage preparation
now apply a 300,000 millisecond dispatch-to-result deadline to every query. The
parent kills timed-out solver processes and exporter descendants, records failure,
and continues queued work in a replacement prepared process. Globally idle
replacement loading is measured separately and excluded from batch wall time.
Completion within the SLO precedes latency and common-route modeled cost in
comparisons; newly solved and recovered timed-out requests are explicit gains.

A complete capped coverage pass adds 27 regions. The resulting frozen snapshot
contains 119 regions and 19,311,641,687 bytes of physical inputs. The full fourteen-
request input closure is not established. A same-input 4.02-kilometre reference
and integrated solve each time out at 300 seconds in prewarm and measurement,
with zero complete routes. The integrated measured batch takes 300.007 seconds;
111.355 seconds of replacement loading are excluded.

The catalog graph cache no longer discards prepared topology and walking
reachability when switching between local and shared action banks. Three
interleaved fresh-process pairs, each with fifteen six-request measured batches,
reduce average serial latency from 313.532 to 303.622 milliseconds per query
(3.16 percent). Every pair improves; all 540 measured query outcomes and modeled
costs match the reference. The scope is the trained, frozen static-action
algorithm. The integrated kernel is commit `5b6bf83`; format, lint, typecheck and
411 default tests pass, along with ten focused native catalog tests.

Horizontal-span reuse changes the same local-workload mean by only 0.26 percent
and is not merged. Paired-height BVH memo variants also lack a useful measured
signal and remain local experiments. Further optimization and physical coverage
preparation are paused after the catalog change.


## Editable Atlos workspace migration, 2026-11-14

Imported Ganglia `a2faa25` into Atlos `talos/packages/ganglia` from Atlos base
`3d038d4`. All tracked solver source, tests, benchmarks, research tools, Rust
prototype, licenses and documentation are retained. The package lockfile and
installation policy are owned by the enclosing pnpm workspace. Documentation
standards apply repository-wide through Atlos's root `AGENTS.md`; package-local
instructions retain algorithm ownership and resource provenance requirements.

World and the generated noclip extractor now depend on `workspace:*`. The maintained
extractor patches produce that dependency, and the generated source is rebuilt
from those patches. Removed the archive extraction script, its archive-specific
test and the superseded vendored package. Vite route caches bind a digest of the
workspace solver source, and the browser benchmark hashes that source directly.
The workspace's test, type-check and lint tasks include Ganglia's own checks;
Ganglia keeps its strict oxfmt/oxlint configuration. No algorithm or benchmark
measurement-policy change is included.

The route-server fixture's tiny unconstrained tail now covers its original start
under the imported solver's existing fast path. To keep testing provisional tails,
prefix failure, alternative arrivals and terminal caching, the fixture explicitly
requires ground projection. This preserves its assertions and makes independent
prefix verification necessary, rather than expecting a complete tail to remain
partial.

Validation: Ganglia formatting, lint, typecheck and all 411 tests passed. World
browser/worker typechecks and the generated extractor typecheck passed. World
Vitest passed all 56 tests. The eight route server, worker and network tests passed after
the fixture correction; all 35 task and noclip preparation tests also passed. The source-only World production build passed; full font
asset packaging and browser visual inspection were outside this migration check.
Both World and extractor resolve the factory from `packages/ganglia/src/solver`.

A real headless six-query control used the retained map02 inputs, ten catalog
training queries, holdout offset ten, and the retained native kernel with label
limit 64. It resolved the migrated workspace source, completed all six queries
within the 300-second SLO, and matched all six retained reference outcomes and
modeled route costs exactly. Its single measured batch took 2.128 seconds. This
run establishes execution and route equivalence; it is not a controlled timing
comparison. Existing datasets and native artifacts remain local external inputs.


## Local resource relocation, 2026-11-14

The standalone checkout's ignored `.local/` resource directory was moved directly
into the Atlos repository root on the same filesystem. Directory identity and
hard links were retained; no compatibility link was left at the old resource
root. The packed and SLO snapshot datasets retain 242 shared ordinary-file inodes
(19,311,659,042 logical bytes), including all 119 ground/collision region pairs.
Private configuration, executable local helpers, existing internal links and a
Git object alternate were rebound. All 23 archived experiment worktrees retain
their original standalone Git ownership with repaired worktree registration;
tracked working-tree statuses of those worktrees and seven dependency checkouts
are preserved, including uncommitted drafts. Historical reports, provenance and
frozen source contents retain their original measurement bindings. The current
noclip generated tree was moved to Atlos's `talos/.cache/noclip` and verified
against the maintained integration inputs.

Frozen-lockfile offline installation, noclip preparation verification and Ganglia
formatting, lint, typecheck and all 411 tests passed. Four retained real-scene input
SHA-256 values match the migration reference. A fresh native-backed six-query
replay uses the Atlos workspace solver, ten catalog training queries, holdout
offset ten and label limit 64. All six routes complete within the 300-second SLO;
all six outcome hashes and modeled costs match `migration-validation.json`
exactly, with no lost solutions or timeouts. Evidence is retained under
`.local/research/resource-relocation/`. This verifies relocation and execution,
with no algorithm, benchmark-policy or performance improvement claim. The full
long-range workload was not replayed and its recorded coverage gap remains open.


## Unified benchmark lifecycle, 2026-11-14

Reporting follow-up: JSON retains reference batch/end-to-end times and explicit
reasons when an automatic ratio is unavailable. Markdown presents both speedup
rows prominently. The existing timeout/quality regression verifies failed
queries cannot appear as speedups and older timing references receive a reason.
Format, lint, typecheck and all 414 tests pass after this reporting change.

Schema 8 measures one algorithm and preparation recipe, then interprets the
measurements for server queries, browser offload or offline batch processing.
There are no deployment-mode branches. Solver `src/` and search budgets are
unchanged. Read/decode/hash time is separated from adapter/source validation,
resource indexing and factory preparation. Catalog training and freezing belong
to service preparation. Every worker receives the entire ordered training set;
training is not split among workers. Each dispatch retains its 300-second
watchdog. Worker-ready and service-ready time and memory are reported separately.

Runtime warmup requires a separately declared disjoint workload. No scored batch
is used as excluded prewarm. All scored rounds contribute to throughput, and
repeatability compares outcomes and truncation to the first scored round. Service,
queue and response time are distinct. Recovery remains in actual batch wall time.
End-to-end time spans Node process origin through solver shutdown, including all
loading, preparation, training, runtime warmup, measured rounds and recovery.
Final source re-verification and report formatting follow that interval. Phase
timers can overlap; actual end-to-end time is measured rather than summed.
Browser index transfer, restoration and execution remain unmeasured. Existing
lazy query preparation and cache-history effects remain visible in query timing;
no eager immutable-index or fresh-query independence claim is made.

An unmerged prototype had selected different algorithm states using deployment
modes and query-local input copies. It was rejected because it changed what was
being measured. Its trained-reference quality failure and superseded controls
are retained under `.local/research/benchmark-lifecycle/`, marked by
`discarded-experiments.json`, and excluded from acceptance. All mode and cloning
changes were removed. No route-cost gate was relaxed.

Final format, lint, typecheck and all 414 tests pass. Added coverage protects
renamed warmup leakage, measured-round stability, recovery accounting, queue
latency and complete ordered training in each process. Real validation uses Node
v26.13.0, the retained native kernel with label limit 64, the same map02 inputs
and movement/search Config, ten training queries, holdout offset ten, six scored
queries and two independent runtime warmup requests. A one-worker/one-lane run
and a two-worker/two-lane run each measure two rounds. All 24 measured attempts
complete within the SLO; all six ordered outcome hashes, modeled costs and
truncation flags match across rounds and schedules and retain the original
quality reference. Both quality gates pass, with mean and worst cost ratios of 1.
Every worker completes all ten training requests and freezes 239 actions.

Serial service readiness and end-to-end times are 29472.506292 and
36370.641917 ms; parallel values are 33544.767750 and 38464.445375 ms.
These are execution/measurement-boundary checks, with no stable performance
improvement claim. Prior schema-7 reports remain quality references; no speed
ratio is emitted across changed measurement contracts. JSON-to-Markdown rendering
of both final reports succeeds. World checks and full-map coverage were not
rerun because only the benchmark harness, tests and documentation changed.

Accepted evidence: `.local/research/benchmark-lifecycle/unified-serial.json`,
`unified-parallel.json`, `validation-summary.json` and `check.log`. The exact
training/warmup/scored queries, Config, consumed file hashes and runtime flags
are bound in those reports. Source/benchmark SHA-256:
`374098d617fb719c0347f234319e3646cb0479a596569d209b66b87bf139a23a`.
Unchanged kernel SHA-256:
`c0d0ab7702e048104a7e999d8d060e2ff4ac794cc796cfb04e325695eef92b55`.
Game adapter SHA-256:
`2c932f2ca8e668f8f4ee6937633d9c77e240986241e2a530f908fbb2cc88c623`.


## Shared TypeScript model and independent evaluation, 2026-11-14

Starting from Atlos `3111de4`, extracted collision, walls, spatial/support geometry,
goal predicates, flight-control execution and locomotion state transitions into
`src/model/`. Preserved the numerical code and native hook ownership. V1 retains
candidate enumeration, control selection, graph search, resource dominance and
bounded schedule optimization. No algorithm or search budget was replaced.
The generic prepared-solver contract accepts a solver-specific configuration;
`SolverSettings` carries execution identity while public `SolverConfig` retains
its V1 integration meaning. Model rules exclude locomotion search budgets.

Moved scene/exporter preparation and the solving worker into the V1 benchmark
adapter. `--adapter` selects another process entry and policy defaults without
editing the measurement harness. Catalog statistics are optional IPC data; only
catalog-enabled preparation requires them. An independent worker fixture has no
V1 imports and passes the same ordered batch, timing and quality path.

Independent evaluation rejects malformed/discontinuous traces, recomputes modeled
time and length, and verifies available starts, ordered waypoints and terminal
geometry from the query and snapshot projection tolerance. It never repairs or
optimizes a submitted route. Invalid completed traces cannot improve completion
or objective statistics. Synthetic timing fixtures now represent their fixed
cost as arrival overhead and supply consistent zero-length traces; their timing,
SLO and stability assertions remain unchanged. Schema 9 records `route-contract`
evaluation scope. This scope does not certify complete physical execution:
control witnesses and whole-world coverage remain necessary for independent
capsule/resource/device/boost replay. Shared rules provide that implementation
boundary without adopting V1 search policy as a universal contract.

Validation: package formatting, lint, typecheck and all 424 tests pass. World
application and worker typechecks and seven integration tests pass. Native parity passes seven transfer,
collision, ground, goal and locomotion cases; five candidate-index cases fail
because the retained native library has no `CandidateSearchIndex` export. That
prototype path is unchanged and disabled in the real replay. No native artifact
or physical input was rebuilt.

Real replay uses Node v26.13.0 with a 6144 MiB heap, retained native transfers,
collision/locomotion/ground/goal hooks and locomotion label limit 64. The exact
command is the retained resource-relocation workload/config with map02 data,
migration-adapter, ten training queries, holdout offset ten, six scored requests,
two disjoint warmup queries, two rounds, one worker and one lane. All twelve
attempts complete within the SLO. Six ordered outcome hashes match
`migration-validation.json`; truncation is stable, the quality gate passes and
recomputed costs differ from the reference by at most 2.67e-15 seconds.
Evidence is retained under `.local/research/ts-decoupling/`, including the JSON
report with complete input/query/config/source bindings and native parity log.
This is refactor validation; no baseline rerun or full-map experiment was added.


Review made query-rule context mandatory for every benchmark adapter and added
wrong-goal rejection to the independent-process fixture. Ordered-waypoint checks
intersect horizontal and vertical tolerance intervals and retain the earliest
admissible point, including vertical and zero-length traces. These fixes were
rechecked through the focused evaluator/adapter cases and the 424-test package
pass. Seven World integration cases and both World typechecks pass.

The accepted replay is `accepted-serial.json`; earlier intermediate replays are
retained separately. Its source/benchmark SHA-256 is `a4613c71a43041e9ae151a722f586066480dc923cc1c268607348865c793fadd`, and its kernel SHA-256
is `f93095f611537bbb38513b7b65450be4a0b2427d86a9ff42f78a0201d84fc39d`. The unchanged game-adapter SHA-256 is `2c932f2ca8e668f8f4ee6937633d9c77e240986241e2a530f908fbb2cc88c623`.
Mean serial service time is 477.232 ms/query, service readiness is 26.667 s and
end-to-end time is 33.187 s. All 12 attempts succeed. The report retains complete
input/config/query bindings; `validation-summary.json` indexes this evidence.


## Independent physical execution verifier, 2026-11-14

Added a search-independent physical evaluator over provider-owned normalized
`PhysicalInput` snapshots. Shared `model/world.ts` owns source coverage, support,
capsule motion and support-following walking. Shared placement geometry was
extracted from the V1 following-route implementation. `evaluation/physical.ts`
uses public contracts and shared numerical rules, without V1 candidate discovery,
search, catalog or schedule selection.

Acceptance re-executes submitted whole-route resource controls and flight
witnesses against trusted movement/device facts, checks authored/device timing,
boost pickup and expiry, placement body clearance and terminal first-goal events.
Sparse source tile holes are rejected. Existing exported moving-support
phase-free and following-support activity-range assumptions are retained. Convex
bodies outside flat placement eligibility remain obstacles without extra roof
support. V1 emits controls and first constructs physically supported walking
geometry before resource scheduling; the verifier never corrects a submission.

Review counterexamples drove the final physical checks. Projection truthiness
accepted airborne takeoffs and floating walks; length-only support correction
missed constant-height offsets, while nominal slope chords undercharged actual
travel. Acceptance now requires supported feet and actual supported length,
including stationary origins. A 4 mm flight deviation remained inside the timed
replay tolerance but penetrated a wall with 2 mm nominal clearance; submitted
geometry is now swept independently. Placed cuboids are checked against complete
terrain and other bodies rather than only footprint corners. Equivalent knot
density and semantic segment splits continue to pass without sample alignment.

Schema 10 performs physical-verification RPCs after timed batches. Scene adapters
capture normalized facts before search; separate TS verifier indexes are built
lazily outside solve timing. Replacement workers can recover facts through a
no-search exporter capture sink. Evaluation cost remains in end-to-end time.
The outcome digest excludes witnesses/controls so adding execution evidence does
not itself change the identity of an otherwise identical route.

Package formatting, lint, typecheck and all 438 tests pass. Both World application
and worker typechecks pass; the seven World integration tests passed during this
milestone before the final focused evaluator regressions. Read-only Standards
and Spec rechecks found no remaining required issues within the exported model
assumptions.

A minimal Node v26.13.0 native-backed CPU-profiled diagnostic trained one catalog request and
measured one holdout request. Physical evaluation passed without timeout. Service
preparation took 86.981 s and observed end-to-end time was 93.573 s. A CPU profile
identified active geometry construction/search and 20.695 s of GC, including
8.245 s in shared TS physical-world construction. The long preparation was not an
IPC deadlock. Stricter supported-foot candidate construction rejects nominal
navigation trajectories and can trigger additional search/refinement. This
one-request diagnostic establishes execution only; it is not a six-query quality
or repeatability result. Its validated report is
`.local/research/physical-verifier/minimal.json`. A second instrumented profile
was discarded because removing its instrumentation changed source during the
run. The ten-training/six-holdout/two-round control was canceled after 20 min 28 s
before service readiness. It produced no scored attempts and establishes no
query SLO or quality result. Evidence is `train10-incomplete-summary.json` in the
same directory.

The smaller declared preparation recipe completed with one processed training
request, no runtime warmup, six holdout requests, two rounds, one worker and one
lane. The quality gate failed: only `new-goal-near-lower-floor-ground-jump-6-1`
completed in both rounds and passed physical replay. The other five requests
returned `no-verified-route` in both rounds, losing five reference solutions.
There were zero watchdog timeouts or worker recoveries. Outcomes and truncation
were stable across rounds, including the failures. The training request itself
returned no completed route; its search populated 86 actions before freezing.
The unchanged cost gates were 1.01 geometric mean and 1.05 worst ratio. The sole
completed pair has cost ratio 0.983459; that pair does not satisfy the required
six-request completion gate.

Mean serial service time across all twelve attempts was 120352.946 ms/attempt,
including failed searches. The successful request averaged 534.429 ms across its
two samples, 635.596 and 433.262 ms. Each failed request averaged between 90.768
and 180.994 s. The rounds took 713.119 and 731.116 s, totaling 1444.236 s of batch
wall time. Successful batch throughput was 0.001385 queries/s. Service readiness
was 91.006 s, including 89.781 s of catalog training. Observed end-to-end time was
1540.952 s, with successful throughput 0.001298 queries/s. This is a completion
and performance regression; no new speedup is accepted. The earlier 6.40x
cumulative checkpoint retains its own historical workload and timing scope.

Evidence is `.local/research/physical-verifier/serial-train1.json` and
`validation-summary.json`; the raw report is retained unchanged. It records
`d35e4997` plus a dirty working tree because measurement began before the feature
commit. Its source/benchmark digest exactly matches committed `48e6e791`:
`a34f6d2ae8e2fb8b3b01d08d8445290e3ab0ff026a84b70ed1fdc48e3dc0a36f`.
The report SHA-256 is
`9d658d8bff7dd1edf6b2ed24af32efcb494e1e20d054b7f8a926982cd75a1bde`.
The kernel digest is
`f82913d3d412b41de140b81610ec3c95afb418e2197a3fcb8f4bd46920fb1c94`,
and the unchanged game-adapter digest is
`2c932f2ca8e668f8f4ee6937633d9c77e240986241e2a530f908fbb2cc88c623`.
No further solver run or algorithm change was made for this measurement followup.

### Early collection sprint eligibility

Engine integration identified a shared evaluator error for uniform airborne
collection. A witness can describe a full landing while execution stops at an
earlier interaction. The fallback air-speed check divided the full landing
displacement by the collection-clipped duration and falsely required sprint.
It now uses the executed replay displacement and duration; model-provided peak
speeds still govern nonuniform flight. A focused regression accepts early
collection within run air speed and rejects the same flight when the movement
rules require active sprint. No witness changes or physics limits are needed.
The regression fails with `Fast flight requires active sprint` under the original
fallback and passes after the correction. Package format, lint, typecheck and all
439 tests pass. No solver benchmark was rerun for this evaluator-only fix.

### Sparse-window placement proof ownership

Engine integration identified a shared evaluator false rejection: configuring
each sparse snapshot with all route placements required every snapshot to export
every selected following ID and cover every selected body. A later window could
therefore reject a placement already fully proved in an earlier window.

Evaluation now unions immutable following facts across snapshots, rejects
conflicting definitions, and requires a complete local placement proof for each
selected ID before replay. Window configurations share all body geometry while
reporting only their complete placement proofs. Global unknown IDs, missing
proof coverage, unsupported placement geometry and body collisions remain
failures. The complete proof must include original collision ownership when a
body moves; evidence fragmented across snapshots is not inferred to be complete.
A two-sparse-window regression covers a valid placement exported only in the
first window, global unknown IDs, missing placement coverage, conflicting facts,
and an omitted default body obstructing the later route.
Original coverage and collision ownership are checked per source body, preserving
unknown or occupied gaps between separate cuboids. The regression includes a
missing gap tile and a static slab between the bodies. Package formatting, lint,
typecheck and all 440 tests pass. Independent correctness and Standards reviews
found no remaining scoped findings. No solver benchmark was rerun for this fix.
