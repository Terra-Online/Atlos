import {
  type Model,
  random,
  rank,
  crossEntropy,
  withFallback,
} from '#@/scripts/research/policy.ts';
import { type CollisionWorld, createCollisionWorld } from '#@/src/collision.ts';
import type { Vec3, Surface, CollisionGeometry } from '#@/src/geometry.ts';
import type { JumpModel } from '#@/src/movement.ts';
import type { GroundOptions } from '#@/src/route.ts';
import {
  type Arc,
  jumpDuration,
  jumpConnection,
  runOffConnection,
} from '#@/src/v1/motion/jumps.ts';
type Source = { buildGuid?: string; contentHash?: string };
type Binding = {
  scene: string;
  source: Source;
  selection: unknown;
  options: { profile: GroundOptions['profile'] };
};
type Ground = Binding & {
  surfaces: Surface[];
  options: GroundOptions;
  coverage: { complete: boolean };
};
type Collision = Binding & CollisionGeometry & { coverage: { complete: boolean } };
type Movement = {
  source: Source;
  defaultProfile: GroundOptions['profile'];
  assets: { path: string; settings: Record<string, number> }[];
};
type Group = {
  key: string;
  cell: number[];
  center: Vec3;
  area: number;
  triangles: { surface: string; vertices: Vec3[]; area: number; cumulative: number }[];
};
type Control = { mode: 'jump' | 'drop'; horizontalSplit?: number };
type Proposal = ReturnType<typeof propose>;
type Decision = Proposal & {
  valid: boolean;
  reason: string;
  duration: number | null;
  sweeps: number;
  elapsedMs: number;
  motion?: Arc;
};
export type CompactDecision = ReturnType<typeof compact>;
type Arm = {
  primaryMs: number;
  primaryFirstMs: number | null;
  fullFirstMs: number | null;
  fallbackMs: number;
  generationMs: number;
  primary: CompactDecision[];
  fallback: CompactDecision[];
  bestDuration: number;
};
export type Episode = {
  id: string;
  map: string;
  level: string;
  levelBinding: unknown;
  split: string;
  source: string;
  target: string;
  stratum: number;
  generationMs: number;
  decisions: CompactDecision[];
  unresolved: boolean;
  arms?: Record<string, Arm>;
};
type Entry = {
  id: string;
  ground: string;
  collision: string;
  movement: string;
  level: string;
  levelBinding: unknown;
  split: string;
};
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, appendFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, isDeepStrictEqual } from 'node:util';

import { createWallChecker } from '#@/src/v1/geo/walls.ts';
import { createGoalProjector } from '#@/src/v1/motion/goals.ts';
import { createGroundStraightener } from '#@/src/v1/route/straighten.ts';
import { standingFoot } from '#@/src/v1/search/traversal.ts';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const horizontal = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const controls: Control[] = [
  { mode: 'jump' },
  { mode: 'drop' },
  ...[0.25, 0.5, 0.75].map((horizontalSplit) => ({ mode: 'jump' as const, horizontalSplit })),
];

async function sourceIdentity() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
    files: { path: string; sha256: string }[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(resolve(root, directory), { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith('.ts'))
        files.push({ path, sha256: hash(await readFile(resolve(root, path))) });
    }
  };
  await visit('src');
  await visit('scripts/research');
  return { files, sha256: hash(JSON.stringify(files)) };
}

export function checkBinding(
  ground: Binding,
  collision: Binding,
  movement: Pick<Movement, 'source' | 'defaultProfile'>,
) {
  if (
    ground.scene !== collision.scene ||
    !ground.source?.buildGuid ||
    !ground.source?.contentHash ||
    !isDeepStrictEqual(ground.source, collision.source) ||
    !isDeepStrictEqual(ground.source, movement.source) ||
    !isDeepStrictEqual(ground.selection, collision.selection) ||
    !isDeepStrictEqual(ground.options.profile, collision.options.profile) ||
    !isDeepStrictEqual(ground.options.profile, movement.defaultProfile)
  )
    throw new Error('Scene/source/selection/profile mismatch');
}

