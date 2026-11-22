import type { Vec3 } from '#@/src/geometry.ts';
import { createCoverage, physicalTileSpan } from '#@/src/model/coverage.ts';
import { shifted, vector } from '#@/src/model/placement.ts';
import { supportBounds } from '#@/src/model/supports.ts';
import type { Bounds } from '#@/src/scene-pack.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

/** Fixed preparation scopes, independent of query selection. The southern
 * metre in map02 retains complete body coverage at the authored rope trigger. */
export function preparationBounds(scenario: string, frozen?: Bounds): Bounds | undefined {
  if (scenario === 'map02-007') return { min: [-832, -1633], max: [-640, -1440] };
  if (scenario === 'map01-019') return { min: [-704, -224], max: [-512, 64] };
  // Fixed lift/forklift district; construction never follows individual queries.
  if (scenario === 'map01-021') return { min: [-180, -112], max: [-64, -48] };
  if (scenario === 'map02-022') return { min: [-1520, -184], max: [-1496, -160] };
  return frozen;
}

/** Source landmarks, independent of measurement selection. These are candidate
 * feet, not forced edges: native preparation still proves support and motion.
 * Keep small contact faces omitted by the generated navigation mesh visible. */
export const anchors: Record<string, { position: Vec3; source: string }[]> = {
  map01: [
    // Collision record 162565457, triangles 6/7: narrow step above the rope exit.
    { position: [-103.11, 115.06, -534.38], source: 'collision/162565457/6-7' },
    // Opposing basin ledges approaching rope 2100430017.
    { position: [-108.6, 92.662, -529.65], source: 'ground/163550086/16/35' },
    { position: [-106.213, 93.989, -531.599], source: 'ground/163550086/16/27' },
  ],
  map02: [
    // Static bridge 10100030203, authored state 0 away. These four upward
    // top-face centroids are absent from navigation; add standing clearance.
    {
      position: [-750.502597761711, 242.92857397079467, -1390.6660457404166],
      source: 'static-support/10100030203/7',
    },
    {
      position: [-750.8124754961185, 242.92857397079467, -1390.6126245598507],
      source: 'static-support/10100030203/10',
    },
    {
      position: [-754.8831733953175, 242.92857397079467, -1386.9537790021213],
      source: 'static-support/10100030203/182',
    },
    {
      position: [-754.9692209716405, 242.92857397079467, -1386.651332564841],
      source: 'static-support/10100030203/189',
    },
    // Collision-backed rim contact on the isolated eastern chest platform.
    // Interior navigation representatives put its landing beyond a normal jump.
    { position: [-674.096100522, 228.460560872, -1601.256439863], source: 'east-platform/rim' },
    // Finite capsule contact at the southern ridge. Interior nav representatives
    // make this rise look >2.1 m; these collision-proven edge contacts are 2.00 m apart.
    { position: [-773.8, 248.101615509, -1629.3], source: 'south-ridge/lower-contact' },
    { position: [-774.2, 250.103008504, -1629.3], source: 'south-ridge/upper-contact' },
    { position: [-770.801, 237.617, -1598.593], source: 'ground/-21,-42/5215' },
    { position: [-770.767, 241.45, -1599.967], source: 'ground/-21,-42/5134' },
    { position: [-771.55, 245.85, -1597.7], source: 'ground/-21,-42/4993' },
    // Opposing static gap edges; source ground elevations are refined against collision.
    { position: [-767.259, 232.726, -1594.457], source: 'static-gap/east' },
    { position: [-772.464, 232.929, -1594.749], source: 'static-gap/west' },
  ],
};

const placementHints: Record<
  string,
  {
    layout: { device: string; position: Vec3 }[];
    anchors: Vec3[];
    source: string;
  }[]
> = {
  map01: [
    {
      layout: [{ device: '300001708', position: [327.5, 26.851648043847263, -646.5] }],
      anchors: [[327, 28.253298509781267, -645.2]],
      // Flat terrain 4279771580 supports the translated source box; mesh
      // 474682448 supplies the upper ledge. The anchor is the placed box edge contact.
      source: 'collision/4279771580+474682448;following/300001708',
    },
  ],
};

/** Admit fixed scene annotations only when original and selected box bodies
 * are fully covered. Native construction still proves placement and motion. */
export function placementAnnotations(scene: string, physical: PhysicalInput, bounds: Bounds) {
  const tiles = physical.ground.tiles;
  if (!tiles) return [];
  const covered = createCoverage({ bounds, tiles, tileSpan: physicalTileSpan });
  return (placementHints[scene] ?? []).filter(
    (hint) =>
      hint.layout.every((placement) => {
        const support = physical.devices?.followingSupports?.find((s) => s.id === placement.device);
        if (!support) return false;
        const delta = vector((axis) => placement.position[axis] - support.spawn[axis]);
        return support.bodies.every((body) => {
          const original = supportBounds([body]);
          const selected = supportBounds([body.map((point) => shifted(point, delta))]);
          return covered(original.min, original.max) && covered(selected.min, selected.max);
        });
      }) &&
      hint.anchors.every((point) => covered(point, point, physical.ground.options.profile.radius)),
  );
}
