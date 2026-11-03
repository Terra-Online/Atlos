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
NODE_OPTIONS=--max-old-space-size=8192 \
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
