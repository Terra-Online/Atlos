# Local candidate route inspection

In the development server only, append `?routePreview=/oem/<local-file>.json` to
a World point URL. The local OEM mount serves this data; extracted game
coordinates are not committed. The query survives World navigation and reloads.

The detail page's **Route from nearest teleport** button opens the existing
point view with `?planRoute=nearest`. The development service selects the
closest anchor by 3D distance in that level and assumes it unlocked. It queries
the reusable Ganglia planner, preserving the target camera and drawing the
resulting planar route on the minimap. Source build mismatches, missing
projections and disconnected ground are reported separately. Player-state
availability remains an explicit assumption.

From `talos`, `pnpm dev:world` starts the main site on 5173 and World on 5176,
and directs the detail-page links to the local World server. Set
`VITE_WORLD_CATALOG_URL` in the parent environment so both applications receive
the catalog. The main site's preview and route buttons require that catalog.
For example, with the matching package service already running on 5199,

```sh
VITE_WORLD_CATALOG_URL=http://127.0.0.1:5199/oem/RELEASE_ID/index.json \
WORLD_ROUTING_DIRECTORY=/path/to/local-routing-data \
WORLD_EXTRACTOR_DIRECTORY=/path/to/endfield-noclip \
WORLD_GAME_CONFIG=/path/to/endfield.local.json \
WORLD_EXTRACTOR_NODE="$(command -v node)" \
pnpm dev:world
```

Open a point on 5173 and choose **Route from nearest teleport**. The resulting
World URL has the form `http://127.0.0.1:5176/POINT_TOKEN?planRoute=nearest`.

While a route is active, the minimap fits its projected bounds and camera with
padding. Clearing it restores camera-follow framing. The 3D target view remains
the existing point view until the user selects an overview.

Set `WORLD_ROUTING_DIRECTORY` to the local build-bound exports containing
`<scene>-ground-all.json`, `travel-points.json`, and optional
`<scene>-interaction-points.json`. The point identifier and source transform
select its effective authored interaction goal. Sphere, height and facing
constraints apply to standing endpoints when resolved. Missing rules retain
ground-projection behaviour and are reported. Changed source builds reject stale
interaction data.

With `WORLD_EXTRACTOR_DIRECTORY`, `WORLD_GAME_CONFIG` and optionally
`WORLD_EXTRACTOR_NODE` configured, route queries enqueue a
collision-derived player-ground build. Jobs are deduplicated, serialized and
polled by the panel. An available ground route appears immediately while physical
action optimization continues. Polling retains that route and playback until a
faster complete result arrives. Failed, unavailable or slower optimization results
preserve the incumbent. Their source-bound cache records approximation and coverage
gaps. Physical-ground queries enqueue `player-route` and Ganglia's `planJumpRoute`,
which compares generic ground/jump/drop combinations with collision sweeps and
air-wall constraints, then applies the current sprint entry and recovery policy.
Work is bounded and the panel reports truncated searches. The candidate model
requires game validation.

Movement discovery groups all eligible interaction faces by ground component.
Distance/height-guided region chains receive resumable local candidate-generation
and trajectory-validation batches. Spatially diverse takeoffs and goal-directed
3D landing queries cover intermediate box platforms and longer drops. Partial
candidate coverage remains explicit after a feasible route has been found.
Successful routes also receive shortcut discovery. Takeoff sampling covers exposed
ledges before fine pullbacks; landings include surface interiors beneath platforms.
Ground-reachable transfers and isolated intermediate surfaces retain separate work
shares. Supported continuous ground visibility connects retained action endpoints,
so multiple jumps can join the same selected route. Global continuous-time
optimality and joint resource/corridor optimization remain unresolved.

Ground and route caches include the solver dependency identity and an immutable
movement-export content fingerprint. Route caches also bind the actual arrival,
target, interaction volume and exclusions. Restart the development server after
regenerating source exports.

