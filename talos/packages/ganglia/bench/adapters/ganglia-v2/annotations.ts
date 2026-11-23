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
    // Finite capsule contacts offset toward the gap from the nearest bridge
    // vertices (triangles 10/189); native preparation proves the sprint crossing.
    {
      position: [-751.1595325277767, 242.9249841322467, -1390.5257706458467],
      source: 'static-support/10100030203/10/edge',
    },
    {
      position: [-754.6483722897664, 242.86580210181893, -1387.3899138024053],
      source: 'static-support/10100030203/189/edge',
    },
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

const scopeHints: Record<
  string,
  {
    scenario?: string;
    scope?: Bounds;
    layout: { device: string; position: Vec3 }[];
    anchors?: Vec3[];
    paths?: Vec3[][];
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
    {
      scenario: 'map01-019',
      scope: { min: [-576, -640], max: [-448, -448] },
      layout: [
        { device: '2100390859', position: [-513.5, 92.51199645362794, -526.5] },
        { device: '2100390488', position: [-518.4, 92.51199645362794, -533] },
      ],
      // The west box reaches the outer ledge. The inner box and existing
      // upper support continue the ascent to the roof.
      paths: [
        [
          [-519.3424875895182, 92.6669964595884, -530.4912562052409],
          [-520.6, 92.6669964595884, -531.8],
          [-517.9499999999999, 94.01699645362794, -532.23],
          [-515.2100000000002, 95.32904853626677, -531.2099999999998],
          [-514.9233333333335, 95.33390105955978, -531.0566666666665],
          [-514.3500000000003, 95.32808306017553, -530.7499999999998],
          [-513.3, 92.67, -529.6499999999999],
          [-513.5, 94.01699648343026, -527.45],
          [-513.5, 94.01699648343026, -525.55],
          [-512.9999877929688, 95.64000368595121, -522.0700073242188],
          [-514.7894868456436, 96.5696714413893, -524.5438239614614],
          [-514.7753249439254, 96.56967156384307, -525.2913430574124],
        ],
      ],
      source: 'collision/185026747;following/2100390488+2100390859/roof-approach',
    },
    {
      scenario: 'map01-019',
      scope: { min: [-576, -640], max: [-448, -448] },
      layout: [
        {
          device: '2100021143',
          position: [-541.47998046875, 92.51199673329485, -609.239990234375],
        },
      ],
      source: 'following/2100021143/south-roof',
    },
    {
      scenario: 'map01-034',
      scope: { min: [-608, -640], max: [-352, -416] },
      layout: [{ device: '2100390859', position: [-441, 92.51199645362794, -537.7] }],
      // Use the box to enter the enclosed street, then reach the roof via
      // three narrow support faces along the northern wall.
      paths: [
        [
          [-439.64063408852155, 92.66699637631487, -536.8687261962891],
          [-439.15000000596046, 92.66699636030334, -537.7],
          [-441, 94.01699648343026, -537.7],
          [-441, 92.6669964220809, -534.4],
          [-439, 92.66699642285687, -530],
          [-439.0575198716132, 92.6669964439848, -523.5002545077234],
          [-439.1000000000002, 92.6669964595884, -515.899999999999],
          [-440.644752107858, 94.03385079395568, -515.9205518180665],
          [-441.324583875268, 95.31853118580821, -516.4846846671692],
          [-442.07324372270955, 96.705680017608, -518.0882513755295],
          [-442.23815409362953, 96.70568001747097, -518.5271678043072],
        ],
      ],
      source: 'collision/206182586;following/2100390859/north-steps',
    },
    {
      scenario: 'map01-037',
      layout: [
        {
          device: '2100390488',
          position: [-434.8389892578125, 92.51199627673695, -537.5650024414062],
        },
      ],
      // The translated roof breaks the rise between the basin and the upper
      // ledge. Keep both roof contacts visible to the prepared jump search.
      anchors: [
        [-437.1, 92.66699636490041, -537.5650024414062],
        [-435.03900146484375, 94.01699630653927, -537.3650309244791],
        [-434.6390075683594, 94.01699630653927, -537.7650349934896],
        [-433.8000183105469, 95.33148283294871, -535.0499877929688],
      ],
      source: 'following/2100390488/basin-ledge',
    },
  ],
  map02: [
    {
      scenario: 'map02-020',
      scope: { min: [-608, 448], max: [-512, 576] },
      layout: [
        {
          device: '10200270059',
          position: [-557.9429931640625, 237.94593307375908, 540.000024420023],
        },
      ],
      // The source box provides the last step into the raised interaction.
      anchors: [
        [-557.9429931640625, 238.10093307971954, 535.500024420023],
        [-557.7430216471354, 239.4509331035614, 539.8000284830729],
        [-557.9429931640625, 239.4509331035614, 540.6000366210938],
      ],
      source: 'following/10200270059/upper-interaction',
    },
  ],
};

/** Admit fixed landmarks and layouts only within complete coverage.
 * Native construction still proves support, placement and motion. */
export function scopeAnnotations(
  scene: string,
  scenario: string,
  physical: PhysicalInput,
  bounds: Bounds,
) {
  const tiles = physical.ground.tiles;
  if (!tiles) return [];
  const covered = createCoverage({ bounds, tiles, tileSpan: physicalTileSpan });
  return (scopeHints[scene] ?? [])
    .map(({ anchors = [], paths = [], ...hint }) => ({
      ...hint,
      anchors: [...anchors, ...paths.flat()],
      links: paths.flatMap((path) => path.slice(1).map((to, index) => ({ from: path[index], to }))),
    }))
    .filter(
      (hint) =>
        (!hint.scenario || hint.scenario === scenario) &&
        (!hint.scope ||
          (hint.scope.min.every((value, axis) => value === bounds.min[axis]) &&
            hint.scope.max.every((value, axis) => value === bounds.max[axis]))) &&
        hint.layout.every((placement) => {
          const support = physical.devices?.followingSupports?.find(
            (s) => s.id === placement.device,
          );
          if (!support) return false;
          const delta = vector((axis) => placement.position[axis] - support.spawn[axis]);
          return support.bodies.every((body) => {
            const original = supportBounds([body]);
            const selected = supportBounds([body.map((point) => shifted(point, delta))]);
            return covered(original.min, original.max) && covered(selected.min, selected.max);
          });
        }) &&
        hint.anchors.every((point) =>
          covered(point, point, physical.ground.options.profile.radius),
        ),
    );
}