export function regions(surfaces: Surface[], size = 6) {
  const groups = new Map<string, Group>();
  for (const surface of surfaces) {
    const coordinate = (axis: number) =>
      surface.vertices.reduce((sum, point) => sum + point[axis], 0) / surface.vertices.length;
    const center: Vec3 = [coordinate(0), coordinate(1), coordinate(2)];
    const cell = [
      Math.floor(center[0] / size),
      Math.floor(center[1] / 3),
      Math.floor(center[2] / size),
    ];
    const key = cell.join('/');
    const group = groups.get(key) ?? { key, cell, triangles: [], area: 0, center };
    for (let index = 2; index < surface.vertices.length; index++) {
      const vertices = [surface.vertices[0], surface.vertices[index - 1], surface.vertices[index]];
      const [a, b, c] = vertices;
      const area = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2;
      if (area < 1e-8) continue;
      group.area += area;
      group.triangles.push({ surface: surface.id, vertices, area, cumulative: group.area });
    }
    if (group.area) groups.set(key, group);
  }
  return groups;
}

/** Uniform projected-area sampling of a fan-triangulated support union. The first
 * coordinate chooses a triangle and an independent residual within its CDF bin.
 * CEM's coordinate chart is piecewise continuous at triangle ownership changes.
 */
export function sample(
  group: Group,
  u: number,
  v: number,
): { surface: string; position: Vec3; area: number; edge: number } {
  const area = Math.min(1 - Number.EPSILON, Math.max(0, u)) * group.area;
  let low = 0,
    high = group.triangles.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (group.triangles[mid].cumulative > area) high = mid;
    else low = mid + 1;
  }
  const triangle = group.triangles[low];
  const a = Math.sqrt(Math.max(0, (area - (triangle.cumulative - triangle.area)) / triangle.area));
  const weights = [1 - a, a * (1 - v), a * v];
  const coordinate = (axis: number) =>
    triangle.vertices.reduce((sum, point, i) => sum + weights[i] * point[axis], 0);
  return {
    surface: triangle.surface,
    position: [coordinate(0), coordinate(1), coordinate(2)],
    area: triangle.area,
    edge: Math.min(...weights) * Math.sqrt(triangle.area),
  };
}

function propose(
  source: Group,
  target: Group,
  vector: number[],
  ordinal: number,
  model: JumpModel,
) {
  const start = sample(source, vector[0], vector[1]),
    end = sample(target, vector[2], vector[3]);
  const control = controls[ordinal % controls.length];
  const span = horizontal(start.position, end.position),
    rise = end.position[1] - start.position[1];
  const duration = jumpDuration(start.position[1], end.position[1], {
    ...model,
    mode: control.mode,
  });
  const features = [
    span / 24,
    rise / 15,
    Math.abs(rise) / 15,
    (duration ?? 10) / 5,
    Math.min(10, span / Math.max(0.01, (duration ?? 0) * model.maxHorizontalSpeed)),
    Math.log1p(start.area),
    Math.log1p(end.area),
    start.edge,
    end.edge,
    Number(control.mode === 'drop'),
    control.horizontalSplit ?? -1,
  ];
  return {
    id: `${ordinal}/${vector.join('/')}`,
    vector,
    start,
    end,
    control,
    features,
    heuristic: (duration ?? 10) + span / model.maxHorizontalSpeed,
  };
}

