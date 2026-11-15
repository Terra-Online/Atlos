import { verificationPolicy, within, type VerificationPolicy } from '#@/src/evaluation/policy.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { findGoalHit } from '#@/src/model/goals.ts';
import { validateMotion } from '#@/src/model/motion.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';

const point = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const equal = (a: number, b: number) =>
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** Evaluate the submitted trace without searching, retiming or repairing it.
 * This checks representation and recomputes the objective. Physical feasibility
 * additionally needs world coverage and the controls that produced the trace. */
export interface Evaluation {
  scope: 'route-contract' | 'physical';
  valid: boolean;
  issues: string[];
  costSeconds: number | null;
  length: number | null;
  execution?: { maxWalkSnap: number; costDeltaSeconds: number; lengthDelta: number };
}
export function evaluateRoute(route: Route, options: Partial<VerificationPolicy> = {}): Evaluation {
  const policy = verificationPolicy(options);
  const issues: string[] = [];
  if (route.status !== 'complete')
    return {
      scope: 'route-contract' as const,
      valid: false,
      issues,
      costSeconds: null,
      length: null,
    };
  if (!Number.isFinite(route.arrivalCost) || route.arrivalCost < 0)
    issues.push('Invalid arrival cost');
  if (
    !Array.isArray(route.points) ||
    !route.points.length ||
    !route.points.every(point) ||
    !Array.isArray(route.segments)
  )
    return {
      scope: 'route-contract' as const,
      valid: false,
      issues: [...issues, 'Invalid route trace'],
      costSeconds: null,
      length: null,
    };
  let costSeconds = route.arrivalCost,
    length = 0,
    endpoint = route.points[0];
  for (const [index, segment] of route.segments.entries()) {
    try {
      if (
        !Array.isArray(segment.points) ||
        segment.points.length < 2 ||
        !segment.points.every(point) ||
        !Array.isArray(segment.times)
      )
        throw new Error('Invalid segment trace');
      const duration = segment.times.at(-1)!;
      if (!Number.isFinite(duration) || duration < 0) throw new Error('Invalid segment duration');
      validateMotion({ ...segment, cost: duration });
      if (distance(endpoint, segment.points[0]) > 1e-6)
        issues.push(`Discontinuous segment ${index}`);
      for (let i = 1; i < segment.points.length; i++)
        length += distance(segment.points[i - 1], segment.points[i]);
      costSeconds += duration;
      endpoint = segment.points.at(-1)!;
    } catch (error) {
      issues.push(`Segment ${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (distance(endpoint, route.points.at(-1)!) > 1e-6) issues.push('Inconsistent route endpoint');
  if (
    !Number.isFinite(route.cost) ||
    !within(route.cost, costSeconds, policy.costTolerance, policy.relativeTolerance)
  )
    issues.push('Declared cost differs from trace duration');
  if (
    !Number.isFinite(route.length) ||
    !within(route.length, length, policy.lengthTolerance, policy.relativeTolerance)
  )
    issues.push('Declared length differs from trace length');
  return {
    scope: 'route-contract' as const,
    valid: !issues.length,
    issues,
    costSeconds: issues.length ? null : costSeconds,
    length: issues.length ? null : length,
  };
}

/** Projection tolerance comes from the supplied world/movement snapshot. Solver
 * diagnostics and its claimed groundedTarget are never goal witnesses. */
export function verifyRoute(
  query: RouteQuery,
  route: Route,
  options: { maxVertical: number } & Partial<VerificationPolicy>,
) {
  if (!Number.isFinite(options.maxVertical) || options.maxVertical < 0)
    throw new Error('Invalid projection tolerance');
  const policy = verificationPolicy(options);
  const evaluation = evaluateRoute(route, policy);
  if (!evaluation.valid || route.status !== 'complete') return evaluation;
  const issues = [...evaluation.issues];
  const nearProjection = (a: Vec3, b: Vec3, horizontal = 1e-6) =>
    Math.hypot(a[0] - b[0], a[2] - b[2]) <= horizontal &&
    Math.abs(a[1] - b[1]) <= options.maxVertical + 1e-6;
  const start = query.starts.find(
    (start) => start.id === route.start && start.state === 'available',
  );
  if (
    !start ||
    !nearProjection(start.position, route.points[0]) ||
    !equal(start.cost, route.arrivalCost)
  )
    issues.push('Route does not begin at an available query start');
  const endpoint = route.points.at(-1)!;
  if (query.interaction) {
    if (!findGoalHit([endpoint, endpoint], query.goal, query.interaction))
      issues.push('Route endpoint misses the interaction goal');
  } else if (!nearProjection(query.goal, endpoint, policy.goalTolerance + 1e-6))
    issues.push('Route endpoint misses the goal');
  return {
    ...evaluation,
    valid: !issues.length,
    issues,
    costSeconds: issues.length ? null : evaluation.costSeconds,
    length: issues.length ? null : evaluation.length,
  };
}
