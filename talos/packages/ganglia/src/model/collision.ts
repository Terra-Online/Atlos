import type { CollisionOptions, Capsule, CollisionWorld } from '#@/src/collision.ts';
import type { CollisionGeometry, Vec3 } from '#@/src/geometry.ts';

type GroundHit = ReturnType<CollisionWorld['groundAt']>;
type SweepHit = ReturnType<CollisionWorld['sweepCapsule']>;
type Hit = GroundHit | SweepHit;
type CachedHit = { kind: 'ground'; result: GroundHit } | { kind: 'sweep'; result: SweepHit };

// Scalar zero-allocation geometry primitives. Keeping every intermediate in
// local numbers eliminates the transient Vec3 allocations per triangle test
// that dominated V8 GC during sweepCapsule and groundAt.

const pointSegmentSq = (
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (lengthSq !== 0) {
    t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lengthSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const ex = px - (ax + dx * t);
  const ey = py - (ay + dy * t);
  const ez = pz - (az + dz * t);
  return ex * ex + ey * ey + ez * ez;
};

// Skew-line interior distance squared between segments (a,b) and (c,d).
// Returns Infinity when the closest pair is not in the open/closed interior
// of both segments (those endpoint cases are already covered by vertex-to-face
// checks in the caller).
const skewSegmentSegmentSq = (
  ax: number,
  ay: number,
  az: number,
  ux: number,
  uy: number,
  uz: number,
  cx: number,
  cy: number,
  cz: number,
  vx: number,
  vy: number,
  vz: number,
): number => {
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const denom = nx * nx + ny * ny + nz * nz;
  if (!(denom > 0)) return Infinity;
  const wx = cx - ax;
  const wy = cy - ay;
  const wz = cz - az;
  const wvx = wy * vz - wz * vy;
  const wvy = wz * vx - wx * vz;
  const wvz = wx * vy - wy * vx;
  const s = (wvx * nx + wvy * ny + wvz * nz) / denom;
  if (s >= 0 && s <= 1) {
    const wux = wy * uz - wz * uy;
    const wuy = wz * ux - wx * uz;
    const wuz = wx * uy - wy * ux;
    const t = (wux * nx + wuy * ny + wuz * nz) / denom;
    if (t >= 0 && t <= 1) {
      const ex = ax + ux * s - (cx + vx * t);
      const ey = ay + uy * s - (cy + vy * t);
      const ez = az + uz * s - (cz + vz * t);
      return ex * ex + ey * ey + ez * ez;
    }
  }
  return Infinity;
};

const insideTri = (
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number,
): boolean => {
  // Edge a -> b
  let ex = bx - ax;
  let ey = by - ay;
  let ez = bz - az;
  let rx = px - ax;
  let ry = py - ay;
  let rz = pz - az;
  if (!((ey * rz - ez * ry) * nx + (ez * rx - ex * rz) * ny + (ex * ry - ey * rx) * nz >= 0)) {
    return false;
  }
  // Edge b -> c
  ex = cx - bx;
  ey = cy - by;
  ez = cz - bz;
  rx = px - bx;
  ry = py - by;
  rz = pz - bz;
  if (!((ey * rz - ez * ry) * nx + (ez * rx - ex * rz) * ny + (ex * ry - ey * rx) * nz >= 0)) {
    return false;
  }
  // Edge c -> a
  ex = ax - cx;
  ey = ay - cy;
  ez = az - cz;
  rx = px - cx;
  ry = py - cy;
  rz = pz - cz;
  return (ey * rz - ez * ry) * nx + (ez * rx - ex * rz) * ny + (ex * ry - ey * rx) * nz >= 0;
};

const pointTriangleSq = (
  px: number,
  py: number,
  pz: number,
  signedDot: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number,
  area: number,
): number => {
  if (area > 0) {
    const distance = signedDot / area;
    const qx = px - nx * distance;
    const qy = py - ny * distance;
    const qz = pz - nz * distance;
    if (insideTri(qx, qy, qz, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz)) {
      const dx = px - qx;
      const dy = py - qy;
      const dz = pz - qz;
      return dx * dx + dy * dy + dz * dz;
    }
  }
  let best = pointSegmentSq(px, py, pz, ax, ay, az, bx, by, bz);
  let d = pointSegmentSq(px, py, pz, bx, by, bz, cx, cy, cz);
  if (d < best) best = d;
  d = pointSegmentSq(px, py, pz, cx, cy, cz, ax, ay, az);
  return d < best ? d : best;
};

// Exact distance squared between a segment (a, b) and a triangle (t0, t1, t2)
// with precomputed normal (nx, ny, nz), squared normal length `area`, and
// precomputed plane dots `da = (a - t0) · n`, `db = (b - t0) · n`.
// Used for degenerate sweeps (stationary, purely vertical, or sphere capsule).
const segmentTriangleSq = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  da: number,
  db: number,
  t0x: number,
  t0y: number,
  t0z: number,
  t1x: number,
  t1y: number,
  t1z: number,
  t2x: number,
  t2y: number,
  t2z: number,
  nx: number,
  ny: number,
  nz: number,
  area: number,
): number => {
  if (da !== db && ((da <= 0 && db >= 0) || (da >= 0 && db <= 0))) {
    const t = da / (da - db);
    if (
      t >= 0 &&
      t <= 1 &&
      insideTri(
        ax + (bx - ax) * t,
        ay + (by - ay) * t,
        az + (bz - az) * t,
        t0x,
        t0y,
        t0z,
        t1x,
        t1y,
        t1z,
        t2x,
        t2y,
        t2z,
        nx,
        ny,
        nz,
      )
    ) {
      return 0;
    }
  }
  let best = pointTriangleSq(
    ax,
    ay,
    az,
    da,
    t0x,
    t0y,
    t0z,
    t1x,
    t1y,
    t1z,
    t2x,
    t2y,
    t2z,
    nx,
    ny,
    nz,
    area,
  );
  let d = pointTriangleSq(
    bx,
    by,
    bz,
    db,
    t0x,
    t0y,
    t0z,
    t1x,
    t1y,
    t1z,
    t2x,
    t2y,
    t2z,
    nx,
    ny,
    nz,
    area,
  );
  if (d < best) best = d;
  // Triangle vertices vs segment (a, b)
  d = pointSegmentSq(t0x, t0y, t0z, ax, ay, az, bx, by, bz);
  if (d < best) best = d;
  d = pointSegmentSq(t1x, t1y, t1z, ax, ay, az, bx, by, bz);
  if (d < best) best = d;
  d = pointSegmentSq(t2x, t2y, t2z, ax, ay, az, bx, by, bz);
  if (d < best) best = d;
  // Interior skew segment-edge pairs
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az;
  d = skewSegmentSegmentSq(ax, ay, az, ux, uy, uz, t0x, t0y, t0z, t1x - t0x, t1y - t0y, t1z - t0z);
  if (d < best) best = d;
  d = skewSegmentSegmentSq(ax, ay, az, ux, uy, uz, t1x, t1y, t1z, t2x - t1x, t2y - t1y, t2z - t1z);
  if (d < best) best = d;
  d = skewSegmentSegmentSq(ax, ay, az, ux, uy, uz, t2x, t2y, t2z, t0x - t2x, t0y - t2y, t0z - t2z);
  return d < best ? d : best;
};

