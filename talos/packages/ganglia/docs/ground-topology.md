# Supported ground topology and general route feasibility

Planning revision, 2026-11-04. The implementation baseline is `0.1.0-alpha.21`,
commit `3a32a5d`. This supplements the state, action and offline-build contracts in
[architecture](architecture.md). It adds a prerequisite to M1–M4 and I0–I1.
The structures and phases below are proposed work. The diagnostic observations
describe the current implementation.

The alpha.22 implementation and fixed-sample results are recorded in
[stair routing validation](stairs-validation.md). It implements local support
connections and directed passage intervals. Regional contraction remains a later
milestone.

## 1. Decision and scope

Represent ordinary movement as motion over layered support regions with explicit
directed passage relations. Level floors, ramps, curbs and stair flights share
this ground-motion model. A stair label can describe a passage for presentation
or diagnostics. Feasibility comes from support, body clearance and controller
rules. Each locally traversable riser contributes to a continuous ground route.

Establish this layer before expanding airborne candidate generation. Ground
traversal, jumping, falling and devices then compose through the action interface
already defined in the architecture. Query-independent ground connectivity and
local passage validation become reusable offline assets.

Define generality through an explicit supported scene, character and operation
domain. Require sound returned routes and preserve search coverage information.
A finite complete search establishes reachability within its stated abstraction.
Coverage of continuous game motion additionally requires a justified abstraction
or refinement argument and physical-model calibration. Budget exhaustion leaves
reachability unresolved.

## 2. Observed evidence

### 2.1 The supplied Atlos case

The URL `http://127.0.0.1:5176/100yS9e` resolves through Atlos's existing token
decoder to point `3500030845` in `map01_lv006`. Its source-derived interaction
center is approximately `[569.172, 45.134, 241.976]`, with radius 3.5 m and
vertical allowance 3 m. The selected nearest anchor is
`TpForMap_ent_3500031060`, approximately `[542.804, 39.416, 249.097]`.

The viewer shows a multilevel industrial structure. The user's report supplies
the expectation of a walking approach through stairs. Exact physical passage
and controller behavior along that approach still require verification.

Existing local artifacts were inspected from the running server's configured
`endfield-noclip/.research` directory. Both consumers use alpha.21. The source
binding is build `2954fa80-23c1-1579-2b22-4ecfd6d70418`, content hash
`23821a7611be5c0478dc4695d96fd74a`.

| Physical build bounds in XZ | Exported support triangles | Imported seam transfers | Discovery SCCs | Exposed boundary edges |
| --- | ---: | ---: | ---: | ---: |
| `[512,192]`–`[608,288]` | 48,313 | 5,376 | 10,208 | 29,860 |
| `[448,160]`–`[640,320]` | 151,122 | 16,844 | 17,628 | 91,948 |
| `[384,96]`–`[704,384]` | 609,196 | 59,796 | unrecorded | unrecorded |

The first two completed cached solves report `groundStatus=no-verified-route`,
`status=unavailable` and truncation. Their summed per-batch neighbor-check counters
are 921,857 and 833,387 respectively. Those counters include repeated work and
describe computational effort. The SCC counts cover the entire build, including
incidental surfaces, so their magnitude alone cannot locate a stair defect.

Local evidence files for the first two route results have suffixes
`9c1c986aeaa1694b0f0b4fe87a8e101b843ed73a14b4914ecbdf400dd771f3ee.json` and
`53a247ad63b2933a68eadd785297594cccfd1d6b00cacdf0a22e5795d7da2da6.json`.
The corresponding ground suffixes are
`c357067be9abb89c6ff41e71730f031815b5fc4b3276485d99c89ffa457946ff.json` and
`04c187b4e20cd74aecaf16cec5da9a1ecca5a6946bb4d5b2885d3749e5a11f1d.json`.
These game-derived files remain local.

Opening the normal `?planRoute=nearest` flow reached the terminal response
`unavailable`, category `physical-build-failed`, message `Physical route job failed`,
with `groundFailure=disconnected-ground`. The child failure cause remains
unresolved. The ground exports also declare incomplete collision coverage.
Real-scene diagnosis must distinguish missing collision, rasterization loss,
exported adjacency loss, excluded passage state and route-search limitations.

### 2.2 A generic staircase diagnostic

