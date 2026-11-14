import type { Vec3 } from '#@/src/geometry.ts';
import type { SweptSupport } from '#@/src/solver/physical.ts';

/** Translate a source rotor into the agreed phase-free circular contact domain.
 * Small horizontal contact patches admit boarding/exit, not a filled wheel disk.
 * Adjacent transfers trace the rim; their sagitta bounds the chord approximation.
 * Static braces and external obstacles remain the caller's collision geometry. */
export function circularSupport(input: {
  id: string;
  level: string;
  model: string;
  center: Vec3;
  axis: Vec3;
  radius: number;
  halfWidth: number;
  speed: number;
}): SweptSupport {
  const { id, level, model, center, radius, halfWidth, speed } = input;
  const norm = Math.hypot(...input.axis);
  if (
    center.length !== 3 ||
    input.axis.length !== 3 ||
    ![...center, ...input.axis, radius, halfWidth, speed].every(Number.isFinite) ||
    !Number.isFinite(norm) ||
    norm < 1e-6 ||
    radius <= 0 ||
    halfWidth <= 0 ||
    speed <= 0
  ) {
    throw new Error('Invalid circular support');
  }
  const axis = input.axis.map((v) => v / norm) as Vec3;
  // The current abstraction is a vertical wheel, not an arbitrary tumbling body.
  if (Math.abs(axis[1]) > 1e-6) throw new Error('Circular support axis is not horizontal');
  const upLength = Math.sqrt(1 - axis[1] ** 2);
  const up: Vec3 = [(-axis[0] * axis[1]) / upLength, upLength, (-axis[2] * axis[1]) / upLength];
  const across: Vec3 = [
    axis[1] * up[2] - axis[2] * up[1],
    axis[2] * up[0] - axis[0] * up[2],
    axis[0] * up[1] - axis[1] * up[0],
  ];
  const sagitta = Math.min(0.005, radius / 100);
  const count = Math.max(16, Math.ceil(Math.PI / Math.acos(1 - sagitta / radius)));
  if (count > 4096) throw new Error('Circular support exceeds contact resolution limit');
  const feet = Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count;
    return center.map(
      (v, k) => v + radius * (Math.cos(angle) * up[k] + Math.sin(angle) * across[k]),
    ) as Vec3;
  });
  const horizontal = Math.hypot(axis[0], axis[2]);
  const along: Vec3 = [axis[0] / horizontal, 0, axis[2] / horizontal];
  const side: Vec3 = [-along[2], 0, along[0]];
  const contact = Math.min(0.025, sagitta * 2);
  const surfaces = feet.map((p, i) => ({
    id: `circular/${id}/${i}`,
    vertices: [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1],
    ].map(
      ([a, b]) => p.map((v, k) => v + a * halfWidth * along[k] + b * contact * side[k]) as Vec3,
    ),
  }));
  const poses = surfaces.map((s) => ({
    min: [0, 1, 2].map((k) => Math.min(...s.vertices.map((p) => p[k]))) as Vec3,
    max: [0, 1, 2].map((k) => Math.max(...s.vertices.map((p) => p[k]))) as Vec3,
  }));
  return {
    id,
    level,
    model,
    family: 'waterwheel',
    assumption: 'phase-free-swept-support',
    circular: { center, axis, radius, halfWidth, sagitta },
    surfaces,
    poses,
    surfacePoses: surfaces.map((_, i) => [{ body: 0, fromPose: i, toPose: i }]),
    endpoints: { initial: poses[0], terminal: poses[Math.floor(count / 2)] },
    transfers: feet.map((p, i) => ({
      from: p,
      to: feet[(i + 1) % count],
      speed,
      body: 0,
      fromPose: i,
      toPose: (i + 1) % count,
    })),
  };
}
