import type { Vec3, Surface } from '#@/src/geometry.ts';
import type { JumpModel } from '#@/src/movement.ts';
import type { Bounds } from '#@/src/v1/geo/bounds.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';

interface FaceBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  scale: number;
}
export type Face = Surface & Bounds;

const epsilon = Number.EPSILON;
const maximumCells = 16;
const pointDistance = (
  point: Vec3,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) =>
  Math.hypot(
    Math.max(minX - point[0], 0, point[0] - maxX),
    Math.max(minY - point[1], 0, point[1] - maxY),
    Math.max(minZ - point[2], 0, point[2] - maxZ),
  );
// Landing witnesses use bounded affine interpolation of these vertices. Keep
// their rounding allowance outside the box, including the averaged inset centre.
const padding = (surface: Face, axis: number) => {
  const low = surface.min[axis],
    high = surface.max[axis];
  if (low === high) {
    let sum = 0;
    for (let index = 0; index < surface.vertices.length; index++) sum += low;
    if (sum / surface.vertices.length === low) return 0;
  }
  return 32 * epsilon * (surface.vertices.length + 1) * Math.max(1, Math.abs(low), Math.abs(high));
};
/** Reject only faces whose witnesses cannot enter any covered top-K bucket.
 * This is for one non-frontier enumeration: a frontier also records the exact
 * coordinates of discarded witnesses, which cannot be reproduced by this bound.
 * The caller still charges the face against its original neighbour budget.
 */
export function createCandidateBounds({
  model,
  endpointTolerance = 0,
  diversity,
  speed,
  to,
  centers,
  departure,
  pairs,
  limit,
}: {
  model: JumpModel;
  endpointTolerance?: number;
  diversity: number;
  speed: number;
  to: Vec3;
  centers: Map<string, Vec3>;
  departure: Map<string, number>;
  pairs: Map<string, { uncertain: boolean; score: number }[]>;
  limit: number;
}) {
  const vertical = {
    ...model,
    mode: model.maxJumpHeight > 0 ? ('jump' as const) : ('drop' as const),
  };
  const faces = new WeakMap<Face, FaceBounds | false>();
  const boundsFor = (surface: Face): FaceBounds | false => {
    const previous = faces.get(surface);
    if (previous !== undefined) return previous;
    const padX = padding(surface, 0),
      padY = padding(surface, 1),
      padZ = padding(surface, 2);
    const minX = surface.min[0] - padX,
      minY = surface.min[1] - padY,
      minZ = surface.min[2] - padZ;
    const maxX = surface.max[0] + padX,
      maxY = surface.max[1] + padY,
      maxZ = surface.max[2] + padZ;
    const x0 = Math.floor(minX / diversity),
      y0 = Math.floor(minY / diversity),
      z0 = Math.floor(minZ / diversity);
    const x1 = Math.floor(maxX / diversity),
      y1 = Math.floor(maxY / diversity),
      z1 = Math.floor(maxZ / diversity);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    // Beyond this range adding one can leave an index unchanged. Such tiny
    // cells retain the ordinary witness enumeration rather than entering a loop.
    if (
      !Number.isFinite(count) ||
      count < 1 ||
      count > maximumCells ||
      Math.max(Math.abs(x0), Math.abs(y0), Math.abs(z0), Math.abs(x1), Math.abs(y1), Math.abs(z1)) >
        Number.MAX_SAFE_INTEGER
    ) {
      faces.set(surface, false);
      return false;
    }
    const value = {
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      x0,
      y0,
      z0,
      x1,
      y1,
      z1,
      scale: Math.max(
        1,
        Math.abs(minX),
        Math.abs(minY),
        Math.abs(minZ),
        Math.abs(maxX),
        Math.abs(maxY),
        Math.abs(maxZ),
      ),
    };
    faces.set(surface, value);
    return value;
  };
  return (start: { cell?: string; position: Vec3; walk: number }, surface: Face) => {
    const bounds = boundsFor(surface);
    if (!bounds) return false;
    const { minX, minY, minZ, maxX, maxY, maxZ, x0, y0, z0, x1, y1, z1 } = bounds;
    const cell =
      start.cell ?? start.position.map((value) => Math.floor(value / diversity)).join('/');
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const group = pairs.get(`${cell}:${x}/${y}/${z}`),
            worst = group?.at(-1);
          // A face might contain a certain witness. Its score cannot dominate an
          // uncertain bucket tail because uncertainty sorts before numerical score.
          if (!worst || group!.length < limit || worst.uncertain) return false;
        }
    const peak = start.position[1] + model.maxJumpHeight;
    // Nominal flight time decreases with landing height. Above the whole
    // nominal apex, only the tolerance-corrected fallback can supply the score.
    const sourceHeight = minY > peak ? start.position[1] + endpointTolerance : start.position[1];
    const targetHeight = minY > peak ? maxY - endpointTolerance : maxY;
    const duration =
      jumpDuration(
        sourceHeight,
        Math.min(targetHeight, sourceHeight + model.maxJumpHeight),
        vertical,
      ) ?? 0;
    const connected = departure.has(surface.id),
      remaining = connected ? departure.get(surface.id)! : 0;
    const reference = connected ? centers.get(surface.id) : to;
    if (!reference) return false;
    const scale = Math.max(
      bounds.scale,
      Math.abs(reference[0]),
      Math.abs(reference[1]),
      Math.abs(reference[2]),
    );
    // Division into a cell and multiplication back to its boundary can round in
    // opposite directions. Expanded cell clips also retain those boundary ties.
    const cellPadding = 32 * epsilon * Math.max(scale, diversity);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const worst = pairs.get(`${cell}:${x}/${y}/${z}`)!.at(-1)!;
          const distance = pointDistance(
            reference,
            Math.max(minX, x * diversity - cellPadding),
            Math.max(minY, y * diversity - cellPadding),
            Math.max(minZ, z * diversity - cellPadding),
            Math.min(maxX, (x + 1) * diversity + cellPadding),
            Math.min(maxY, (y + 1) * diversity + cellPadding),
            Math.min(maxZ, (z + 1) * diversity + cellPadding),
          );
          const lower = (start.walk + remaining + distance) / speed + duration;
          const slack =
            256 *
            epsilon *
            Math.max(
              1,
              Math.abs(start.walk) / speed,
              Math.abs(remaining) / speed,
              distance / speed,
              duration,
              scale / speed,
              Math.abs(lower),
            );
          // Strict comparison deliberately keeps exact and near ties in their
          // original stable insertion order rather than depending on rounded bounds.
          if (!Number.isFinite(lower) || !(lower > worst.score + slack)) return false;
        }
    return true;
  };
}