// Exact distance squared between the non-degenerate upright swept-capsule
// parallelogram P = (a, b, d, c) and triangle Q = (t0, t1, t2).
// Here (b - a) = (0, L, 0) with L > 0 and (c - a) = (vx, vy, vz) with
// horizSq = vx*vx + vz*vz > 0, so P is a vertical sheared parallelogram with
// normal nP = (L*vz, 0, -L*vx) and areaSq = nPSq = L*L * horizSq.
// By convexity of P and Q, the exact minimum distance is realized by one of:
//   1. An edge of P piercing Q, or an edge of Q piercing P (distance = 0)
//   2. A vertex of P (4) to Q
//   3. A vertex of Q (3) to P
//   4. An interior skew pair among the 4 boundary edges of P and 3 edges of Q
// This avoids all duplicated vertex/edge checks across the two split triangles
// (a,b,d) and (a,d,c), reducing work ~5x while staying mathematically exact.
const parallelogramTriangleSq = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
  L: number,
  vx: number,
  vy: number,
  vz: number,
  invHorizSq: number,
  invL: number,
  npx: number,
  npz: number,
  invNpSq: number,
  da: number,
  db: number,
  dc: number,
  dd: number,
  dt0: number,
  dt1: number,
  dt2: number,
  t0x: number,
  t0y: number,
  t0z: number,
  t1x: number,
  t1y: number,
  t1z: number,
  t2x: number,
  t2y: number,
  t2z: number,
  fnx: number,
  fny: number,
  fnz: number,
  fnSq: number,
): number => {
  // 1a. Check if any of the 4 boundary edges of P pierces Q.
  // Skip entirely when all 4 quad vertices are strictly on one side of Q's plane.
  const allPosQ = da > 0 && db > 0 && dc > 0 && dd > 0;
  const allNegQ = da < 0 && db < 0 && dc < 0 && dd < 0;
  if (!allPosQ && !allNegQ) {
    // Edge a -> b
    if (da !== db && ((da <= 0 && db >= 0) || (da >= 0 && db <= 0))) {
      const t = da / (da - db);
      if (
        t >= 0 &&
        t <= 1 &&
        insideTri(ax, ay + L * t, az, t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z, fnx, fny, fnz)
      )
        return 0;
    }
    // Edge b -> d
    if (db !== dd && ((db <= 0 && dd >= 0) || (db >= 0 && dd <= 0))) {
      const t = db / (db - dd);
      if (
        t >= 0 &&
        t <= 1 &&
        insideTri(
          bx + vx * t,
          by + vy * t,
          bz + vz * t,
          t0x,
          t0y,
          t0z,
          t1x,
          t1y,
          t1z,
          t2x,
          t2y,
          t2z,
          fnx,
          fny,
          fnz,
        )
      )
        return 0;
    }
    // Edge d -> c
    if (dd !== dc && ((dd <= 0 && dc >= 0) || (dd >= 0 && dc <= 0))) {
      const t = dd / (dd - dc);
      if (
        t >= 0 &&
        t <= 1 &&
        insideTri(dx, dy - L * t, dz, t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z, fnx, fny, fnz)
      )
        return 0;
    }
    // Edge c -> a
    if (dc !== da && ((dc <= 0 && da >= 0) || (dc >= 0 && da <= 0))) {
      const t = dc / (dc - da);
      if (
        t >= 0 &&
        t <= 1 &&
        insideTri(
          cx - vx * t,
          cy - vy * t,
          cz - vz * t,
          t0x,
          t0y,
          t0z,
          t1x,
          t1y,
          t1z,
          t2x,
          t2y,
          t2z,
          fnx,
          fny,
          fnz,
        )
      )
        return 0;
    }
  }

  // 1b. Check if any of the 3 edges of Q pierces P.
  // A point q on P's plane lies in P iff its sheared coordinates (u, v) satisfy
  // 0 <= u <= 1 and 0 <= v <= 1.
  const allPosP = dt0 > 0 && dt1 > 0 && dt2 > 0;
  const allNegP = dt0 < 0 && dt1 < 0 && dt2 < 0;
  if (!allPosP && !allNegP) {
    if (dt0 !== dt1 && ((dt0 <= 0 && dt1 >= 0) || (dt0 >= 0 && dt1 <= 0))) {
      const t = dt0 / (dt0 - dt1);
      if (t >= 0 && t <= 1) {
        const qx = t0x + (t1x - t0x) * t;
        const qy = t0y + (t1y - t0y) * t;
        const qz = t0z + (t1z - t0z) * t;
        const u = ((qx - ax) * vx + (qz - az) * vz) * invHorizSq;
        if (u >= 0 && u <= 1) {
          const v = (qy - ay - u * vy) * invL;
          if (v >= 0 && v <= 1) return 0;
        }
      }
    }
    if (dt1 !== dt2 && ((dt1 <= 0 && dt2 >= 0) || (dt1 >= 0 && dt2 <= 0))) {
      const t = dt1 / (dt1 - dt2);
      if (t >= 0 && t <= 1) {
        const qx = t1x + (t2x - t1x) * t;
        const qy = t1y + (t2y - t1y) * t;
        const qz = t1z + (t2z - t1z) * t;
        const u = ((qx - ax) * vx + (qz - az) * vz) * invHorizSq;
        if (u >= 0 && u <= 1) {
          const v = (qy - ay - u * vy) * invL;
          if (v >= 0 && v <= 1) return 0;
        }
      }
    }
    if (dt2 !== dt0 && ((dt2 <= 0 && dt0 >= 0) || (dt2 >= 0 && dt0 <= 0))) {
      const t = dt2 / (dt2 - dt0);
      if (t >= 0 && t <= 1) {
        const qx = t2x + (t0x - t2x) * t;
        const qy = t2y + (t0y - t2y) * t;
        const qz = t2z + (t0z - t2z) * t;
        const u = ((qx - ax) * vx + (qz - az) * vz) * invHorizSq;
        if (u >= 0 && u <= 1) {
          const v = (qy - ay - u * vy) * invL;
          if (v >= 0 && v <= 1) return 0;
        }
      }
    }
  }

  // 2. Four vertices of P to Q.
  let best = pointTriangleSq(
    ax,
    ay,
    az,
    da,
    t0x,
    t0y,
    t0z,
    t1x,
    t1y,
    t1z,
    t2x,
    t2y,
    t2z,
    fnx,
    fny,
    fnz,
    fnSq,
  );
  if (best === 0) return 0;
  let dist = pointTriangleSq(
    bx,
    by,
    bz,
    db,
    t0x,
    t0y,
    t0z,
    t1x,
    t1y,
    t1z,
    t2x,
    t2y,
    t2z,
    fnx,
    fny,
    fnz,
    fnSq,
  );
  if (dist < best) best = dist;
  if (best === 0) return 0;
  dist = pointTriangleSq(
    cx,
    cy,
    cz,
    dc,
    t0x,
    t0y,
    t0z,
    t1x,
    t1y,
    t1z,
    t2x,
    t2y,
    t2z,
    fnx,
    fny,
    fnz,
    fnSq,
  );
  if (dist < best) best = dist;
  if (best === 0) return 0;
  dist = pointTriangleSq(
    dx,
    dy,
    dz,
    dd,
    t0x,
    t0y,
    t0z,
    t1x,
    t1y,
    t1z,
    t2x,
    t2y,
    t2z,
    fnx,
    fny,
    fnz,
    fnSq,
  );
  if (dist < best) best = dist;
  if (best === 0) return 0;

  // 3. Three vertices of Q to P (interior projection first, else 4 edges of P).
  // Since nPy === 0, projecting onto P's plane only shifts X and Z.
  for (let vi = 0; vi < 3; vi++) {
    const px = vi === 0 ? t0x : vi === 1 ? t1x : t2x;
    const py = vi === 0 ? t0y : vi === 1 ? t1y : t2y;
    const pz = vi === 0 ? t0z : vi === 1 ? t1z : t2z;
    const dtp = vi === 0 ? dt0 : vi === 1 ? dt1 : dt2;
    const scale = dtp * invNpSq;
    const qx = px - npx * scale;
    const qz = pz - npz * scale;
    const u = ((qx - ax) * vx + (qz - az) * vz) * invHorizSq;
    if (u >= 0 && u <= 1) {
      const v = (py - ay - u * vy) * invL;
      if (v >= 0 && v <= 1) {
        const pd = dtp * scale;
        if (pd < best) best = pd;
        if (best === 0) return 0;
        continue;
      }
    }
    dist = pointSegmentSq(px, py, pz, ax, ay, az, bx, by, bz);
    if (dist < best) best = dist;
    dist = pointSegmentSq(px, py, pz, bx, by, bz, dx, dy, dz);
    if (dist < best) best = dist;
    dist = pointSegmentSq(px, py, pz, dx, dy, dz, cx, cy, cz);
    if (dist < best) best = dist;
    dist = pointSegmentSq(px, py, pz, cx, cy, cz, ax, ay, az);
    if (dist < best) best = dist;
    if (best === 0) return 0;
  }

  // 4. Twelve interior skew edge-edge pairs (4 edges of P x 3 edges of Q).
  const e0x = t1x - t0x,
    e0y = t1y - t0y,
    e0z = t1z - t0z;
  const e1x = t2x - t1x,
    e1y = t2y - t1y,
    e1z = t2z - t1z;
  const e2x = t0x - t2x,
    e2y = t0y - t2y,
    e2z = t0z - t2z;

  // Edge a -> b = (0, L, 0)
  dist = skewSegmentSegmentSq(ax, ay, az, 0, L, 0, t0x, t0y, t0z, e0x, e0y, e0z);
  if (dist < best) best = dist;
  dist = skewSegmentSegmentSq(ax, ay, az, 0, L, 0, t1x, t1y, t1z, e1x, e1y, e1z);
  if (dist < best) best = dist;
  dist = skewSegmentSegmentSq(ax, ay, az, 0, L, 0, t2x, t2y, t2z, e2x, e2y, e2z);
  if (dist < best) best = dist;
  // Edge b -> d = (vx, vy, vz)
  dist = skewSegmentSegmentSq(bx, by, bz, vx, vy, vz, t0x, t0y, t0z, e0x, e0y, e0z);
  if (dist < best) best = dist;
  dist = skewSegmentSegmentSq(bx, by, bz, vx, vy, vz, t1x, t1y, t1z, e1x, e1y, e1z);
  if (dist < best) best = dist;
  dist = skewSegmentSegmentSq(bx, by, bz, vx, vy, vz, t2x, t2y, t2z, e2x, e2y, e2z);
  if (dist < best) best = dist;
  // Edge c -> d = (0, L, 0)
  dist = skewSegmentSegmentSq(cx, cy, cz, 0, L, 0, t0x, t0y, t0z, e0x, e0y, e0z);
  if (dist < best) best = dist;
  dist = skewSegmentSegmentSq(cx, cy, cz, 0, L, 0, t1x, t1y, t1z, e1x, e1y, e1z);
  if (dist < best) best = dist;
  dist = skewSegmentSegmentSq(cx, cy, cz, 0, L, 0, t2x, t2y, t2z, e2x, e2y, e2z);
  if (dist < best) best = dist;
  // Edge a -> c = (vx, vy, vz)
  dist = skewSegmentSegmentSq(ax, ay, az, vx, vy, vz, t0x, t0y, t0z, e0x, e0y, e0z);
  if (dist < best) best = dist;
  dist = skewSegmentSegmentSq(ax, ay, az, vx, vy, vz, t1x, t1y, t1z, e1x, e1y, e1z);
  if (dist < best) best = dist;
  dist = skewSegmentSegmentSq(ax, ay, az, vx, vy, vz, t2x, t2y, t2z, e2x, e2y, e2z);
  return dist < best ? dist : best;
};

