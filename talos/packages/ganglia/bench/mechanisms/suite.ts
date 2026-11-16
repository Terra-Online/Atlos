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
        ['available', 'locked', 'unknown'].includes(String(start.state)),
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

export async function readSuite(file: string): Promise<Suite> {
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!record(raw)) throw new Error('Invalid mechanism manifest');
  // The separate legacy negative controls share the adjacent suite's source bindings.
  let shared: Suite | undefined;
  if (raw.schema !== 6 && (!record(raw.sources) || !Array.isArray(raw.physicalRegions))) {
    const suiteFile = resolve(dirname(file), 'suite.json');
    if (suiteFile !== resolve(file)) shared = await readSuite(suiteFile);
  }
  const sources = record(raw.sources) ? (raw.sources as Suite['sources']) : shared?.sources;
  const physicalRegions = Array.isArray(raw.physicalRegions)
    ? (raw.physicalRegions as Suite['physicalRegions'])
    : shared?.physicalRegions;
  if (
    !sources ||
    !physicalRegions ||
    Object.entries(sources).some(
      ([scene, source]) =>
        !scene ||
        !record(source) ||
        !record(source.source) ||
        !record(source.profile) ||
        !finite(source.profile.radius) ||
        !finite(source.profile.height) ||
        !locomotionValue(source.locomotion) ||
        (source.traversalGenerator !== undefined &&
          typeof source.traversalGenerator !== 'string') ||
        (source.interactives !== undefined && typeof source.interactives !== 'string'),
    ) ||
    physicalRegions.some(
      (region) =>
        !record(region) ||
        typeof region.id !== 'string' ||
        typeof region.scene !== 'string' ||
        !(region.scene in sources) ||
        !Array.isArray(region.bounds) ||
        region.bounds.length !== 4 ||
        !region.bounds.every(finite),
    )
  )
    throw new Error('Invalid mechanism source bindings');
  if (shared && !isDeepStrictEqual(raw.source, shared.source))
    throw new Error('Legacy mechanism source differs from shared suite');
  const ids = new Set<string>();
  const validateCase = (c: Case) => {
    if (
      !c ||
      !c.id ||
      !/^[a-zA-Z0-9_.-]+$/.test(c.id) ||
      ids.has(c.id) ||
      !(c.scene in sources) ||
      !queryValue(c.query) ||
      !strings(c.assertions) ||
      !Array.isArray(c.evidence) ||
      !strings(c.tags) ||
      typeof c.group !== 'string' ||
      !record(c.setup)
    )
      throw new Error('Invalid or duplicate mechanism case');
    ids.add(c.id);
    checkSetup(c);
  };
  if (raw.schema !== 6) {
    if (!Array.isArray(raw.cases) || !raw.source) throw new Error('Invalid mechanism manifest');
    // Normalize legacy per-case setup into the same world/requirements split.
    const cases = raw.cases as Case[];
    const groups: { setup: WorldSetup; cases: CaseSpec[] }[] = [];
    for (const c of cases) {
      validateCase(c);
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
      !strings(value.training) ||
      !Array.isArray(value.cases)
    )
      throw new Error('Invalid or duplicate mechanism scenario');
    scenarioIds.add(value.id);
    const { scene, ...world } = value.setup;
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
        !['complete', 'reject', 'constraint'].includes(String(item.expect.kind)) ||
        !strings(item.expect.assertions) ||
        !record(item.metadata) ||
        typeof item.metadata.group !== 'string' ||
        !strings(item.metadata.tags) ||
        !Array.isArray(item.metadata.evidence) ||
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
      const c: Case = {
        ...item.metadata,
        id: item.id,
        scene,
        group: item.metadata.group,
        tags: item.metadata.tags,
        evidence: item.metadata.evidence,
        query: item.query,
        setup: { ...world, ...requirements },
        assertions: item.expect.assertions,
      };
      validateCase(c);
      if (expectation(c) !== item.expect.kind) throw new Error('Inconsistent case expectation');
      cases.push(c);
      tests.push(item as unknown as CaseSpec);
    }
    const localIds = new Set(tests.map((item) => item.id));
    if (
      new Set(value.training).size !== value.training.length ||
      value.training.some((id) => !localIds.has(id))
    )
      throw new Error('Invalid scenario training references');
    scenarios.push({
      id: value.id,
      setup: value.setup as WorldSetup,
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
export function checkSetup(c: Case) {
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
