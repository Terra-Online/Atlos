import type { JumpModel } from '#@/src/movement.ts';
import type { Bounds } from '#@/src/v1/geo/bounds.ts';
import { jumpDuration, jumpTravel } from '#@/src/v1/motion/jumps.ts';

export interface EnvelopeOptions {
  model: JumpModel;
  maxDrop: number;
  maxHorizontalDistance: number;
  endpointTolerance?: number;
  reverse?: boolean;
  padding?: readonly number[];
}
interface FlightEnvelope {
  model: JumpModel;
  maxDrop: number;
  endpointTolerance: number;
  initial: number;
  duration(drop: number, mode?: 'jump' | 'drop'): number | null;
  travel(initialSpeed: number, time: number): number;
  reach(drop: number): number;
}
interface Domain {
  sourceHeight: number[];
  targetHeight: number[];
  flightTime: number[];
  initialSpeed: number[];
  horizontal: { x: number[]; z: number[]; distance: number[] };
}

const flightTables = new WeakMap<JumpModel, FlightEnvelope>();
const modelFields = [
  'gravity',
  'fallingGravity',
  'maxJumpHeight',
  'maxFallingSpeed',
  'apexTime',
  'maxHorizontalSpeed',
  'startHorizontalSpeed',
  'airOverspeedDeceleration',
] as const;
const heightResolution = 0.25;
function flightEnvelope(
  model: JumpModel,
  maxDrop: number,
  endpointTolerance: number,
): FlightEnvelope {
  const previous = flightTables.get(model);
  if (
    previous?.maxDrop === maxDrop &&
    previous.endpointTolerance === endpointTolerance &&
    modelFields.every((key) => Object.is(previous.model[key], model[key]))
  )
    return previous;
  const snapshot: JumpModel = {
    gravity: model.gravity,
    fallingGravity: model.fallingGravity,
    maxJumpHeight: model.maxJumpHeight,
    maxFallingSpeed: model.maxFallingSpeed,
    apexTime: model.apexTime,
    maxHorizontalSpeed: model.maxHorizontalSpeed,
    startHorizontalSpeed: model.startHorizontalSpeed,
    airOverspeedDeceleration: model.airOverspeedDeceleration,
  };
  // Validate the shared vertical model, including the zero-jump-height case.
  jumpDuration(0, 0, { ...snapshot, mode: 'drop' });
  const vertical = {
    ...snapshot,
    mode: model.maxJumpHeight > 0 ? ('jump' as const) : ('drop' as const),
  };
  const initial = Math.max(model.maxHorizontalSpeed, model.startHorizontalSpeed ?? 0);
  const analyticReach = (drop: number) => {
    const duration = jumpDuration(0, -drop, vertical);
    if (duration === null) return 0;
    return Number.isFinite(snapshot.airOverspeedDeceleration) &&
      snapshot.airOverspeedDeceleration! > 0
      ? jumpTravel(initial, duration, snapshot)
      : initial * duration;
  };
  const minimumBin = Math.floor(-model.maxJumpHeight / heightResolution);
  const maximumBin = Math.ceil(
    (maxDrop + 4 * endpointTolerance + heightResolution) / heightResolution,
  );
  const count = maximumBin - minimumBin + 1;
  // A higher drop has a longer flight. Rounding up by a quarter metre gives a
  // conservative reach lookup and avoids sqrt/terminal-fall work at every node.
  // Keep extreme parameter ranges bounded and use the shared analytic fallback.
  const table =
    Number.isSafeInteger(count) && count > 0 && count <= 4096
      ? Float64Array.from({ length: count }, (_, index) =>
          analyticReach((minimumBin + index) * heightResolution),
        )
      : null;
  const result = {
    model: snapshot,
    maxDrop,
    endpointTolerance,
    initial,
    duration(drop: number, mode: 'jump' | 'drop' = vertical.mode) {
      return jumpDuration(0, -drop, mode === vertical.mode ? vertical : { ...snapshot, mode });
    },
    travel(initialSpeed: number, time: number) {
      return Number.isFinite(snapshot.airOverspeedDeceleration) &&
        snapshot.airOverspeedDeceleration! > 0
        ? jumpTravel(initialSpeed, time, snapshot)
        : initialSpeed * time;
    },
    reach(drop: number) {
      const index = Math.ceil(drop / heightResolution) - minimumBin;
      return table && index >= 0 && index < table.length ? table[index] : analyticReach(drop);
    },
  };
  flightTables.set(model, result);
  return result;
}
/** Optimistic envelope for the existing jump-discovery candidate contract.
 * The anchor is a nominal takeoff, or a nominal landing when reverse is true.
 * Actual supported feet may differ in height by endpointTolerance. Padding
 * additionally encloses witnesses generated outside an indexed boundary, such
 * as inward boundary offsets followed by vertical navigation projection.
 *
 * This is a necessary candidate test, with no support/collision guarantee.
 * Discovery already bounds total seed-to-landing span and uses its optimistic
 * vertical duration before trying jump, split, waypoint and supported run-off
 * controls. Arbitrary supported approaches outside that contract need their own
 * approach envelope. Model speed expiry is ignored here to retain an upper bound.
 */