The inspection overlay projects supplied world-coordinate segments, clips them at
the viewer's near plane, and uses Ganglia's `sampleJourney` for timed playback.
Lines render on the GPU after tonemapping, sampling current opaque/cutout scene
depth with its projection jitter and render scale accounted for. Visible fragments
are solid. Occluded fragments use 5 CSS-pixel strokes and 3-pixel gaps, with phase
continuous across path segments. A 0.15-metre view-depth tolerance avoids ground
contact flicker. Occlusion follows the geometry currently streamed and displayed.
All movement segments share the luminous cable colour treatment.
The panel uses the existing host Panel component and right-hand dock. Dashed
fragments retain visibility through geometry; reachability remains a separate
planner/model concern. The overlay consumes the planner's candidate samples.
Changing scene, level, or
source build hides it.

The route overlay draws optional `supportBoxes` at the selected route's actual
device contacts. Boarding and borrowed conveyor poses are cyan; alighting poses
are orange. A conveyor borrow selects one feasible box at the used position.
Lift trips retain boarding and alighting boxes, coalescing internal ride samples.
Source pose provenance supplies translated bounds or a seesaw's sampled tilt pose.
The existing route Hide control removes these diagrams and releases their GPU
buffers. Catalogue endpoints do not generate route annotations on their own.

The local JSON has `version: 1`, `status: "candidate"`, `scene`, `level`,
`source: { buildGuid, contentHash }`, `title`, `markers: [{ label, position }]`,
and a Ganglia complete-shaped `route` containing supplied segments and times.
Its complete shape enables playback only; the enclosing candidate status remains
authoritative. An optional `overview: { position, yaw, pitch, fovY }` supplies a
manually inspected side camera (angles in radians). No inspection code is loaded
in production.

The descent demonstration uses separately solved continuous ground routes before
and after a provisional jump trajectory. Playback timing uses the
resource-constrained sprint schedule and a candidate air-motion model. The
overlay renders the planner's samples directly. Travel times and traversal
connections still require in-game validation.

The normal detail-button query for the supplied descent example also completes
against the full neighbouring-cell collision build, with ground, jump and ground
segments. Its current model time is about 6.66 seconds. The search reports truncation,
and approximation enclosures can overblock. Current inspection assumes all
teleports unlocked and uses base scene state 0 / area 0. Complete navigation
coverage, movement-device connections and resource-optimal corridor selection
remain open.

## Ground topology planning prerequisite

The 2026-11-04 investigation of point `3500030845` (`100yS9e`, `map01_lv006`)
found two completed local physical solves with `groundStatus=no-verified-route`
and truncated movement discovery. Their ground builds contain 48,313 and 151,122
detail triangles. A larger cached build contains 609,196 triangles. The normal
`?planRoute=nearest` flow subsequently returned `physical-build-failed` with
`groundFailure=disconnected-ground` and message `Physical route job failed`.
The child failure cause and the exact real-scene ground break remain unresolved.

Ganglia's `docs/ground-topology.md` records the evidence, a generic multi-riser
staircase false negative and the proposed G0–G5 implementation sequence. The
architecture now places layered ground support, explicit directed passages and
local connectivity refinement before broad airborne feasibility discovery.
The staircase diagnostic succeeds at finer horizontal resolution, establishing
build-stage sensitivity. Real-scene diagnosis must also trace collision coverage,
exported adjacency, controller behavior and exclusion state.

The integration work is planned in this order.

1. The noclip exporter preserves source-bound support regions, detail heights,
   directed passage domains and their validation evidence from the revised
   Ganglia build interface. Tile and passage assets can be reused across goals.
2. Ganglia uses the same passage contract for ground search, tracing, path
   reconstruction and exposed-boundary discovery. The reference validation
   includes stairs, ramps, overlapping supports, one-way steps and blocked controls.
3. Atlos binds the new artifact schema and solver identity, loads required regional
   dependencies and distinguishes missing input, uncertain ground topology,
   search truncation and execution failure. Coverage expansion follows evidence
   of a route leaving the loaded region. Uncertain internal passages trigger
   source diagnosis or local refinement.
4. The normal point entry presents the first feasible route and its evidence while
   optional action optimization proceeds. Ground, airborne and device actions
   share the established state and resource contracts.

Nearest-anchor inspection currently solves one anchor selected by 3D distance.
Its candidate count describes the eligible pool. A general best-arrival query
needs an explicit eligible start set forwarded to Ganglia's multi-source interface.
Keep that product policy visible in the query and result applicability.

