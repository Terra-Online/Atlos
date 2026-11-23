import { preparationBounds } from '#@/bench/adapters/ganglia-v2/annotations.ts';
import type { Case, Suite } from '#@/bench/mechanisms/suite.ts';
import type { Window } from '#@/bench/scene-data/loader.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { physicalTileSpan } from '#@/src/model/coverage.ts';
import type { Bounds } from '#@/src/scene-pack.ts';

export type ExecutionScenario = Suite['scenarios'][number] & {
  preparation?: { sourceScenarioId: string; bounds: Window; error?: string };
};
export type ExecutionSuite = Omit<Suite, 'scenarios'> & {
  scenarios: readonly ExecutionScenario[];
};

const tiles = ({ min, max, tiles }: Window) =>
  tiles?.length ||
  (Math.ceil(max[0] / physicalTileSpan) - Math.floor(min[0] / physicalTileSpan)) *
    (Math.ceil(max[1] / physicalTileSpan) - Math.floor(min[1] / physicalTileSpan));
const contains = ({ min, max }: Bounds, p: Vec3) =>
  p[0] >= min[0] && p[0] <= max[0] && p[2] >= min[1] && p[2] <= max[1];
const union = (a: Bounds, b: Bounds): Bounds => ({
  min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
  max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
});
const overlaps = (a: Bounds, b: Bounds) =>
  a.min.every((v, i) => v < b.max[i] && a.max[i] > b.min[i]);

function extent(item: Case): Vec3[] {
  const points = [
    ...item.query.starts.map((start) => start.position),
    item.query.goal,
    ...(item.query.waypoints ?? []),
  ];
  // A multi-box world's authored activity spheres are part of its physical
  // input, including the original boxes that remain obstacles after placement.
  for (const source of item.setup.followingPlacement?.sourceActivityRanges ?? [])
    for (const sign of [-1, 1])
      points.push([
        source.spawn[0] + sign * source.radius,
        source.spawn[1],
        source.spawn[2] + sign * source.radius,
      ]);
  return points;
}

function district(points: Vec3[]): Bounds {
  const padding = 32;
  return {
    min: [0, 2].map(
      (axis) => Math.floor((Math.min(...points.map((p) => p[axis])) - padding) / 32) * 32,
    ) as Bounds['min'],
    max: [0, 2].map(
      (axis) => Math.ceil((Math.max(...points.map((p) => p[axis])) + padding) / 32) * 32,
    ) as Bounds['max'],
  };
}

/** Partition the complete authored suite before measurement filtering. These
 * extents select scene input only: query positions never become graph anchors.
 * Each execution district owns one prebuilt immutable solver and worker. */
export function executionSuite(
  suite: Suite,
  overrides: ReadonlyMap<string, Window> = new Map(),
): ExecutionSuite {
  const byId = new Map(suite.cases.map((item) => [item.id, item]));
  return {
    ...suite,
    scenarios: suite.scenarios.flatMap((spec): ExecutionScenario[] => {
      const input = spec.setup.input;
      if (input.kind === 'frozen-window')
        return [
          {
            ...spec,
            preparation: {
              sourceScenarioId: spec.id,
              bounds: preparationBounds(spec.id, {
                min: [input.bounds[0], input.bounds[1]],
                max: [input.bounds[2], input.bounds[3]],
              })!,
            },
          },
        ];

      const retained = preparationBounds(spec.id);
      type District = {
        id: string;
        bounds: Window;
        cases: (typeof spec.cases)[number][];
        retained?: boolean;
      };
      const districts: District[] = retained
        ? [{ id: spec.id, bounds: retained, cases: [], retained: true }]
        : [];
      for (const item of [...spec.cases].sort((a, b) => a.id.localeCompare(b.id))) {
        const override = overrides.get(item.id);
        if (override) {
          districts.push({
            id: `${spec.id}@${item.id}`,
            bounds: override,
            cases: [item],
            retained: true,
          });
          continue;
        }
        const points = extent(byId.get(item.id)!);
        if (retained && points.every((point) => contains(retained, point))) {
          districts[0].cases.push(item);
          continue;
        }
        const bounds = district(points);
        // Nearby cases share geometry, but a chain of overlapping windows must
        // not gradually turn a local mechanism district into a whole-map load.
        const existing = districts.find(
          (d) => !d.retained && overlaps(d.bounds, bounds) && tiles(union(d.bounds, bounds)) <= 64,
        );
        if (existing) {
          existing.bounds = union(existing.bounds, bounds);
          existing.cases.push(item);
        } else districts.push({ id: `${spec.id}@${item.id}`, bounds, cases: [item] });
      }
      return districts
        .filter((d) => d.cases.length)
        .map((d) => ({
          ...spec,
          id: d.id,
          cases: d.cases,
          training: spec.training.filter((id) => d.cases.some((item) => item.id === id)),
          preparation: {
            sourceScenarioId: spec.id,
            bounds: d.bounds,
            ...(tiles(d.bounds) > 512
              ? {
                  error: `Fixed preparation district needs ${tiles(d.bounds)} tiles, exceeding the 512 tile snapshot limit; a sparse corridor is required`,
                }
              : {}),
          },
        }));
    }),
  };
}
