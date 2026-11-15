import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { StartResolution } from '#@/bench/mechanism-query.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import type { LocomotionOptions } from '#@/src/index.ts';
import { joinedGeometry, roofContains, shifted } from '#@/src/model/placement.ts';
import { projectPoint } from '#@/src/model/support.ts';
import type { RouteQuery, RouteResult, RouteEvent } from '#@/src/solver/contract.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

export interface MechanismCase {
  id: string;
  scene: string;
  group: string;
  query: RouteQuery;
  assertions: string[];
  setup: {
    physical?: {
      mode: 'frozen-window';
      region: string;
      ground: string;
      collision: string;
      allowExpansion?: boolean;
    };
    locomotion?: LocomotionOptions;
    locomotionPatch?: { stamina?: Partial<NonNullable<LocomotionOptions['stamina']>> };
    followingPlacement?: {
      movableSourceIds: string[];
      minimumDistinctUsedBoxes: number;
      retainOtherSourceBoxes: true;
      jointSnapshot: true;
      sourceActivityRanges: { id: string; spawn: number[]; radius: number }[];
    };
    requiredDevice?: string;
    requiredSupport?: string;
    excludedUnresolvedDevice?: string;
    projectStartToPhysicalSupport?: boolean;
    deviceAvailability?: 'assumed-enabled';
    assumption?: 'phase-free-swept-support';
    supportModel?: 'phase-free-circular-surface';
    sourceAnimation?: { collection: string; id: string };
  };
  evidence: { file: string; collection: string; id?: string; index?: number }[];
  tags: string[];
}
export interface MechanismSuite {
  schema: number;
  source: unknown;
  cases: MechanismCase[];
  physicalRegions: { id: string; scene: string; bounds: number[] }[];
  sources: Record<
    string,
    {
      source: unknown;
      profile: unknown;
      locomotion: LocomotionOptions;
      traversalGenerator?: string;
      interactives?: string;
    }
  >;
}
export interface MechanismBinding {
  suite: MechanismSuite;
  item: MechanismCase;
  roots: { exports: string; retained: string };
  extractor: string;
  kernel: string;
  sceneDataRoot?: string;
  prepareConfig?: string;
  deviceExports?: string;
}
const keys = new Set([
  'physical',
  'locomotion',
  'locomotionPatch',
  'followingPlacement',
  'requiredDevice',
  'requiredSupport',
  'excludedUnresolvedDevice',
  'projectStartToPhysicalSupport',
  'deviceAvailability',
  'assumption',
  'supportModel',
  'sourceAnimation',
]);
export async function readMechanismSuite(file: string): Promise<MechanismSuite> {
  const suite = JSON.parse(await readFile(file, 'utf8')) as MechanismSuite;
  if (!suite || !Array.isArray(suite.cases) || !suite.sources || !suite.source)
    throw new Error('Invalid mechanism manifest');
  const ids = new Set<string>();
  for (const c of suite.cases) {
    if (
      !c.id ||
      !/^[a-zA-Z0-9_.-]+$/.test(c.id) ||
      ids.has(c.id) ||
      !suite.sources[c.scene] ||
      !Array.isArray(c.query?.starts) ||
      !Array.isArray(c.query.goal) ||
      c.query.goal.length !== 3 ||
      !c.query.goal.every(Number.isFinite) ||
      !Array.isArray(c.assertions) ||
      !Array.isArray(c.evidence) ||
      !c.setup
    )
      throw new Error('Invalid or duplicate mechanism case');
    ids.add(c.id);
  }
  return suite;
}
export function resourcePath(name: string, roots: MechanismBinding['roots']) {
  const slash = name.indexOf('/'),
    key = name.slice(0, slash);
  if (slash < 0 || (key !== 'exports' && key !== 'retained'))
    throw new Error('Unknown mechanism resource root');
  const base = resolve(roots[key]),
    result = resolve(base, name.slice(slash + 1)),
    rel = relative(base, result);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
    throw new Error('Mechanism resource escapes its root');
  return result;
}
export function checkSetup(c: MechanismCase) {
  for (const key of Object.keys(c.setup))
    if (!keys.has(key)) throw new Error('Unsupported setup: ' + key);
  const s = c.setup;
  if (
    s.sourceAnimation &&
    (s.sourceAnimation.collection !== 'staticSupports.parts.motion' ||
      s.sourceAnimation.id !== s.requiredSupport)
  )
    throw new Error('Unsupported source animation binding');
  if (s.locomotionPatch && Object.keys(s.locomotionPatch).some((k) => k !== 'stamina'))
    throw new Error('Unsupported locomotion patch');
  if (s.physical && (s.physical.mode !== 'frozen-window' || s.physical.allowExpansion === true))
    throw new Error('Unsupported frozen-window expansion');
  if (s.projectStartToPhysicalSupport !== undefined && s.projectStartToPhysicalSupport !== true)
    throw new Error('Unsupported start projection policy');
  if (s.assumption !== undefined && s.assumption !== 'phase-free-swept-support')
    throw new Error('Unsupported support assumption');
  if (s.deviceAvailability !== undefined && s.deviceAvailability !== 'assumed-enabled')
    throw new Error('Unsupported device availability');
  if (s.supportModel !== undefined && s.supportModel !== 'phase-free-circular-surface')
    throw new Error('Unsupported support model');
  if (s.locomotionPatch && !s.locomotion)
    throw new Error('locomotionPatch requires its resolved policy');
  if (
    s.followingPlacement &&
    (!s.followingPlacement.retainOtherSourceBoxes ||
      !s.followingPlacement.jointSnapshot ||
      !s.followingPlacement.movableSourceIds.length ||
      new Set(s.followingPlacement.movableSourceIds).size !==
        s.followingPlacement.movableSourceIds.length)
  )
    throw new Error('Unsupported following placement policy');
}
/** Scenario conditions are applied before preparation and shared by search and
 * the independent verifier. Assertion targets do not manufacture solver edges. */