An in-memory diagnostic called the current public `buildGroundSurfaces` and
`planGroundRoute` entry points. It used 12 treads, each rising 0.2 m, width 2 m,
with 3 m bottom and top landings. The character radius was 0.35 m, height 1.66 m,
slope limit 46 degrees, step limits 0.4 m up and 0.6 m down, horizontal cell
size 0.15 m and vertical cell size 0.05 m. Endpoints lay inside the landings.
No jump connections were supplied.

| Tread depth | Support triangles | Undirected support components | Ground result |
| --- | ---: | ---: | --- |
| 0.25 m | 8 | 2 | `no-verified-route` |
| 0.30 m | 22 | 3 | `no-verified-route` |
| 0.45 m | 94 | 1 | `complete`, walk |
| 0.60 m | 90 | 1 | `complete`, walk |

Adding explicit vertical risers to the 0.30 m case preserved the failure at
0.15 m horizontal resolution. The same geometry produced complete walking
routes at 0.10 m and 0.075 m, with 142 and 148 exported triangles respectively.

A separate diagnostic queried Recast's native polygon graph before triangle
export, using the same 0.30 m treads and relevant build parameters. At 0.15 m,
`findPath` returned status `1073741888`, including `DT_PARTIAL_RESULT`, and the
last polygon differed from the requested goal polygon. At 0.10 m and 0.075 m,
the native paths reached that goal polygon. This establishes a rasterization
or build-stage connectivity sensitivity in a controlled staircase. Exported
adjacency needs independent checking as well.

