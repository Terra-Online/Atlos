import type { Vec3 } from '#@/src/geometry.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import type { GroundPlanner } from '#@/src/v1/route/ground.ts';

export type CandidateQuery = Pick<RouteQuery, 'starts' | 'goal' | 'interaction'>;
export type CandidateEvaluation = {
  route: Route;
  rejection?: { reason: string; walk?: { from: Vec3; to: Vec3 } };
  repair?: boolean;
};
export type EvaluateCandidate = (route: Route, query: CandidateQuery) => CandidateEvaluation;

/** A navigation proposal becomes an incumbent only after execution in its own
 * query. Prefix goals differ from the final goal and must be checked separately. */
export const evaluateCandidate = (
  route: Route,
  query: CandidateQuery,
  evaluate?: EvaluateCandidate,
): Route => (route.status === 'complete' && evaluate ? evaluate(route, query).route : route);

export const candidatePlanner = (
  planner: GroundPlanner,
  evaluate?: EvaluateCandidate,
): GroundPlanner['plan'] =>
  evaluate
    ? (starts, goal, query) =>
        evaluateCandidate(
          planner.plan(starts, goal, query),
          { starts, goal, interaction: query?.interaction },
          evaluate,
        )
    : planner.plan.bind(planner);
