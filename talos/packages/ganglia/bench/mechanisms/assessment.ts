/**
 * Mechanism assessment observes routes and source geometry without changing
 * solver outcomes. Expected rejection is independent from search completion;
 * exercise evidence cannot reject a valid alternative route. Facility receipts
 * certify imported geometry only, and first-complete capture is observational.
 */
import { isDeepStrictEqual } from 'node:util';

import type { StartResolution } from '#@/bench/mechanisms/query.ts';
import type { Case } from '#@/bench/mechanisms/suite.ts';
import { classify } from '#@/bench/outcome.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { physicalTileSpan } from '#@/src/model/coverage.ts';
import { roofContains, shifted } from '#@/src/model/placement.ts';
import { projectPoint } from '#@/src/model/support.ts';
import type { RouteQuery, RouteResult, RouteEvent } from '#@/src/solver/contract.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

export function expectation(c: Case): 'complete' | 'reject' | 'constraint' {
  if (c.expected !== undefined) return c.expected;
  // Flat manifests encode expectations in assertions and group names.
  if (
    c.assertions.includes('no-complete-route-from-unavailable-arrival') ||
    c.assertions.includes('uncovered-target-cannot-be-complete')
  )
    return 'reject';
  return c.group === 'boundary-and-rejection' ? 'constraint' : 'complete';
}
/** Expected rejection and mechanism constraints do not change the search outcome. */
export function matchesExpectation(c: Case, result: RouteResult) {
  const status = classify(result);
  if (status === 'timeout' || status === 'error') return false;
  if (expectation(c) === 'reject') return status === 'no-route' && !result.partial;
  return expectation(c) === 'constraint' || status === 'success';
}
function singleConveyorPose(
  c: Case,
  result: RouteResult,
  input?: Pick<PhysicalInput, 'devices'>,
): boolean | undefined {
  const route = result.route;
  if (route.status !== 'complete' || !input || route.segments.some((s) => s.mode !== 'walk'))
    return undefined;
  const boxes = (result.supportBoxes ?? []).filter(
    (b) =>
      b.family === 'conveyor' && (!c.setup.requiredSupport || b.device === c.setup.requiredSupport),
  );
  if (boxes.length !== 1 || boxes[0].role !== 'use') return false;
  const box = boxes[0],
    support = input.devices?.movingSupports?.find((s) => s.id === box.device);
  if (!support?.poses || !support.surfacePoses) return undefined;
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-5;
  for (const transfer of support.transfers) {
    if (transfer.fromPose === undefined || transfer.toPose === undefined) continue;
    const a = support.poses[transfer.fromPose],
      b = support.poses[transfer.toPose];
    if (!a || !b) continue;
    const delta = b.min.map((v, i) => v - a.min[i]),
      squared = delta.reduce((sum, v) => sum + v * v, 0);
    const t = squared
      ? delta.reduce((sum, v, i) => sum + v * (box.min[i] - a.min[i]), 0) / squared
      : 0;
    if (
      t < -1e-6 ||
      t > 1 + 1e-6 ||
      !a.min.every(
        (v, i) => close(box.min[i], v + t * delta[i]) && close(box.max[i], a.max[i] + t * delta[i]),
      )
    )
      continue;
    for (const [index, spans] of support.surfacePoses.entries()) {
      if (!spans.some((s) => s.fromPose === transfer.fromPose && s.toPose === transfer.fromPose))
        continue;
      const surface = support.surfaces[index];
      if (!surface) continue;
      const translated = {
        ...surface,
        vertices: surface.vertices.map((p) => p.map((v, i) => v + box.min[i] - a.min[i]) as Vec3),
      };
      // A convex source roof containing every endpoint also contains each straight
      // walk chord. Complex jump/walk episodes remain explicitly unassessed here.
      if (
        route.segments.every((s) =>
          s.points.every((p) => !!projectPoint([translated], p, { maxVertical: 0.02 })),
        )
      )
        return true;
    }
  }
  return false;
}

