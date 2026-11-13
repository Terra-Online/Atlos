import type { Corridor } from '#@/src/solver/resources.ts';
export const physicalTileSpan = 256 * 0.15;
export const physicalMargin = 24;
export const physicalCoverage = (
  start: number[],
  target: number[],
  approach: { margin: number; corridor?: Corridor },
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