export function createJumpEnvelope(
  anchor: readonly number[],
  {
    model,
    maxDrop,
    maxHorizontalDistance,
    endpointTolerance = 0,
    reverse = false,
    padding = [0, 0, 0],
  }: EnvelopeOptions,
) {
  if (
    !Array.isArray(anchor) ||
    anchor.length !== 3 ||
    !anchor.every(Number.isFinite) ||
    !Array.isArray(padding) ||
    padding.length !== 3 ||
    !padding.every((value) => Number.isFinite(value) && value >= 0) ||
    ![maxDrop, maxHorizontalDistance, endpointTolerance, model?.maxHorizontalSpeed].every(
      Number.isFinite,
    ) ||
    maxDrop < 0 ||
    maxHorizontalDistance <= 0 ||
    endpointTolerance < 0 ||
    model.maxHorizontalSpeed < 0 ||
    (model.startHorizontalSpeed !== undefined &&
      (!Number.isFinite(model.startHorizontalSpeed) || model.startHorizontalSpeed < 0))
  ) {
    throw new Error('Invalid jump candidate envelope');
  }
  const flight = flightEnvelope(model, maxDrop, endpointTolerance);
  const [x, y, z] = anchor;
  const [paddingX, paddingY, paddingZ] = padding;
  const rise = model.maxJumpHeight + 2 * endpointTolerance;
  const fall = maxDrop + 2 * endpointTolerance;
  const scale = Math.max(
    1,
    Math.abs(x),
    Math.abs(y),
    Math.abs(z),
    maxHorizontalDistance,
    rise,
    fall,
  );
  return (box: Bounds) => {
    const minX = box.min[0] - paddingX,
      maxX = box.max[0] + paddingX;
    const minY = box.min[1] - paddingY,
      maxY = box.max[1] + paddingY;
    const minZ = box.min[2] - paddingZ,
      maxZ = box.max[2] + paddingZ;
    // Outward roundoff slack keeps exact-height, tangential and large-coordinate
    // boundary witnesses eligible. Non-finite arithmetic cannot justify pruning.
    const epsilon =
      32 *
      Number.EPSILON *
      Math.max(
        scale,
        Math.abs(minX),
        Math.abs(maxX),
        Math.abs(minY),
        Math.abs(maxY),
        Math.abs(minZ),
        Math.abs(maxZ),
      );
    if (!Number.isFinite(epsilon)) return true;
    const dx = Math.max(minX - x, 0, x - maxX),
      dz = Math.max(minZ - z, 0, z - maxZ);
    const span = Math.hypot(dx, dz);
    if (span > maxHorizontalDistance + epsilon) return false;
    if (
      reverse
        ? maxY < y - rise - epsilon || minY > y + fall + epsilon
        : maxY < y - fall - epsilon || minY > y + rise + epsilon
    )
      return false;
    // Flight time increases with source height and decreases with landing height.
    // Clip the optimistic pair to the declared drop allowance before taking the
    // longest possible flight, and use relative heights to retain local precision.
    const source = reverse ? Math.min(maxY, y + fall) : y;
    const landing = reverse ? y : Math.max(minY, y - fall);
    const drop = source - landing + 2 * endpointTolerance + epsilon;
    if (!Number.isFinite(drop)) return true;
    const reach = flight.reach(drop);
    return !Number.isFinite(reach) || span <= reach + epsilon;
  };
}
/** Necessary predecessor and control intervals for an entire target region.
 * Source/target padding encloses nominal witnesses offset from indexed geometry.
 * Ordinary goal projection keeps XZ fixed and changes only height, so an inset
 * boundary source needs XZ padding for its largest inset and Y padding for the
 * projection allowance. endpointTolerance separately covers supported-foot height
 * correction. All boxes and intervals retain double precision.
 *
 * The predicate tests two AABBs before seed projection or spatial enumeration.
 * domain(sourceBox) returns null when impossible, otherwise necessary nominal
 * height, ballistic-time and scalar launch-speed intervals for local generation.
 * These enclose the existing discovery contract and its jump/drop controls.
 * They do not establish collision clearance or include arbitrary supported
 * approaches outside that contract. Expiry is ignored for an optimistic bound.
 */
