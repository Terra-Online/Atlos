import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { BoundsIndex } from '#@/src/model/bounds.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import { createSupportProjector } from '#@/src/v1/geo/support-projector.ts';
import { surfaceGraph, surfacePortals } from '#@/src/v1/geo/surfaces.ts';
import { type GroundTopology, groundComponents } from '#@/src/v1/reach/connectivity.ts';
import { type LookupMap, groundPreparation } from '#@/src/v1/route/ground.ts';
import type { Graph } from '#@/src/v1/route/routes.ts';
import {
  type DiscoveryOptions,
  type Region,
  type Boundary,
  exposedBoundaries,
} from '#@/src/v1/search/traversal.ts';

interface Geometry {
  graph: Graph;
  forward?: NonNullable<ReturnType<typeof groundPreparation>>['routeBase']['forward'];
  blocked: ReturnType<typeof createWallChecker>;
  portals: ReturnType<typeof surfacePortals>;
  byId: LookupMap<string, Surface>;
  lengthScale: number;
  centers: LookupMap<string, Vec3>;
  project: ReturnType<typeof createGoalProjector>;
  projectSupport: ReturnType<typeof createSupportProjector>;
  visibility?: NonNullable<ReturnType<typeof groundPreparation>>['straighten'];
  topology: GroundTopology;
  boundaries: Boundary[];
  regions?: { regions: Region[]; boundaries: Boundary[]; queryRegions: BoundsIndex<Region> };
}

const snapshots = new WeakMap<
  NonNullable<ReturnType<typeof groundPreparation>>,
  { signature: string; portals: DiscoveryOptions['portals']; value: Geometry }
>();
// Share only immutable ground geometry. Each discovery call owns its temporary
// action overlays, reachability, seeds and validation budgets.
export const movementGeometry = (
  surfaces: Surface[],
  options: Pick<DiscoveryOptions, 'walls' | 'profile' | 'portals' | 'groundPlanner'>,
): Geometry => {
  const candidate = groundPreparation(options.groundPlanner);
  const prepared = candidate?.surfaces === surfaces ? candidate : undefined;
  const signature = JSON.stringify([options.walls, options.profile]);
  const cached = prepared && snapshots.get(prepared);
  if (cached?.signature === signature && cached.portals === options.portals) return cached.value;
  const portals = prepared?.portals ?? surfacePortals(surfaces);
  const reused = prepared?.importedPortals === options.portals && prepared?.graph;
  const normalized =
    reused && prepared.constraintsSignature === signature ? prepared.routeBase : undefined;
  const blocked = normalized?.blocked ?? createWallChecker(options.walls, options.profile);
  const base = reused || surfaceGraph(surfaces, { speed: 1, portals: options.portals }, portals);
  const graph = normalized?.graph ?? {
    nodes: base.nodes,
    edges: base.edges.filter(
      (edge) => !edge.points.slice(1).some((point, index) => blocked(edge.points[index], point)),
    ),
  };
  const byId =
    prepared?.byId ?? new Map<string, Surface>(surfaces.map((surface) => [surface.id, surface]));
  let topology: GroundTopology | undefined, boundaries: Boundary[] | undefined;
  const value: Geometry = {
    graph,
    forward: normalized?.forward,
    blocked,
    portals,
    byId,
    lengthScale: reused ? prepared.searchSpeed : 1,
    centers:
      prepared?.centers ??
      new Map<string, Vec3>(graph.nodes.map((node) => [node.id, node.position])),
    project: prepared?.projectGoal ?? createGoalProjector(surfaces),
    projectSupport: prepared?.projectSupport ?? createSupportProjector(surfaces, byId),
    visibility: prepared?.straighten,
    get topology() {
      return normalized?.topology ?? (topology ??= groundComponents(graph));
    },
    get boundaries() {
      if (!boundaries) {
        if (prepared?.overlay) {
          // Reuse cached static exposed boundaries and append only the tiny
          // overlay roof boundaries instead of scanning 409k static faces.
          const baseGeo = movementGeometry(prepared.overlay.basePrep.surfaces, {
            walls: prepared.overlay.basePrep.walls,
            profile: prepared.overlay.basePrep.profile,
            portals: prepared.overlay.basePrep.importedPortals,
            groundPlanner: prepared.overlay.basePlanner,
          });
          const extra = exposedBoundaries(
            prepared.overlay.extraSurfaces,
            prepared.overlay.extraImportedPortals,
            prepared.overlay.extraPortals,
          );
          boundaries = extra.length ? [...baseGeo.boundaries, ...extra] : baseGeo.boundaries;
        } else {
          boundaries = exposedBoundaries(surfaces, options.portals ?? [], portals);
        }
      }
      return boundaries;
    },
  };
  if (prepared) snapshots.set(prepared, { signature, portals: options.portals, value });
  return value;
};