The fixture establishes a general false-negative risk under the intended step
model. It leaves the exact real-scene failure and real-game execution open.
Recast documents both the voxel-based climb limit and the effect of resolution
on small curbs and stairs. [Official rcConfig reference](https://recastnav.com/structrcConfig.html).

The existing `test/build.test.ts` and `test/tiles.test.ts` suites were run once
after the planning edits and passed all 12 tests. They cover single steps and
tile constraints. The multi-riser diagnostics above were additional in-memory
experiments and expose a gap in that baseline coverage.

### 2.3 Current representation gaps

| Current location | Observed contract | Consequence for the plan |
| --- | --- | --- |
| `src/build.ts`, `buildGroundSurfaces` | Uses the smaller directional step limit with one vertical voxel of margin, exports detail triangles, then destroys the native mesh | Inspect compact-span, native-polygon and exported topology separately. Preserve authoritative adjacency and support provenance during export |
| `src/build.ts`, `joinTiles` | Emits directed seam midpoint pairs | Carry the usable crossing interval and its height relation through clipping and stitching |
| `src/surfaces.ts`, `surfaceGraph` | Infers shared collinear 3D edges and accepts explicit directed transfers at matching XZ boundaries | Ground-controller passage needs an explicit relation when support heights change |
| `src/straighten.ts`, `createGroundStraightener` | Reconstructs shared-edge adjacency independently and consumes walls and profile | Search, support tracing and path reconstruction need one passage contract, including directed height-changing transfers |
| `src/ground.ts`, `createGroundPlanner` | Searches triangle-center corridors, adds pairwise endpoint visibility, then straightens and retimes | Retain continuous interface geometry and state-dependent local transfers when compressing search |
| `src/jump-planner.ts`, `planJumpRoute` | A failed ground baseline triggers region proposals and bidirectional action frontiers | Diagnose and refine unresolved ground topology before using airborne discovery to seek feasibility |
| Atlos `physical-route-builder.ts` and `dev-route-server.ts` | Cache whole bounds-based builds and expand margins after unavailable solves | Choose refinement or spatial expansion from the failure evidence and share tile-level assets |

The native Detour structure already separates convex navigation polygons from
detail geometry and exposes polygon references and links. The current helper
`getNavMeshPositionsAndIndices` exports detail triangles without those link
records. That is a reusable source for a richer exporter. Native connectivity
still depends on the preceding build's accuracy. [Official Detour reference](https://recastnav.com/group__detour.html).

## 3. Ground state and passage model

### 3.1 Layered support regions

Associate a grounded state with a support region identifier and local position,
alongside the velocity, gait and resource fields required by the existing
hybrid-state contract. A support region records its geometry, admissible body
configuration, local height evaluation, clearance and source dependencies.
Retain multiple supports at the same XZ position. Support identity resolves
bridges, stair flights, landings and the space beneath them.

Store coarse navigation polygons and their adjacency separately from detailed
height/contact samples. Attach detail triangles to their owning region. The
runtime can refine a regional route to physical support geometry without
turning every detail triangle into a global decision node.

SCCs provide a directed topological index. Resource-aware routing continues to
retain distinctions between entry states. A component's internal travel costs
and exit states remain part of local transfer relations.

### 3.2 Directed passage relations

For neighboring supports i and j, define a passage relation

$$
\mathcal P_{ij}\subseteq X_i\times U^*\times X_j.
$$

A member specifies an admissible entry, an executable local control sequence
and the resulting exit. Its spatial entry and exit domains can be intervals or
regions. Store direction, support references, height correspondence, clearance,
controller applicability, motion reconstruction and validation evidence.

Use the same relation for a level crossing, a slope and a controller step.
An upward step and its downward counterpart receive separate authorization.
The relation must check a legal support progression, local rise and descent,
body width, headroom, swept obstacle clearance and active exclusions. Endpoint
height difference alone cannot establish these properties. Brief contact changes
follow the actual controller's stepping rules.

Validate the actual local stepping motion. A linear capsule sweep into a riser
can reject valid controller stepping, while an unconstrained vertical lift can
cross a low ceiling. Preserve the contact and collision rules throughout any
lift, advance and settle sequence. Record uncertainty in the controller model.

For intervals with changing height or overhead clearance, split the interval
or conservatively validate its declared domain. A sampled midpoint establishes
one witness. Interval-wide authorization requires appropriate domain evidence.

### 3.3 Topology construction and refinement

1. Import selected collision, body and movement rules with their source bindings.
   Preserve coverage and exclusion state through every later stage.
2. Build layered support candidates and authoritative local adjacency. Keep
   compact-span or equivalent build diagnostics available locally for refinement.
3. Export navigation regions, detail support and directed passages together.
   Compare native connectivity with exported connectivity before accepting a tile.
4. Investigate uncertain local interfaces using source geometry and the ground
   controller model. Refine rasterization locally when it loses a supported
   passage. Publish only the validated replacement topology and motion witness.
5. Stitch padded neighboring tiles through the same passage contract and update
   affected connectivity indices. Refinement across a seam updates both sides.

Refinement triggers include ambiguous support near a step limit, a small-feature
discontinuity and a native/export connectivity mismatch. Every refinement has a
bounded domain and dependency set. Geometry-based rules apply across the scene.
This allows local computational work to produce reusable assets for every query.

Further investigation should compare retaining Recast polygon topology with an
explicit supported-span ground-controller representation. The synthetic native
failure makes build-stage refinement a required part of that comparison.

### 3.4 Minimal persisted structure and migration

Keep a versioned ground asset with the following records. Exact serialized field
names can follow implementation once G0 fixes their semantics.

| Record | Required contents |
| --- | --- |
| Asset | Schema version, source and controller binding, tile dependencies, region/detail/passage records and coverage |
| Region | Stable local ID, support layer, navigable boundary, references to detail height/contact geometry, clearance and provenance |
| Passage | Directed region pair, paired entry/exit domains, legal control or trace reference, applicability and validation evidence |
| Local transfer | Entry/exit interfaces, applicable state domain, timed motion or reconstruction reference and resource/velocity transition |

Separate raw contact geometry from body-clear navigation geometry. Record whether
clearance erosion is already applied so import and validation apply body margins
consistently. A visual stair slope fitted across treads needs a separately
validated motion and contact reconstruction before it can authorize passage.

Preserve current `Surface[]` callers through their existing shared-edge and
explicit-transfer contract during migration. Introduce richer ground assets
through a versioned adapter or entry point with explicit schema validation.
Current `GroundConnection` excludes `walk`, and current `Portal` stores one pair
of points. Their present shapes need explicit migration to carry supported
passage domains and controller evidence. Define the actual trace samples and
timing at route reconstruction, while retaining passage references for validation.

Prepare one immutable ground asset for repeated queries. Extend existing
`createGroundPlanner`, `surfaceGraph`, `createGroundStraightener` and
`exposedBoundaries` around shared adjacency and direction handling. Reuse
`createWallChecker`, collision queries and source-binding logic. Any new ground
controller kernel has the concrete responsibility of legal step/contact
propagation, which the current airborne sweep interface leaves unspecified.

## 4. Search and offline organization

First construct an inspectable directed ground graph with actual passage
witnesses. Use Dijkstra as the finite reference search. Reuse resource-transition
logic from `locomotion.mjs` in the planned multi-label ground/action search where
velocity, gait or stamina affect continuation. The current scheduler operates
after corridor selection. Add hierarchical routing after small-model equivalence
checks.

Contract a stair flight or other corridor only when local transfer relations
preserve entry and exit domains, travel time, resource evolution, relevant
intermediate goals and access to side exits. Keep branch landings and
capability-changing interfaces explicit. A single center point and zero-cost
component edge lose these conditions.

Search regional interfaces, then reconstruct a continuous supported path using
the same directed passages. Ordinary supported steps can remain `walk` in
playback, with ground-controller semantics retained in the underlying action.
Ground tracing, smoothing, wall checks, retiming and exposed-boundary discovery
must agree on which passages are authorized in each direction.

A ground route supplies a useful feasible incumbent. Reachability discovery can
then focus on unresolved transitions, while optional jump and device actions
continue to compete for better routes. Global time lower bounds must cover all
allowed movement modes. Use the architecture's optimistic action
abstraction for global lower bounds and completeness claims.

The ground-first sequence sets development priority. During solving, share one
request-wide budget among local ground refinement and the other permitted action
families. Preserve progress in each branch. Unknown ground passages retain their
unresolved status while verified jump or device alternatives can supply a
feasible result. Reserve a resumable share for deferred candidates when claiming
coverage under progressive refinement.

Separate these failure responses in build diagnostics.

| Evidence | Next computation |
| --- | --- |
| Missing scene geometry or unresolved collision selection | Acquire or resolve the relevant source data |
| Uncertain local ground passage or rasterization sensitivity | Refine and validate that interface |
| Native and exported connectivity differ | Repair export or clipping and invalidate its dependents |
| A plausible path crosses the loaded boundary | Load or build additional regions |
| Verified ground lacks a required transition | Discover other allowed action families |
| Search budget exhausted or child failed | Retain verified assets and resume unfinished work with its diagnostics |

Offline cache keys bind source geometry, selected state, body, controller rules,
resolution, passage-validation version and tolerances. Query-independent tiles,
passages and regional transfers can serve many goals. Goal access retains its
interaction predicate and support alternatives. Failed samples keep their tested
domains and budgets. Invalidation follows all geometry crossed by each action.

## 5. Repository responsibilities and implementation order

| Stage | Owner and deliverable | Acceptance gate |
| --- | --- | --- |
| G0 Ground contract | Ganglia documents support identity, directed passage semantics, legal stepping, evidence and finite coverage. noclip establishes the source/controller parameters | Specify stairs, ramps, curbs, overlapping floors, one-way descent and blocked passages with the same rules |
| G1 Diagnostic baseline | Ganglia compares native and exported topology and records failed local interfaces. noclip traces their collision sources | Reproduce the generic stair failure and attribute each real-case obstruction to a stage or an explicit unresolved condition |
| G2 Ground assets | Ganglia exports regions, detail support and validated passages, with bounded local refinement. noclip preserves them in source-bound tile artifacts | Ground-only reference search traverses valid staircase families and rejects physically blocked ones |
| G3 Shared hierarchy | Ganglia adds local transfer caching and state-preserving corridor contraction | On small models, compressed and uncompressed searches agree on reachability and the declared cost objective |
| G4 Atlos integration | noclip packages the revised assets. Atlos binds the new solver/schema, loads regional dependencies and shows first-feasible routes and unresolved work | The normal arbitrary-point entry uses the same ground pipeline, reports layer-specific failures and reuses neighboring-query assets |
| G5 Unified actions | Ganglia composes ground, airborne and device actions with resources and replay under the existing architecture | Returned paths satisfy complete state continuity, task completion and the chosen evidence threshold |

G0 and G1 are the immediate next implementation milestone. G2 precedes broad
airborne-search performance tuning. This supplements the existing M0–M4 modeling
sequence and establishes concrete ground acceptance within I0 and I1.

Atlos's current inspection policy selects one nearest anchor by 3D distance.
Only that anchor is solved under this policy, despite five eligible candidates
in this case. Preserve an explicit query policy for nearest-anchor inspection and for
best route among eligible arrivals. Ganglia's general feasibility contract
operates on the supplied eligible start set, and the caller must supply the
complete set required by the selected product policy.

## 6. Acceptance families and evidence still required

Use parameterized geometry families with known intended connectivity. Include
long straight stairs, switchbacks, intermediate and side landings, ramps,
short curbs, overlapping stair flights and floors below stairs. Vary tread
depth, rise, width, grid offset, rotation, tile seam and negative coordinates.
Check travel in both directions under asymmetric step rules.
Require the valid stair families to complete with ground movement alone.

Include negative controls for excessive rises, gaps, obstructing risers, narrow
passages, low ceilings, closed doors and active or unknown walls. Goal cases
include interaction volumes spanning several supports and targets at intermediate
landings. Resource cases verify that corridor contraction preserves feasible
continuations and recovery time.

Measure false-positive and false-negative connectivity separately. Record native
polygons, detail triangles, passages, SCCs, ground labels expanded, airborne
candidates, collision checks, first-feasible time, total solve time, peak memory,
offline build cost and reuse across goals. Compare cold and incremental builds.
Use small exhaustive graph checks before performance-oriented pruning.

Point `3500030845` belongs in the real-scene acceptance set alongside additional
stairs and other passage types. Its collision provenance, exact walking approach,
local connectivity break and controller replay remain open. The current
diagnostics establish the prerequisite and a reproducible generic failure.
Algorithmic completeness remains scoped to the explicitly modeled and covered
domain, with real-game validation recorded separately.


## Collision hot-path validation

The capsule-distance primitives use fixed three-component arithmetic and fixed triangle edges.
This removes temporary map/reduce arrays without changing sweep subdivision, collision inflation,
support selection, contact thresholds or triangle ordering. A seeded differential probe compared
3,000 sweeps and 3,000 support queries against the previous implementation with exact results,
including degenerate geometry. Existing collision, motion and stair regressions remain the release gate.

On one retained real-scene input, the full route and discovered connections were exactly equal.
Action search fell from 44.86 to 11.50 seconds and total solver time from 57.83 to 24.78 seconds.
This is a single-input measurement, not a scene-wide speedup claim. Input decoding, physical indexing
and fine goal support construction are still charged separately; terrain-cache hits alone do not
measure solver latency or establish route optimality.


## Uniform lazy planning investigation (2026-11-09)

All query distances should share the same topology and validation pipeline. Query
length alone must not select a separate solver. A same-region query can finish
without expanding other regions; an unresolved passage triggers local detail and
action discovery. Physical geometry residency follows the current validation
window, while accepted transfers remain reusable under their source dependencies.

The intended combination is HPA-style region entrances and LazySP-style candidate
validation. Preserve directed portals, support identity and distinct spatial
entrances. SCC condensation accelerates reachability but does not replace the
cost of travelling between entrances within a component. Candidate edge costs
must be lower bounds until validated. Rejected candidates trigger replanning;
budget exhaustion leaves an unknown edge resumable.

Primary algorithm references and scope:

- [HPA*](https://webdocs.cs.ualberta.ca/~mmueller/ps/2004/hpastar.pdf) supplies region entrance transfers and hierarchical reuse.
- [LazySP](https://www.ri.cmu.edu/pub_files/2016/3/paper-lazysp.pdf) and [GLS](https://personalrobotics.cs.washington.edu/publications/mandalika2019gls.pdf) defer expensive validation to selected paths.
- [ALT](https://www.microsoft.com/en-us/research/publication/computing-the-shortest-path-a-search-meets-graph-theory/) can strengthen directed graph search after topology and costs stabilize.
- [Polyanya](https://www.ijcai.org/proceedings/2017/70) and [Theta*](https://idm-lab.org/bib/abstracts/papers/aaai07a.pdf) inform local geometric routing. Their planar/grid guarantees do not establish movement feasibility across stacked supports or devices.
- [JPS](https://pathfinding.ai/pdf/harabor-grastien-aaai11.pdf) relies on grid symmetry that resource-dependent directed actions do not generally preserve.

The map02 acceptance pair uses real teleport anchors 25000000462 (south,
lv006) and 37900000014 (north, lv010). Initial topology contains 611,335 polygons
and 1,372,164 directed edges. Exact endpoint projection succeeds, while the
south forward-reachable set initially contains only 581 polygons. A locally
validated physical transfer connects polygons 162861966/1/26 and /1/46 through
walk/jump/walk motion. This local result does not yet satisfy whole-route
acceptance. Full south-to-north validation and the 02gcZm4 ordinary-entry route
remain pending.

Compare short flat paths, short layered paths, device combinations, medium
corridors and the extreme pair. Record topology preparation, candidate counts,
physical validations, maximum resident details, first feasible time and total
time. Select partition and validation-window sizes from this combined set.