export function createJumpPredecessor(
  targetBox: Bounds,
  {
    model,
    maxDrop,
    maxHorizontalDistance,
    endpointTolerance = 0,
    sourcePadding = [0, 0, 0],
    targetPadding = [0, 0, 0],
  }: Omit<EnvelopeOptions, 'padding' | 'reverse'> & {
    sourcePadding?: readonly number[];
    targetPadding?: readonly number[];
  },
) {
  const validPadding = (value: unknown) =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => Number.isFinite(component) && component >= 0);
  if (
    !targetBox ||
    !Array.isArray(targetBox.min) ||
    !Array.isArray(targetBox.max) ||
    targetBox.min.length !== 3 ||
    targetBox.max.length !== 3 ||
    ![...targetBox.min, ...targetBox.max].every(Number.isFinite) ||
    targetBox.min.some((value, axis) => value > targetBox.max[axis]) ||
    !validPadding(sourcePadding) ||
    !validPadding(targetPadding)
  ) {
    throw new Error('Invalid jump predecessor region');
  }
  // Keep one validation contract for the scalar movement and discovery settings.
  createJumpEnvelope(targetBox.min, { model, maxDrop, maxHorizontalDistance, endpointTolerance });
  const flight = flightEnvelope(model, maxDrop, endpointTolerance);
  const [sx, sy, sz] = sourcePadding;
  const tx0 = targetBox.min[0] - targetPadding[0],
    tx1 = targetBox.max[0] + targetPadding[0];
  const ty0 = targetBox.min[1] - targetPadding[1],
    ty1 = targetBox.max[1] + targetPadding[1];
  const tz0 = targetBox.min[2] - targetPadding[2],
    tz1 = targetBox.max[2] + targetPadding[2];
  const rise = flight.model.maxJumpHeight + 2 * endpointTolerance;
  const fall = maxDrop + 2 * endpointTolerance;
  const targetScale = Math.max(
    1,
    Math.abs(tx0),
    Math.abs(tx1),
    Math.abs(ty0),
    Math.abs(ty1),
    Math.abs(tz0),
    Math.abs(tz1),
    maxHorizontalDistance,
    rise,
    fall,
  );
  function test(box: Bounds, details: false): boolean;
  function test(box: Bounds, details: true): Domain | null;
  function test(box: Bounds, details: boolean): Domain | null | boolean {
    const x0 = box.min[0] - sx,
      x1 = box.max[0] + sx;
    const y0 = box.min[1] - sy,
      y1 = box.max[1] + sy;
    const z0 = box.min[2] - sz,
      z1 = box.max[2] + sz;
    const epsilon =
      32 *
      Number.EPSILON *
      Math.max(
        targetScale,
        Math.abs(x0),
        Math.abs(x1),
        Math.abs(y0),
        Math.abs(y1),
        Math.abs(z0),
        Math.abs(z1),
      );
    const dx = Math.max(tx0 - x1, x0 - tx1, 0),
      dz = Math.max(tz0 - z1, z0 - tz1, 0);
    const span = Math.hypot(dx, dz);
    const finite = Number.isFinite(epsilon);
    if (
      finite &&
      (span > maxHorizontalDistance + epsilon ||
        y1 < ty0 - rise - epsilon ||
        y0 > ty1 + fall + epsilon)
    )
      return details ? null : false;
    const maximumDrop = Math.min(y1 - ty0, fall) + 2 * endpointTolerance + epsilon;
    const reach = finite && Number.isFinite(maximumDrop) ? flight.reach(maximumDrop) : Infinity;
    if (Number.isFinite(reach) && span > reach + epsilon) return details ? null : false;
    if (!details) return true;
    const slack = finite ? epsilon : Infinity;
    const maxTime = Number.isFinite(maximumDrop)
      ? (flight.duration(maximumDrop) ?? Infinity)
      : Infinity;
    const minimumDrop = y0 - ty1 - 2 * endpointTolerance - slack;
    let minTime = 0;
    if (maximumDrop < 0 && flight.model.maxJumpHeight > 0) {
      minTime = flight.duration(Math.max(-flight.model.maxJumpHeight, minimumDrop)) ?? 0;
    } else if (minimumDrop > 0) minTime = flight.duration(minimumDrop, 'drop') ?? 0;
    // Only a span beyond sustained-speed travel requires a launch impulse. With
    // the longest possible flight, binary search returns an optimistic lower
    // launch speed. The lower bracket is retained to keep boundary cases eligible.
    let initialLow = 0;
    if (Number.isFinite(maxTime) && span > flight.model.maxHorizontalSpeed * maxTime + slack) {
      let low = flight.model.maxHorizontalSpeed,
        high = flight.initial;
      for (let index = 0; index < 40; index++) {
        const middle = (low + high) / 2;
        if (flight.travel(middle, maxTime) + slack >= span) high = middle;
        else low = middle;
      }
      initialLow = low;
    }
    return {
      sourceHeight: [Math.max(y0, ty0 - rise - slack), Math.min(y1, ty1 + fall + slack)],
      targetHeight: [Math.max(ty0, y0 - fall - slack), Math.min(ty1, y1 + rise + slack)],
      flightTime: [Math.max(0, minTime - slack), maxTime + slack],
      initialSpeed: [initialLow, flight.initial],
      horizontal: {
        x: [tx0 - x1 - slack, tx1 - x0 + slack],
        z: [tz0 - z1 - slack, tz1 - z0 + slack],
        distance: [Math.max(0, span - slack), Math.min(maxHorizontalDistance, reach) + slack],
      },
    };
  }
  const predecessor = (box: Bounds): boolean => test(box, false);
  predecessor.domain = (box: Bounds): Domain | null => test(box, true);
  return predecessor;
}