These are planning changes. Implementation and real-game walking validation are
the next milestones.

## Alpha.22 implementation and acceptance

The physical builder preserves consecutive controller-sized steps through local
support connections. Tile passages retain directed entry and exit intervals,
shared by search and tracing. The packed dependency and cache identity use alpha.22.

The default validation snapshot assumes all level tasks completed. The air-wall
exporter records a completed control interpretation where the selected stage
and event effects resolve consistently. The ground importer applies that
result for the explicit completed progression. Other states remain unknown and
blocked. Regenerate the bound ground exports and restart the local service when
changing this snapshot.
Empty mission rise/down lists carry no activation reason. Their initial false
state allows completed down conditions to resolve without a spurious unknown
rise condition.
The `wall-controls-v2` export also scans group-id controllers, including scripts
outside the stored owner. The level-script check type can have a zero owner and
still receive runtime writes. The authored switch is used as a base state after
that scan. Level briefs supply stage limits and parameterized global references.
The completed snapshot selects the declared maximum stage, with a contiguous
stage-domain fallback. Completion-disabled encounter and fog-nest modules clear
their referenced walls, with independent script writers still checked. Known
mission and stage guards prune paths. Unresolved guards preserve possible effects
without asserting that a write executes. Conflicting controller effects remain
unknown. Dynamic properties and trigger state require additional snapshot input.

`player-route` atomically publishes a walking candidate before airborne indexing
and optional optimization. Polling displays it and retains its optimization state.
Interrupted provisional outputs remain resumable. A restart preserves their
provisional status until completed work replaces them.
Foreground physical builds and `--ground-only` queries share one queue, while
full action optimization uses an independent background queue. Walking failure
triggers bounded ground coverage expansion before action discovery. A complete
walking baseline limits optional shortcut discovery to 512 candidates. Unresolved
reachability retains the existing 8000-candidate budget and explicit truncation.

The fixed four-region population contains 71 elevated targets. The independent
high-resolution reference confirms 31 walking-positive cases. Alpha.22 at the
existing resolution completes all 31, including all 13 measured step-profile
cases. Alpha.21 at that resolution completes 27/31 and 10/13 respectively. Both
comparisons use the corrected completed-task snapshot. The other 40 candidates
remain unclassified within the selected inputs and bounds.

The normal entry for `100yS9e` shows a physical-ground route consisting entirely
of walking, with model duration about 21.97 seconds. The selected script wall is
inactive in the completed-task terminal-stage snapshot. Browser inspection
confirms route rendering and playback controls. In-game execution remains a
separate acceptance step.

The additional examples `0loYRkm` and `14lAI8l` both return walking candidates.
Physical walking checks give model durations of 33.02 and 30.39 seconds, while
the current authored-navmesh incumbents have durations of 30.36 and 30.16 seconds.
With physical ground cached and walking-query caches absent, the foreground
commands took about 7.9 and 8.4 seconds. An HTTP run first returned candidates
after about 0.54 and 4.00 seconds. Background shortcut work still takes tens of
seconds and remains visibly separate from the available candidate. Stage timings
are available in the command result's `diagnostics.timingMs`.

`0165dV6` was blocked by a default-off level-script wall retaining unknown
state. After the controller scan permits its base state, the physical walking baseline
is 31.87 model seconds. Optional comparison selects 30.77 seconds with three
jumps. With physical ground cached, the full command takes about 33.7 seconds,
including 7.7 seconds for walking and 24.0 seconds for shortcut comparison. The
normal page displays the completed candidate and playback controls.

The subsequent control audit covers 504 walls. The completed snapshot selects
347 inactive, 43 active and 114 unknown, reducing the earlier 196 unknowns by 82.
Map01 has 112 inactive, 16 active and 30 unknown. Map02 has 235 inactive, 27 active
and 84 unknown. The remaining controls depend on dynamic properties, callbacks,
trigger occupancy, owner activation or incomplete client input. Wall purpose
alone supplies no permanent-boundary classification or activation state.

