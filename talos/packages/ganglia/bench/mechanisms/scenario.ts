import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { loadScene } from '#@/bench/adapters/ganglia-v1/scene.ts';
/**
 * Construct a mechanism world once, retaining its resource windows and resolved
 * query evidence for all training and measured requests. World setup is applied
 * to every physical snapshot; case requirements check source facts rather than
 * forcing a solver route. The returned scene stays inside its owning worker.
 */
import { exercised, facilityAudit } from '#@/bench/mechanisms/assessment.ts';
import { QueryInputError, resolveQuery, sourceSupportWorld } from '#@/bench/mechanisms/query.ts';
import { checkSetup, type Case, readSuite } from '#@/bench/mechanisms/suite.ts';
import { exportPhysicalRegion } from '#@/bench/prepare-region.ts';
import type { WorkerSetup } from '#@/bench/workers.ts';
import type { LocomotionOptions } from '#@/src/index.ts';
import { joinedGeometry } from '#@/src/model/placement.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

export interface Binding {
  suite: string;
  ids: string[];
  dataRoot: string;
  exports: string;
  prepareConfig?: string;
  inputRevision: string;
}

export async function loadScenario(
  setup: WorkerSetup,
  onRegion: (files: { ground: string; collision: string }) => void,
  checkpoint: () => void,
) {
  const binding = JSON.parse(await readFile(setup.dataRoot, 'utf8')) as Binding;
  const suite = await readSuite(binding.suite);
  const items = suite.cases.filter((c) => binding.ids.includes(c.id));
  const first = items[0];
  const catalog = JSON.parse(
    await readFile(resolve(binding.exports, `${first.scene}-traversal-devices.json`), 'utf8'),
  );
  if (!isDeepStrictEqual(catalog.source, suite.source))
    throw new Error('Mechanism source build differs from exported device facts');
  const inputs: PhysicalInput[] = [];
  // Only these fields change physical rules. Required IDs and exercise assertions
  // describe source coverage, rather than forcing the solver to choose a device.
  const policy = {
    ...first,
    setup: {
      locomotion: first.setup.locomotion,
      locomotionPatch: first.setup.locomotionPatch,
      followingPlacement: first.setup.followingPlacement,
    },
  };
  for (const item of items) {
    const required = item.setup.requiredDevice;
    if (required && !catalog.devices.some((d: { id: string }) => d.id === required))
      throw new Error(`Missing required source device: ${required}`);
  }
  const scene = await loadScene(
    binding.dataRoot,
    setup.extractor,
    1,
    first.scene,
    binding.prepareConfig && !first.setup.physical
      ? async (request) => {
          const files = await exportPhysicalRegion(
            {
              dataRoot: binding.dataRoot,
              extractor: setup.extractor,
              config: binding.prepareConfig!,
              devices: resolve(binding.exports, `${first.scene}-traversal-devices.json`),
            },
            request,
          );
          onRegion(files);
          return files;
        }
      : undefined,
    {
      onProgress: checkpoint,
      transformInput: (raw) => {
        if (first.setup.physical) {
          const region = suite.physicalRegions.find((r) => r.id === first.setup.physical!.region);
          if (
            !region ||
            !isDeepStrictEqual(raw.ground.build?.bounds, {
              min: region.bounds.slice(0, 2),
              max: region.bounds.slice(2, 4),
            })
          )
            throw new Error('Frozen physical bounds differ from the selected specification');
        }
        const audit = facilityAudit(raw, catalog);
        if (audit.staticImport !== 'matched')
          throw new Error(
            'Missing source facility geometry: ' +
              [...audit.missing, ...audit.mismatched].join(','),
          );
        const input = scenarioInput(raw, policy);
        if (!isDeepStrictEqual(input.ground.options.profile, suite.sources[first.scene].profile))
          throw new Error('Mechanism player profile differs from the frozen specification');
        if (!inputs.includes(input)) inputs.push(input);
        return input;
      },
    },
  );
  // Scene owns the whole-route resource clock. Physical windows and replay
  // receive this same policy through transformInput above.
  scene.input.locomotion = first.setup.locomotion ?? scene.input.locomotion;
  if (first.setup.physical) {
    const region = suite.physicalRegions.find((r) => r.id === first.setup.physical!.region)!;
    const resources = scene.input.resources;
    const query = resources.query;
    // A frozen case offers its selected window, even when the coarse planner
    // proposes a larger corridor. Physical snapshots keep their actual bounds
    // and tiles, so neither search nor verification can treat the halo as loaded.
    resources.query = (scene, source, start, target, options) =>
      query(scene, source, start, target, {
        ...options,
        corridor: {
          ...options.corridor,
          bounds: {
            min: [region.bounds[0], region.bounds[1]],
            max: [region.bounds[2], region.bounds[3]],
          },
          tiles: [],
        },
      });
  }
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
            files: job.region.files,
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
    }
  }
  const byQuery = new Map(items.map((item) => [JSON.stringify(resolved[item.id]), item]));
  return {
    ...scene,
    metadata: {
      ...scene.metadata,
      mechanism: { resolved, resolutions, resolutionErrors, inputRevision: binding.inputRevision },
    },
    inspectResult(query: RouteQuery, result: RouteResult) {
      const item = byQuery.get(JSON.stringify(query));
      if (!item) return result;
      const input = inputs.findLast(
        (input) =>
          !item.setup.requiredSupport ||
          input.devices?.movingSupports?.some((s) => s.id === item.setup.requiredSupport) ||
          input.devices?.followingSupports?.some((s) => s.id === item.setup.requiredSupport),
      );
      return {
        ...result,
        diagnostics: {
          ...result.diagnostics,
          mechanism: { exercise: exercised(item, result, input) },
        },
      };
    },
  };
}

export function scenarioInput(input: PhysicalInput, c: Case): PhysicalInput {
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