export function exercised(c: Case, result: RouteResult, input?: Pick<PhysicalInput, 'devices'>) {
  const route = result.route;
  const used = new Set<string>();
  if (route.status === 'complete' && input)
    for (const p of route.placements ?? []) {
      const box = input.devices?.followingSupports?.find((b) => b.id === p.device);
      if (!box) continue;
      const bodies = box.bodies.map((b) =>
        b.map((v) =>
          shifted(v, p.position.map((v, k) => v - box.spawn[k]) as [number, number, number]),
        ),
      );
      if (
        route.segments.some((s) =>
          (s.mode === 'walk' ? s.points : [s.points[0], s.points.at(-1)!]).some((point) =>
            bodies.some(
              (body) =>
                Math.abs(point[1] - Math.max(...body.map((v) => v[1]))) <= 0.02 &&
                roofContains(body, point),
            ),
          ),
        )
      )
        used.add(p.device);
    }
  return c.assertions
    .filter((a) => a.startsWith('exercise:'))
    .map((assertion) => {
      let hit: boolean | undefined;
      if (route.status === 'complete') {
        const name = assertion.slice(9),
          segments = route.segments;
        const contact = (family?: string) =>
          result.supportBoxes?.some(
            (b) =>
              (!family || b.family === family) &&
              (!c.setup.requiredSupport || b.device === c.setup.requiredSupport),
          ) ?? false;
        if (['rope', 'drop', 'launch'].includes(name)) {
          const prefix = `${name}/${c.setup.requiredDevice}`;
          hit = segments.some(
            (s) =>
              s.mode === name &&
              !s.traversal &&
              (!c.setup.requiredDevice ||
                s.connection === prefix ||
                s.connection?.startsWith(prefix + '/')),
          );
        } else if (name === 'boost-pickup')
          hit =
            route.boosts?.some((b) => !c.setup.requiredDevice || b.id === c.setup.requiredDevice) ??
            false;
        else if (name === 'box-placement') hit = used.has(c.setup.requiredSupport ?? '');
        else if (name === 'joint-box-placement')
          hit =
            (c.setup.followingPlacement?.movableSourceIds ?? []).every((id) => used.has(id)) &&
            used.size >= 2;
        else if (name.startsWith('at-least-')) hit = used.size >= Number(name.split('-')[2]);
        else if (name === 'waterwheel-circular-surface')
          hit = contact('waterwheel') && segments.some((s) => s.traversal === 'moving-support');
        else if (
          [
            'contact-support',
            'moving-support-transfer',
            'swept-roof-support',
            'vertical-reachability',
            'sampled-tilt-support',
          ].includes(name)
        )
          hit =
            contact() &&
            (name !== 'moving-support-transfer' ||
              segments.some((s) => s.traversal === 'moving-support'));
        else if (name === 'single-conveyor-pose') hit = singleConveyorPose(c, result, input);
      }
      return {
        assertion,
        status: hit === undefined ? 'unassessed' : hit ? 'exercised' : 'not-exercised',
      };
    });
}
export type PhysicalOutcome = {
  originalQuery?: RouteQuery;
  resolvedQuery?: RouteQuery;
  startResolution?: StartResolution;
  exercise: ReturnType<typeof exercised>;
  inputBindings?: unknown;
  physicalDiagnostics?: unknown;
  lastProgress?: unknown;
  missingCoverage?: boolean;
  normalizationMs?: number;
  preparationMs?: number;
  solverMs?: number;
  firstCompleteSolverMs?: number;
  firstCompleteDispatchMs?: number;
  effectiveStart?: number[];
  mode: 'physical-diagnostic';
};
export type Result = RouteResult & {
  diagnostics: RouteResult['diagnostics'] & { mechanism: PhysicalOutcome };
};

export interface FacilityCatalog {
  scene: string;
  source: unknown;
  generator?: string;
  staticSupports?: { id: string; model: string; pose: string; positions: number[] }[];
  transports?: { id: string; kind: string }[];
  unsupportedStructures?: { id: string; reason: string }[];
  unsupportedMovingSupports?: { id: string; reason: string }[];
}
/** Check the exporter-owned import receipt, not whether a solver happened to
 * reach a nearby point. This proves declared static imports only, not exhaustive
 * world geometry or support for every exported movement capability. */
