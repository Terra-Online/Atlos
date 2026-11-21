/**
 * Decode the strict suite format, then resolve its cross-references. Cases share
 * a scenario's world, including its training inputs. The flattened view serves
 * the diagnostic and preparation tools in their historical case order.
 */
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import {
  legacySuiteSchema,
  suiteSchema,
  type AuthoredSuite,
  type Bounds,
  type CaseSetup,
  type Source,
} from '#@/bench/mechanisms/suite-schema.ts';
import type { Expectation, Suite as SuiteConfig } from '#@/bench/suite.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';

type AuthoredScenario = AuthoredSuite['scenarios'][number];
type CaseSpec = AuthoredScenario['cases'][number];

export type ScenarioInput = { scene: string } & (
  | { kind: 'dynamic' }
  | { kind: 'frozen-window'; region: string; bounds: Bounds }
);
type ScenarioSetup = Omit<AuthoredScenario['setup'], 'scene' | 'input'> & {
  input: ScenarioInput;
};
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

interface DiagnosticSuite {
  source: AuthoredSuite['requiredSource'];
  cases: Case[];
  sources: Record<string, Source>;
}
export interface Suite extends SuiteConfig<ScenarioSetup, CaseSpec>, DiagnosticSuite {}

export interface Binding {
  suite: DiagnosticSuite;
  item: Case;
  roots: { exports: string; retained: string };
  extractor: string;
  kernel: string;
  sceneDataRoot?: string;
  prepareConfig?: string;
  deviceExports?: string;
}

export async function readSuite(file: string): Promise<Suite> {
  return readManifest(file, (raw) => decodeSuite(suiteSchema.parse(raw)));
}

export async function readDiagnosticSuite(file: string): Promise<DiagnosticSuite> {
  return readManifest(file, async (raw) => {
    if (!(raw && typeof raw === 'object' && 'cases' in raw && !('scenarios' in raw)))
      return decodeSuite(suiteSchema.parse(raw));

    const legacy = legacySuiteSchema.parse(raw);
    const suiteFile = resolve(dirname(file), 'suite.json');
    const shared =
      legacy.sources || suiteFile === resolve(file) ? undefined : await readSuite(suiteFile);
    if (shared && !isDeepStrictEqual(legacy.source, shared.source))
      throw new Error('Legacy mechanism source differs from shared suite');
    const sources = legacy.sources ?? shared?.sources;
    if (!sources) throw new Error('Missing mechanism source bindings');
    const cases = legacy.cases.map(({ setup: { physical, ...setup }, ...item }): Case => ({
      ...item,
      setup: {
        ...setup,
        ...(physical
          ? {
              physical: {
                mode: physical.mode,
                region: physical.region,
                diagnostic: { ground: physical.ground, collision: physical.collision },
              },
            }
          : {}),
      },
    }));
    checkCases(cases, sources);
    return { source: legacy.source, cases, sources };
  });
}

async function readManifest<T>(file: string, decode: (raw: unknown) => T): Promise<T> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    // Previously authored suites may still carry an informational schema field.
    if (raw && typeof raw === 'object' && 'schema' in raw) {
      const { schema: _schema, ...manifest } = raw;
      return await decode(manifest);
    }
    return await decode(raw);
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

function decodeSuite(authored: AuthoredSuite): Suite {
  for (const [scene, { regions }] of Object.entries(authored.sources))
    for (const [id, region] of Object.entries(regions)) {
      const [minX, minZ, maxX, maxZ] = region.bounds;
      if (minX >= maxX || minZ >= maxZ) throw new Error(`Invalid bounds for ${scene}/${id}`);
    }

  const errors: string[] = [];
  const scenarioIds = new Set<string>();
  const cases: Case[] = [];
  const scenarios = authored.scenarios.flatMap((scenario) => {
    if (scenarioIds.has(scenario.id)) throw new Error(`Duplicate scenario: ${scenario.id}`);
    scenarioIds.add(scenario.id);
    const caseIds = new Set(scenario.cases.map(({ id }) => id));
    if (
      new Set(scenario.training).size !== scenario.training.length ||
      scenario.training.some((id) => !caseIds.has(id))
    )
      throw new Error(`Invalid training references for scenario: ${scenario.id}`);

    const { scene, input: selection, ...world } = scenario.setup;
    const source = Object.hasOwn(authored.sources, scene) ? authored.sources[scene] : undefined;
    if (!source) {
      errors.push(`${scenario.id}: unknown scene ${scene}`);
      return [];
    }
    let input: ScenarioInput;
    let physical: CaseSetup['physical'];
    if (selection.kind === 'dynamic') {
      input = { kind: 'dynamic', scene };
    } else {
      const { region } = selection;
      const entry = Object.hasOwn(source.regions, region) ? source.regions[region] : undefined;
      if (!entry) {
        errors.push(`${scenario.id}: unknown fixed window ${scene}/${region}`);
        return [];
      }
      const { bounds, diagnostic } = entry;
      input = { kind: 'frozen-window', scene, region, bounds };
      physical = { mode: 'frozen-window', region, diagnostic };
    }

    for (const { id, query, expect, requirements, metadata, note } of scenario.cases) {
      cases.push({
        ...metadata,
        ...(note === undefined ? {} : { note }),
        id,
        scene,
        group: metadata?.group ?? 'ungrouped',
        tags: metadata?.tags ?? [],
        evidence: metadata?.evidence ?? [],
        query,
        setup: { ...world, ...requirements, ...(physical ? { physical } : {}) },
        expected: expect.kind,
        assertions: expect.assertions,
      });
    }
    return [{ ...scenario, setup: { ...world, input } }];
  });
  if (errors.length) throw new Error('Invalid scenario inputs:\n' + errors.join('\n'));
  checkCases(cases, authored.sources);
  cases.sort((a, b) => a.id.localeCompare(b.id));
  return { ...authored, source: authored.requiredSource, scenarios, cases };
}

function checkCases(cases: Case[], sources: DiagnosticSuite['sources']) {
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate case: ${item.id}`);
    ids.add(item.id);
    if (!Object.hasOwn(sources, item.scene)) throw new Error(`Unknown scene for case: ${item.id}`);
    checkSetup(item);
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
