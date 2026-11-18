/**
 * Decode the strict suite format, then resolve its cross-references. Cases share
 * a scenario's world, including its training inputs. The flattened view serves
 * the diagnostic and preparation tools in their historical case order.
 */
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { expectation } from '#@/bench/mechanisms/assessment.ts';
import {
  legacySuiteSchema,
  suiteSchema,
  type AuthoredSuite,
  type CaseSetup,
} from '#@/bench/mechanisms/suite-schema.ts';
import type { Expectation, Suite as SuiteConfig } from '#@/bench/suite.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';

type ScenarioSpec = AuthoredSuite['scenarios'][number];
type CaseSpec = ScenarioSpec['cases'][number];
type Metadata = NonNullable<CaseSpec['metadata']>;

export interface Case {
  id: string;
  scene: string;
  group: string;
  query: RouteQuery;
  expected?: Expectation['kind'];
  assertions: string[];
  setup: CaseSetup;
  evidence: NonNullable<Metadata['evidence']>;
  tags: string[];
}

export interface Suite extends SuiteConfig<ScenarioSpec['setup'], CaseSpec> {
  source: AuthoredSuite['requiredSource'];
  cases: Case[];
  physicalRegions: AuthoredSuite['physicalRegions'];
  sources: AuthoredSuite['sources'];
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

export async function readSuite(file: string): Promise<Suite> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (raw && typeof raw === 'object' && 'schema' in raw && raw.schema === 1)
      return await readLegacySuite(file, raw);

    const authored = suiteSchema.parse(raw);
    const cases = authored.scenarios.flatMap(({ setup: { scene, ...world }, cases }) =>
      cases.map(({ id, query, expect, requirements, metadata, note }): Case => ({
        ...metadata,
        ...(note === undefined ? {} : { note }),
        id,
        scene,
        group: metadata?.group ?? 'ungrouped',
        tags: metadata?.tags ?? [],
        evidence: metadata?.evidence ?? [],
        query,
        setup: { ...world, ...requirements },
        expected: expect.kind,
        assertions: expect.assertions,
      })),
    );
    cases.sort((a, b) => a.id.localeCompare(b.id));
    const suite = { ...authored, source: authored.requiredSource, cases };
    checkReferences(suite);
    return suite;
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? '\n' + z.prettifyError(error)
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`Invalid mechanism suite ${file}: ${message}`, { cause: error });
  }
}

async function readLegacySuite(file: string, raw: unknown): Promise<Suite> {
  const legacy = legacySuiteSchema.parse(raw);
  // Flat diagnostic controls can reuse resource bindings in the adjacent suite.
  const suiteFile = resolve(dirname(file), 'suite.json');
  const shared =
    (!legacy.sources || !legacy.physicalRegions) && suiteFile !== resolve(file)
      ? await readSuite(suiteFile)
      : undefined;
  const sources = legacy.sources ?? shared?.sources;
  const physicalRegions = legacy.physicalRegions ?? shared?.physicalRegions;
  if (!sources || !physicalRegions) throw new Error('Missing mechanism source bindings');
  if (shared && !isDeepStrictEqual(legacy.source, shared.source))
    throw new Error('Legacy mechanism source differs from shared suite');

  const groups: { setup: ScenarioSpec['setup']; cases: CaseSpec[] }[] = [];
  for (const c of legacy.cases) {
    const { scene, query, id, assertions, setup, ...metadata } = c;
    const {
      requiredDevice,
      requiredSupport,
      excludedUnresolvedDevice,
      projectStartToPhysicalSupport,
      ...world
    } = setup;
    const scenarioSetup = { scene, ...world };
    let scenario = groups.find((entry) => isDeepStrictEqual(entry.setup, scenarioSetup));
    if (!scenario) {
      scenario = { setup: scenarioSetup, cases: [] };
      groups.push(scenario);
    }
    const requirements = {
      ...(requiredDevice === undefined ? {} : { requiredDevice }),
      ...(requiredSupport === undefined ? {} : { requiredSupport }),
      ...(excludedUnresolvedDevice === undefined ? {} : { excludedUnresolvedDevice }),
      ...(projectStartToPhysicalSupport === undefined ? {} : { projectStartToPhysicalSupport }),
    };
    scenario.cases.push({
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
  const suite = { ...legacy, id: legacy.name ?? 'legacy', sources, physicalRegions, scenarios };
  checkReferences(suite);
  return suite;
}

function checkReferences(suite: Suite) {
  const regions = new Map<string, string>();
  for (const region of suite.physicalRegions) {
    if (regions.has(region.id) || !Object.hasOwn(suite.sources, region.scene))
      throw new Error(`Invalid or duplicate physical region: ${region.id}`);
    regions.set(region.id, region.scene);
  }
  const scenarioIds = new Set<string>();
  for (const scenario of suite.scenarios) {
    if (scenarioIds.has(scenario.id)) throw new Error(`Duplicate scenario: ${scenario.id}`);
    scenarioIds.add(scenario.id);
    const caseIds = new Set(scenario.cases.map(({ id }) => id));
    if (
      new Set(scenario.training).size !== scenario.training.length ||
      scenario.training.some((id) => !caseIds.has(id))
    )
      throw new Error(`Invalid training references for scenario: ${scenario.id}`);
  }
  const caseIds = new Set<string>();
  for (const c of suite.cases) {
    if (caseIds.has(c.id)) throw new Error(`Duplicate case: ${c.id}`);
    caseIds.add(c.id);
    if (!Object.hasOwn(suite.sources, c.scene)) throw new Error(`Unknown scene for case: ${c.id}`);
    const { physical } = c.setup;
    if (physical && regions.get(physical.region) !== c.scene)
      throw new Error(`Unknown physical region for case: ${c.id}`);
    checkSetup(c);
  }
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
export function checkSetup({ setup }: Pick<Case, 'setup'>) {
  if (setup.sourceAnimation && setup.sourceAnimation.id !== setup.requiredSupport)
    throw new Error('Source animation must match the required support');
  if (setup.locomotionPatch && !setup.locomotion)
    throw new Error('locomotionPatch requires its resolved policy');
  const ids = setup.followingPlacement?.movableSourceIds;
  if (ids && new Set(ids).size !== ids.length) throw new Error('Duplicate movable source IDs');
}
