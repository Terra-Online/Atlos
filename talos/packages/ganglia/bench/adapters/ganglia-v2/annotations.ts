import type { Vec3 } from '#@/src/geometry.ts';
import type { Bounds } from '#@/src/scene-pack.ts';

/** Fixed preparation scopes, independent of query selection. The southern
 * metre in map02 retains complete body coverage at the authored rope trigger. */
export function preparationBounds(scenario: string, frozen?: Bounds): Bounds | undefined {
  if (scenario === 'map02-007') return { min: [-832, -1633], max: [-640, -1440] };
  if (scenario === 'map01-019') return { min: [-704, -224], max: [-512, 64] };
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