The three elevated examples retain complete physical walking baselines under
these exclusions. The fixed reference-positive population also retains 31/31
complete walking routes, including all 13 measured step-profile cases.
A focused cached-ground check took 3.6, 7.0 and 7.3 seconds for
`0loYRkm`, `14lAI8l` and `0165dV6`. These timings exclude ground construction and
optional shortcut comparison. The selected stage and authored base switch remain
planning assumptions. Actual save state and in-game execution have not been read.
The final normal-entry API check for `0165dV6` returned a candidate at 1.95 seconds
and completed shortcut comparison at 42.3 seconds, selecting 30.77 model seconds.

## Fixed movement devices

The physical action stage reads an optional `<scene>-traversal-devices.json`
beside the route data. It copies the input to an immutable fingerprinted file and
includes that fingerprint in cache policy 8. Restart the service after replacing
the selected device snapshot. Walking feasibility remains independent of devices.
If walking fails, the action stage tries covered devices and airborne actions
before expanding the physical build rectangle.

The extractor assumes all exported reciprocal vertical ropes enabled and unlocked,
and imports ordinary enabled fixed-target
bounce devices using effective interaction triggers, supported feet, timed paths
and collision/wall checks. Completed mission gates use the existing all-tasks-done
default. Power, unknown overrides and unsupported device models retain unresolved
outcomes. Device candidates can be published while shortcut comparison continues.

Point `3500070545`, token `0UCMfry`, is a real nearest-anchor validation case. The
normal API returns walking, a small jump, walking, launch device `3500031283`, then
walking to the point's interaction volume. The route takes 22.16 model seconds,
against a physical walking baseline of 27.64 seconds. The first candidate arrived
at 0.74 seconds and the full cold query completed at 39.36 seconds. A separate
physical rope case from `300020256` to `300020282` completes with walk/rope/walk
in 5.93 model seconds. In-game execution and the device motion timing remain
independent validation requirements.

The all-enabled policy is independent of the rope's authored state and progression
gate. It retains physical support, interaction and collision checks. Normal entry
for point `10100023101`, token `0PdYvB2`, returns walk/rope/walk through pair
`10100023065` / `10100023064`, taking 5.97 model seconds.

Alpha.23 shares preparation between ground, device and jump stages. On one fixed
profiled physical input, full command time falls from 58.39 to 23.76 seconds and
action search from 33.18 to 11.22, with the same search budget and returned model
cost. First physical construction and optional shortcut work still add latency.

Walking failure now triggers a foreground `--devices-only` query over ready
physical ground. It returns known-device feasibility before entering the background
jump queue. Queued walking/device queries precede further queued ground builds,
with one active foreground job and one background optimizer. This preserves the
existing concurrency limit. `10100023101` returns walk/rope/walk after 13.54 seconds
in the observed cached-ground normal query. The independent small rope command
finishes its known-action stage in 1.45 seconds, without free jump discovery.


Long queries first prepare potential directions from navigation regions grouped by
physical tile and height. Alternative directions and wider halos select sparse
physical tiles before detailed ground and action search. These optimistic relations
are proposals only; missing tiles and an exhausted search do not prove a target
unreachable. Full physical collision remains available inside the selected build
bounds, including air outside the ground corridor. Current proposals can still miss
winding approaches, and large refinements can exceed the process memory limit.

The default preview and routing snapshot fully enables supported ropes, launch
facilities and electrical power, and opens controllable passage barriers. Fixed
structure, boundaries, body clearance and motion checks still apply. This is an
explicit unrestricted planning assumption rather than a recovered saved-game state.

Every physical build and route stage appends a `.progress.jsonl` file beside its
result. Records retain a run identifier, input and source binding, queue and phase
times, per-tile progress, stderr, process exit and final status. Repeated runs append
to the same artifact log; cache reuse is recorded too. The `route-jobs.jsonl` index
links route point identifiers to these files. **Task log** in Route preview opens
the latest stage; `/__routes/logs` opens the index. Both endpoints are local,
read-only and uncached. Logs survive browser reload and server restart.

Route preview keeps the route name, current progress, time and playback/view
controls. Technical verification, occlusion, stamina and model descriptions are
omitted from the panel; diagnostic data remains in the retained artifacts.


