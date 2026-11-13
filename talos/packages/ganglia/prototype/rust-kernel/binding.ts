import { loadNativeLibrary } from '#@/prototype/rust-kernel/native.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import type { TransferQueryFactory } from '#@/src/v1/search/candidate-transfers.ts';

type NativeIndex = { query(component: number): Float64Array };
const { TransferIndex } = loadNativeLibrary() as {
  TransferIndex: new (
    points: Float64Array,
    components: Uint32Array,
    radius: number,
    verticalRange: number,
  ) => NativeIndex;
};

export const createRustTransferQuery: TransferQueryFactory = (
  surfaces,
  topology,
  radius,
  verticalRange,
) => {
  const points: Vec3[] = [],
    owners: string[] = [];
  const count = surfaces.reduce((sum, surface) => sum + surface.vertices.length, 0);
  const packed = new Float64Array(count * 3),
    components = new Uint32Array(count);
  let ordinal = 0;
  for (const surface of surfaces) {
    const component = topology.components[topology.ids.get(surface.id)!];
    for (const point of surface.vertices) {
      packed.set(point, ordinal * 3);
      components[ordinal] = component;
      points.push(point);
      owners.push(surface.id);
      ordinal++;
    }
  }
  const index = new TransferIndex(packed, components, radius, verticalRange);
  return (component) => {
    const result = index.query(component),
      proposals = [];
    for (let offset = 0; offset < result.length; offset += 12) {
      const later = result[offset],
        earlier = result[offset + 1],
        occurrence = result[offset + 2];
      const a = components[later],
        b = components[earlier];
      proposals.push({
        key: [Math.min(a, b), Math.max(a, b), ...points[later].map(Math.floor)].join('/'),
        rank: Array.from(result.subarray(offset + 4, offset + 8)),
        first: Array.from(result.subarray(offset + 8, offset + 12)),
        from: owners[occurrence],
        to: owners[earlier],
        points: [points[later], points[earlier]],
        length: result[offset + 3],
        unresolved: true,
      });
    }
    return proposals;
  };
};
