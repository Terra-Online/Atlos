# Solver reuse and performance

2026-11-08, alpha.58. This records implementation progress against
[architecture](architecture.md) and [ground topology](ground-topology.md), separately
from their alpha.21 modeling baseline.

## Current boundary

G0–G2 have directed ground passages, stair-family validation and bounded local
refinement; see [stairs validation](stairs-validation.md) for its measured coverage.
G3 regional entry/exit transfer assets and state-preserving contraction remain open.
Atlos implements parts of G4: shared physical tiles, retained task logs, feasible
incumbents and interleaved origin/coverage attempts. The full I0 resource-state and
forward-replay reference is incomplete; I1 currently has terrain assets rather
than shared regional action assets. Static device macros do not complete I2.

## Moving-support endpoint visibility in alpha.56

phase-free moving supports can introduce hundreds of transport endpoints into
one query. ground transfer comparison now rejects pairs whose supporting
triangles share no weak portal component. component membership comes from the
straightener's own immutable triangle graph and point locator. overlapping
supports retain every possible component, and directed passage and wall checks
remain part of the final trace. mutable endpoint arrays are rechecked against
their current coordinates.

failed visibility traces are no longer retained as serialized endpoint-pair
keys. successful traces remain reusable for successive action comparisons.
candidate budgets, transport durations and collision rules retain their existing
contracts. the SDK's 195 tests pass, including overlapping support, endpoint
mutation, one-way passage and disconnected device-chain cases.

one fresh-process device preflight on retained inputs with 838,331 ground faces
took 61.06 seconds with alpha.55 and 55.04 seconds with alpha.56. both returned
unavailable. final heap use was 3.716 and 3.744 GB respectively. this single replay
does not establish a uniform speedup or a reduction in large-region memory use.
full-detail graph preparation and regional entry/exit contraction remain open
performance work.

