import { isDeepStrictEqual } from 'node:util';

import type { MechanismCase } from '#@/bench/mechanism-suite.ts';
import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { createTypeScriptCollisionWorld } from '#@/src/model/collision.ts';
import { createGoalProjector, findGoalHit, type GoalProjection } from '#@/src/model/goals.ts';
import { trianglesOf } from '#@/src/model/placement.ts';
import { createPhysicalWorld, type Coverage, type PhysicalWorld } from '#@/src/model/world.ts';
import type { InteractionGoal } from '#@/src/movement.ts';
import type { GroundArrival } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

export const witnessLimit = 32;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const point = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
type InputStatus = 'input-invalid' | 'input-unavailable' | 'input-unresolved';
type Volume = {
  position: Vec3;
  interaction: InteractionGoal;
  source: { buildGuid: string; contentHash: string; path: string };
  model: string;
};
const sourceIndexes = new WeakMap<PhysicalWorld, CollisionWorld>();

/** Only source-volume support is needed for input resolution. A local index
 * keeps the complete vertical collision column and never certifies a route or
 * claims coverage beyond the provider's snapshot.
 */
export function sourceSupportWorld(
  input: PhysicalInput,
  coverage: Exclude<Coverage, 'complete'>,
  volume: Pick<Volume, 'position' | 'interaction'>,
) {
  const radius = volume.interaction.radius + input.ground.options.profile.radius + 1e-5;
  const bounds = {
    min: [volume.position[0] - radius, volume.position[2] - radius] as [number, number],
    max: [volume.position[0] + radius, volume.position[2] + radius] as [number, number],
  };
  if (
    bounds.min.some((v, i) => v < coverage.bounds.min[i] || bounds.max[i] > coverage.bounds.max[i])
  )
    throw new Error('Source support volume exceeds physical coverage');
  const base = createTypeScriptCollisionWorld(input.collision, { bounds });
  const world = createPhysicalWorld(input, { ...coverage, bounds });
  sourceIndexes.set(world, base);
  return world;
}
export interface SourceSnapshot {
  input: PhysicalInput;
  world: PhysicalWorld;
  revision: string;
  source: unknown;
  files: unknown;
  reuse: string;
}
export interface QuerySource {
  file: string;
  document: unknown;
  source: unknown;
  profile: unknown;
  catalog: unknown;
}
type Candidate = {
  witness?: GoalProjection;
  feet?: Vec3;
  distance?: number;
  reason?: string;
};
type StartReceipt = {
  id: string;
  volume?: Volume;
  direction?: string;
  floor: [number, number];
  snapshot?: { revision: string; source: unknown; files: unknown; profile: unknown; reuse: string };
  status?: 'retained' | 'resolved';
  candidates?: Candidate[];
  witnessCount?: number;
  rawWitnessCount?: number;
  rawCandidates?: Candidate[];
  selected?: Candidate;
  original?: Candidate;
  limitedReason?: string;
};
export interface StartResolution {
  status: 'not-requested' | 'retained' | 'resolved' | InputStatus;
  sourceFile: string;
  witnessLimit: number;
  reason?: string;
  starts: StartReceipt[];
}
export class QueryInputError extends Error {
  readonly status: InputStatus;
  readonly receipt: StartResolution;
  constructor(status: InputStatus, receipt: StartResolution) {
    super(receipt.reason);
    this.status = status;
    this.receipt = receipt;
  }
}

/** The source interaction supplies an admissible start volume, never a route
 * answer. Failed finite witnesses remain an unresolved input setup, not proof
 * that the requested destination is unreachable.
 */
