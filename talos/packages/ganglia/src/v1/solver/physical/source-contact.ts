import type { Surface, Vec3, Wall } from '#@/src/geometry.ts';
import { physicalTileSpan } from '#@/src/model/coverage.ts';
import { createPhysicalWorld, type PreparedBase } from '#@/src/model/world.ts';
import type { GroundArrival, Route } from '#@/src/route.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Admit already supported physical feet missing from the navigation mesh. A
 * contact chart proposes graph endpoints only and never enters collision.
 * Action discovery uses the original prepared terrain and its bounds. */
export function sourceContact(
  input: PhysicalInput,
  arrival: GroundArrival,
  range: [number, number],
  prepared: PreparedBase,
  walls: Wall[],
) {
  const rejected = (reason: string) => ({ status: 'rejected' as const, reason });
  if (arrival.state !== 'available') return rejected('arrival-unavailable');
  const bounds = input.ground.build?.bounds;
  if (!bounds || !input.ground.tiles) return rejected('coverage-undeclared');
  const physical = createPhysicalWorld(
    { ...input, roundedWalls: walls },
    { bounds, tiles: input.ground.tiles, tileSpan: physicalTileSpan },
    prepared,
  );
  const point = arrival.position;
  if (!physical.covered(point, point)) return rejected('coverage-incomplete');
  if (point[1] < range[0] || point[1] > range[1]) return rejected('outside-source-band');
  const configured = physical.configured();
  const feet = configured.standing(point);
  if (!feet)
    return rejected(
      configured.blocked(point, point) ||
        configured.world.sweepCapsule(point, point, input.ground.options.profile)
        ? 'body-blocked'
        : 'support-unproved',
    );
  if (distance(feet, point) > 1e-5) return rejected('source-foot-mismatch');
  const profile = input.ground.options.profile;
  const hit = prepared.world.groundAt(point, {
    maxUp: 1e-6,
    maxDown: 0.01 + 1e-6,
    maxSlope: input.movement.maxSlope,
    radius: profile.radius,
  });
  const id = `source-contact/${arrival.id}/${JSON.stringify(point)}`;
  let surface: Surface | undefined;
  if (hit && hit.triangle >= 0 && hit.triangle < prepared.geometry.indices.length / 3) {
    const vertices = [0, 1, 2].map((i) => {
      const at = prepared.geometry.indices[hit.triangle * 3 + i] * 3;
      return [
        prepared.geometry.positions[at],
        prepared.geometry.positions[at + 1],
        prepared.geometry.positions[at + 2],
      ] as Vec3;
    });
    const candidate = { id, vertices };
    const projection = projectPoint([candidate], point, { maxVertical: 0.01 + 1e-6 });
    if (projection && projection.position[1] >= range[0] && projection.position[1] <= range[1])
      surface = candidate;
  }
  const kind = surface ? 'source-triangle' : 'contact-point';
  if (!surface) {
    // Sphere support can rest outside a finite cap's vertical footprint. This
    // tiny proposal chart keeps that exact proven foot as an entry, without
    // declaring its surrounding area supported or clearing any collision.
    const extent = Math.max(profile.radius / 4, (input.ground.build?.cellSize ?? 0.15) / 16);
    surface = {
      id,
      vertices: [
        [point[0] - extent, point[1], point[2] - extent],
        [point[0] - extent, point[1], point[2] + extent],
        [point[0] + extent, point[1], point[2] + extent],
        [point[0] + extent, point[1], point[2] - extent],
      ],
    };
  }
  return {
    status: 'accepted' as const,
    world: prepared.world,
    surface,
    kind,
    triangle: hit?.triangle,
    arrival: { ...arrival, position: [...point] as Vec3 },
    range,
  };
}

type Contact = Extract<ReturnType<typeof sourceContact>, { status: 'accepted' }>;

/** Bind the native navigation origin to the admitted source without changing
 * geometry or clocks. The authorized height band permits navigation projection;
 * actions that begin immediately retain their exact constructed takeoff. */
export function proveSourceContact(route: Route, contact: Contact): Route {
  if (route.status !== 'complete') return route;
  const source = contact.arrival;
  const point = route.points[0];
  const rejected = (): Route => ({ status: 'no-verified-route' });
  if (
    source.state !== 'available' ||
    route.start !== source.id ||
    route.arrivalCost !== source.cost ||
    !point ||
    !point.every(Number.isFinite) ||
    Math.hypot(point[0] - source.position[0], point[2] - source.position[2]) > 1e-6 ||
    point[1] < contact.range[0] ||
    point[1] > contact.range[1]
  )
    return rejected();
  const first = route.segments[0];
  if (first && first.mode !== 'walk' && distance(first.points[0], source.position) > 1e-5)
    return rejected();
  return route;
}
