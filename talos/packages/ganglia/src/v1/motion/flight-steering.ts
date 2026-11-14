import type { Vec3 } from '#@/src/geometry.ts';
import {
  type JumpOptions,
  type MotionControl,
  jumpDuration,
  jumpVerticalRange,
} from '#@/src/v1/motion/jumps.ts';

// Only the constant-horizontal jump family has this inverse time interval.
// Other controls retain their complete trajectory and goal checks.
export function mayReachGoal(
  start: Vec3,
  end: Vec3,
  goal: Vec3,
  radius: number,
  model: Omit<JumpOptions, 'mode' | 'profile' | 'walls' | 'sweep'>,
  control: MotionControl,
) {
  if (
    control.mode !== 'jump' ||
    control.horizontalSplit !== undefined ||
    control.horizontalWaypoint !== undefined ||
    model.horizontalSplit !== undefined ||
    model.horizontalWaypoint !== undefined ||
    control.expireAfter !== undefined ||
    model.expireAfter !== undefined
  )
    return true;
  const movement = { ...model, ...control };
  const duration = jumpDuration(start[1], end[1], movement);
  if (duration === null) return false;
  const dx = end[0] - start[0],
    dz = end[2] - start[2],
    span = Math.hypot(dx, dz);
  if (span / duration > movement.maxHorizontalSpeed) return true;
  // Goal checks intersect sampled chords. Inflate by the maximum parabola/chord
  // deviation so even a tangent hit on an old chord remains eligible here.
  const scale = Math.max(
    1,
    radius,
    ...start.map(Math.abs),
    ...end.map(Math.abs),
    ...goal.map(Math.abs),
  );
  const expanded =
    radius +
    (Math.max(movement.gravity, movement.fallingGravity) * 0.025 ** 2) / 8 +
    64 * Number.EPSILON * scale;
  if (!Number.isFinite(expanded)) return true;
  const ax = start[0] - goal[0],
    az = start[2] - goal[2];
  let near = 0,
    far = 1;
  if (span === 0) {
    if (Math.hypot(ax, az) > expanded) return false;
  } else {
    const squared = dx * dx + dz * dz;
    const center = -(ax * dx + az * dz) / squared;
    const perpendicular = Math.hypot(ax + center * dx, az + center * dz);
    if (![squared, center, perpendicular].every(Number.isFinite)) return true;
    if (perpendicular > expanded) return false;
    const extent = Math.sqrt(
      Math.max(0, ((expanded - perpendicular) * (expanded + perpendicular)) / squared),
    );
    near = Math.max(0, center - extent);
    far = Math.min(1, center + extent);
    if (near > far) return false;
  }
  const range = jumpVerticalRange(start[1], end[1], movement, near * duration, far * duration);
  return !range || (range.min <= goal[1] + expanded && range.max >= goal[1] - expanded);
}
