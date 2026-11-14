import type { Vec3 } from '#@/src/geometry.ts';
import type { Bounds } from '#@/src/model/bounds.ts';
import type { JumpModel } from '#@/src/movement.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';
const horizontalGap = (a: Bounds, b: Bounds) =>
  Math.hypot(
    Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], 0),
    Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2], 0),
  );
const pointGap = (point: Vec3, box: Bounds) =>
  Math.hypot(
    Math.max(box.min[0] - point[0], point[0] - box.max[0], 0),
    Math.max(box.min[2] - point[2], point[2] - box.max[2], 0),
  );
const conservative = (time: number) =>
  Number.isFinite(time) ? Math.max(0, time - 64 * Number.EPSILON * Math.max(1, time)) : time;
/** Minimum durations for complete transfers between supported-foot boxes.
 * Boxes must enclose every corrected foot represented by the caller's region.
 * The jump bound includes the full authored ascent and apex hold. A terminal
 * flight clipped at an airborne collection event needs a separate bound.
 */
export function createMotionBounds(
  model: JumpModel,
  { endpointTolerance = 0 }: { endpointTolerance?: number } = {},
) {
  const snapshot = { ...model };
  jumpDuration(0, -1, { ...snapshot, mode: snapshot.maxJumpHeight > 0 ? 'jump' : 'drop' });
  const cap = snapshot.maxHorizontalSpeed;
  const initial = Math.max(cap, snapshot.startHorizontalSpeed ?? 0);
  if (
    ![cap, initial, endpointTolerance].every(Number.isFinite) ||
    cap < 0 ||
    initial < 0 ||
    endpointTolerance < 0
  )
    throw new Error('Invalid motion duration bound');
  const acceleration = snapshot.airOverspeedDeceleration;
  if (acceleration !== undefined && (!Number.isFinite(acceleration) || acceleration <= 0)) {
    throw new Error('Invalid motion launch deceleration');
  }
  const ascent =
    snapshot.maxJumpHeight > 0
      ? Math.sqrt(2 * snapshot.gravity * snapshot.maxJumpHeight) / snapshot.gravity +
        snapshot.apexTime
      : 0;
  const terminalTime = snapshot.maxFallingSpeed / snapshot.fallingGravity;
  const terminalDistance = (snapshot.maxFallingSpeed * terminalTime) / 2;
  const fallTime = (distance: number) =>
    distance <= terminalDistance
      ? Math.sqrt((2 * distance) / snapshot.fallingGravity)
      : terminalTime + (distance - terminalDistance) / snapshot.maxFallingSpeed;
  const inverseTravel = (span: number) => {
    if (span <= 0) return 0;
    if (initial <= cap || acceleration === undefined)
      return initial > 0 ? span / initial : Infinity;
    const braking = (initial - cap) / acceleration;
    const distance = ((initial + cap) * braking) / 2;
    if (span <= distance) {
      return (
        (2 * span) / (initial + Math.sqrt(Math.max(0, initial * initial - 2 * acceleration * span)))
      );
    }
    return cap > 0 ? braking + (span - distance) / cap : Infinity;
  };
  const verticalSlack = (low: number, high: number) =>
    64 * Number.EPSILON * Math.max(1, Math.abs(low), Math.abs(high), snapshot.maxJumpHeight);
  return {
    jump(source: Bounds, landing: Bounds) {
      if (snapshot.maxJumpHeight === 0) return Infinity;
      const low = source.min[1] - endpointTolerance,
        high = landing.max[1] + endpointTolerance;
      const slack = verticalSlack(low, high);
      if (
        landing.min[1] - endpointTolerance >
        source.max[1] + endpointTolerance + snapshot.maxJumpHeight + slack
      ) {
        return Infinity;
      }
      const vertical = ascent + fallTime(Math.max(0, low + snapshot.maxJumpHeight - high - slack));
      return conservative(Math.max(vertical, inverseTravel(horizontalGap(source, landing))));
    },
    /** A supported run-off can walk uphill before its true launch. Without a
     * verified matching prefix, only its whole-motion horizontal speed is bounded.
     * A prefix supplies its corrected launch and supported path distance.
     */
    runOff(source: Bounds, landing: Bounds, prefix?: { launch: Vec3; distance: number }) {
      if (!prefix) {
        const span = horizontalGap(source, landing);
        return conservative(cap > 0 ? span / cap : span > 0 ? Infinity : 0);
      }
      const { launch, distance } = prefix;
      if (
        !Array.isArray(launch) ||
        launch.length !== 3 ||
        !launch.every(Number.isFinite) ||
        !Number.isFinite(distance) ||
        distance < 0
      )
        throw new Error('Invalid supported approach bound');
      const high = landing.max[1] + endpointTolerance;
      const slack = verticalSlack(launch[1], high);
      if (landing.min[1] - endpointTolerance > launch[1] + slack) return Infinity;
      const span = pointGap(launch, landing);
      const horizontal = cap > 0 ? span / cap : span > 0 ? Infinity : 0;
      const supported = cap > 0 ? distance / cap : distance > 0 ? Infinity : 0;
      return conservative(
        supported + Math.max(horizontal, fallTime(Math.max(0, launch[1] - high - slack))),
      );
    },
  };
}
