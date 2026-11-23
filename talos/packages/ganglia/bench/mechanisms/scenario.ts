import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { loadPackedScene } from '#@/bench/adapters/ganglia-v1/packed-scene.ts';
import {
  anchors,
  scopeAnnotations,
  preparationBounds as v2PreparationBounds,
} from '#@/bench/adapters/ganglia-v2/annotations.ts';
import { exercised, facilityAudit } from '#@/bench/mechanisms/assessment.ts';
import { QueryInputError, resolveQuery, sourceSupportWorld } from '#@/bench/mechanisms/query.ts';
import { checkSetup, type Case, readSuite } from '#@/bench/mechanisms/suite.ts';
import type { Window } from '#@/bench/scene-data/loader.ts';
import type { WorkerSetup } from '#@/bench/workers.ts';
import type { LocomotionOptions } from '#@/src/index.ts';
import { joinedGeometry } from '#@/src/model/placement.ts';
import type { Bounds } from '#@/src/scene-pack.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import {
  prepareGangliaV2,
  gangliaV2LibraryPath,
  type V2PreparedSolver,
} from '#@/src/solver/ganglia-v2-rust.ts';
import type { GangliaV2Config } from '#@/src/solver/ganglia-v2.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

export interface Binding {
  suite: string;
  scenarioId: string;
  sourceScenarioId?: string;
  preparationBounds?: Window;
  preparationError?: string;
  ids: string[];
  dataRoot: string;
  exports: string;
  memoryBudget: number;
}