The v62 preview uses the matching v62 renderer and release catalog. Physical-ground
cache identity follows the installed extractor's geometry generator, separately from
the route solver version. Overlapping queries and widened proposals share padded
tile meshes through `ground-tile-cache`; request-specific clipping and seams are
rebuilt. Progress says **Reusing route terrain** for hits and retains per-tile cache
and duration fields in the task log. Geometry, body, voxel/step or source changes
invalidate reuse. Walking, device and jump stages still use separate child jobs;
their repeated graph preparation remains a distinct cost from native mesh building.

Task elapsed time is retained independently of each stage's duration. Negative
tile coordinates use the explicit `--tiles=<coordinates>` form.

## Cold query performance

The alpha.53 integration reduces temporary spatial lookup and jump-duration work,
skips empty landing streams and carries unchanged goal probes between phases of
one query. Required input reads overlap, and a device stage admitting no new edges
uses its walking result. Foreground walking/device jobs and background optimization
retain their existing scheduling. A combined progressive-call experiment did not
improve measured rear-approach latency and is not enabled.

All 38 fixed successful requests retained identical complete routes, actions and
candidate limits in separate fresh processes. Aggregate command time was
417.453 / 398.647 seconds and search time 140.154 / 129.342 seconds for alpha.47 /
alpha.53. These are 4.5 and 7.7 percent reductions, excluding native terrain builds,
HTTP polling and other origin attempts. Eight individual timings rose by 12–475 ms;
the largest RSS peak was 3.09 / 3.21 GiB. The requested 90 percent command reduction
remains unmet. Historical route-quality gaps are unchanged by this performance gate.

The physical geometry generator identity is unchanged, so existing tile meshes
remain reusable. Full route results still bind the new solver version. No larger
worker-retention limit or additional simultaneous full search is enabled.

## Coverage proposals

Every query compares the ordinary endpoint rectangle and the coarse corridor
proposals by their physical tile count. Rectangles count the tile columns and rows
intersecting their rounded build bounds. Corridors count their explicit selected
tiles. Endpoint height and distance do not select a planning mode. Equal counts
retain the rectangle first. Failed searches retain both kinds of wider proposals,
interleaved with other teleport origins. Exhausting both proposal families can
require more attempts than the previous four-choice schedule.

The v74 normal-entry regression for `0mpNfFm` had selected a 34.402-second detour.
The tile-ranked local attempt retains the current 6.454-second walk/jump/walk route.
These are model travel seconds. Normal-entry verification reused disk artifacts
and does not establish cold query latency.

## Device chain recovery

The multi-storey `0T264e6` failure had valid start and goal support. Its export
already included the three nearby fixed launchers. Their importer rejected all
three under one combined support/clearance outcome. One aim was 0.700 metres above
collision support, another had no nearby support, and the third had supported
endpoints but needed another legal entry witness for its swept arc.

Alpha.54 retains the fixed launch velocity through an airborne aim until a
supported, completely collision-checked landing. It restores these three actions.
A failed primary search then derives causal entry goals from the known-action
relations. An entry qualifies only if it already connects to the actual target.
Upstream entries cover downstream entries. Each remaining entry receives a
bounded discovery query, with its additional budget recorded in diagnostics.
This additional phase preserves completed primary searches.

Normal HTTP entry now returns a 31.666-second model route for `0T264e6`, including
two launch actions. The full-action task took 35.211 wall seconds with ground,
collision and device preparation reused from preceding stages. Ground construction
and foreground stages are excluded. The latest HTTP read reused that completed
result. A separate fresh CLI process took 47.798 seconds with retained ground files.
These measurements do not meet the cold-query latency target.

The earlier local descent `0mpNfFm` remains 6.454 model seconds through normal HTTP
entry after this integration. Removing coarse waypoints, increasing regional
proposal work and rebuilding the access structure at 0.05-metre cells had not
resolved the multi-storey case by themselves.

A separate frontier experiment rejects unreachable takeoffs before landing
enumeration using the same rejection formerly applied during validation. It remains
outside the default SDK pending independent performance and route validation.

