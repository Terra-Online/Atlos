import type { Vec3 } from '#@/src/geometry.ts';

export const physicalTileSpan = 256 * 0.15;
export const physicalMargin = 24;
export const physicalCoverage = (
  start: number[],
  target: number[],
  approach: {
    margin: number;
    corridor?: { bounds: { min: number[]; max: number[] }; tiles: readonly unknown[] };
  },
) => {
  const { margin, corridor } = approach;
  const min = corridor?.bounds.min ?? [
    Math.min(start[0], target[0]) - margin,
    Math.min(start[2], target[2]) - margin,
  ];
  const max = corridor?.bounds.max ?? [
    Math.max(start[0], target[0]) + margin,
    Math.max(start[2], target[2]) + margin,
  ];
  const bounds = [
    Math.floor(min[0] / 32) * 32,
    Math.floor(min[1] / 32) * 32,
    Math.ceil(max[0] / 32) * 32,
    Math.ceil(max[1] / 32) * 32,
  ];
  const tiles =
    corridor?.tiles.length ??
    (Math.ceil(bounds[2] / physicalTileSpan) - Math.floor(bounds[0] / physicalTileSpan)) *
      (Math.ceil(bounds[3] / physicalTileSpan) - Math.floor(bounds[1] / physicalTileSpan));
  return { bounds, tiles };
};

export type Coverage =
  | 'complete'
  | {
      bounds: { min: [number, number]; max: [number, number] };
      tiles: readonly { x: number; z: number }[];
      tileSpan: number;
    };
/** Check declared geometry coverage without building a collision index. */
export function createCoverage(
  coverage: Coverage,
  defaultRadius = 0,
  scope?: { min: [number, number]; max: [number, number] } | null,
) {
  if (
    coverage !== 'complete' &&
    (!Number.isFinite(coverage.tileSpan) ||
      coverage.tileSpan <= 0 ||
      coverage.bounds.min.some(
        (v, i) =>
          !Number.isFinite(v) ||
          !Number.isFinite(coverage.bounds.max[i]) ||
          v >= coverage.bounds.max[i],
      ) ||
      coverage.tiles.some(({ x, z }) => !Number.isSafeInteger(x) || !Number.isSafeInteger(z)))
  )
    throw new Error('Invalid physical coverage');
  const tiles = new Set(
    coverage === 'complete' ? [] : coverage.tiles.map(({ x, z }) => `${x},${z}`),
  );
  return (a: Vec3, b: Vec3, radius = defaultRadius) => {
    const low = [Math.min(a[0], b[0]) - radius, Math.min(a[2], b[2]) - radius];
    const high = [Math.max(a[0], b[0]) + radius, Math.max(a[2], b[2]) + radius];
    // A prepared bounded index cannot claim facts outside its own scope,
    // including when the caller otherwise declares complete source geometry.
    if (scope && low.some((v, i) => v < scope.min[i] || high[i] > scope.max[i])) return false;
    if (coverage === 'complete') return true;
    if (
      low.some((v, i) => v < coverage.bounds.min[i]) ||
      high.some((v, i) => v > coverage.bounds.max[i])
    )
      return false;
    for (
      let x = Math.floor(low[0] / coverage.tileSpan);
      x <= Math.floor(high[0] / coverage.tileSpan);
      x++
    )
      for (
        let z = Math.floor(low[1] / coverage.tileSpan);
        z <= Math.floor(high[1] / coverage.tileSpan);
        z++
      )
        if (!tiles.has(`${x},${z}`)) return false;
    return true;
  };
}
