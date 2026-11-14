import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { GroundTopology } from '#@/src/v1/reach/connectivity.ts';
interface Occurrence {
  surface: string;
  ordinal: number;
}
interface Vertex extends Occurrence {
  component: number;
  position: Vec3;
  x: number;
  z: number;
  retained: boolean;
  repeats?: Occurrence[];
}
interface Group {
  sources: Vertex[];
  retained: Vertex[];
  positions?: Map<string, Vertex>;
}
export interface Proposal {
  key: string;
  rank: number[];
  first: number[];
  from: string;
  to: string;
  points: Vec3[];
  length: number;
  unresolved: boolean;
}
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const compare = (a: readonly number[], b: readonly number[]) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
/** Index vertices once, then materialize transfers only for expanded components.
 * A bucket still chooses the same shortest proposal as the eager input-order pass.
 * Both sides of an encounter are indexed because its later vertex owns the bucket.
 */
export function createTypeScriptTransferQuery(
  surfaces: Surface[],
  topology: GroundTopology,
  radius: number,
  verticalRange: number,
) {
  const cells = new Map<string, { groups: Map<number, Group> }>(),
    components = new Map<number, Vertex[]>();
  const cellKey = (x: number, z: number) => `${x},${z}`;
  let ordinal = 0;
  for (const surface of surfaces) {
    const component = topology.components[topology.ids.get(surface.id)!];
    const vertices = components.get(component) ?? [];
    components.set(component, vertices);
    for (const position of surface.vertices) {
      const x = Math.floor(position[0] / radius),
        z = Math.floor(position[2] / radius);
      const key = cellKey(x, z);
      let cell = cells.get(key);
      if (!cell) {
        cell = { groups: new Map<number, Group>() };
        cells.set(key, cell);
      }
      let group = cell.groups.get(component);
      if (!group) {
        group = { sources: [], retained: [], positions: new Map<string, Vertex>() };
        cell.groups.set(component, group);
      }
      const positionKey = position.join('/'),
        occurrence = { surface: surface.id, ordinal: ordinal++ };
      const duplicate = group.positions!.get(positionKey);
      if (duplicate) {
        (duplicate.repeats ??= []).push(occurrence);
        continue;
      }
      const retained = !group.retained.some((other) => distance(position, other.position) < 0.001);
      const vertex: Vertex = { ...occurrence, component, position, x, z, retained };
      group.positions!.set(positionKey, vertex);
      vertices.push(vertex);
      group.sources.push(vertex);
      if (retained) group.retained.push(vertex);
    }
  }
  for (const cell of cells.values())
    for (const group of cell.groups.values()) delete group.positions;
  return (component: number): Proposal[] => {
    const proposals = new Map<string, Proposal>();
    const consider = (later: Vertex, earlier: Vertex) => {
      if (
        later.component === earlier.component ||
        Math.abs(later.position[1] - earlier.position[1]) > verticalRange ||
        Math.hypot(
          later.position[0] - earlier.position[0],
          later.position[2] - earlier.position[2],
        ) > radius
      )
        return;
      // Duplicate source vertices share geometry, but the first occurrence after
      // this retained neighbour determines the original encounter and surface id.
      let occurrence: Occurrence = later;
      if (later.ordinal <= earlier.ordinal) {
        const repeats = later.repeats ?? [];
        let low = 0,
          high = repeats.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (repeats[middle].ordinal <= earlier.ordinal) low = middle + 1;
          else high = middle;
        }
        if (low === repeats.length) return;
        occurrence = repeats[low];
      }
      const key = [
        Math.min(later.component, earlier.component),
        Math.max(later.component, earlier.component),
        ...later.position.map(Math.floor),
      ].join('/');
      const rank = [occurrence.ordinal, earlier.x - later.x, earlier.z - later.z, earlier.ordinal];
      const length = distance(later.position, earlier.position),
        previous = proposals.get(key);
      const first = previous && compare(previous.first, rank) < 0 ? previous.first : rank;
      if (
        previous &&
        (previous.length < length ||
          (previous.length === length && compare(previous.rank, rank) <= 0))
      ) {
        previous.first = first;
        return;
      }
      proposals.set(key, {
        key,
        rank,
        first,
        from: occurrence.surface,
        to: earlier.surface,
        points: [later.position, earlier.position],
        length,
        unresolved: true,
      });
    };
    for (const vertex of components.get(component) ?? []) {
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const cell = cells.get(cellKey(vertex.x + dx, vertex.z + dz));
          if (!cell) continue;
          for (const [otherComponent, group] of cell.groups) {
            if (otherComponent === component) continue;
            for (const other of group.retained) consider(vertex, other);
            if (vertex.retained) for (const other of group.sources) consider(other, vertex);
          }
        }
    }
    return [...proposals.values()].sort((a, b) => compare(a.first, b.first));
  };
}

export { createTypeScriptTransferQuery as createTransferQuery };