The retained 38 successful requests were replayed with their original content
hashes after integration. All 38 remain complete with identical selected routes,
model costs and discovery limits. Two results contain additional valid unused
actions. Movement and device input snapshots were copied for the replay because
preview startup atomically rewrites identical immutable files. Metadata-only
interruptions were rerun against those copied inputs.

## Round occupancy and decoded ground lifetime

`0mmXi4a` included the nearer teleport in its candidate list. A conservative
capsule envelope had been filled as an AABB, blocking every exit from the
arrival's support face even though the body lay outside the rounded solid.
Alpha.55 supports continuous capsule/sphere exclusion queries. The importer
refines known round-envelope occupancy after conservative ground connectivity
fails, retaining the original triangles, source binding and discovery limits.
Completed ground graphs keep their existing candidate ordering. An unconditional
refinement experiment changed bounded shortcut coverage and made one retained
route slower, so that experiment is not the integrated policy.

Normal HTTP entry now selects the nearer teleport and returns an 11.524-second
model route, replacing the 39.942-second far-anchor route. This is a travel-time
improvement; it does not establish faster cold solving. Capsule axes and length
conventions remain unresolved and their sphere envelopes remain conservative.

A separate `Failed to fetch` report coincided with the World development server
aborting at its roughly 4 GB V8 heap limit. Its job table retained every decoded
physical ground region. The builder now retains one current decoded ground
region; task metadata, route results, disk artifacts and logs remain available.
Revisiting another completed region reads its existing artifact without invoking
the ground builder. Returned ready snapshots retain their own mesh while a
concurrent request switches the current region. Finished task records include
`serverMemory` in bytes, separately from solver-worker memory reports.

`0DPyejn` loads and its HTTP route requests respond again after restart. Its
physical route remains unresolved after multiple anchor and coverage attempts;
restoring the service does not establish reachability for that goal.

The final policy was replayed against 38 frozen successful requests. All remain
complete with identical route geometry, movement timing and discovery limits.
The strict comparator records 37 exact route objects and 36 exact action sets:
one selected route renumbers its connection references, and two action sets differ.
No selected-route cost increases. SDK tests, extractor route/occupancy tests,
server/worker tests, builder scheduling tests and focused type checks pass.

## Moving-support verification

The local catalogue now includes phase-free swept supports for moving platforms,
lotus leaves, conveyor boxes and seesaws, with independent endpoint diagrams.
Static collision, body clearance and steam exclusions remain active.

The remote `16Btp0f` query returned a complete 38.862-second model route after
79.63 HTTP wall seconds. Every sampled walking point had original static support,
so this case provides no evidence of necessary lotus use. A separate arbitrary
goal on a lotus terminal cap has no static support within four vertical metres.
Its fresh-process solve took 25.12 seconds with retained physical inputs and
returned a 33.170-second model route. Of 583 walking samples, 74 were supported
only by the new moving surfaces at both 0.15-metre and 0.5-metre tolerances.
These cover two sweep strips of 37.95 and 9.69 metres. No walking sample lacked
support. This validates the selected phase-free envelope model. Motion phase,
waiting and seesaw angular timing remain open.

The `map02_lv009` remote case `02lUaTb` also returns a complete route from its
retained anchor, 184.83 metres from the goal. A fresh process took 51.90 seconds
and selected a 55.686-second model route with two ziplines and seven jumps.
All 1,116 walking samples have static support and none touch the moving envelope.
The six research-only coarse waypoints in the old request were removed for this
run. Its former out-of-memory exit therefore supplies no comparable speed baseline.

The high-ascent `0YnbG6f` query originally failed during moving-support preparation
because its auxiliary support index exposed a narrower scope than static collision.
The overlay now retains the body-padded static query scope and still requires
clearance-baked support. The same small region completes device preparation in
12.61 seconds and a full solve in 52.51 seconds, but returns unavailable.
Larger coverage attempts also exposed a native vertical-domain limit and a JSON
string-size limit. Reachability for this point remains unresolved.

The alpha.56 frozen replay retains all 38 successful candidates and their selected
costs. GPU rendering of the endpoint overlay still requires manual inspection.