export function facilityAudit(input: PhysicalInput, catalog: FacilityCatalog) {
  const collision = input.collision as PhysicalInput['collision'] & {
    source?: unknown;
    coverage?: {
      complete?: boolean;
      staticSupports?: { id: string; model: string; pose: string }[];
    };
  };
  if (!isDeepStrictEqual(collision.source, catalog.source))
    throw new Error('Facility catalog and collision source differ');
  const bounds = input.ground.build?.bounds;
  if (!bounds) throw new Error('Missing facility audit bounds');
  const { cellSize, tileCells } = input.ground.build!;
  const tileSpan =
    cellSize !== undefined && tileCells !== undefined ? cellSize * tileCells : physicalTileSpan;
  const expected = (catalog.staticSupports ?? []).filter((s) => {
    if (!s.positions.length) return false;
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let i = 0; i < s.positions.length; i += 3) {
      x0 = Math.min(x0, s.positions[i]);
      x1 = Math.max(x1, s.positions[i]);
      z0 = Math.min(z0, s.positions[i + 2]);
      z1 = Math.max(z1, s.positions[i + 2]);
    }
    if (!(x1 >= bounds.min[0] && x0 <= bounds.max[0] && z1 >= bounds.min[1] && z0 <= bounds.max[1]))
      return false;
    // A sparse snapshot's outer rectangle includes unmapped holes. Only
    // facilities touching its actual loaded tiles require import receipts.
    return (
      !input.ground.tiles ||
      input.ground.tiles.some(
        ({ x, z }) =>
          x1 >= x * tileSpan &&
          x0 <= (x + 1) * tileSpan &&
          z1 >= z * tileSpan &&
          z0 <= (z + 1) * tileSpan,
      )
    );
  });
  const receipt = collision.coverage?.staticSupports;
  const byId = new Map((receipt ?? []).map((s) => [s.id, s]));
  const missing = expected.filter((s) => !byId.has(s.id)).map((s) => s.id);
  const mismatched = expected
    .filter((s) => {
      const actual = byId.get(s.id);
      return actual && (actual.model !== s.model || actual.pose !== s.pose);
    })
    .map((s) => s.id);
  return {
    source: catalog.source,
    generator: catalog.generator,
    bounds,
    staticImport: missing.length || mismatched.length ? 'incomplete' : 'matched',
    receiptPresent: Array.isArray(receipt),
    expected: expected.length,
    imported: receipt?.length ?? 0,
    missing,
    mismatched,
    exporterComplete: collision.coverage?.complete === true,
    capabilityGaps: [
      ...(catalog.transports?.length
        ? [
            {
              kind: 'unconsumed-transports',
              ids: catalog.transports.map((t) => t.id),
              scope: 'scene-inventory; necessity for this query is unproven',
            },
          ]
        : []),
      ...(catalog.unsupportedStructures?.length
        ? [
            {
              kind: 'unsupported-structures',
              ids: catalog.unsupportedStructures.map((t) => t.id),
              scope: 'scene-inventory; location/necessity unresolved',
            },
          ]
        : []),
      ...(catalog.unsupportedMovingSupports?.length
        ? [
            {
              kind: 'unsupported-moving-supports',
              ids: catalog.unsupportedMovingSupports.map((t) => t.id),
              scope: 'scene-inventory; location/necessity unresolved',
            },
          ]
        : []),
    ],
  };
}

/** Observe availability once, without changing the terminal solver outcome. */
export function captureFirstComplete(
  receive: (event: Extract<RouteEvent, { type: 'candidate' }>) => void,
) {
  let captured = false;
  return (event: RouteEvent) => {
    if (
      captured ||
      event.type !== 'candidate' ||
      event.result.partial ||
      event.result.route.status !== 'complete'
    )
      return;
    captured = true;
    receive(event);
  };
}
