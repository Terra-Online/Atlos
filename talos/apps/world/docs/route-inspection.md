# Local candidate route inspection

In the development server only, append `?routePreview=/oem/<local-file>.json` to a World point URL. The local OEM mount serves this data; extracted game coordinates are not committed. The query survives World navigation and reloads.

The inspection overlay draws supplied world-coordinate segments using the viewer camera, clips lines at the near plane, and uses Ganglia's `sampleJourney` for timed playback. All movement segments currently share a thin luminous cable treatment; movement-specific colours and line styles are intentionally deferred. The panel uses the existing host Panel component and right-hand dock. This is a through-wall overlay, not a depth-tested visibility or reachability proof. The candidate trajectory never becomes an open planner connection. Changing scene, level, or source build hides the overlay.

The local JSON has `version: 1`, `status: "candidate"`, `scene`, `level`, `source: { buildGuid, contentHash }`, `title`, `markers: [{ label, position }]`, and a Ganglia complete-shaped `route` containing supplied segments and times. Its complete shape enables playback only; the enclosing candidate status remains authoritative. An optional `overview: { position, yaw, pitch, fovY }` supplies a manually inspected side camera (angles in radians). No inspection code is loaded in production.

The descent demonstration uses separately solved ground routes before and after a provisional jump trajectory. Playback timing uses a candidate motion model, not measured in-game travel time. Ground corridor zigzags are retained; the overlay does not smooth or invent traversal links.
