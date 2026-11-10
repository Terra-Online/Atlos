# Initial corridor and device-detour corrections

The first navigation candidate previously concatenated polygon centres and portal
midpoints. The result was a graph traversal polyline, including repeated sideways
turns on a straight bridge. That polyline also supplied the physical window bounds.

The physical planner compared walking and actions to each window's selected end.
It did not compare an excursion spanning multiple windows with a ground return
inside a later walking segment. A local device could therefore participate in a
valid but unnecessary trip up a roof and back to the original ground corridor.
This was an incomplete comparison of alternatives, rather than an inherently
required rooftop visit or an intrinsically useful device.

## Changes

- Ganglia generates `candidate.points` by tracing each known ground run through
  its support geometry and authoritative directed portals. The selected corridor
  and one neighbour ring are prepared locally. `path` and unresolved edge identity
  stay available for rejection and diagnostics; device/unknown trajectories remain
  hard boundaries. The window planner consumes the new points directly.
- `pruneGroundDetours` compares selected action excursions with walking over the
  same physical support, body and exclusion constraints. Cuts occur only on walk
  segment boundaries. Unreachable support components are rejected before they can
  exhaust the bounded comparison budget. Useful faster devices remain eligible.
- Every accepted replacement preserves exact route endpoints and passes a complete
  resource retiming. Airborne collection events are retained and remapped. Boost
  timelines are preserved conservatively: routes carrying boost evidence are not
  pruned by this pass.
- The ordinary extractor route entry and the window join both run the comparison.
  Window joins include the preceding accepted fragment, allowing a replacement to
  cross a previous window boundary. Completed-window accounting follows evidence,
  independently of how many fragments remain after replacement.
- Non-walking physical result cache policy advances from 17 to 18. The installed
  Ganglia package is alpha.66.

## Recorded map02 checks

All measurements use retained local physical geometry and the declared completed
scene snapshot. They establish these local model routes, not complete new
south-to-north physical validation.

| Case | Before | After |
| --- | --- | --- |
| Screenshot 1, yellow-line endpoints | 107.926 m; 13.829 s; 4 jumps, 1 drop, 1 launch | 9.696 m; 1.310 s; walking only |
| Same area, two complete physical fragments through the next upper endpoint | 193.247 m; 26.308 s | 94.826 m; 13.976 s; 4 later jumps retained |
| Screenshot 2, bridge from Z=358.400 to 396.800 | 26 graph-polyline points; 49.270 m | 4 supported points; 38.430 m; 0 unresolved transfers |
| Existing accepted south-to-north prefix, replaced local excursion and whole-prefix resource retiming | 3686.096 m; 508.766 s | 3587.866 m; 496.379 s |

The bridge's two intermediate points encode an actual 0.030 m height transition.
They are not remaining lateral graph-centre turns.

Local evidence is under the extractor research directory `stage123/`:
`action-detours-comparison.json`, `action-detours-window-comparison.json`,
`bridge-candidate-comparison.json`, `north-south-quality-prefix.json`, and
`north-south-quality.json`. The preview retains a verified prefix, candidate
remainder and separately checked target-side approach. Its draft playback timing
is not a physical travel-time result.

## Validation and limits

Focused coverage protects blocked/missing ground, useful devices, exact endpoints,
full resource retiming, collection events, closed excursions, comparison-budget
starvation, corridor holes, one-way height transitions and cross-window replacement.
The bounded improvement pass does not prove global shortest paths. Action discovery
costs and full-route validation are intentionally deferred to the next step.

Validation completed: Ganglia 239/239 tests; World window/preview tests 4/4;
extractor player-route tests 18/18; World type check and whitespace check passed.
The extractor-wide type check remains blocked by errors outside the changed route
entry (Map/WeakMap `getOrInsertComputed`, Buffer generic compatibility, and DOM
symbols imported from viewer code). It is not reported as passing.

Ganglia local commit: `d2e6d8d`. Atlos integration remains in the working tree
alongside the earlier pending navigation/data changes; no remote push was made
for this step.
