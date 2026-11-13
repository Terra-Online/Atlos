import {
  Recast,
  Raw,
  RecastBuildContext,
  VerticesArray,
  TrianglesArray,
  TriangleAreasArray,
  allocHeightfield,
  allocCompactHeightfield,
  allocContourSet,
  allocPolyMesh,
  allocPolyMeshDetail,
  createRcConfig,
  calcGridSize,
  createHeightfield,
  markWalkableTriangles,
  rasterizeTriangles,
  filterLowHangingWalkableObstacles,
  filterWalkableLowHeightSpans,
  buildCompactHeightfield,
  erodeWalkableArea,
  buildDistanceField,
  buildRegions,
  buildContours,
  buildPolyMesh,
  buildPolyMeshDetail,
  freeHeightfield,
  freeCompactHeightfield,
  freeContourSet,
  freePolyMesh,
  freePolyMeshDetail,
} from '@recast-navigation/core';

import type { Vec3, Surface } from '#@/src/geometry.ts';
/** Offline support topology. Each compact-span connection checks local climb and
 * shared headroom. Radius erosion then removes space next to missing connections.
 * Recast's optional ledge filter also limits the total height range of several
 * neighbors. That extra slope rule erases stairs whose individual steps fit the
 * controller, so ground connectivity is defined by the local connections here.
 */
export function buildSupportField(
  positions: number[],
  bounds: [Vec3, Vec3],
  options: Parameters<typeof createRcConfig>[0],
  triangleAreas?: number[],
): Surface[] {
  const context = new RecastBuildContext();
  const vertices = new VerticesArray(),
    indices = new TrianglesArray(),
    areas = new TriangleAreasArray();
  let config, field, compact, contours, mesh, detail;
  const check = (success: boolean, stage: string) => {
    if (success) return;
    const logs = context.logs.map((entry) => entry.msg).join('; ');
    throw new Error(`Ground build failed: ${stage}${logs ? ` (${logs})` : ''}`);
  };
  try {
    config = createRcConfig(options);
    const size = calcGridSize(bounds[0], bounds[1], config.cs);
    const vertexCount = positions.length / 3,
      triangleCount = vertexCount / 3;
    vertices.copy(positions);
    indices.copy(Array.from({ length: vertexCount }, (_, index) => index));
    areas.resize(triangleCount);
    field = allocHeightfield();
    check(
      createHeightfield(
        context,
        field,
        size.width,
        size.height,
        bounds[0],
        bounds[1],
        config.cs,
        config.ch,
      ),
      'heightfield',
    );
    // Height partitions inherit the original native classification. Reclassifying
    // clipped Float32 triangles can flip a surface at the slope threshold.
    if (triangleAreas) areas.copy(triangleAreas);
    else
      markWalkableTriangles(
        context,
        config.walkableSlopeAngle,
        vertices,
        vertexCount,
        indices,
        triangleCount,
        areas,
      );
    check(
      rasterizeTriangles(
        context,
        vertices,
        vertexCount,
        indices,
        areas,
        triangleCount,
        field,
        config.walkableClimb,
      ),
      'rasterization',
    );
    filterLowHangingWalkableObstacles(context, config.walkableClimb, field);
    filterWalkableLowHeightSpans(context, config.walkableHeight, field);
    compact = allocCompactHeightfield();
    check(
      buildCompactHeightfield(context, config.walkableHeight, config.walkableClimb, field, compact),
      'support connections',
    );
    check(erodeWalkableArea(context, config.walkableRadius, compact), 'body clearance');
    check(buildDistanceField(context, compact), 'distance field');
    check(buildRegions(context, compact, 0, 0, 0), 'support regions');
    contours = allocContourSet();
    check(
      buildContours(
        context,
        compact,
        config.maxSimplificationError,
        config.maxEdgeLen,
        contours,
        Recast.RC_CONTOUR_TESS_WALL_EDGES,
      ),
      'contours',
    );
    mesh = allocPolyMesh();
    check(buildPolyMesh(context, contours, config.maxVertsPerPoly, mesh), 'navigation polygons');
    if (mesh.npolys() === 0) return [];
    detail = allocPolyMeshDetail();
    check(
      buildPolyMeshDetail(context, mesh, compact, config.cs, config.ch, detail),
      'support heights',
    );
    const surfaces: Surface[] = [];
    for (let region = 0; region < detail.nmeshes(); region++) {
      const vertexBase = detail.meshes(region * 4),
        triangleBase = detail.meshes(region * 4 + 2);
      const triangleCount = detail.meshes(region * 4 + 3);
      for (let triangle = 0; triangle < triangleCount; triangle++) {
        const points: Vec3[] = [];
        for (let corner = 0; corner < 3; corner++) {
          const vertex = vertexBase + detail.tris((triangleBase + triangle) * 4 + corner);
          points.push([
            detail.verts(vertex * 3),
            detail.verts(vertex * 3 + 1),
            detail.verts(vertex * 3 + 2),
          ]);
        }
        surfaces.push({ id: String(surfaces.length), vertices: points });
      }
    }
    return surfaces;
  } finally {
    if (detail) freePolyMeshDetail(detail);
    if (mesh) freePolyMesh(mesh);
    if (contours) freeContourSet(contours);
    if (compact) freeCompactHeightfield(compact);
    if (field) freeHeightfield(field);
    if (config) Raw.destroy(config);
    areas.destroy();
    indices.destroy();
    vertices.destroy();
    context.destroy();
  }
}