export async function resolveMechanismQuery(
  item: MechanismCase,
  source: QuerySource,
  snapshot: (start: GroundArrival, volume: Volume) => Promise<SourceSnapshot | null>,
): Promise<{ query: RouteQuery; receipt: StartResolution }> {
  const receipt: StartResolution = {
    status: 'not-requested',
    sourceFile: source.file,
    witnessLimit,
    starts: [],
  };
  if (!item.setup.projectStartToPhysicalSupport) return { query: item.query, receipt };
  function fail(status: InputStatus, reason: string): never {
    receipt.status = status;
    receipt.reason = reason;
    throw new QueryInputError(status, receipt);
  }
  const document = source.document,
    catalog = source.catalog;
  if (
    !record(document) ||
    !record(source.source) ||
    typeof source.source.buildGuid !== 'string' ||
    !source.source.buildGuid.trim() ||
    typeof source.source.contentHash !== 'string' ||
    !source.source.contentHash.trim() ||
    document.scene !== item.scene ||
    !isDeepStrictEqual(document.source, source.source) ||
    !Array.isArray(document.points) ||
    !record(catalog) ||
    catalog.scene !== item.scene ||
    !isDeepStrictEqual(catalog.source, source.source) ||
    !Array.isArray(catalog.devices)
  )
    fail('input-invalid', 'Source scene or build binding differs');
  const starts: GroundArrival[] = [];
  for (const start of item.query.starts) {
    const entry: StartReceipt = {
      id: start.id,
      floor: [start.position[1] - 0.5, start.position[1] + 0.5],
    };
    receipt.starts.push(entry);
    const matches = document.points.filter((p: unknown) => record(p) && p.id === start.id);
    const devices = catalog.devices.filter((d: unknown) => record(d) && d.id === start.id);
    if (matches.length !== 1 || devices.length !== 1 || !record(matches[0]) || !record(devices[0]))
      fail('input-invalid', 'Source start/device id is missing or ambiguous: ' + start.id);
    const placed = matches[0],
      device = devices[0],
      goal = placed.navigationGoal;
    if (
      !record(goal) ||
      !point(goal.position) ||
      !record(goal.interaction) ||
      typeof goal.interaction.radius !== 'number' ||
      !Number.isFinite(goal.interaction.radius) ||
      goal.interaction.radius <= 0 ||
      !record(goal.source) ||
      typeof goal.source.buildGuid !== 'string' ||
      !goal.source.buildGuid.trim() ||
      typeof goal.source.contentHash !== 'string' ||
      !goal.source.contentHash.trim() ||
      goal.source.buildGuid !== source.source.buildGuid ||
      goal.source.contentHash !== source.source.contentHash ||
      typeof goal.source.path !== 'string' ||
      !goal.source.path.trim() ||
      goal.source.path !== placed.templatePath ||
      !record(placed.rules) ||
      !isDeepStrictEqual(placed.rules.source, goal.source) ||
      goal.model !== 'normal-trigger-probe-v1' ||
      !Array.isArray(placed.navigationUnresolved) ||
      placed.navigationUnresolved.length ||
      placed.source !== device.source ||
      placed.template !== device.template ||
      !isDeepStrictEqual(placed.position, device.position)
    )
      fail('input-invalid', 'Source start volume provenance differs: ' + start.id);
    const interaction: InteractionGoal = { ...goal.interaction, radius: goal.interaction.radius };
    try {
      findGoalHit([goal.position, goal.position], goal.position, interaction);
    } catch (error) {
      fail('input-invalid', 'Source interaction geometry is invalid: ' + String(error));
    }
    const volume: Volume = {
      position: [...goal.position],
      interaction,
      source: {
        buildGuid: goal.source.buildGuid,
        contentHash: goal.source.contentHash,
        path: goal.source.path,
      },
      model: goal.model,
    };
    entry.volume = volume;
    if (!findGoalHit([start.position, start.position], volume.position, volume.interaction))
      fail('input-invalid', 'Original source start lies outside its bound volume');
    let selected: SourceSnapshot | null;
    try {
      selected = await snapshot(start, volume);
    } catch (error) {
      if (record(error) && error.code === 'ENOENT')
        fail('input-unavailable', 'Source physical snapshot is absent');
      throw error;
    }
    if (!selected)
      fail('input-unavailable', 'No loaded physical snapshot covers the source volume');
    if (
      !isDeepStrictEqual(selected.source, source.source) ||
      !isDeepStrictEqual(selected.input.ground.options.profile, source.profile)
    )
      fail('input-invalid', 'Source physical snapshot build/profile differs');
    entry.snapshot = {
      revision: selected.revision,
      source: selected.source,
      files: selected.files,
      profile: selected.input.ground.options.profile,
      reuse: selected.reuse,
    };
    const normalized = selected.input.devices?.devices.filter((d) => d.id === start.id) ?? [];
    const normalizedGoal: unknown = normalized[0]?.goal;
    if (
      normalized.length !== 1 ||
      !record(normalizedGoal) ||
      !isDeepStrictEqual(normalizedGoal.position, volume.position) ||
      !isDeepStrictEqual(normalizedGoal.interaction, volume.interaction) ||
      !isDeepStrictEqual(normalizedGoal.source, volume.source) ||
      normalizedGoal.model !== volume.model ||
      !isDeepStrictEqual(normalized[0].position, device.position)
    )
      fail('input-invalid', 'Normalized device goal differs from its source volume');
    if (item.group === 'rope') {
      const evidence = item.evidence.find((e) => e.collection === 'ropes.pairs');
      const pairs =
        record(catalog.ropes) && Array.isArray(catalog.ropes.pairs) ? catalog.ropes.pairs : [];
      const pair = evidence?.index === undefined ? undefined : pairs[evidence.index];
      if (
        !record(pair) ||
        pair.ascent !== 'rope' ||
        pair.descent !== 'drop' ||
        normalized[0].kind !== 'rope' ||
        (pair.top !== start.id && pair.bottom !== start.id) ||
        !selected.input.devices?.ropes.some((p) => p.top === pair.top && p.bottom === pair.bottom)
      )
        fail('input-invalid', 'Source rope pair binding differs');
      entry.direction = pair.bottom === start.id ? 'ascent' : 'descent';
      if (
        (item.tags.includes('ascent') && entry.direction !== 'ascent') ||
        (item.tags.includes('descent') && entry.direction !== 'descent')
      )
        fail('input-invalid', 'Source rope direction differs');
    } else if (
      item.group !== 'launch' ||
      item.setup.requiredDevice !== start.id ||
      normalized[0].kind !== 'launch'
    )
      fail('input-invalid', 'Source launch id/kind binding differs');

    const configured = selected.world.configured();
    const inVolume = (p: Vec3) => !!findGoalHit([p, p], volume.position, volume.interaction);
    const inspect = (p: Vec3, witness?: GoalProjection): Candidate => {
      const candidate: Candidate = { witness };
      try {
        if (!selected.world.covered(p, p)) return { ...candidate, reason: 'outside-coverage' };
        const feet = configured.standing(p);
        if (!feet) return { ...candidate, reason: 'not-standing' };
        candidate.feet = feet;
        if (!inVolume(feet)) return { ...candidate, reason: 'outside-source-volume' };
        if (feet[1] < entry.floor[0] - 1e-6 || feet[1] > entry.floor[1] + 1e-6)
          return { ...candidate, reason: 'outside-original-floor' };
        if (!selected.world.covered(feet, feet))
          return { ...candidate, reason: 'outside-coverage' };
        if (configured.blocked(feet, feet)) return { ...candidate, reason: 'wall-blocked' };
        if (configured.world.sweepCapsule(feet, feet, selected.input.ground.options.profile))
          return { ...candidate, reason: 'capsule-blocked' };
        const exact = configured.standing(feet);
        if (!exact || distance(exact, feet) > 1e-5)
          return { ...candidate, reason: 'standing-not-exact' };
        candidate.distance = distance(feet, start.position);
        return candidate;
      } catch (error) {
        return { ...candidate, reason: String(error) };
      }
    };
    const original = inspect(start.position);
    entry.original = original;
    if (!original.reason && original.feet && distance(original.feet, start.position) <= 1e-5) {
      starts.push(start);
      entry.status = 'retained';
      entry.selected = original;
      entry.limitedReason = 'original-foot-retained';
      continue;
    }
    if (!original.reason) original.reason = 'original-position-is-not-exact-feet';
    const project = createGoalProjector(selected.input.ground.surfaces);
    const vertical = Math.max(...entry.floor.map((y) => Math.abs(y - volume.position[1])));
    const witnesses = project(volume.position, {
      maxVertical: vertical,
      interaction: volume.interaction,
    }).filter(
      (witness) =>
        witness.position[1] >= entry.floor[0] - 1e-6 &&
        witness.position[1] <= entry.floor[1] + 1e-6,
    );
    entry.witnessCount = witnesses.length;
    entry.limitedReason =
      witnesses.length > witnessLimit ? 'source-witness-limit' : 'finite-navigation-witnesses';
    entry.candidates = witnesses
      .slice(0, witnessLimit)
      .map((witness) => inspect(witness.position, witness));
    const admissible = entry.candidates.filter(
      (candidate): candidate is Candidate & { feet: Vec3; distance: number } =>
        !candidate.reason && !!candidate.feet && candidate.distance !== undefined,
    );
    admissible.sort((a, b) => a.distance - b.distance);
    let chosen = admissible[0];
    const remaining = witnessLimit - entry.candidates.length;
    const raw = sourceIndexes.get(selected.world);
    if (!chosen && remaining > 0 && raw?.bounds && raw.trianglesInBounds) {
      // Navigation erosion can remove a narrow but physically supported source
      // contact. Raw faces supply proposals within the remaining witness quota;
      // standing, capsule clearance, coverage and the original floor/volume still
      // decide admission. These faces never become a navigation mesh.
      const ids = raw.trianglesInBounds(raw.bounds);
      const surfaces = trianglesOf(selected.input.collision, ids).map((vertices, index) => ({
        id: `source-raw/${ids[index]}`,
        vertices,
      }));
      const minimumUp = Math.cos((selected.input.movement.maxSlope * Math.PI) / 180);
      const supports: typeof surfaces = [],
        probes: typeof surfaces = [];
      for (const surface of surfaces) {
        const [a, b, c] = surface.vertices;
        const ab = b.map((v, i) => v - a[i]),
          ac = c.map((v, i) => v - a[i]);
        const normal = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        (normal[1] > 0 && normal[1] / Math.hypot(...normal) >= minimumUp ? supports : probes).push(
          surface,
        );
      }
      // Spend the same finite quota on possible support first. Other faces can
      // still propose legal feet on a neighbouring cap, so retain them as
      // secondary probes rather than treating their orientation as a rejection.
      const rawWitnesses = [supports, probes].flatMap((faces) =>
        createGoalProjector(faces)(volume.position, {
          maxVertical: vertical,
          interaction: volume.interaction,
        }).filter(
          (witness) =>
            witness.position[1] >= entry.floor[0] - 1e-6 &&
            witness.position[1] <= entry.floor[1] + 1e-6,
        ),
      );
      entry.rawWitnessCount = rawWitnesses.length;
      entry.rawCandidates = rawWitnesses
        .slice(0, remaining)
        .map((witness) =>
          inspect([witness.position[0], witness.position[1] + 0.005, witness.position[2]], witness),
        );
      const accepted = entry.rawCandidates.filter(
        (candidate): candidate is Candidate & { feet: Vec3; distance: number } =>
          !candidate.reason && !!candidate.feet && candidate.distance !== undefined,
      );
      accepted.sort((a, b) => a.distance - b.distance);
      chosen = accepted[0];
    }
    const exhausted =
      witnesses.length > entry.candidates.length ||
      (entry.rawWitnessCount ?? 0) > (entry.rawCandidates?.length ?? 0);
    if (entry.rawCandidates)
      entry.limitedReason = exhausted
        ? 'source-witness-limit'
        : 'finite-navigation-and-raw-witnesses';
    if (!chosen)
      fail(
        'input-unresolved',
        exhausted ? 'Source witness budget exhausted' : 'Source finite witness set exhausted',
      );
    entry.status = 'resolved';
    entry.selected = chosen;
    starts.push({ ...start, position: [...chosen.feet] });
  }
  receipt.status = receipt.starts.some((start) => start.status === 'resolved')
    ? 'resolved'
    : 'retained';
  return { query: { ...item.query, starts }, receipt };
}