export function scenarioInput(input: PhysicalInput, c: MechanismCase): PhysicalInput {
  checkSetup(c);
  const s = c.setup;
  let result = {
    ...input,
    locomotion: s.locomotion ?? input.locomotion,
    ground: {
      ...input.ground,
      options: { ...input.ground.options, locomotion: s.locomotion ?? input.locomotion },
    },
  };
  if (s.locomotionPatch?.stamina)
    for (const [key, value] of Object.entries(s.locomotionPatch.stamina))
      if (
        !isDeepStrictEqual(
          result.locomotion.stamina?.[key as keyof NonNullable<LocomotionOptions['stamina']>],
          value,
        )
      )
        throw new Error('Resolved locomotion differs from scenario patch');
  const required = s.requiredDevice;
  if (required && !input.devices?.devices.some((d) => d.id === required))
    throw new Error('Missing required source device: ' + required);
  if (s.requiredSupport) {
    const moving = input.devices?.movingSupports?.find((d) => d.id === s.requiredSupport);
    const following = input.devices?.followingSupports?.find((d) => d.id === s.requiredSupport);
    if (!moving && !following)
      throw new Error('Missing required source support: ' + s.requiredSupport);
    if (s.supportModel && !moving?.circular) throw new Error('Missing circular support facts');
    if (s.assumption && moving?.assumption !== s.assumption)
      throw new Error('Support assumption mismatch');
  }
  if (s.excludedUnresolvedDevice) {
    const device = input.devices?.devices.find((d) => d.id === s.excludedUnresolvedDevice);
    if (!device || device.resolved)
      throw new Error('Unresolved-device scenario no longer matches its source');
  }
  const policy = s.followingPlacement;
  if (policy) {
    const all = input.devices?.followingSupports ?? [],
      ids = new Set(policy.movableSourceIds);
    if (policy.movableSourceIds.some((id) => !all.some((b) => b.id === id)))
      throw new Error('Missing movable box facts');
    for (const source of policy.sourceActivityRanges) {
      const b = all.find((b) => b.id === source.id);
      if (!b || !isDeepStrictEqual(b.spawn, source.spawn) || b.maxDistance !== source.radius)
        throw new Error('Following source activity sphere mismatch');
    }
    const fixed = all.filter((b) => !ids.has(b.id));
    result = {
      ...result,
      collision: joinedGeometry(
        input.collision,
        fixed.flatMap((b) => b.bodies),
      ),
      devices: { ...input.devices!, followingSupports: all.filter((b) => ids.has(b.id)) },
    };
  }
  return result;
}
export function expectation(c: MechanismCase): 'complete' | 'reject' | 'constraint' {
  if (
    c.assertions.includes('no-complete-route-from-unavailable-arrival') ||
    c.assertions.includes('uncovered-target-cannot-be-complete')
  )
    return 'reject';
  return c.group === 'boundary-and-rejection' ? 'constraint' : 'complete';
}
export function classify(c: MechanismCase, result: RouteResult) {
  if (result.route.status === 'complete' && !result.partial)
    return expectation(c) === 'reject' ? 'unexpected-complete' : 'complete';
  if (result.reason === 'timeout') return 'timeout';
  if (result.partial) return 'incomplete';
  if (result.reason?.startsWith('input-unavailable:')) return 'input-unavailable';
  if (result.reason?.startsWith('unsupported-setup:')) return 'unsupported-setup';
  if (result.reason?.startsWith('input-invalid:')) return 'input-invalid';
  if (result.reason?.startsWith('input-unresolved:')) return 'input-unresolved';
  if (result.reason?.startsWith('execution-error:')) return 'error';
  return expectation(c) === 'reject'
    ? 'correct-rejection'
    : expectation(c) === 'constraint'
      ? 'constraint-incomplete'
      : 'incomplete';
}
function singleConveyorPose(
  c: MechanismCase,
  result: RouteResult,
  input?: PhysicalInput,
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

export function exercised(c: MechanismCase, result: RouteResult, input?: PhysicalInput) {
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
export type MechanismResult = RouteResult & {
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
    return x1 >= bounds.min[0] && x0 <= bounds.max[0] && z1 >= bounds.min[1] && z0 <= bounds.max[1];
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
