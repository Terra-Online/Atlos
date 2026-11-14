import type { Vec3 } from '#@/src/geometry.ts';
import type { BoostUse, MovementMode } from '#@/src/movement.ts';

const modes = new Set<string>(['walk', 'rope', 'jump', 'drop', 'launch']);
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
// Shared by graph and grounded-connection import. Sample times are measured from
// segment entry, not global time; they preserve acceleration and pauses in a path.
export function validateMotion({
  mode = 'walk',
  points,
  times,
  cost,
  connection,
  requiredGait,
  boost,
}: {
  points: Vec3[];
  cost: number;
  mode?: MovementMode;
  times?: number[];
  connection?: string;
  requiredGait?: 'sprint';
} & {
  boost?: BoostUse;
}) {
  if (
    boost !== undefined &&
    (!boost ||
      typeof boost.id !== 'string' ||
      !boost.id ||
      !Number.isFinite(boost.multiplier) ||
      boost.multiplier <= 1 ||
      !Number.isFinite(boost.duration) ||
      boost.duration <= 0)
  )
    throw new Error('Invalid speed boost segment');
  if (
    !modes.has(mode) ||
    (connection !== undefined && (typeof connection !== 'string' || !connection)) ||
    (requiredGait !== undefined && (requiredGait !== 'sprint' || mode === 'walk'))
  ) {
    throw new Error('Invalid movement segment');
  }
  if (times === undefined) {
    if (mode !== 'walk') throw new Error('Non-walking movement requires sample times');
    return;
  }
  if (
    !Array.isArray(times) ||
    times.length !== points.length ||
    times[0] !== 0 ||
    !times.every(Number.isFinite) ||
    Math.abs(times.at(-1)! - cost) > 1e-7 ||
    (mode !== 'walk' && cost <= 0) ||
    times.some((t, i) => t < 0 || (i > 0 && t < times[i - 1])) ||
    times.some((t, i) => i > 0 && t === times[i - 1] && distance(points[i], points[i - 1]) > 1e-9)
  ) {
    throw new Error('Invalid movement timing');
  }
}
