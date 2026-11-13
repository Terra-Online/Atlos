import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { GroundConnection, Route } from '#@/src/route.ts';
import type { PoseBounds, PoseSpan, SweptSupport } from '#@/src/solver/physical.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';
import { createGoalProjector } from '#@/src/v1/motion/goals.ts';
import type { SourceFace } from '#@/src/v1/solver/physical/moving-ground.ts';

/** a selected route's actual contact pose, independent of its navigation model */
export type SupportBox = PoseBounds & {
  device: string;
  family: SweptSupport['family'] | 'following-box';
  role: 'board' | 'leave' | 'use';
};

type Candidate = { support: number; bounds: PoseBounds; score: number };
type Span = {
  start: number;
  end: number;
  from: Candidate;
  to: Candidate;
  middle: Candidate;
  entry: SupportBox['role'];
  exit: SupportBox['role'];
};

const interpolate = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// clip a route chord against a convex support footprint and its height tolerance.
const faceInterval = (
  a: Vec3,
  b: Vec3,
  face: Surface,
  tolerance: number,
): [number, number] | null => {
  let low = 0,
    high = 1;
  const clip = (from: number, to: number, minimum: number) => {
    if (from < minimum && to < minimum) {
      return false;
    }
    if (from < minimum) {
      low = Math.max(low, (minimum - from) / (to - from));
    } else if (to < minimum) {
      high = Math.min(high, (minimum - from) / (to - from));
    }
    return low <= high;
  };
  let area = 0;
  for (const [i, p] of face.vertices.entries()) {
    const q = face.vertices[(i + 1) % face.vertices.length];
    area += p[0] * q[2] - q[0] * p[2];
  }
  if (Math.abs(area) < 1e-9) {
    return null;
  }
  const sign = Math.sign(area);
  for (const [i, p] of face.vertices.entries()) {
    const q = face.vertices[(i + 1) % face.vertices.length];
    const side = (point: Vec3) =>
      sign * ((q[0] - p[0]) * (point[2] - p[2]) - (q[2] - p[2]) * (point[0] - p[0]));
    if (!clip(side(a), side(b), -1e-8)) {
      return null;
    }
  }
  const origin = face.vertices[0];
  for (let i = 1; i < face.vertices.length - 1; i++) {
    const u = face.vertices[i].map((v, axis) => v - origin[axis]);
    const v = face.vertices[i + 1].map((value, axis) => value - origin[axis]);
    const determinant = u[0] * v[2] - u[2] * v[0];
    if (Math.abs(determinant) < 1e-9) {
      continue;
    }
    const x = (u[1] * v[2] - v[1] * u[2]) / determinant;
    const z = (u[0] * v[1] - v[0] * u[1]) / determinant;
    const offset = (p: Vec3) => p[1] - origin[1] - x * (p[0] - origin[0]) - z * (p[2] - origin[2]);
    if (!clip(offset(a), offset(b), -tolerance) || !clip(-offset(a), -offset(b), -tolerance)) {
      return null;
    }
    return [low, high];
  }
  return null;
};

