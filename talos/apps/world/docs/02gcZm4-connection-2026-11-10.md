# Full ordinary-entry connection for 02gcZm4

The existing rope–vortex–airborne-collection tail was never lost. With alpha.67,
its original physical inputs and then newly rebuilt revision-2 inputs both
returned exactly 8.068946423099348 seconds. The second run rebuilt all 24 tiles:
100,435 navigation faces and 4,207,547 collision triangles.

The ordinary entry instead selected a global corridor to the airborne marker and
cut a target-side window from an unrelated lower support. It repeatedly failed
the ordinary approach to the vortex, before testing the already proven tail.

`terminal-routes.ts` now selects physically revalidated terminal assets by exact
scene, source, geometry-generator, solver, movement and goal-volume bindings. The
ordinary prefix query targets the asset's grounded entry. Prefix and terminal
motion join with exact position continuity and one resource schedule; boost event
clocks and the airborne collection event are retained. No point identifier or
map coordinate is hardcoded in the query implementation.

Current local assets bind Ganglia alpha.67 and navigation export revision 2.
The physical generator hashes collision/support importers and relevant format
decoders, so importer changes cannot reuse an old physical-ground cache merely
because SDK build code stayed unchanged. The 3D package protocol remains 98.

## Observed full result

From the ordinary `02gcZm4?planRoute=nearest` page and `/__routes/nearest`:

- Complete teleport-to-target route, `partial:false`, `optimizing:false`.
- Teleport `TpForMap_ent_22800030004`.
- 707.2061682769495 m, 96.07525585207942 s.
- Rope `22800010018 → 22800010016`, followed by the roof jump and vortex-assisted
  final jump to the collection volume.
- Maximum inter-segment position gap: 2.307076569970579e-13 m.
- Final stamina: 1.192493774915815; 42 dashes.
- This is a complete feasible result, not a claim of globally fastest routing.

Cold global candidate timing: reading 2.419 s, topology preparation 78.431 s,
search 9.998 s, total 90.848 s for 640,747 surfaces and 85 possible origins. The
proven tail was reused; its failed low-floor approach search was not repeated.

Evidence: `.research/stage123/02gcZm4-full-alpha67.json`,
`02-tail-alpha67-regression.json`, `02-profile-before.json`, and
`.research/navigation-assets-current.json` in the local extractor research root.
`terminal-routes.json` stores the model-bound validated tail assets.

Focused terminal binding/join tests: 2 passed. Sparse-window tests: 5 passed.
World type check passed. Ganglia tests: 242 passed. These checks do not establish
that every historical complex route is regression-free. That batch is paused at
34/113 completed: 7 equal, 15 improved, 11 slower, and one historical goal-event
record requiring review. Those results remain recorded for later work.
