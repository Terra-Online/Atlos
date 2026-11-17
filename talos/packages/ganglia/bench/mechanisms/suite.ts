// Scenario specs hold shared world setup and ordered cases; per-case requirements
// describe witnesses. The reader also exposes flattened cases for legacy diagnostics.
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { expectation } from '#@/bench/mechanisms/assessment.ts';
import type {
  Case as QueryCase,
  Expectation,
  ScenarioSpec as Spec,
  Suite as SuiteConfig,
} from '#@/bench/suite.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import type { LocomotionOptions } from '#@/src/index.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';

export interface Case {
  id: string;
  scene: string;
  group: string;
  query: RouteQuery;
  expected?: Expectation['kind'];
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
// Source requirements describe individual witnesses, not a different world.
// Keep them on cases so a scenario can share its prepared physical input.
type Requirements = Pick<
  Case['setup'],
  | 'requiredDevice'
  | 'requiredSupport'
  | 'excludedUnresolvedDevice'
  | 'projectStartToPhysicalSupport'
>;
type WorldSetup = Omit<Case['setup'], keyof Requirements> & { scene: string };
export interface CaseSpec extends QueryCase {
  expect: Expectation;
  requirements?: Requirements;
  metadata: Record<string, unknown> & Pick<Case, 'group' | 'tags' | 'evidence'>;
}
export type ScenarioSpec = Spec<WorldSetup, CaseSpec>;

// `cases` and `source` are the decoded compatibility view used by diagnostics.
// The canonical scenario order and training selections remain available to runners.
export interface Suite extends SuiteConfig<WorldSetup, CaseSpec> {
  source: unknown;
  cases: Case[];
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
export interface Binding {
  suite: Suite;
  item: Case;
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
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const vec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(finite);
const optionalNumber = (value: unknown) => value === undefined || finite(value);
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const expectationKind = (value: unknown): value is Expectation['kind'] =>
  value === 'complete' || value === 'reject' || value === 'constraint';
const evidenceValue = (value: unknown): value is Case['evidence'] =>
  Array.isArray(value) &&
  value.every(
    (entry: unknown) =>
      record(entry) &&
      typeof entry.file === 'string' &&
      typeof entry.collection === 'string' &&
      optionalString(entry.id) &&
      optionalNumber(entry.index),
  );
const queryValue = (value: unknown): value is RouteQuery => {
  if (
    !record(value) ||
    !vec3(value.goal) ||
    !Array.isArray(value.starts) ||
    !value.starts.every(
      (start: unknown) =>
        record(start) &&
        typeof start.id === 'string' &&
        vec3(start.position) &&
        finite(start.cost) &&
        (start.state === 'available' || start.state === 'locked' || start.state === 'unknown'),
    )
  )
    return false;
  if (
    value.waypoints !== undefined &&
    (!Array.isArray(value.waypoints) || !value.waypoints.every(vec3))
  )
    return false;
  if (value.interaction !== undefined) {
    const goal = value.interaction;
    if (
      !record(goal) ||
      !finite(goal.radius) ||
      !optionalNumber(goal.maxVertical) ||
      !optionalNumber(goal.halfAngle) ||
      (goal.facing !== undefined && !vec3(goal.facing)) ||
      (goal.airborne !== undefined && typeof goal.airborne !== 'boolean')
    )
      return false;
  }
  return true;
};
const locomotionValue = (value: unknown): value is LocomotionOptions => {
  if (
    !record(value) ||
    !finite(value.speed) ||
    !finite(value.sprintSpeed) ||
    !finite(value.sprintAcceleration)
  )
    return false;
  if (value.dash !== undefined) {
    const dash = value.dash;
    if (
      !record(dash) ||
      !['speed', 'duration', 'cooldown', 'cost'].every((key) => finite(dash[key]))
    )
      return false;
  }
  if (value.stamina !== undefined) {
    const stamina = value.stamina;
    if (
      !record(stamina) ||
      !['capacity', 'initial', 'recoveryRate', 'recoveryDelay', 'reserve'].every((key) =>
        finite(stamina[key]),
      ) ||
      !['activationCost', 'sprintDrain'].every((key) => optionalNumber(stamina[key])) ||
      !['recoveryDuringSprint', 'recoveryDuringNonWalk'].every(
        (key) => stamina[key] === undefined || typeof stamina[key] === 'boolean',
      )
    )
      return false;
  }
  if (
    value.sprintThrough !== undefined &&
    (!strings(value.sprintThrough) ||
      !value.sprintThrough.every((mode) => ['jump', 'drop', 'rope', 'launch'].includes(mode)))
  )
    return false;
  if (
    value.search !== undefined &&
    (!record(value.search) ||
      !optionalNumber(value.search.maxLabels) ||
      !optionalNumber(value.search.maxExpanded))
  )
    return false;
  return true;
};

const staminaNumbers = [
  'capacity',
  'initial',
  'recoveryRate',
  'recoveryDelay',
  'reserve',
  'activationCost',
  'sprintDrain',
];
const staminaFlags = ['recoveryDuringSprint', 'recoveryDuringNonWalk'];

function setupValue(value: unknown): value is Case['setup'] {
  if (!record(value)) return false;
  const { physical, locomotion, locomotionPatch, followingPlacement, sourceAnimation } = value;
  return (
    optionalString(value.requiredDevice) &&
    optionalString(value.requiredSupport) &&
    optionalString(value.excludedUnresolvedDevice) &&
    (value.projectStartToPhysicalSupport === undefined ||
      value.projectStartToPhysicalSupport === true) &&
    (value.deviceAvailability === undefined || value.deviceAvailability === 'assumed-enabled') &&
    (value.assumption === undefined || value.assumption === 'phase-free-swept-support') &&
    (value.supportModel === undefined || value.supportModel === 'phase-free-circular-surface') &&
    (physical === undefined ||
      (record(physical) &&
        physical.mode === 'frozen-window' &&
        typeof physical.region === 'string' &&
        typeof physical.ground === 'string' &&
        typeof physical.collision === 'string' &&
        (physical.allowExpansion === undefined || physical.allowExpansion === false))) &&
    (locomotion === undefined || locomotionValue(locomotion)) &&
    (locomotionPatch === undefined ||
      (record(locomotionPatch) &&
        (locomotionPatch.stamina === undefined ||
          (record(locomotionPatch.stamina) &&
            Object.entries(locomotionPatch.stamina).every(
              ([key, val]) =>
                (staminaNumbers.includes(key) && finite(val)) ||
                (staminaFlags.includes(key) && typeof val === 'boolean'),
            ))))) &&
    (followingPlacement === undefined ||
      (record(followingPlacement) &&
        strings(followingPlacement.movableSourceIds) &&
        finite(followingPlacement.minimumDistinctUsedBoxes) &&
        followingPlacement.retainOtherSourceBoxes === true &&
        followingPlacement.jointSnapshot === true &&
        Array.isArray(followingPlacement.sourceActivityRanges) &&
        followingPlacement.sourceActivityRanges.every(
          (range: unknown) =>
            record(range) &&
            typeof range.id === 'string' &&
            vec3(range.spawn) &&
            finite(range.radius),
        ))) &&
    (sourceAnimation === undefined ||
      (record(sourceAnimation) &&
        typeof sourceAnimation.collection === 'string' &&
        typeof sourceAnimation.id === 'string'))
  );
}

function sourcesValue(value: unknown): value is Suite['sources'] {
  return (
    record(value) &&
    Object.entries(value).every(
      ([scene, source]) =>
        scene &&
        record(source) &&
        record(source.source) &&
        record(source.profile) &&
        finite(source.profile.radius) &&
        finite(source.profile.height) &&
        locomotionValue(source.locomotion) &&
        optionalString(source.traversalGenerator) &&
        optionalString(source.interactives),
    )
  );
}

function regionsValue(
  value: unknown,
  sources: Suite['sources'],
): value is Suite['physicalRegions'] {
  return (
    Array.isArray(value) &&
    value.every(
      (region: unknown) =>
        record(region) &&
        typeof region.id === 'string' &&
        typeof region.scene === 'string' &&
        Object.hasOwn(sources, region.scene) &&
        Array.isArray(region.bounds) &&
        region.bounds.length === 4 &&
        region.bounds.every(finite),
    )
  );
}

export async function readSuite(file: string): Promise<Suite> {
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!record(raw)) throw new Error('Invalid mechanism manifest');
  // The separate legacy negative controls share the adjacent suite's source bindings.
  let shared: Suite | undefined;
  if (raw.schema !== 6 && (!record(raw.sources) || !Array.isArray(raw.physicalRegions))) {
    const suiteFile = resolve(dirname(file), 'suite.json');
    if (suiteFile !== resolve(file)) shared = await readSuite(suiteFile);
  }
  const sources = raw.sources ?? shared?.sources;
  const physicalRegions = raw.physicalRegions ?? shared?.physicalRegions;
  if (!sourcesValue(sources) || !regionsValue(physicalRegions, sources))
    throw new Error('Invalid mechanism source bindings');
  if (shared && !isDeepStrictEqual(raw.source, shared.source))
    throw new Error('Legacy mechanism source differs from shared suite');
  const scenes = new Set(Object.keys(sources));
  const ids = new Set<string>();
  function validateCase(c: unknown): asserts c is Case {
    if (
      !record(c) ||
      typeof c.id !== 'string' ||
      !c.id ||
      !/^[a-zA-Z0-9_.-]+$/.test(c.id) ||
      ids.has(c.id) ||
      typeof c.scene !== 'string' ||
      !scenes.has(c.scene) ||
      !queryValue(c.query) ||
      !strings(c.assertions) ||
      !evidenceValue(c.evidence) ||
      !strings(c.tags) ||
      typeof c.group !== 'string' ||
      !setupValue(c.setup) ||
      (c.expected !== undefined && !expectationKind(c.expected))
    )
      throw new Error('Invalid or duplicate mechanism case');
    ids.add(c.id);
    checkSetup({ setup: c.setup });
  }
  if (raw.schema !== 6) {
    if (!Array.isArray(raw.cases) || !raw.source) throw new Error('Invalid mechanism manifest');
    // Normalize legacy per-case setup into the same world/requirements split.
    const cases: Case[] = [];
    const groups: { setup: WorldSetup; cases: CaseSpec[] }[] = [];
    for (const c of raw.cases) {
      validateCase(c);
      cases.push(c);
      const {
        requiredDevice,
        requiredSupport,
        excludedUnresolvedDevice,
        projectStartToPhysicalSupport,
        ...world
      } = c.setup;
      const setup = { scene: c.scene, ...world };
      let group = groups.find((entry) => isDeepStrictEqual(entry.setup, setup));
      if (!group) {
        group = { setup, cases: [] };
        groups.push(group);
      }
      const { id, scene: _scene, query, setup: _setup, assertions, ...metadata } = c;
      const requirements: Requirements = {};
      if (requiredDevice !== undefined) requirements.requiredDevice = requiredDevice;
      if (requiredSupport !== undefined) requirements.requiredSupport = requiredSupport;
      if (excludedUnresolvedDevice !== undefined)
        requirements.excludedUnresolvedDevice = excludedUnresolvedDevice;
      if (projectStartToPhysicalSupport !== undefined)
        requirements.projectStartToPhysicalSupport = projectStartToPhysicalSupport;
      group.cases.push({
        id,
        query,
        expect: { kind: expectation(c), assertions },
        metadata,
        ...(Object.keys(requirements).length ? { requirements } : {}),
      });
    }
    const scenarios: ScenarioSpec[] = groups.map(({ setup, cases }, index) => {
      const count = Math.min(10, cases.length);
      return {
        id: `${setup.scene}-${String(index + 1).padStart(3, '0')}`,
        setup,
        cases,
        training: Array.from(
          { length: count },
          (_, i) => cases[Math.floor((i * cases.length) / count)].id,
        ),
      };
    });
    return {
      ...raw,
      id: typeof raw.name === 'string' ? raw.name : 'legacy',
      schema: typeof raw.schema === 'number' ? raw.schema : 0,
      source: raw.source,
      sources,
      physicalRegions,
      scenarios,
      cases,
    };
  }
  if (typeof raw.id !== 'string' || !raw.id || !raw.requiredSource || !Array.isArray(raw.scenarios))
    throw new Error('Invalid mechanism suite');
  const scenarios: ScenarioSpec[] = [];
  const cases: Case[] = [];
  const scenarioIds = new Set<string>();
  for (const value of raw.scenarios) {
    if (
      !record(value) ||
      typeof value.id !== 'string' ||
      !value.id ||
      scenarioIds.has(value.id) ||
      !record(value.setup) ||
      typeof value.setup.scene !== 'string' ||
      !Object.hasOwn(sources, value.setup.scene) ||
      !strings(value.training) ||
      !Array.isArray(value.cases)
    )
      throw new Error('Invalid or duplicate mechanism scenario');
    scenarioIds.add(value.id);
    const { scene, ...world } = value.setup;
    if (!setupValue(world)) throw new Error('Invalid scenario setup');
    if (
      [
        'requiredDevice',
        'requiredSupport',
        'excludedUnresolvedDevice',
        'projectStartToPhysicalSupport',
      ].some((key) => key in world)
    )
      throw new Error('Case requirement in scenario setup');
    const tests: CaseSpec[] = [];
    for (const item of value.cases) {
      if (
        !record(item) ||
        typeof item.id !== 'string' ||
        !queryValue(item.query) ||
        !record(item.expect) ||
        !expectationKind(item.expect.kind) ||
        !strings(item.expect.assertions) ||
        !record(item.metadata) ||
        typeof item.metadata.group !== 'string' ||
        !strings(item.metadata.tags) ||
        !evidenceValue(item.metadata.evidence) ||
        !optionalString(item.note) ||
        (item.requirements !== undefined && !record(item.requirements))
      )
        throw new Error('Invalid mechanism test case');
      const requirements = item.requirements ?? {};
      if (
        Object.keys(requirements).some(
          (key) =>
            ![
              'requiredDevice',
              'requiredSupport',
              'excludedUnresolvedDevice',
              'projectStartToPhysicalSupport',
            ].includes(key),
        )
      )
        throw new Error('Invalid case requirement');
      if (!setupValue(requirements)) throw new Error('Invalid case requirement');
      const c: Case = {
        ...item.metadata,
        id: item.id,
        scene,
        group: item.metadata.group,
        tags: item.metadata.tags,
        evidence: item.metadata.evidence,
        query: item.query,
        setup: { ...world, ...requirements },
        expected: item.expect.kind,
        assertions: item.expect.assertions,
      };
      validateCase(c);
      cases.push(c);
      tests.push({
        id: item.id,
        query: item.query,
        expect: { kind: item.expect.kind, assertions: item.expect.assertions },
        metadata: {
          ...item.metadata,
          group: item.metadata.group,
          tags: item.metadata.tags,
          evidence: item.metadata.evidence,
        },
        ...(item.requirements === undefined ? {} : { requirements }),
        ...(item.note === undefined ? {} : { note: item.note }),
      });
    }
    const localIds = new Set(tests.map((item) => item.id));
    if (
      new Set(value.training).size !== value.training.length ||
      value.training.some((id) => !localIds.has(id))
    )
      throw new Error('Invalid scenario training references');
    scenarios.push({
      id: value.id,
      setup: { ...world, scene },
      training: value.training,
      cases: tests,
      ...(typeof value.note === 'string' ? { note: value.note } : {}),
    });
  }
  // IDs preserve the manifest's original population order for legacy consumers.
  cases.sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...raw,
    schema: 6,
    id: raw.id,
    source: raw.requiredSource,
    sources,
    physicalRegions,
    scenarios,
    cases,
  };
}
export function resourcePath(name: string, roots: Binding['roots']) {
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
export function checkSetup(c: Pick<Case, 'setup'>) {
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