function evaluator(ground: Ground, world: CollisionWorld, model: JumpModel) {
  const project = createGoalProjector(ground.surfaces),
    profile = ground.options.profile;
  const blocked = createWallChecker(ground.options.walls, profile);
  const visibility = createGroundStraightener(ground.surfaces, ground.options);
  const options = {
    profile,
    maxVertical: ground.options.maxVertical,
    maxSlope: 46,
    blocked,
    project,
  };
  return (candidate: Proposal): Decision => {
    const started = performance.now();
    let sweeps = 0;
    const counted: CollisionWorld = {
      ...world,
      sweepCapsule: (...args) => {
        sweeps++;
        return world.sweepCapsule(...args);
      },
    };
    const finish = (reason: string, arc?: Arc | null): Decision => ({
      ...candidate,
      valid: Boolean(arc),
      reason,
      duration: arc?.times.at(-1) ?? null,
      sweeps,
      elapsedMs: performance.now() - started,
      // These are primitive witnesses, not resource-scheduled whole routes.
      ...(arc ? { motion: arc } : {}),
    });
    const start = standingFoot(candidate.start, counted, options);
    if ('reason' in start && start.reason) return finish(`source-${start.reason}`);
    const end = standingFoot(candidate.end, counted, options);
    if ('reason' in end && end.reason) return finish(`target-${end.reason}`);
    if (start.surface === end.surface) return finish('same-surface');
    if (start.position[1] - end.position[1] > 15 || horizontal(start.position, end.position) > 24)
      return finish('range');
    const motion = {
      ...model,
      ...candidate.control,
      profile,
      walls: ground.options.walls,
      wallCheck: blocked,
      world: counted,
      maxSlope: 46,
      sweep: counted.sweepCapsule,
    };
    const arc =
      candidate.control.mode === 'drop'
        ? runOffConnection(start.position, end.position, motion)
        : jumpConnection(start.position, end.position, motion);
    if (arc) {
      const trace = visibility.trace(candidate.start.position, candidate.end.position);
      const walking = trace
        ?.slice(1)
        .reduce(
          (sum, point, i) =>
            sum + Math.hypot(...point.map((value, axis) => value - trace[i][axis])),
          0,
        );
      if (trace && walking! / ground.options.speed <= arc.times.at(-1)!)
        return finish('ground-dominated');
    }
    return finish(arc ? 'accepted' : 'motion', arc);
  };
}

function movementModel(movement: Movement): JumpModel {
  const settings = movement.assets.find((asset) =>
    asset.path.endsWith('/MovementSetting_Default.asset'),
  )?.settings;
  if (!settings) throw new Error('Missing default movement settings');
  const model = {
    gravity: settings._gravity,
    fallingGravity: settings._fallingGravity,
    maxJumpHeight: settings._maxJumpHeight,
    maxFallingSpeed: settings._maxFallingSpeed,
    apexTime: settings._apexTime,
    maxHorizontalSpeed: settings._inAirMaxHorizontalSpeedSprint,
    airOverspeedDeceleration: settings._inAirDecelerationWithInputSprint,
    airAcceleration: settings._inAirAcceleration,
    airDeceleration: settings._inAirDecelerationNoInputSprint,
    startHorizontalSpeed: 0,
  };
  model.startHorizontalSpeed = Math.min(
    settings._startHorizontalSpeedSprint,
    settings._inAirMaxInitHorizontalSpeed,
  );
  if (!Object.values(model).every(Number.isFinite) || settings._slopeLimit !== 46)
    throw new Error('Unsupported movement settings');
  return model;
}

const compact = (row: Decision) => {
  const { motion, ...rest } = row;
  return {
    ...rest,
    ...(motion
      ? {
          witness: {
            start: motion.points[0],
            end: motion.points.at(-1),
            mode: motion.mode,
            points: motion.points.length,
            sha256: hash(JSON.stringify(motion)),
          },
        }
      : {}),
  };
};

