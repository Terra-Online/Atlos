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
`WORLD_EXTRACTOR_NODE` configured, failed AI-ground queries enqueue a
collision-derived player-ground build. Jobs are deduplicated, serialized and
polled by the panel. Their source-bound cache records approximation and coverage
gaps. Disconnected physical-ground queries enqueue `player-route`, which checks
generic jump/drop candidates with collision sweeps and air-wall constraints,
then applies sprint entry requirements and recovery scheduling. Work is bounded
and the panel reports truncated searches. The candidate model requires game
validation.

Ground and route caches include the solver dependency identity and an immutable
movement-export content fingerprint. Route caches also bind the actual arrival,
target, interaction volume and exclusions. Restart the development server after
regenerating source exports.

The inspection overlay draws supplied world-coordinate segments using the viewer
camera, clips lines at the near plane, and uses Ganglia's `sampleJourney` for
timed playback. All movement segments currently share a thin luminous cable
treatment; movement-specific colours and line styles are intentionally deferred.
The panel uses the existing host Panel component and right-hand dock. This is a
through-wall overlay, not a depth-tested visibility or reachability proof. The
overlay consumes the planner's candidate samples. Changing scene, level, or
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
segments. Its model time is about 7.55 seconds. The search reports truncation,
and approximation enclosures can overblock. Current inspection assumes all
teleports unlocked and uses base scene state 0 / area 0. Complete navigation
coverage, movement-device connections and resource-optimal corridor selection
remain open.