/** Resolve queries against one scene pack and apply this scenario's physics in its worker. */
export async function loadScenario(setup: WorkerSetup, checkpoint: () => void) {
  const binding = JSON.parse(await readFile(setup.dataRoot, 'utf8')) as Binding;
  const suite = await readSuite(binding.suite);
  if (binding.preparationError) throw new Error(binding.preparationError);
  const spec = suite.scenarios.find(
    ({ id }) => id === (binding.sourceScenarioId ?? binding.scenarioId),
  );
  if (!spec) throw new Error(`Unknown bound scenario: ${binding.scenarioId}`);
  const { input: source, ...world } = spec.setup;
  const fixedBounds: Bounds | undefined =
    source.kind === 'frozen-window'
      ? { min: [source.bounds[0], source.bounds[1]], max: [source.bounds[2], source.bounds[3]] }
      : undefined;
  const v2 = setup.config.algorithm === 'ganglia-v2';
  const preparationBounds: Window | undefined = v2
    ? (binding.preparationBounds ?? v2PreparationBounds(spec.id, fixedBounds))
    : fixedBounds;
  const loadedBounds: Window | undefined = v2 ? preparationBounds : fixedBounds;
  const items = suite.cases.filter((c) => binding.ids.includes(c.id));
  const landmarks = (anchors[source.scene] ?? []).filter(
    ({ position }) =>
      preparationBounds &&
      position[0] >= preparationBounds.min[0] &&
      position[0] <= preparationBounds.max[0] &&
      position[2] >= preparationBounds.min[1] &&
      position[2] <= preparationBounds.max[1],
  );
  const catalog = JSON.parse(
    await readFile(resolve(binding.exports, `${source.scene}-traversal-devices.json`), 'utf8'),
  );
  if (!isDeepStrictEqual(catalog.source, suite.source))
    throw new Error('Mechanism source build differs from exported device facts');
  let evidence: Pick<PhysicalInput, 'devices'> | undefined;
  const bySupport = new Map<string, Pick<PhysicalInput, 'devices'>>();
  // Only these fields change physical rules. Required IDs and exercise assertions
  // describe source coverage, rather than forcing the solver to choose a device.
  const policy = {
    setup: {
      locomotion: world.locomotion,
      locomotionPatch: world.locomotionPatch,
      followingPlacement: world.followingPlacement,
    },
  };
  for (const item of items) {
    const required = item.setup.requiredDevice;
    if (required && !catalog.devices.some((d: { id: string }) => d.id === required))
      throw new Error(`Missing required source device: ${required}`);
  }
  const scene = await loadPackedScene({
    directory: binding.dataRoot,
    routing: binding.exports,
    extractor: setup.extractor,
    scene: source.scene,
    source: suite.source,
    memoryBudget: binding.memoryBudget,
    fixedBounds: loadedBounds,
    hooks: {
      onProgress: checkpoint,
      transformInput: (raw) => {
        if (
          loadedBounds &&
          !isDeepStrictEqual(raw.ground.build?.bounds, {
            min: loadedBounds.min,
            max: loadedBounds.max,
          })
        )
          throw new Error('Physical bounds differ from the declared preparation scope');
        if (
          loadedBounds?.tiles?.length &&
          !isDeepStrictEqual(
            raw.ground.tiles?.map(({ x, z }) => ({ x, z })),
            [...loadedBounds.tiles].sort((a, b) => a.z - b.z || a.x - b.x),
          )
        )
          throw new Error('Physical tiles differ from the declared preparation scope');
        const audit = facilityAudit(raw, catalog);
        if (audit.staticImport !== 'matched')
          throw new Error(
            'Missing source facility geometry: ' +
              [...audit.missing, ...audit.mismatched].join(','),
          );
        const input = scenarioInput(raw, policy);
        if (!isDeepStrictEqual(input.ground.options.profile, suite.sources[source.scene].profile))
          throw new Error('Mechanism player profile differs from the frozen specification');
        evidence = { devices: input.devices };
        for (const support of [
          ...(input.devices?.movingSupports ?? []),
          ...(input.devices?.followingSupports ?? []),
        ])
          bySupport.set(support.id, evidence);
        return input;
      },
    },
  });
  if (
    !isDeepStrictEqual(scene.input.scene.source, suite.source) ||
    !isDeepStrictEqual(
      scene.input.scene.navigation.options.profile,
      suite.sources[source.scene].profile,
    )
  )
    throw new Error('Navigation source or player profile differs from the suite');
  // Scene owns the whole-route resource clock. Physical windows and replay
  // receive this same policy through transformInput above.
  scene.input.locomotion = world.locomotion ?? scene.input.locomotion;
  scene.input.scene.walls = scene.input.scene.navigation.options.walls ?? [];
  const resolved: Record<string, RouteQuery> = {};
  const resolutions: Record<string, unknown> = {};
  const resolutionErrors: Record<string, { status: string; reason: string }> = {};
  for (const item of items) {
    if (!item.setup.projectStartToPhysicalSupport) {
      resolved[item.id] = item.query;
      continue;
    }
    const file = resolve(binding.exports, `${item.scene}-interaction-points.json`);
    try {
      const prepared = await resolveQuery(
        item,
        {
          file,
          document: JSON.parse(await readFile(file, 'utf8')),
          source: suite.source,
          profile: suite.sources[item.scene].profile,
          catalog,
        },
        async (start, volume) => {
          const radius = volume.interaction.radius + 2;
          const bounds = {
            min: [volume.position[0] - radius, volume.position[2] - radius] as [number, number],
            max: [volume.position[0] + radius, volume.position[2] + radius] as [number, number],
          };
          const resources = scene.input.resources;
          const job = await resources.query(
            item.scene,
            scene.input.scene.source,
            start.position,
            volume.position,
            {
              startBuild: true,
              margin: 4,
              corridor: {
                kind: 'corridor-proposal',
                bounds,
                tiles: [],
                coarse: { regions: 0, edges: 0, path: [], halo: 0 },
              },
            },
          );
          if (!job) return null;
          const snapshot = await resources.physical!(job, {
            scene: item.scene,
            source: scene.input.scene.source,
            arrival: start,
            target: volume.position,
            interaction: volume.interaction,
            walls: scene.input.scene.walls,
          });
          if (snapshot.coverage === 'complete')
            throw new Error('Source resolution requires explicit physical coverage');
          return {
            ...snapshot,
            world: sourceSupportWorld(snapshot.input, snapshot.coverage, volume),
            source: suite.source,
            files: scene.files,
            reuse: 'source-only support proof; no solver search',
          };
        },
      );
      resolved[item.id] = prepared.query;
      resolutions[item.id] = prepared.receipt;
    } catch (error) {
      if (!(error instanceof QueryInputError)) throw error;
      resolutions[item.id] = error.receipt;
      resolutionErrors[item.id] = { status: error.status, reason: error.message };
    } finally {
      scene.endRequest();
    }
  }
  const byQuery = new Map(items.map((item) => [JSON.stringify(resolved[item.id]), item]));
  let prepared: V2PreparedSolver | undefined;
  // Marks are scene annotations from the complete authored catalog, independent
  // of the selected measurement IDs. Starts are never used as preparation hints.
  const marks = suite.cases
    .filter((item) => item.scene === source.scene && item.query.interaction?.airborne)
    .map((item) => ({ position: item.query.goal, interaction: item.query.interaction! }));
  return {
    ...scene,
    ...(v2
      ? {
          nativeLibrary: gangliaV2LibraryPath(),
          async prepareSolver() {
            try {
              if (!preparationBounds)
                throw new Error('ganglia-v2 requires an authored preparation scope');
              prepared = await scene.prepareSnapshot(preparationBounds, (physical) => {
                const hints = scopeAnnotations(source.scene, spec.id, physical, preparationBounds);
                return prepareGangliaV2(
                  setup.config as GangliaV2Config,
                  physical,
                  marks.filter(
                    ({ position }) =>
                      position[0] >= preparationBounds.min[0] &&
                      position[0] <= preparationBounds.max[0] &&
                      position[2] >= preparationBounds.min[1] &&
                      position[2] <= preparationBounds.max[1],
                  ),
                  [
                    ...landmarks.map(({ position }) => position),
                    ...hints.flatMap((hint) => hint.anchors),
                  ],
                  hints.map((hint) => hint.layout),
                  hints.flatMap((hint) => hint.links),
                );
              });
            } catch (error) {
              await scene.input.resources.close?.();
              throw error;
            }
            return {
              ...prepared,
              async close() {
                try {
                  await prepared!.close();
                } finally {
                  await scene.input.resources.close?.();
                }
              },
            };
          },
          preparationStats: () => ({
            scope: preparationBounds,
            landmarks,
            ...prepared?.preparationStats(),
          }),
        }
      : {}),
    metadata: {
      ...scene.metadata,
      mechanism: {
        resolved,
        resolutions,
        resolutionErrors,
        ...(v2
          ? { sourceScenarioId: spec.id, declaredBounds: fixedBounds, preparationBounds }
          : {}),
      },
    },
    inspectResult(query: RouteQuery, result: RouteResult) {
      const item = byQuery.get(JSON.stringify(query));
      if (!item) return result;
      const support = item.setup.requiredSupport;
      const input = support ? bySupport.get(support) : evidence;
      return {
        ...result,
        diagnostics: {
          ...result.diagnostics,
          mechanism: { exercise: exercised(item, result, input), loader: scene.loaderStats() },
        },
      };
    },
  };
}

export function scenarioInput(input: PhysicalInput, c: Pick<Case, 'setup'>): PhysicalInput {
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