async function runEntry(
  entry: Entry,
  directory: string,
  count: number,
  samples: number,
  seed: number,
  weights?: Model,
) {
  const started = performance.now(),
    identities: Record<string, { path: string; bytes: number; sha256: string }> = {},
    solver = await sourceIdentity();
  const load = async <T>(key: 'ground' | 'collision' | 'movement'): Promise<T> => {
    const bytes = await readFile(entry[key]);
    identities[key] = { path: entry[key], bytes: bytes.length, sha256: hash(bytes) };
    return JSON.parse(bytes.toString()) as T;
  };
  const ground = await load<Ground>('ground'),
    collision = await load<Collision>('collision'),
    movement = await load<Movement>('movement');
  checkBinding(ground, collision, movement);
  const model = movementModel(movement),
    profile = ground.options.profile;
  const padding = 2 + 2 * profile.radius;
  const bounds: { min: [number, number]; max: [number, number] } = {
    min: [Infinity, Infinity],
    max: [-Infinity, -Infinity],
  };
  for (const surface of ground.surfaces)
    for (const point of surface.vertices)
      for (const [i, axis] of [0, 2].entries()) {
        bounds.min[i] = Math.min(bounds.min[i], point[axis] - padding);
        bounds.max[i] = Math.max(bounds.max[i], point[axis] + padding);
      }
  const world = createCollisionWorld(collision, { bounds });
  const evaluate = evaluator(ground, world, model),
    groups = regions(ground.surfaces);
  const rng = random(seed),
    all = [...groups.values()],
    episodes: Episode[] = [],
    used = new Set();
  let draws = 0;
  // Balance nine distance/height strata rather than drawing mostly adjacent flat faces.
  const strata = Array.from(
    { length: 9 },
    (): { source: Group; target: Group; stratum: number }[] => [],
  );
  for (
    let attempts = 0;
    attempts < count * 200 && strata.some((rows) => rows.length < Math.ceil(count / 9));
    attempts++
  ) {
    draws++;
    const source = all[Math.floor(rng() * all.length)];
    const x = source.cell[0] + Math.floor(rng() * 9) - 4;
    const z = source.cell[2] + Math.floor(rng() * 9) - 4;
    const y = source.cell[1] + Math.floor(rng() * 7) - 5;
    const target = groups.get([x, y, z].join('/'));
    if (!target || source === target) continue;
    const span = horizontal(source.center, target.center),
      rise = target.center[1] - source.center[1];
    if (span < 1 || span > 24 || rise > model.maxJumpHeight + 2 || rise < -15) continue;
    const stratum = (span < 6 ? 0 : span < 12 ? 1 : 2) * 3 + (rise < -1 ? 0 : rise > 1 ? 2 : 1);
    const key = `${source.key}>${target.key}`;
    if (used.has(key) || strata[stratum].length >= Math.ceil(count / 9)) continue;
    used.add(key);
    strata[stratum].push({ source, target, stratum });
  }
  for (let index = 0; episodes.length < count; index++) {
    const row = strata[index % 9].shift();
    if (!row) {
      if (strata.every((rows) => !rows.length)) break;
      continue;
    }
    const { source, target, stratum } = row;
    const id = `${entry.id}/${episodes.length}`;
    const generate = (vector: number[], ordinal: number) =>
      propose(source, target, vector, ordinal, model);
    const generationAt = performance.now();
    const candidates = Array.from({ length: samples }, (_, ordinal) =>
      generate(Array.from({ length: 4 }, rng), ordinal),
    );
    const ordered = rank(candidates);
    const generationMs = performance.now() - generationAt;
    const decisions = ordered.map(evaluate);
    const episode: Episode = {
      id,
      map: ground.scene,
      level: entry.level,
      levelBinding: entry.levelBinding,
      split: entry.split,
      source: source.key,
      target: target.key,
      stratum,
      generationMs,
      decisions: decisions.map(compact),
      unresolved: !decisions.some((row) => row.valid),
    };
    if (weights) {
      const arms: Record<string, Arm> = {};
      // Rotate execution order to reduce systematic JIT/thermal bias. No result cache is shared.
      const names = ['reference', 'cem', 'learned', 'hybrid'];
      for (let offset = 0; offset < names.length; offset++) {
        const name = names[(episodes.length + offset) % names.length],
          at = performance.now();
        let rows: Decision[],
          firstMs: number | null = null;
        const timed = (candidate: Proposal) => {
          const row = evaluate(candidate);
          if (row.valid && firstMs === null) firstMs = performance.now() - at;
          return row;
        };
        if (name === 'reference' || name === 'learned')
          rows = rank(candidates, name === 'learned' ? weights : undefined).map(timed);
        else
          rows = crossEntropy({
            rng: random(seed + episodes.length * 101),
            propose: generate,
            evaluate: timed,
            model: name === 'hybrid' ? weights : undefined,
            budget: samples,
          });
        const primaryMs = performance.now() - at;
        const fallbackAt = performance.now();
        // Measured fallback is always executed; cached offline labels are never substituted.
        const primaryFirstMs = firstMs;
        const fallback = name === 'cem' || name === 'hybrid' ? ordered.map(timed) : [];
        const combined = withFallback(rows, fallback);
        arms[name] = {
          primaryMs,
          primaryFirstMs,
          fullFirstMs: firstMs,
          fallbackMs: performance.now() - fallbackAt,
          generationMs,
          primary: rows.map(compact),
          fallback: fallback.map(compact),
          bestDuration: Math.min(
            ...combined.filter((row) => row.valid).map((row) => row.duration!),
          ),
        };
      }
      episode.arms = arms;
    }
    episodes.push(episode);
    await appendFile(resolve(directory, `${entry.id}.jsonl`), JSON.stringify(episode) + '\n');
    if (episodes.length % 50 === 0)
      console.log(JSON.stringify({ entry: entry.id, finished: episodes.length }));
  }
  const report = {
    entry,
    seed,
    requested: count,
    finished: episodes.length,
    samples,
    draws,
    identities,
    solver,
    source: ground.source,
    selection: ground.selection,
    coverage: { ground: ground.coverage.complete, collision: collision.coverage.complete },
    profile,
    model,
    bounds,
    regions: all.length,
    valid: episodes.reduce(
      (sum, episode) => sum + episode.decisions.filter((row) => row.valid).length,
      0,
    ),
    elapsedMs: performance.now() - started,
    maxRss: process.resourceUsage().maxRSS,
    runtime: { node: process.version, execArgv: process.execArgv },
  };
  await writeFile(resolve(directory, `${entry.id}.json`), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      entry: entry.id,
      episodes: report.finished,
      valid: report.valid,
      elapsedMs: report.elapsedMs,
    }),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string' },
      output: { type: 'string' },
      episodes: { type: 'string', default: '180' },
      samples: { type: 'string', default: '40' },
      seed: { type: 'string', default: '20261111' },
      entry: { type: 'string' },
      weights: { type: 'string' },
    },
  });
  if (!values.manifest || !values.output)
    throw new Error(
      'Usage: collect.ts --manifest <JSON> --output <new directory> [--weights <JSON>]',
    );
  const manifestPath = resolve(values.manifest),
    directory = resolve(values.output);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { entries: Entry[] };
  if (
    !Array.isArray(manifest.entries) ||
    !manifest.entries.length ||
    new Set(manifest.entries.map((entry) => entry.id)).size !== manifest.entries.length ||
    manifest.entries.some(
      (entry) =>
        !/^[a-zA-Z0-9_-]+$/.test(entry.id) ||
        !['train', 'validation', 'test'].includes(entry.split),
    )
  )
    throw new Error('Invalid manifest entries/ids/splits');
  const count = Number(values.episodes),
    samples = Number(values.samples),
    seed = Number(values.seed);
  if (
    ![count, samples, seed].every(Number.isSafeInteger) ||
    count < 1 ||
    samples < 8 ||
    samples > 1000
  )
    throw new Error('Invalid finite budget');
  const weights = values.weights
    ? (JSON.parse(await readFile(values.weights, 'utf8')) as Model)
    : undefined;
  if (values.entry !== undefined) {
    const index = Number(values.entry);
    const entry = manifest.entries[index];
    if (!entry) throw new Error('Invalid entry');
    for (const key of ['ground', 'collision', 'movement'] as const)
      entry[key] = resolve(dirname(manifestPath), entry[key]);
    await runEntry(entry, directory, count, samples, seed + index * 1009, weights);
    return;
  }
  // Never overwrite prior evidence. A process per snapshot keeps peak geometry memory bounded.
  await mkdir(directory);
  await writeFile(
    resolve(directory, 'manifest.json'),
    JSON.stringify(
      {
        ...manifest,
        collection: {
          count,
          samples,
          seed,
          manifestSha256: hash(await readFile(manifestPath)),
          weightsSha256: values.weights ? hash(await readFile(values.weights)) : null,
        },
      },
      null,
      2,
    ),
  );
  for (let index = 0; index < manifest.entries.length; index++) {
    const args = [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      '--manifest',
      manifestPath,
      '--output',
      directory,
      '--episodes',
      String(count),
      '--samples',
      String(samples),
      '--seed',
      String(seed),
      '--entry',
      String(index),
    ];
    if (values.weights) args.push('--weights', resolve(values.weights));
    const child = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (child.status !== 0)
      throw new Error(
        `Collection failed for ${manifest.entries[index].id}: ${child.signal ?? child.status}`,
      );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
