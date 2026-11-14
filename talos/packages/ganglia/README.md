# Ganglia

Ganglia is an experimental route solver for Open Endfield Map. Atlos owns game-data
adaptation and visualization; Ganglia owns route feasibility, search and movement
scheduling. See the [development guide](docs/contributing.md) for local integration.

**License notice:** current project-owned releases use the custom [Ganglia Source-Available
License](LICENSE), which excludes zmdmap.com, fz.wiki and the related operators and projects
defined there. For eligible recipients, it incorporates AGPL 3.0 copyleft obligations,
including the modified-version network source offer. Read the complete license before use.

## Solver interface

Choose an algorithm and its fixed policy when preparing a solver. Scene resources
and movement facts must belong to the same immutable game snapshot. Queries supply
starts, a goal and optional interaction conditions or discovery waypoints.

```ts
import {
  gangliaV1Defaults,
  prepareRouteSolver,
} from '@opendfieldmap/ganglia';

const solver = await prepareRouteSolver(
  { ...gangliaV1Defaults, maxCandidates: 4000 },
  { kind: 'scene', scene, resources, locomotion },
);
try {
  const results = await solver.solveBatch(queries);
} finally {
  await solver.close();
}
```

The factory also accepts prepared physical or surface inputs. Configuration fields,
units and policy constraints are defined in [GangliaV1Config](src/solver/ganglia-v1.ts).
The same policy applies to every query and batch lane. Results distinguish complete,
partial and unverified routes; bounded-search truncation does not prove that no route
exists or that a returned route is optimal.

Package entry points separate callers by responsibility:

- `@opendfieldmap/ganglia`: primary solver factory, configuration, contracts and playback.
- `@opendfieldmap/ganglia/solver`: solver-focused entry for the same factory and contracts.
- `@opendfieldmap/ganglia/solver/host`: resource-adapter operations and serialized work.
- `@opendfieldmap/ganglia/build`: physical ground generation.
- `@opendfieldmap/ganglia/collision`: collision queries.

The `src/v1/` tree contains the ganglia-v1 implementation. It has no package export.
Shared contracts live outside it so another solver can implement the same interface.
Algorithm changes belong in Ganglia. Atlos owns its maintained noclip patches;
`talos/.cache/noclip` is generated source.

## Development

Node.js 24.12 or newer runs the TypeScript sources directly. Native Node consumers
resolve workspace sources outside `node_modules`; browser consumers use their bundler.
The package-local `#@/` imports resolve through `package.json`. Atlos consumes this editable workspace package directly.

```bash
pnpm check
pnpm benchmark:full --limit 3 --json
```

The benchmark records one algorithm lifecycle: input loading, service preparation
(including declared catalog training and freezing), optional independent runtime
warmup, measured queries and shutdown. It reports per-query service/queue/response
times, batch wall time and actual end-to-end successful throughput. Runtime warmup
requires `--warmup-workload <json-file>` with disjoint queries; measured requests
are never used as an excluded warm pass. `--config` accepts a complete serialized
solver configuration. See the [measurement guide](docs/contributing.md#interpret-benchmark-results).
Keep local dependencies, data and generated evidence under the Atlos repository
root `.local/`, or pass explicit paths for existing verified inputs. Use
`--data-root` and `--extractor` when resources live outside the workspace.