const point = (p: unknown): p is Vec3 =>
  Array.isArray(p) &&
  p.length === 3 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Number.isFinite(p[2]);

// Highest bottom-sphere support on the triangle, including its edges and corners.
// The edge objective is concave, so its stationary point or a segment endpoint
// gives the exact maximum. This avoids directional ray sampling at a ledge.
const sphereSupportEdge = (
  px: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
  rSq: number,
  best: number,
): number => {
  const dx = bx - ax;
  const dz = bz - az;
  const dy = by - ay;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return best;
  const x = px - ax;
  const z = pz - az;
  const projection = (x * dx + z * dz) / lengthSquared;
  const ox = x - projection * dx;
  const oz = z - projection * dz;
  const reachSquared = rSq - (ox * ox + oz * oz);
  if (reachSquared < 0) return best;
  let fraction =
    projection + dy * Math.sqrt(reachSquared / (lengthSquared * (lengthSquared + dy * dy)));
  if (fraction < 0) fraction = 0;
  else if (fraction > 1) fraction = 1;
  const hx = x - fraction * dx;
  const hz = z - fraction * dz;
  const horizontalSquared = hx * hx + hz * hz;
  if (horizontalSquared <= rSq) {
    const candidate = ay + fraction * dy + Math.sqrt(rSq - horizontalSquared) - radius;
    if (candidate > best) return candidate;
  }
  return best;
};

const sphereSupport = (
  px: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number,
  radius: number,
): number => {
  const contactX = px - radius * nx;
  const contactZ = pz - radius * nz;
  const planeHeight = ay - (nx * (px - ax) + nz * (pz - az)) / ny;
  const contactY = planeHeight + radius / ny - radius * ny;
  let best = insideTri(contactX, contactY, contactZ, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz)
    ? planeHeight + radius * (1 / ny - 1)
    : -Infinity;
  const rSq = radius * radius;
  best = sphereSupportEdge(px, pz, ax, ay, az, bx, by, bz, radius, rSq, best);
  best = sphereSupportEdge(px, pz, bx, by, bz, cx, cy, cz, radius, rSq, best);
  best = sphereSupportEdge(px, pz, cx, cy, cz, ax, ay, az, radius, rSq, best);
  return best;
};

const fmtNum = (value: number) => (Object.is(value, -0) ? '-0' : String(value));

/** Index a snapshot of world-space triangle surfaces. No layer, state or coverage
 * inference is performed. Triangles are double-sided thin surfaces, not solid volumes.
 * A capsule contained wholly inside a closed mesh therefore needs a separate initial
 * occupancy check. Callers must start from a verified free standing position.
 * Optional XZ bounds retain all intersecting triangles at every height. Queries
 * outside that scope throw rather than treating unindexed space as clear.
 */