The post-integration replay retains 38/38 complete candidates at the same selected
cost as the frozen baseline. Exact object comparisons match 37 selected routes
and 36 complete action sets, retaining the reference-number and unused-action
differences from the preceding integration. The
[updated per-point table](per-point-performance.md#alpha5658-移动支撑集成后的固定输入回放)
records every request and stage. Command time totals 457.298 seconds against
467.518 in the preceding moving-support integration replay. These separate runs
were not load-isolated or interleaved. They do not establish a stable speedup,
and the earlier alpha.53 total was 398.647 seconds.

## Tall physical build domains

The offline builder partitions excessive vertical extent at empty potential-support
height gaps. Each partition retains overlapping collision for headroom and radius
erosion. Clipped triangles inherit their original native slope classification.
Ordinary-sized builds keep the original native call. Continuous walkable support
spanning the native vertical limit still fails explicitly, because independently
sampled height contours cannot supply an exact ground seam.

A retained physical tile that previously exceeded the 8,190-voxel limit built
15,898 faces in 1.958 seconds. Eight actual support-height samples projected back
within 0.01 metre, and the separated low and high support domains received no
ordinary cross-domain portal. The SDK's 199 tests passed at this checkpoint,
including low ceilings, inherited low-hanging support and horizontal tile seams.
This establishes the tile-build repair only. It does not establish complete route
reachability through that region.

## Reuse without changing candidate coverage

CPU sampling of the successful rear-approach query found about 12 seconds under
the base graph search, including about 9 seconds in repeated goal-distance
estimation. This is inclusive sampled CPU attribution, not an independent sum of
stage durations. The query has multiple standing targets within its interaction
volume, and action discovery repeatedly searches with newly added connections.

The prepared route planner now retains exact minimum Euclidean distances for its
current target-position set. Repeated node relaxations and successive searches
reuse those distances. Time estimates still divide by the current graph's speed
bound, including new fast devices and zero-cost transfers. Changing target
positions resets the cache even when temporary endpoint IDs are reused. Weak keys
avoid retaining discarded query endpoint positions, and only one target set is
retained. Three-dimensional distance evaluation no longer allocates a temporary
array for every target comparison.

No candidates, budgets, ordering rules, movement costs or collision requirements
are removed or relaxed. This is a preparation/search optimization, not regional
contraction or cross-process reuse. It does not change route-result feasibility
or optimality claims.

## Validation method

Replay identical retained physical inputs with the alpha.30 implementation and
the candidate in separate processes. Compare complete route and connection data,
not only success and duration. Record input, ground, collision, devices, refinement,
search and total command times separately. Do not treat a finished-route cache hit
as new-goal reuse or a single command as total multi-origin task latency.

The SDK regression suite also checks reused estimates against fresh graph searches
when a faster or zero-cost remote action is added and removed, target sets change,
or an endpoint ID is rebound to a different position.

## Fixed-input results

Separate-process alpha.30/alpha.31 replays with existing physical input files:

| Query | Search before / after (s) | Command total before / after (s) | Model route (s) |
| --- | --- | --- | --- |
| `10YLgUg` | 4.67 / 4.52 | 10.96 / 10.32 | 8.198852 |
| `17nac6U` | 10.78 / 8.98 | 23.35 / 20.64 | 22.633835 |
| `0bzZEM3` | 44.03 / 35.82 | 63.55 / 54.57 | 50.811684 |
| `0nQJhsI` | 13.39 / 9.15 | 30.63 / 24.18 | 32.513703 |
| `0ahvvCZ` | 41.91 / 33.11 | 65.62 / 54.60 | 56.819418 |

All five complete route objects and connection arrays were identical, not merely
within a duration tolerance. The 155 SDK tests passed. These are paired local
measurements, not population percentiles; the small change for `10YLgUg` is not
strong evidence of a material speedup. A separate sampled rear-query run measured
45.00 / 35.46 seconds of search and returned identical route data as well.

The second target initially used the box query's narrower terrain: both versions
were unavailable with identical connection arrays (61.08 / 46.65 seconds search).
The successful row above uses its original 349,112-surface terrain. Keep this
coverage failure separate from the five successful regressions.

Local raw evidence is retained in noclip's `.research/profiles/reuse-comparison.json`,
`reuse-wide-comparison.json`, paired result files and `rear-reuse-before.cpuprofile`.
Those alpha.31 measurements preceded its integration into the v69 World preview.
The cold-start work below starts from that integrated alpha.31 baseline.

## Next acceptance gates

1. Aggregate all attempts, queueing and preparation under one query ledger, keeping
   first-feasible latency separate from optional improvement.
2. Reuse prepared region geometry and collision indices across tasks under explicit
   source, state, body and model dependencies, with bounded memory and incremental
   loading. Keep target-specific refinement separate.
3. Implement G3 local directed entry/exit transfers and compare compressed searches
   against an uncompressed reference on stairs, stacked floors, one-way drops and
   device shortcuts before enabling them for arbitrary points.
4. Share unresolved interface work across targets. Budget exhaustion preserves
   unknown status and verified actions; it is not evidence of physical impossibility.

Every stage must preserve the fixed query corpus's reachability and route quality.
Measure cold preparation, same-region new goals and expanded coverage separately.

## Reusing boundary preparation without reducing search coverage

Discovery now builds an immutable spatial hierarchy of exposed boundaries. The
previous ordering first sorted every eligible boundary, then grouped it into
successively smaller spatial cells and interleaved those groups. In that ordering,
a region first appears at its least-ranked eligible boundary. Ranking child
regions by those minima, retaining the original boundary index as the stable tie
breaker, therefore produces the same sequence. Only the prefix that the seed
budget can consume is materialized. Each boundary stream yields at least one seed,
so later distinct streams cannot be visited once that many streams have already
consumed the complete seed budget. This removes unconsumed allocation and sorting
work; candidate limits and their charging remain unchanged.

A prepared ground planner can also retain its static discovery adjacency, boundary
and landing indices across queries with identical support surfaces, imported
portal identity and wall/body values. It retains one constraints variant and one
spatial subdivision variant. Per-query goal projections, rankings, motion checks,
rejected pairs and reachability decisions remain separate. Changing collision
worlds does not reuse any standing or swept-motion proof.

Repeated device and action endpoint projections use a bounded support cache owned
by the immutable ground planner. Every coordinate, height tolerance and explicit
support identity participates in the key. The underlying projection remains the
original polygon scan, retaining its numerical edge tolerance and floor-selection
rules. The cache bounds retained entries and preserves signed-zero coordinates.

An independent full-list ordering reference covers filtered stacked floors,
negative coordinates, ties and multiple prefix budgets. Projection comparisons
cover changing floors, height tolerances, mutable input coordinates and cache
replacement. Repeated-query checks compare reused and fresh planners while
changing goals and collision worlds. These verify equivalence and isolation; they
do not establish a tenfold reduction in cold-query time.

## Cold-start preparation and search

The primary acceptance regime is a fresh Node process solving its first query
from retained physical input files. It has no previously prepared planner,
collision BVH, goal refinement or completed route. This is process-cold execution,
not a claim that operating-system file pages were flushed. Same-region new-goal
and repeated-input workers are auxiliary measurements, reported separately.

Alpha.39 reduces work within that first invocation:

- Collision BVH construction selects exact median partitions instead of sorting
  every complete subtree. Total tie-breaking and the parent's leaf order remain
  identical, preserving support selection and the first reported collision.
- Support bounds precompute centres in temporary typed columns while retaining
  the previous three-way partition sequence and complete tree/leaf order.
- Local goal refinement queries the already built collision BVH for inclusive
  XZ triangle candidates at every height, then restores original input order.
  Native mesh construction receives the same triangle sequence as the full scan.
- Coarse and refined planners share content-checked owned surface primitives.
  Each planner still rebuilds its global portals, triangle IDs and neighbours;
  far-away added geometry can change global traversal order, so concatenating
  independently built portal graphs is not equivalent.
- Static wall-filtered movement topology and spatial indices are prepared once
  per matching planner. Action overlays and reachability remain per-query.
  After a full failed A* search, a directed component DAG can reject later
  disconnected overlays before repeating A*, without authorizing any passage.
- Boundary discovery materializes only the consumed ordering prefix, and landing
  projection avoids temporary fixed-size vectors with unchanged arithmetic order.

Exact collision-query memoization is opt-in and defaults to disabled. It is not
used to obtain the cold figures. Derived edge-string retention increased the
rear-query total in a focused comparison and was rejected. A separate lazy
straightener experiment did not establish a material total-time improvement and
was also excluded. No candidate budget or physical check was reduced.

The fixed replay population contains 38 alpha.31 successes, using 36 distinct
physical input bindings. Fourteen requests have their original CLI logs; the
other 24 have explicitly frozen recovered input selections. The gate compares
complete route objects, all discovered connections and candidate limits, not just
reachability or a cost tolerance. Historical best-route differences remain a
separate quality backlog: ten current alpha.31 baselines have worse historical
costs, including differences reproduced on alpha.30 with the same retained inputs.
The performance gate does not redefine those historical routes as solved.

Focused three-request measurements before the final extractor release-lifetime
adjustment were 95.44 s for alpha.31 and 66.02 s for alpha.39. The rear-approach
request was 53.20 / 34.72 s, the box request 28.46 / 19.85 s and a third request
13.78 / 11.44 s. All route, connection and limit objects matched exactly. These
single-run samples support continued cold preparation work; they do not establish
the requested 90 percent total-time reduction.

The final frozen 38-request replay, after restoring the one-shot extractor's coarse
planner release, passed 38/38 exact route/connection/limit comparisons:

| Stage | Alpha.31 total (s) | Alpha.39 total (s) |
| --- | ---: | ---: |
| Input | 18.448 | 17.740 |
| Ground | 118.491 | 106.332 |
| Collision | 38.407 | 23.326 |
| Devices | 7.103 | 6.393 |
| Refinement | 168.900 | 145.287 |
| Search | 202.690 | 152.695 |
| Command total | 554.891 | 452.624 |

The command reduction is 18.4 percent; search alone is 24.7 percent lower. The
rear query was 53.197 / 32.983 s, the box query 28.463 / 19.042 s and the third
focused query 13.783 / 11.144 s. No candidate run became slower in this replay,
though near-equal single-run times should not be interpreted as reliable speedups.
The 180 SDK tests passed. This remains well above the requested ten-percent
remaining-time target. Further work must reduce repeated topology analysis,
frontier generation and graph search; retaining more results in memory alone
cannot satisfy that gate.

A fresh-process alpha.31 control replay after the candidate corpus took 95.301 s
for the same three focused requests, against 95.443 s in the frozen record.
Its complete route, connection and limit objects also matched. This checks that
the focused improvement is not explained by a large overall machine-speed change.

## Reducing repeated graph work

The next implementation removes duplicate topology and distance searches rather
than increasing retained cross-query state:

- Ground routing exposes its already validated, wall-filtered graph and forward
  adjacency to movement discovery. Original edge weights are scaled on relaxation,
  avoiding a full copied edge graph just for unit conversion. They share its SCC
  computation and derive the directed rejection DAG from those same components. The standalone public graph planner still
  retains only its condensation, without keeping the full numeric topology.
- Each physical query owns only its current forward/reverse distance labels.
  When actions extend an unchanged graph, Dijkstra resumes from newly improved
  endpoints. An unchanged field expands no nodes. Deleted/reordered/changed
  action weights, changed roots or a changed base graph restart the full search.
  These fields are released with the query; worker preparation does not retain
  them for another target. Candidate ordering continues to use the same final
  shortest-distance labels.
- Ground tracing indexes polygon boundaries by surface ID and integer edge
  ordinal. Fan diagonals are grouped only within their owning polygon, so they
  do not require global serialized keys. Neighbour and portal insertion order
  remains unchanged. Empty diagonal maps are not allocated for triangle faces.

The query diagnostics expose distance-field resets, node expansions, outgoing-edge
visits and reachable-node counts. The last count records how much a full field
pass would traverse, making the avoided graph work visible independently of
wall-clock variance. No candidate budgets, grounded support checks or swept
collision validations are weakened. A face-level kinematic prefilter was tested
but excluded because its small rejection rate did not improve total work time.

### Alpha.47 fixed-input validation

All 38 requests again passed exact route, discovered-connection and candidate-limit
comparisons with alpha.31. Each request ran in a new process; neither prepared
worker state nor completed route results participated. The packed runtime matches
the frozen benchmark source. The 188 SDK tests passed.

| Stage | Alpha.31 (s) | Alpha.39 (s) | Alpha.47 (s) |
| --- | ---: | ---: | ---: |
| Input | 18.448 | 17.740 | 17.555 |
| Ground | 118.491 | 106.332 | 93.067 |
| Collision | 38.407 | 23.326 | 23.155 |
| Devices | 7.103 | 6.393 | 6.199 |
| Refinement | 168.900 | 145.287 | 136.351 |
| Search | 202.690 | 152.695 | 140.154 |
| Command total | 554.891 | 452.624 | 417.453 |

Alpha.47 reduces the fixed population's command time by 24.8 percent and search
time by 30.9 percent relative to alpha.31. No case became slower in this replay;
these remain local measurements rather than latency percentiles. The rear query
was 53.197 / 29.731 s, the box query 28.463 / 18.089 s, and the third focused query
13.783 / 10.552 s.

Across 192 distance-field calls, 76 required no expansion. Incremental propagation
expanded 1,960,025 nodes, versus 5,953,562 reachable nodes across corresponding
complete field passes: 67.1 percent fewer expansions. The rear query alone visited
125,646 versus 1,363,499 nodes in these fields. These are distance-field counts,
not a claim of a 90 percent total-command reduction.

Separate three-request resource runs measured peak RSS around 1.7–2.9 GiB for
alpha.47, against about 1.9–2.8 GiB for the alpha.31 control. The rear query reached
3.1 GiB in the complete corpus run. Peak RSS did not uniformly decrease; fewer
edge copies do not by themselves establish a smaller process peak. An additional
in-place distance-field-reset experiment showed no stable wall-time/RSS gain and
was excluded from this release.

The requested ten-percent remaining-time target is not reached. Ground preparation
and goal refinement still consume about 55 percent of the current command total.
Further improvement must avoid constructing and traversing unnecessary global
fine support structures, while preserving directed passages, overlapping supports,
physical checks and the complete-route incumbent. More retained query results
cannot substitute for that algorithmic work.

## Jump candidate lookup and serial work

Alpha.53 reduces temporary work while preserving candidate prefixes and budgets:

- The bounds-tree builder scans packed lower/upper columns instead of nested
  entry bounds at every partition level. Its ordering, hierarchy and leaf entry
  identities stay unchanged. These columns are build-only scratch, released
  after construction; no additional cross-query cache is retained.
- Nearest traversal uses parallel heap columns instead of allocating a wrapper
  per visited node or entry. Comparisons, ties and the order of child insertion
  stay identical. The three-dimensional bounds and distance path avoids repeated
  axis loops. Empty filtered sets do not create landing-search streams.
- Analytic jump duration no longer builds phase objects for each candidate pair.
  Actual trajectory construction and capsule sweeps still use the same phase
  model, arithmetic order and physical checks. New and old duration/trajectory
  outputs matched exactly on 48 jump/drop model combinations, including apex
  holds and terminal-speed descent.
- Coarse-direction planning hands its latest unchanged goal probe to the final
  phase rather than solving that identical state again. This handoff lasts only
  within one query. The extractor also retains its walking result when device
  validation admits no new edges, and reads independent required inputs together.

A separate serial-pipeline experiment combined walking, known devices and full
search in one progressive worker call. The rear query took 31.94 / 32.59 seconds
for staged / combined execution, then 30.95 / 32.79 seconds in reverse test order.
The box query took 18.18 / 17.89 seconds. Each trial began with a fresh worker;
the staged trial retained preparation between its own phases. All final route,
connection and limit objects matched. This did not establish a useful latency
gain, so the existing foreground/optimization scheduling remains in place.
No larger retention ceiling or additional concurrent full search is enabled.

### Alpha.53 fixed-input validation

All 38 fresh-process requests passed exact route, connection and limit-object
comparisons with the frozen alpha.31 successes. Installed package source matches
the benchmark source. The SDK's 190 tests passed, including the unchanged-query
handoff and legacy nearest-prefix references.

| Stage | Alpha.31 (s) | Alpha.47 (s) | Alpha.53 (s) |
| --- | ---: | ---: | ---: |
| Input | 18.448 | 17.555 | 17.774 |
| Ground | 118.491 | 93.067 | 89.183 |
| Collision | 38.407 | 23.155 | 23.432 |
| Devices | 7.103 | 6.199 | 5.091 |
| Refinement | 168.900 | 136.351 | 132.990 |
| Search | 202.690 | 140.154 | 129.342 |
| Command total | 554.891 | 417.453 | 398.647 |

This is 4.5 percent less command time and 7.7 percent less search time than
alpha.47. Relative to alpha.31, command time is 28.2 percent lower. The rear query
was 29.731 / 28.275 seconds, the box query 18.089 / 17.226 seconds and the third
focused query 10.552 / 9.741 seconds for alpha.47 / alpha.53.

These are single fixed-population replays, not latency percentiles or uniform
per-point speedups. Eight requests took 12–475 ms longer than alpha.47 in this
replay. The largest process peak was 3.09 / 3.21 GiB, so lower allocation work has
not established a lower RSS peak. The ten historical quality gaps noted above
remain unchanged. Neither G3 contraction nor the requested ten-percent
remaining-time target is complete.

## Per-point audit and prebuilt assets

The [per-point table](per-point-performance.md) contains all 38 tokens, stage times,
exact route/action gates, four interleaved retests and the ten historical quality
gaps. The retests ran alongside a CPU-heavy simulator update and have wide ranges.
They support further controlled measurement before classifying a latency change.

[Prebuilt navigation assets](prebuilt-navigation.md) records the current native
surface pipeline, the lost polygon/detail ownership, measured binary payloads,
full-scene coverage estimates and a scoped WASM prototype. The next structural
work is persistent regional geometry/topology and directed transfers, with detail
support and collision loaded for required validations.

## Alpha.76 jump candidate generation (2026-11-10)

The target for this round is at most 20 percent of the original cost. It is **not
met**. Changes are limited to improvement discovery: conservative face/bucket
dominance before landing-witness generation, per-query goal projections, stable
bounded insertion and reusable spatial cell keys. Frontier discovery retains its
previous candidate sorting and witness generation. Physics and route retiming
are unchanged.

The face bound accounts for every covered endpoint cell, remaining-distance and
nominal/tolerance flight-time bounds. It requires full buckets with certain tails
and strict score separation; ties and unsupported numerical ranges retain the
original enumeration. Skipped faces still consume their original neighbour slots.
This preserves existing bounded-search representatives rather than using the
heuristic score as a lower bound on the final resource-timed route.

Fresh-process retained-input runs used Node v26.13.0 and a 4 GiB heap limit.
Times below are command total / extractor search stage, in seconds. Search
includes route planning and physical action discovery, and is nested in total.

| Case | Original alpha.70 | Previous alpha.72/73 algorithm | This round |
| --- | ---: | ---: | ---: |
| Heavy action | 158.36 / 153.90 | 121.10 / 116.64 | 102.56 / 98.04 |
| Failed window, trial before frontier restoration | 23.19 / 16.02 | 24.98 / 17.10 | 24.40 / 16.66 |
| Direction, final installed alpha.76 | 44.41 / 24.38 | 48.13 / 24.63 | 61.05 / 34.48 |

Heavy-action total/search cost is 64.8/63.7 percent of the original, or
84.7/84.1 percent of the previous algorithm. Its fourteen improvement queries
still charge 1,792,000 seed slots and 7,168,000 neighbour slots. The bound skips
landing generation for 708,159 faces (9.88 percent of charged neighbours), while
retaining 4,629,386 bucket candidates across queries and performing 6,238 uncached
shortcut trajectory attempts. Those counts do not include airborne-terminal
trajectory attempts or establish fewer spatial-node visits. Point-pair generation
and complete per-function costs were not reprofiled in this round.

The heavy-action route and the trial failure outcome match alpha.70 exactly.
All direction runs return the exact reference route. Direction trials ranged
from 47.99 to 61.05 seconds total and 26.18 to 34.48 seconds search, including
the final replay after restoring frontier processing. These measurements show
no direction-search benefit, and the final replay is slower than the retained
baseline. They do not establish a stable speedup across windows.

A shared local spatial-tree prototype took 125.97 seconds on the heavy case,
against 121.10 seconds previously. Almost every local iterator still started
the global traversal, so that prototype was removed. Exact collinear boundary
merging reduces 61,264 scene boundaries to 60,610, only 1.07 percent, and was not
adopted. No approximate face merging or motion-validation shortcut was enabled.

The remaining structural cost is repeated source/landing enumeration, especially
the fourteen full improvement batches. Search-directed regional transfers and
lazy validation of route-relevant actions remain necessary work toward the target;
the current measurements cannot predict their eventual speedup. The SDK's 271
tests and Atlos's 10 route worker/server tests passed. Packaged and installed SDK
sources match the checkout byte for byte. Local raw artifacts are retained under
`endfield-noclip/.research/stage123/action-search-20261110/`, including comparison,
timing, result and per-query work JSON.