const validBounds = (bounds: PoseBounds) =>
  [bounds?.min, bounds?.max].every(
    (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
  ) && bounds.min.every((value, axis) => value <= bounds.max[axis]);

/**
 * @param options matching moving bake provenance, raw catalogue and original static support faces
 * @returns a query-local annotator of immutable selected routes and their connection catalogues; legacy
 *   catalogues without pose provenance yield no boxes
 */
export const createMovingRouteAnnotator = ({
  supports,
  surfaces,
  baseSurfaces,
  baseProject,
  sourceFaces,
  tolerance,
}: {
  supports: SweptSupport[];
  surfaces: Surface[];
  baseSurfaces: Surface[];
  baseProject: ReturnType<typeof createGoalProjector>;
  sourceFaces: Map<string, SourceFace[]>;
  tolerance: number;
}): ((route: Route, connections: GroundConnection[]) => SupportBox[]) => {
  const movingSurfaces = surfaces.filter((surface) => sourceFaces.has(surface.id));
  const movingProject = createGoalProjector(movingSurfaces);
  const facesById = new Map([...movingSurfaces, ...baseSurfaces].map((face) => [face.id, face]));
  const nearby = (project: typeof baseProject, a: Vec3, b: Vec3) =>
    project(interpolate(a, b, 0.5), {
      maxVertical: tolerance,
      interaction: {
        radius: Math.hypot(...a.map((value, axis) => value - b[axis])) / 2 + tolerance,
        maxVertical: Math.abs(a[1] - b[1]) / 2 + tolerance,
      },
    }).map((hit) => facesById.get(hit.surface)!);
  const baseIds = new Set(baseSurfaces.map((surface) => surface.id));
  const caps = supports.map((support) => {
    const result = new Map<string, Surface[]>();
    for (const [index, spans] of (support.surfacePoses ?? []).entries()) {
      for (const span of spans) {
        if (span.fromPose === span.toPose && support.surfaces[index]) {
          const key = span.body + '/' + span.fromPose;
          const faces = result.get(key) ?? [];
          faces.push(support.surfaces[index]);
          result.set(key, faces);
        }
      }
    }
    return result;
  });
  const poseCandidate = (supportIndex: number, span: PoseSpan, point: Vec3): Candidate | null => {
    const support = supports[supportIndex];
    const a = support.poses?.[span.fromPose],
      b = support.poses?.[span.toPose];
    if (!a || !b || !validBounds(a) || !validBounds(b)) {
      return null;
    }
    const pieces = caps[supportIndex].get(span.body + '/' + span.fromPose);
    const cap =
      span.fromPose === span.toPose
        ? pieces?.find((piece) => faceInterval(point, point, piece, tolerance))
        : pieces?.[0];
    if (!cap) {
      return null;
    }
    const delta: Vec3 = [b.min[0] - a.min[0], b.min[1] - a.min[1], b.min[2] - a.min[2]];
    if (delta.some((value, axis) => Math.abs(b.max[axis] - a.max[axis] - value) > 1e-5)) {
      return null;
    }
    const relative: Vec3 = [point[0] - delta[0], point[1] - delta[1], point[2] - delta[2]];
    const interval = faceInterval(point, relative, cap, tolerance);
    if (!interval) {
      return null;
    }
    const center = [0, 1, 2].map(
      (axis) => cap.vertices.reduce((sum, p) => sum + p[axis], 0) / cap.vertices.length,
    );
    const squared = delta.reduce((sum, value) => sum + value * value, 0);
    const closest = squared
      ? delta.reduce((sum, value, axis) => sum + (point[axis] - center[axis]) * value, 0) / squared
      : 0;
    const t = Math.max(interval[0], Math.min(interval[1], closest));
    return {
      support: supportIndex,
      bounds: { min: interpolate(a.min, b.min, t), max: interpolate(a.max, b.max, t) },
      score: center.reduce(
        (sum, value, axis) => sum + (value + delta[axis] * t - point[axis]) ** 2,
        0,
      ),
    };
  };
  const contact = (point: Vec3, surfaceId?: string, onlySupport?: number): Candidate | null => {
    if (surfaceId && baseIds.has(surfaceId)) {
      return null;
    }
    const faces =
      surfaceId && sourceFaces.has(surfaceId)
        ? [surfaceId]
        : movingProject(point, {
            maxVertical: tolerance,
            interaction: { radius: tolerance, maxVertical: tolerance },
          }).map((hit) => hit.surface);
    let winner: Candidate | null = null;
    for (const face of faces) {
      for (const source of sourceFaces.get(face) ?? []) {
        if (onlySupport !== undefined && source.support !== onlySupport) {
          continue;
        }
        const support = supports[source.support];
        const raw = support?.surfaces[source.surface];
        if (!raw || !projectPoint([raw], point, { maxVertical: tolerance })) {
          continue;
        }
        for (const span of support.surfacePoses?.[source.surface] ?? []) {
          const candidate = poseCandidate(source.support, span, point);
          if (candidate && (!winner || candidate.score < winner.score)) {
            winner = candidate;
          }
        }
      }
    }
    return winner;
  };
  const rides = new Map<string, { support: number; from: PoseSpan; to: PoseSpan }>();
  for (const [index, support] of supports.entries()) {
    for (const [transferIndex, transfer] of support.transfers.entries()) {
      if (
        transfer.fromPose === undefined ||
        transfer.toPose === undefined ||
        transfer.body === undefined
      ) {
        continue;
      }
      const from = { body: transfer.body, fromPose: transfer.fromPose, toPose: transfer.fromPose };
      const to = { body: transfer.body, fromPose: transfer.toPose, toPose: transfer.toPose };
      const id = 'moving-ride/' + support.id + '/' + transferIndex;
      rides.set(id, { support: index, from, to });
      rides.set(id + '/reverse', { support: index, from: to, to: from });
    }
  }
  return (route, connections) => {
    if (route.status !== 'complete' || !sourceFaces.size) {
      return [];
    }
    const boxes: SupportBox[] = [];
    const add = (candidate: Candidate | null, role: SupportBox['role']) => {
      if (!candidate) {
        return;
      }
      const support = supports[candidate.support];
      if (
        boxes.some(
          (box) =>
            box.device === support.id &&
            [box.min, box.max].every((p, i) =>
              p.every(
                (value, axis) =>
                  Math.abs(value - [candidate.bounds.min, candidate.bounds.max][i][axis]) < 1e-3,
              ),
            ),
        )
      ) {
        return;
      }
      boxes.push({ device: support.id, family: support.family, role, ...candidate.bounds });
    };
    const spans: Span[] = [];
    const byId = new Map(connections.map((connection) => [connection.id, connection]));
    for (const [index, segment] of route.segments.entries()) {
      if (segment.mode !== 'walk') {
        const connection = segment.connection && byId.get(segment.connection);
        if (!connection || !segment.points.length) {
          continue;
        }
        const ride = rides.get(connection.id);
        const a = segment.points[0],
          b = segment.points.at(-1)!;
        const from = contact(a, connection.fromSurface),
          to = contact(b, connection.toSurface);
        if (ride && from?.support === ride.support && to?.support === ride.support) {
          const boarding = poseCandidate(ride.support, ride.from, a),
            leaving = poseCandidate(ride.support, ride.to, b);
          if (boarding && leaving) {
            spans.push({
              start: index,
              end: index + 1,
              from: boarding,
              to: leaving,
              middle: boarding,
              entry: 'board',
              exit: 'leave',
            });
          }
        } else {
          if (from) {
            spans.push({
              start: index,
              end: index,
              from,
              to: from,
              middle: from,
              entry: 'leave',
              exit: 'leave',
            });
          }
          if (to) {
            spans.push({
              start: index + 1,
              end: index + 1,
              from: to,
              to,
              middle: to,
              entry: 'board',
              exit: 'board',
            });
          }
        }
        continue;
      }
      for (let leg = 1; leg < segment.points.length; leg++) {
        const a = segment.points[leg - 1],
          b = segment.points[leg];
        const intervals = nearby(movingProject, a, b).flatMap((face) => {
          const interval = faceInterval(a, b, face, tolerance);
          return interval ? [interval] : [];
        });
        if (!intervals.length) {
          continue;
        }
        const cuts = intervals.flat();
        for (const face of nearby(baseProject, a, b)) {
          const interval = faceInterval(a, b, face, tolerance);
          if (
            interval &&
            intervals.some(([low, high]) => interval[0] <= high && interval[1] >= low)
          ) {
            cuts.push(...interval);
          }
        }
        cuts.sort((x, y) => x - y);
        for (let cut = 1; cut < cuts.length; cut++) {
          const low = cuts[cut - 1],
            high = cuts[cut];
          if (high - low < 1e-8) {
            continue;
          }
          const point = interpolate(a, b, (low + high) / 2);
          if (baseProject(point, { maxVertical: tolerance }).length) {
            continue;
          }
          const middle = contact(point);
          if (!middle) {
            continue;
          }
          const from = contact(interpolate(a, b, low), undefined, middle.support);
          const to = contact(interpolate(a, b, high), undefined, middle.support);
          if (from && to) {
            spans.push({
              start: index + (leg - 1 + low) / (segment.points.length - 1),
              end: index + (leg - 1 + high) / (segment.points.length - 1),
              from,
              to,
              middle,
              entry: 'board',
              exit: 'leave',
            });
          }
        }
      }
    }
    const runs: Span[] = [];
    for (const span of spans) {
      const previous = runs.at(-1);
      if (
        previous &&
        previous.to.support === span.from.support &&
        Math.abs(previous.end - span.start) < 1e-7
      ) {
        previous.end = span.end;
        previous.to = span.to;
        previous.exit = span.exit;
      } else {
        runs.push({ ...span });
      }
    }
    for (const run of runs) {
      if (supports[run.from.support].family === 'conveyor') {
        add(run.middle, 'use');
      } else {
        add(run.from, run.entry);
        const exit =
          run.exit === 'leave' && Math.abs(run.end - route.segments.length) < 1e-7
            ? 'use'
            : run.exit;
        add(run.to, exit);
      }
    }
    return boxes;
  };
};
