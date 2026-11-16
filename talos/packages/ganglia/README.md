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

See [package exports](package.json) for supported entry points. Atlos consumes this
editable workspace package; generated noclip source is maintained through Atlos's
integration patches.

## Development

Use Node 26 for the integrated noclip toolchain and install from the `talos`
workspace with its pinned package manager.

```bash
pnpm check
```

For benchmark commands, input bindings and acceptance gates, read
[AGENTS.md](AGENTS.md). Keep private data and generated evidence in Atlos's ignored
root `.local/`, or select verified external inputs explicitly.