export function createTypeScriptCollisionWorld(
  geometry: CollisionGeometry,
  options?: CollisionOptions,
): CollisionWorld {
  if (
    !geometry?.positions ||
    !geometry.indices ||
    geometry.positions.length % 3 ||
    geometry.indices.length % 3
  )
    throw new Error('Invalid collision geometry');
  const sourcePositions = geometry.positions;
  const sourceIndices = geometry.indices;
  const vertexCount = sourcePositions.length / 3;
  for (let i = 0; i < sourcePositions.length; i++)
    if (!Number.isFinite(sourcePositions[i])) throw new Error('Non-finite collision vertex');
  for (let i = 0; i < sourceIndices.length; i++) {
    const idx = sourceIndices[i];
    if (!Number.isInteger(idx) || idx < 0 || idx >= vertexCount)
      throw new Error('Invalid collision index');
  }
  const queryCacheSize = options?.queryCacheSize === undefined ? 0 : options.queryCacheSize;
  if (!Number.isSafeInteger(queryCacheSize) || queryCacheSize < 0)
    throw new Error('Invalid collision query cache size');
  // One bounded FIFO serves both methods for this immutable geometry/scope.
  // Default-off avoids key allocation for cold worlds or mostly unique sweeps.
  const queryCache = queryCacheSize ? new Map<string, CachedHit>() : null;
  let cacheHits = 0,
    cacheMisses = 0;
  function copyResult(result: GroundHit): GroundHit;
  function copyResult(result: SweepHit): SweepHit;
  function copyResult(result: Hit): Hit {
    if (result === null) return null;
    if ('position' in result)
      return {
        position: [result.position[0], result.position[1], result.position[2]],
        triangle: result.triangle,
        normal: [result.normal[0], result.normal[1], result.normal[2]],
      };
    return { triangle: result.triangle, distance: result.distance };
  }
  const remember = (key: string, entry: CachedHit) => {
    if (queryCache!.size >= queryCacheSize) queryCache!.delete(queryCache!.keys().next().value!);
    if (entry.kind === 'ground') entry.result = copyResult(entry.result);
    else entry.result = copyResult(entry.result);
    queryCache!.set(key, entry);
  };

  let scopeMinX = 0,
    scopeMinZ = 0,
    scopeMaxX = 0,
    scopeMaxZ = 0,
    hasScope = false;
  if (options?.bounds !== undefined) {
    const requested = options.bounds;
    if (
      !requested ||
      !Array.isArray(requested.min) ||
      !Array.isArray(requested.max) ||
      requested.min.length !== 2 ||
      requested.max.length !== 2 ||
      !Number.isFinite(requested.min[0]) ||
      !Number.isFinite(requested.min[1]) ||
      !Number.isFinite(requested.max[0]) ||
      !Number.isFinite(requested.max[1]) ||
      requested.min[0] > requested.max[0] ||
      requested.min[1] > requested.max[1]
    ) {
      throw new Error('Invalid collision XZ bounds');
    }
    scopeMinX = requested.min[0];
    scopeMinZ = requested.min[1];
    scopeMaxX = requested.max[0];
    scopeMaxZ = requested.max[1];
    hasScope = true;
  }

  // Inspect source coordinates directly before allocating retained triangle snapshots.
  // A triangle with outside vertices can still cross the indexed rectangle.
  const retained: number[] | null = hasScope ? [] : null;
  if (hasScope) {
    for (let offset = 0; offset < sourceIndices.length; offset += 3) {
      const a = sourceIndices[offset] * 3;
      const b = sourceIndices[offset + 1] * 3;
      const c = sourceIndices[offset + 2] * 3;
      const minX = Math.min(sourcePositions[a], sourcePositions[b], sourcePositions[c]);
      const maxX = Math.max(sourcePositions[a], sourcePositions[b], sourcePositions[c]);
      const minZ = Math.min(sourcePositions[a + 2], sourcePositions[b + 2], sourcePositions[c + 2]);
      const maxZ = Math.max(sourcePositions[a + 2], sourcePositions[b + 2], sourcePositions[c + 2]);
      if (maxX >= scopeMinX && minX <= scopeMaxX && maxZ >= scopeMinZ && minZ <= scopeMaxZ) {
        retained!.push(offset / 3);
      }
    }
  }
  const originalIds = retained ? Uint32Array.from(retained) : null;
  const count = originalIds ? originalIds.length : sourceIndices.length / 3;

  // Build-time temporary buffers (dropped once leaf-ordered buffers are packed).
  const order = new Uint32Array(count);
  const srcBounds = new Float64Array(count * 6);
  const srcVerts = new Float64Array(count * 9);
  for (let id = 0; id < count; id++) {
    order[id] = id;
    const srcOff = (originalIds ? originalIds[id] : id) * 3;
    const ia = sourceIndices[srcOff] * 3;
    const ib = sourceIndices[srcOff + 1] * 3;
    const ic = sourceIndices[srcOff + 2] * 3;
    const ax = sourcePositions[ia],
      ay = sourcePositions[ia + 1],
      az = sourcePositions[ia + 2];
    const bx = sourcePositions[ib],
      by = sourcePositions[ib + 1],
      bz = sourcePositions[ib + 2];
    const cx = sourcePositions[ic],
      cy = sourcePositions[ic + 1],
      cz = sourcePositions[ic + 2];
    const vOff = id * 9;
    srcVerts[vOff] = ax;
    srcVerts[vOff + 1] = ay;
    srcVerts[vOff + 2] = az;
    srcVerts[vOff + 3] = bx;
    srcVerts[vOff + 4] = by;
    srcVerts[vOff + 5] = bz;
    srcVerts[vOff + 6] = cx;
    srcVerts[vOff + 7] = cy;
    srcVerts[vOff + 8] = cz;
    const bOff = id * 6;
    srcBounds[bOff] = ax < bx ? (ax < cx ? ax : cx) : bx < cx ? bx : cx;
    srcBounds[bOff + 1] = ay < by ? (ay < cy ? ay : cy) : by < cy ? by : cy;
    srcBounds[bOff + 2] = az < bz ? (az < cz ? az : cz) : bz < cz ? bz : cz;
    srcBounds[bOff + 3] = ax > bx ? (ax > cx ? ax : cx) : bx > cx ? bx : cx;
    srcBounds[bOff + 4] = ay > by ? (ay > cy ? ay : cy) : by > cy ? by : cy;
    srcBounds[bOff + 5] = az > bz ? (az > cz ? az : cz) : bz > cz ? bz : cz;
  }

  // Flat data-oriented BVH layout:
  // - nodeBoxes[node * 6 .. +5]: Float64 AABB [minX, minY, minZ, maxX, maxY, maxZ]
  // - nodeLeft[node] >= 0: internal node with children (nodeLeft[node], nodeRight[node])
  // - nodeLeft[node] < 0: leaf covering leaf-ordered triangles [~nodeLeft[node], nodeRight[node])
  // Median partitioning splits any range > 8 into halves >= 4, so total nodes <= ceil(count/2) + 2.
  const maxNodes = count ? Math.max(1, Math.ceil(count / 2) + 2) : 0;
  let nodeBoxes = new Float64Array(maxNodes * 6);
  let nodeLeft = new Int32Array(maxNodes);
  let nodeRight = new Int32Array(maxNodes);
  let nodeCount = 0;

  const sortRange = (start: number, end: number, axis: number) => {
    // Insertion sort for small leaves (<= 16), avoiding TypedArray.sort closure overhead.
    for (let i = start + 1; i < end; i++) {
      const key = order[i];
      const keyCenter = srcBounds[key * 6 + axis] + srcBounds[key * 6 + axis + 3];
      let j = i - 1;
      while (j >= start) {
        const cur = order[j];
        const curCenter = srcBounds[cur * 6 + axis] + srcBounds[cur * 6 + axis + 3];
        if (curCenter < keyCenter || (curCenter === keyCenter && cur < key)) break;
        order[j + 1] = cur;
        j--;
      }
      order[j + 1] = key;
    }
  };

  const selectAxis = (start: number, end: number, middle: number, axis: number) => {
    // Bound partition work on adversarial layouts. The fallback sorts only the
    // remaining selection interval, whose outside members are already decided.
    let budget = 2 * (end - start);
    while (end - start > 16) {
      if ((budget -= end - start) < 0) {
        order.subarray(start, end).sort((a, b) => {
          const diff =
            srcBounds[a * 6 + axis] +
            srcBounds[a * 6 + axis + 3] -
            (srcBounds[b * 6 + axis] + srcBounds[b * 6 + axis + 3]);
          return diff || a - b;
        });
        return;
      }
      let a = order[start];
      let b = order[(start + end) >>> 1];
      let c = order[end - 1];
      let ac = srcBounds[a * 6 + axis] + srcBounds[a * 6 + axis + 3];
      let bc = srcBounds[b * 6 + axis] + srcBounds[b * 6 + axis + 3];
      let cc = srcBounds[c * 6 + axis] + srcBounds[c * 6 + axis + 3];
      if (ac > bc || (ac === bc && a > b)) {
        const tv = a;
        a = b;
        b = tv;
        const tc = ac;
        ac = bc;
        bc = tc;
      }
      if (bc > cc || (bc === cc && b > c)) {
        const tv = b;
        b = c;
        c = tv;
        const tc = bc;
        bc = cc;
        cc = tc;
      }
      const pivot = ac > bc || (ac === bc && a > b) ? a : b;
      const pivotCenter = srcBounds[pivot * 6 + axis] + srcBounds[pivot * 6 + axis + 3];
      let lower = start;
      let upper = end - 1;
      while (lower <= upper) {
        while (true) {
          const v = order[lower];
          const vc = srcBounds[v * 6 + axis] + srcBounds[v * 6 + axis + 3];
          if (!(vc < pivotCenter || (vc === pivotCenter && v < pivot))) break;
          lower++;
        }
        while (true) {
          const v = order[upper];
          const vc = srcBounds[v * 6 + axis] + srcBounds[v * 6 + axis + 3];
          if (!(vc > pivotCenter || (vc === pivotCenter && v > pivot))) break;
          upper--;
        }
        if (lower <= upper) {
          const tmp = order[lower];
          order[lower++] = order[upper];
          order[upper--] = tmp;
        }
      }
      if (middle <= upper) end = upper + 1;
      else if (middle >= lower) start = lower;
      else return;
    }
    sortRange(start, end, axis);
  };

  const buildNode = (start: number, end: number, parentAxis: number): number => {
    const node = nodeCount++;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let j = start; j < end; j++) {
      const bOff = order[j] * 6;
      const x0 = srcBounds[bOff],
        y0 = srcBounds[bOff + 1],
        z0 = srcBounds[bOff + 2];
      const x1 = srcBounds[bOff + 3],
        y1 = srcBounds[bOff + 4],
        z1 = srcBounds[bOff + 5];
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (z0 < minZ) minZ = z0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
      if (z1 > maxZ) maxZ = z1;
    }
    const nOff = node * 6;
    nodeBoxes[nOff] = minX;
    nodeBoxes[nOff + 1] = minY;
    nodeBoxes[nOff + 2] = minZ;
    nodeBoxes[nOff + 3] = maxX;
    nodeBoxes[nOff + 4] = maxY;
    nodeBoxes[nOff + 5] = maxZ;

    if (end - start <= 8) {
      // Internal nodes need only exact median membership. Leaves restore their
      // parent's sorted order so tied supports and first collision IDs stay exact.
      if (parentAxis >= 0) sortRange(start, end, parentAxis);
      nodeLeft[node] = ~start;
      nodeRight[node] = end;
      return node;
    }
    const sx = maxX - minX;
    const sy = maxY - minY;
    const sz = maxZ - minZ;
    let axis = 0;
    if (sy > sx) axis = 1;
    if (sz > (axis === 0 ? sx : sy)) axis = 2;
    const middle = (start + end) >>> 1;
    selectAxis(start, end, middle, axis);
    nodeLeft[node] = buildNode(start, middle, axis);
    nodeRight[node] = buildNode(middle, end, axis);
    return node;
  };

  if (count > 0) buildNode(0, count, -1);

  // Trim flat node arrays to exact nodeCount when over-allocated.
  if (nodeCount < maxNodes) {
    nodeBoxes = nodeBoxes.slice(0, nodeCount * 6);
    nodeLeft = nodeLeft.slice(0, nodeCount);
    nodeRight = nodeRight.slice(0, nodeCount);
  }

  // Pack triangle vertices, bounds, and original IDs in leaf order so every leaf
  // scan reads contiguous memory with zero indirection through order[].
  const triVerts = new Float64Array(count * 9);
  const triBounds = new Float64Array(count * 6);
  const triIds = new Uint32Array(count);
  for (let slot = 0; slot < count; slot++) {
    const id = order[slot];
    triIds[slot] = originalIds ? originalIds[id] : id;
    const srcV = id * 9;
    const dstV = slot * 9;
    triVerts[dstV] = srcVerts[srcV];
    triVerts[dstV + 1] = srcVerts[srcV + 1];
    triVerts[dstV + 2] = srcVerts[srcV + 2];
    triVerts[dstV + 3] = srcVerts[srcV + 3];
    triVerts[dstV + 4] = srcVerts[srcV + 4];
    triVerts[dstV + 5] = srcVerts[srcV + 5];
    triVerts[dstV + 6] = srcVerts[srcV + 6];
    triVerts[dstV + 7] = srcVerts[srcV + 7];
    triVerts[dstV + 8] = srcVerts[srcV + 8];
    const srcB = id * 6;
    const dstB = slot * 6;
    triBounds[dstB] = srcBounds[srcB];
    triBounds[dstB + 1] = srcBounds[srcB + 1];
    triBounds[dstB + 2] = srcBounds[srcB + 2];
    triBounds[dstB + 3] = srcBounds[srcB + 3];
    triBounds[dstB + 4] = srcBounds[srcB + 4];
    triBounds[dstB + 5] = srcBounds[srcB + 5];
  }

  // Preallocated iterative traversal stack shared by synchronous query methods.
  let stack = new Int32Array(128);
  const ensureStack = (needed: number) => {
    if (needed <= stack.length) return;
    const grown = new Int32Array(stack.length * 2);
    grown.set(stack);
    stack = grown;
  };

  const requireScope = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    if (
      hasScope &&
      (minX < scopeMinX || minZ < scopeMinZ || maxX > scopeMaxX || maxZ > scopeMaxZ)
    ) {
      throw new Error('Collision query exceeds indexed XZ bounds');
    }
  };

  return {
    bounds: hasScope ? { min: [scopeMinX, scopeMinZ], max: [scopeMaxX, scopeMaxZ] } : null,
    get queryCacheStats() {
      return {
        capacity: queryCacheSize,
        entries: queryCache?.size ?? 0,
        hits: cacheHits,
        misses: cacheMisses,
      };
    },
    /** Original input triangle IDs overlapping an inclusive XZ rectangle, in
     * input order. This reuses the obstacle index for local geometry preparation.
     */
    trianglesInBounds(rectangle: NonNullable<CollisionOptions['bounds']>): number[] {
      if (
        !rectangle ||
        !Array.isArray(rectangle.min) ||
        !Array.isArray(rectangle.max) ||
        rectangle.min.length !== 2 ||
        rectangle.max.length !== 2 ||
        !Number.isFinite(rectangle.min[0]) ||
        !Number.isFinite(rectangle.min[1]) ||
        !Number.isFinite(rectangle.max[0]) ||
        !Number.isFinite(rectangle.max[1]) ||
        rectangle.min[0] > rectangle.max[0] ||
        rectangle.min[1] > rectangle.max[1]
      ) {
        throw new Error('Invalid collision triangle rectangle');
      }
      const qMinX = rectangle.min[0];
      const qMinZ = rectangle.min[1];
      const qMaxX = rectangle.max[0];
      const qMaxZ = rectangle.max[1];
      requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
      const result: number[] = [];
      if (nodeCount === 0) return result;
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const node = stack[--top];
        const nOff = node * 6;
        if (
          qMinX > nodeBoxes[nOff + 3] ||
          qMaxX < nodeBoxes[nOff] ||
          qMinZ > nodeBoxes[nOff + 5] ||
          qMaxZ < nodeBoxes[nOff + 2]
        ) {
          continue;
        }
        const left = nodeLeft[node];
        if (left >= 0) {
          ensureStack(top + 2);
          stack[top++] = left;
          stack[top++] = nodeRight[node];
          continue;
        }
        const start = ~left;
        const end = nodeRight[node];
        for (let slot = start; slot < end; slot++) {
          const bOff = slot * 6;
          if (
            qMinX <= triBounds[bOff + 3] &&
            qMaxX >= triBounds[bOff] &&
            qMinZ <= triBounds[bOff + 5] &&
            qMaxZ >= triBounds[bOff + 2]
          ) {
            result.push(triIds[slot]);
          }
        }
      }
      return result.sort((a, b) => a - b);
    },
    /** Find upward support at exactly the supplied XZ position. Slope is in degrees.
     * Height limits are explicit and independent. This establishes triangle support
     * only; callers still verify standing capsule clearance and active world coverage.
     */
    groundAt(position: Vec3, options: Parameters<CollisionWorld['groundAt']>[1]): GroundHit {
      const { maxUp, maxDown, maxSlope, radius = 0 } = options ?? {};
      if (
        !point(position) ||
        !Number.isFinite(maxUp) ||
        !Number.isFinite(maxDown) ||
        !Number.isFinite(maxSlope) ||
        !Number.isFinite(radius) ||
        maxUp < 0 ||
        maxDown < 0 ||
        maxSlope <= 0 ||
        maxSlope >= 90 ||
        radius < 0
      )
        throw new Error('Invalid ground support query');
      const px = position[0];
      const py = position[1];
      const pz = position[2];
      const qMinX = px - radius;
      const qMinY = py - maxDown - radius;
      const qMinZ = pz - radius;
      const qMaxX = px + radius;
      const qMaxY = py + maxUp + radius;
      const qMaxZ = pz + radius;
      if (
        !Number.isFinite(qMinX) ||
        !Number.isFinite(qMinY) ||
        !Number.isFinite(qMinZ) ||
        !Number.isFinite(qMaxX) ||
        !Number.isFinite(qMaxY) ||
        !Number.isFinite(qMaxZ)
      )
        throw new Error('Non-finite ground support bounds');
      requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
      let key: string | null = null;
      if (queryCache) {
        key = `ground/${fmtNum(px)},${fmtNum(py)},${fmtNum(pz)},${fmtNum(maxUp)},${fmtNum(maxDown)},${fmtNum(maxSlope)},${fmtNum(radius)}`;
        const found = queryCache.get(key);
        if (found?.kind === 'ground') {
          cacheHits++;
          return copyResult(found.result);
        }
        cacheMisses++;
      }
      if (nodeCount === 0) {
        if (key !== null) remember(key, { kind: 'ground', result: null });
        return null;
      }
      const minimumUp = Math.cos((maxSlope * Math.PI) / 180);
      const minHeight = py - maxDown;
      const maxHeight = py + maxUp;
      let bestSlot = -1;
      let bestHeight = -Infinity;
      let bestOffset = Infinity;
      let bestNx = 0,
        bestNy = 0,
        bestNz = 0;

      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const node = stack[--top];
        const nOff = node * 6;
        if (
          qMinX > nodeBoxes[nOff + 3] ||
          qMaxX < nodeBoxes[nOff] ||
          qMinY > nodeBoxes[nOff + 4] ||
          qMaxY < nodeBoxes[nOff + 1] ||
          qMinZ > nodeBoxes[nOff + 5] ||
          qMaxZ < nodeBoxes[nOff + 2]
        ) {
          continue;
        }
        const left = nodeLeft[node];
        if (left >= 0) {
          ensureStack(top + 2);
          stack[top++] = left;
          stack[top++] = nodeRight[node];
          continue;
        }
        const start = ~left;
        const end = nodeRight[node];
        for (let slot = start; slot < end; slot++) {
          const bOff = slot * 6;
          if (
            qMinX > triBounds[bOff + 3] ||
            qMaxX < triBounds[bOff] ||
            qMinY > triBounds[bOff + 4] ||
            qMaxY < triBounds[bOff + 1] ||
            qMinZ > triBounds[bOff + 5] ||
            qMaxZ < triBounds[bOff + 2]
          ) {
            continue;
          }
          const vOff = slot * 9;
          const ax = triVerts[vOff],
            ay = triVerts[vOff + 1],
            az = triVerts[vOff + 2];
          const bx = triVerts[vOff + 3],
            by = triVerts[vOff + 4],
            bz = triVerts[vOff + 5];
          const cx = triVerts[vOff + 6],
            cy = triVerts[vOff + 7],
            cz = triVerts[vOff + 8];
          const abx = bx - ax,
            aby = by - ay,
            abz = bz - az;
          const acx = cx - ax,
            acy = cy - ay,
            acz = cz - az;
          const ny = abz * acx - abx * acz;
          // Fast skip downward/vertical faces before computing full normal/hypot.
          if (ny <= 0) {
            // Still guard against non-finite cross products on extreme coordinates.
            if (!Number.isFinite(ny)) throw new Error('Non-finite ground support normal');
            continue;
          }
          const nx = aby * acz - abz * acy;
          const nz = abx * acy - aby * acx;
          const lenSq = nx * nx + ny * ny + nz * nz;
          const length =
            lenSq > 0 && Number.isFinite(lenSq) ? Math.sqrt(lenSq) : Math.hypot(nx, ny, nz);
          if (!Number.isFinite(length)) throw new Error('Non-finite ground support normal');
          if (length === 0 || ny / length < minimumUp) continue;
          let height: number;
          let unx: number, uny: number, unz: number;
          if (radius > 0) {
            unx = nx / length;
            uny = ny / length;
            unz = nz / length;
            height = sphereSupport(
              px,
              pz,
              ax,
              ay,
              az,
              bx,
              by,
              bz,
              cx,
              cy,
              cz,
              unx,
              uny,
              unz,
              radius,
            );
          } else {
            const x = px - ax;
            const z = pz - az;
            const determinant = -ny;
            const u = (x * acz - z * acx) / determinant;
            const v = (abx * z - abz * x) / determinant;
            // Only a numerical barycentric tolerance is allowed; the query never
            // searches neighbouring XZ positions or snaps across a missing floor.
            if (u < -1e-10 || v < -1e-10 || u + v > 1 + 1e-10) continue;
            height = ay + u * aby + v * acy;
            unx = nx / length;
            uny = ny / length;
            unz = nz / length;
          }
          if (height === -Infinity) continue;
          if (!Number.isFinite(height)) throw new Error('Non-finite ground support height');
          if (height < minHeight || height > maxHeight) continue;
          const offset = Math.abs(height - py);
          if (
            (radius > 0 && (bestSlot < 0 || height > bestHeight)) ||
            (radius === 0 &&
              (offset < bestOffset || (offset === bestOffset && height > bestHeight)))
          ) {
            bestSlot = slot;
            bestHeight = height;
            bestOffset = offset;
            bestNx = unx;
            bestNy = uny;
            bestNz = unz;
          }
        }
      }
      const best: GroundHit =
        bestSlot >= 0
          ? {
              position: [px, bestHeight, pz],
              triangle: triIds[bestSlot],
              normal: [bestNx, bestNy, bestNz],
            }
          : null;
      if (key !== null) remember(key, { kind: 'ground', result: best });
      return best;
    },
    /** Continuous straight translation of an upright capsule, given feet positions.
     * Its axis sweeps a parallelogram; distance to that entire surface, not discrete
     * positions along the path, decides collision. Inflation bounds interpolation
     * error for curved paths and enlarges the capsule in every direction.
     * Returns any touching triangle, NOT the earliest impact or a landing proof.
     */
    sweepCapsule(start: Vec3, end: Vec3, profile: Capsule): SweepHit {
      const { radius, height, inflation = 0 } = profile ?? {};
      if (
        !point(start) ||
        !point(end) ||
        !Number.isFinite(radius) ||
        !Number.isFinite(height) ||
        !Number.isFinite(inflation) ||
        radius < 0 ||
        height <= 0 ||
        height < 2 * radius ||
        inflation < 0
      )
        throw new Error('Invalid capsule sweep');
      const r = radius + inflation;
      const sx = start[0],
        sy = start[1],
        sz = start[2];
      const ex = end[0],
        ey = end[1],
        ez = end[2];
      const qMinX = (sx < ex ? sx : ex) - r;
      const qMinY = (sy < ey ? sy : ey) - inflation;
      const qMinZ = (sz < ez ? sz : ez) - r;
      const qMaxX = (sx > ex ? sx : ex) + r;
      const qMaxY = (sy > ey ? sy : ey) + height + inflation;
      const qMaxZ = (sz > ez ? sz : ez) + r;
      if (
        !Number.isFinite(qMinX) ||
        !Number.isFinite(qMinY) ||
        !Number.isFinite(qMinZ) ||
        !Number.isFinite(qMaxX) ||
        !Number.isFinite(qMaxY) ||
        !Number.isFinite(qMaxZ)
      )
        throw new Error('Non-finite capsule bounds');
      requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
      let key: string | null = null;
      if (queryCache) {
        key = `sweep/${fmtNum(sx)},${fmtNum(sy)},${fmtNum(sz)},${fmtNum(ex)},${fmtNum(ey)},${fmtNum(ez)},${fmtNum(radius)},${fmtNum(height)},${fmtNum(inflation)}`;
        const found = queryCache.get(key);
        if (found?.kind === 'sweep') {
          cacheHits++;
          return copyResult(found.result);
        }
        cacheMisses++;
      }
      if (nodeCount === 0) {
        if (key !== null) remember(key, { kind: 'sweep', result: null });
        return null;
      }

      const rSq = r * r;
      const ax = sx,
        ay = sy + radius,
        az = sz;
      const bx = sx,
        by = sy + height - radius,
        bz = sz;
      const cx = ex,
        cy = ey + radius,
        cz = ez;
      const dx = ex,
        dy = ey + height - radius,
        dz = ez;

      const L = by - ay;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const horizSq = vx * vx + vz * vz;
      // Non-degenerate parallelogram iff both capsule axis length and horizontal
      // translation are positive and their plane normal has finite squared length.
      const npx = L * vz;
      const npz = -L * vx;
      const npSq = npx * npx + npz * npz;
      const isQuad = L > 0 && horizSq > 0 && npSq > 0 && Number.isFinite(npSq);
      const invHorizSq = isQuad ? 1 / horizSq : 0;
      const invL = isQuad ? 1 / L : 0;
      const invNpSq = isQuad ? 1 / npSq : 0;

      // Degenerate segment endpoints when swept axis collapses to a single segment
      // (stationary, purely vertical, or sphere capsule where height === 2*radius).
      const segAx = ax;
      const segAy = horizSq === 0 ? (ay < cy ? ay : cy) : ay;
      const segAz = az;
      const segBx = horizSq === 0 ? ax : cx;
      const segBy = horizSq === 0 ? (by > dy ? by : dy) : cy;
      const segBz = horizSq === 0 ? az : cz;

      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const node = stack[--top];
        const nOff = node * 6;
        if (
          qMinX > nodeBoxes[nOff + 3] ||
          qMaxX < nodeBoxes[nOff] ||
          qMinY > nodeBoxes[nOff + 4] ||
          qMaxY < nodeBoxes[nOff + 1] ||
          qMinZ > nodeBoxes[nOff + 5] ||
          qMaxZ < nodeBoxes[nOff + 2]
        ) {
          continue;
        }
        const left = nodeLeft[node];
        if (left >= 0) {
          ensureStack(top + 2);
          stack[top++] = left;
          stack[top++] = nodeRight[node];
          continue;
        }
        const startSlot = ~left;
        const endSlot = nodeRight[node];
        for (let slot = startSlot; slot < endSlot; slot++) {
          const bOff = slot * 6;
          if (
            qMinX > triBounds[bOff + 3] ||
            qMaxX < triBounds[bOff] ||
            qMinY > triBounds[bOff + 4] ||
            qMaxY < triBounds[bOff + 1] ||
            qMinZ > triBounds[bOff + 5] ||
            qMaxZ < triBounds[bOff + 2]
          ) {
            continue;
          }
          const vOff = slot * 9;
          const t0x = triVerts[vOff],
            t0y = triVerts[vOff + 1],
            t0z = triVerts[vOff + 2];
          const t1x = triVerts[vOff + 3],
            t1y = triVerts[vOff + 4],
            t1z = triVerts[vOff + 5];
          const t2x = triVerts[vOff + 6],
            t2y = triVerts[vOff + 7],
            t2z = triVerts[vOff + 8];
          const e1x = t1x - t0x,
            e1y = t1y - t0y,
            e1z = t1z - t0z;
          const e2x = t2x - t0x,
            e2y = t2y - t0y,
            e2z = t2z - t0z;
          const fnx = e1y * e2z - e1z * e2y;
          const fny = e1z * e2x - e1x * e2z;
          const fnz = e1x * e2y - e1y * e2x;
          const fnSq = fnx * fnx + fny * fny + fnz * fnz;

          let distance: number;
          if (isQuad) {
            // Fast-reject 1: signed distance from triangle vertices to quad plane.
            const dt0 = (t0x - ax) * npx + (t0z - az) * npz;
            const dt1 = (t1x - ax) * npx + (t1z - az) * npz;
            const dt2 = (t2x - ax) * npx + (t2z - az) * npz;
            if (dt0 > 0 && dt1 > 0 && dt2 > 0) {
              const m = dt0 < dt1 ? (dt0 < dt2 ? dt0 : dt2) : dt1 < dt2 ? dt1 : dt2;
              if (m * m > rSq * npSq) continue;
            } else if (dt0 < 0 && dt1 < 0 && dt2 < 0) {
              const m = dt0 > dt1 ? (dt0 > dt2 ? dt0 : dt2) : dt1 > dt2 ? dt1 : dt2;
              if (m * m > rSq * npSq) continue;
            }
            // Fast-reject 2: signed distance from quad vertices to triangle plane.
            const da = (ax - t0x) * fnx + (ay - t0y) * fny + (az - t0z) * fnz;
            const db = da + L * fny;
            const dc = (cx - t0x) * fnx + (cy - t0y) * fny + (cz - t0z) * fnz;
            const dd = dc + L * fny;
            if (fnSq > 0 && Number.isFinite(fnSq)) {
              if (da > 0 && db > 0 && dc > 0 && dd > 0) {
                const m0 = da < db ? da : db;
                const m1 = dc < dd ? dc : dd;
                const m = m0 < m1 ? m0 : m1;
                if (m * m > rSq * fnSq) continue;
              } else if (da < 0 && db < 0 && dc < 0 && dd < 0) {
                const m0 = da > db ? da : db;
                const m1 = dc > dd ? dc : dd;
                const m = m0 > m1 ? m0 : m1;
                if (m * m > rSq * fnSq) continue;
              }
            }
            distance = parallelogramTriangleSq(
              ax,
              ay,
              az,
              bx,
              by,
              bz,
              cx,
              cy,
              cz,
              dx,
              dy,
              dz,
              L,
              vx,
              vy,
              vz,
              invHorizSq,
              invL,
              npx,
              npz,
              invNpSq,
              da,
              db,
              dc,
              dd,
              dt0,
              dt1,
              dt2,
              t0x,
              t0y,
              t0z,
              t1x,
              t1y,
              t1z,
              t2x,
              t2y,
              t2z,
              fnx,
              fny,
              fnz,
              fnSq,
            );
          } else {
            const da = (segAx - t0x) * fnx + (segAy - t0y) * fny + (segAz - t0z) * fnz;
            const db = (segBx - t0x) * fnx + (segBy - t0y) * fny + (segBz - t0z) * fnz;
            if (fnSq > 0 && Number.isFinite(fnSq)) {
              if (da > 0 && db > 0) {
                const m = da < db ? da : db;
                if (m * m > rSq * fnSq) continue;
              } else if (da < 0 && db < 0) {
                const m = da > db ? da : db;
                if (m * m > rSq * fnSq) continue;
              }
            }
            distance = segmentTriangleSq(
              segAx,
              segAy,
              segAz,
              segBx,
              segBy,
              segBz,
              da,
              db,
              t0x,
              t0y,
              t0z,
              t1x,
              t1y,
              t1z,
              t2x,
              t2y,
              t2z,
              fnx,
              fny,
              fnz,
              fnSq,
            );
          }
          if (!Number.isFinite(distance)) throw new Error('Non-finite collision distance');
          if (distance <= rSq) {
            const result = {
              triangle: triIds[slot],
              distance: Math.sqrt(distance),
            };
            if (key !== null) remember(key, { kind: 'sweep', result });
            return result;
          }
        }
      }
      if (key !== null) remember(key, { kind: 'sweep', result: null });
      return null;
    },
    hasTrianglesInAabb(
      qMinX: number,
      qMinY: number,
      qMinZ: number,
      qMaxX: number,
      qMaxY: number,
      qMaxZ: number,
    ): boolean {
      requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
      if (nodeCount === 0) return false;
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const node = stack[--top];
        const nOff = node * 6;
        if (
          qMinX > nodeBoxes[nOff + 3] ||
          qMaxX < nodeBoxes[nOff] ||
          qMinY > nodeBoxes[nOff + 4] ||
          qMaxY < nodeBoxes[nOff + 1] ||
          qMinZ > nodeBoxes[nOff + 5] ||
          qMaxZ < nodeBoxes[nOff + 2]
        ) {
          continue;
        }
        const left = nodeLeft[node];
        if (left >= 0) {
          ensureStack(top + 2);
          stack[top++] = left;
          stack[top++] = nodeRight[node];
          continue;
        }
        const startSlot = ~left;
        const endSlot = nodeRight[node];
        for (let slot = startSlot; slot < endSlot; slot++) {
          const bOff = slot * 6;
          if (
            qMinX <= triBounds[bOff + 3] &&
            qMaxX >= triBounds[bOff] &&
            qMinY <= triBounds[bOff + 4] &&
            qMaxY >= triBounds[bOff + 1] &&
            qMinZ <= triBounds[bOff + 5] &&
            qMaxZ >= triBounds[bOff + 2]
          ) {
            return true;
          }
        }
      }
      return false;
    },
    probeSphere(center: Vec3, radius: number): boolean {
      const px = center[0],
        py = center[1],
        pz = center[2];
      const qMinX = px - radius,
        qMinY = py - radius,
        qMinZ = pz - radius;
      const qMaxX = px + radius,
        qMaxY = py + radius,
        qMaxZ = pz + radius;
      requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
      if (nodeCount === 0) return false;
      const rSq = radius * radius;
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const node = stack[--top];
        const nOff = node * 6;
        if (
          qMinX > nodeBoxes[nOff + 3] ||
          qMaxX < nodeBoxes[nOff] ||
          qMinY > nodeBoxes[nOff + 4] ||
          qMaxY < nodeBoxes[nOff + 1] ||
          qMinZ > nodeBoxes[nOff + 5] ||
          qMaxZ < nodeBoxes[nOff + 2]
        ) {
          continue;
        }
        const left = nodeLeft[node];
        if (left >= 0) {
          ensureStack(top + 2);
          stack[top++] = left;
          stack[top++] = nodeRight[node];
          continue;
        }
        const startSlot = ~left;
        const endSlot = nodeRight[node];
        for (let slot = startSlot; slot < endSlot; slot++) {
          const bOff = slot * 6;
          if (
            qMinX > triBounds[bOff + 3] ||
            qMaxX < triBounds[bOff] ||
            qMinY > triBounds[bOff + 4] ||
            qMaxY < triBounds[bOff + 1] ||
            qMinZ > triBounds[bOff + 5] ||
            qMaxZ < triBounds[bOff + 2]
          ) {
            continue;
          }
          const vOff = slot * 9;
          const t0x = triVerts[vOff],
            t0y = triVerts[vOff + 1],
            t0z = triVerts[vOff + 2];
          const t1x = triVerts[vOff + 3],
            t1y = triVerts[vOff + 4],
            t1z = triVerts[vOff + 5];
          const t2x = triVerts[vOff + 6],
            t2y = triVerts[vOff + 7],
            t2z = triVerts[vOff + 8];
          const e1x = t1x - t0x,
            e1y = t1y - t0y,
            e1z = t1z - t0z;
          const e2x = t2x - t0x,
            e2y = t2y - t0y,
            e2z = t2z - t0z;
          const fnx = e1y * e2z - e1z * e2y;
          const fny = e1z * e2x - e1x * e2z;
          const fnz = e1x * e2y - e1y * e2x;
          const fnSq = fnx * fnx + fny * fny + fnz * fnz;
          const dp = (px - t0x) * fnx + (py - t0y) * fny + (pz - t0z) * fnz;
          // Exact plane-distance fast-reject before projection/edge checks.
          if (fnSq > 0 && Number.isFinite(fnSq) && dp * dp > rSq * fnSq) continue;
          const distSq = pointTriangleSq(
            px,
            py,
            pz,
            dp,
            t0x,
            t0y,
            t0z,
            t1x,
            t1y,
            t1z,
            t2x,
            t2y,
            t2z,
            fnx,
            fny,
            fnz,
            fnSq,
          );
          if (distSq <= rSq) return true;
        }
      }
      return false;
    },
  };
}

export { createTypeScriptCollisionWorld as createCollisionWorld };
