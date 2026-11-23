/// <reference lib="dom" />

export type Point = readonly [x: number, y: number, z: number];
export type Bounds = { min: Point; max: Point };

type Paint = { color: string; opacity?: number };
type Outline = Paint & { width?: number };
type Stroke = Outline & { dash?: readonly number[] };
type Rgb = readonly [red: number, green: number, blue: number];
type Material =
  | ({ kind: 'flat'; outline?: Stroke } & Paint)
  | { kind: 'matte'; color: Rgb; opacity?: number }
  | { kind: 'contour'; color: Rgb; outline: Rgb };

type Mesh = {
  kind: 'mesh';
  /** Planar, convex faces. Triangles and annotation polygons use the same primitive. */
  faces: readonly (readonly Point[])[];
  material: Material;
  clip?: Bounds;
};

/** Screen coordinates and stroke sizes use CSS pixels. World coordinates use scene units. */
export type Drawable = { space?: 'world' | 'screen' } & (
  | ({ kind: 'point'; at: Point; radius: number; outline?: Outline } & Paint)
  | {
      kind: 'line';
      points: readonly Point[];
      stroke: Stroke;
      outline?: Stroke;
      /** An arrow in the direction of the point order. */
      arrow?: { color: string };
      /** Draw the full line with its own style regardless of scene depth. */
      alwaysRender?: boolean;
    }
  | Mesh
  | {
      kind: 'label';
      at: Point;
      text: string;
      color: string;
      halo?: string;
      offset?: readonly [x: number, y: number];
      align?: 'left' | 'right';
      marker?: { color: string; align?: 'left' | 'right' };
    }
);

export interface State {
  viewport: { width: number; height: number; pixelRatio: number };
  /** Orthographic orbit camera. Scale in CSS pixels per world unit is focalLength / distance. */
  camera: { center: Point; yaw: number; pitch: number; distance: number; focalLength: number };
  occlusion?: 'dash' | 'hide';
  contourSamples?: 1 | 2;
}

// The HTML generator embeds this factory in standalone pages. Keep runtime dependencies inside it.
export function createRenderer(canvas: HTMLCanvasElement, state: State) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ctx = context;
  // Mesh inputs are snapshots. Replace a mesh when its geometry, clipping bounds or material changes.
  const prepared = new WeakMap<Mesh, { points: readonly Point[]; normal: Point }[]>();
  const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function frame() {
    const { yaw, pitch, center, distance, focalLength } = state.camera;
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw);
    const cp = Math.cos(pitch),
      sp = Math.sin(pitch);
    const right: Point = [cy, 0, -sy];
    const up: Point = [-sp * sy, cp, -sp * cy];
    const back: Point = [cp * sy, sp, cp * cy];
    const position: Point = [
      center[0] + distance * back[0],
      center[1] + distance * back[1],
      center[2] + distance * back[2],
    ];
    return { right, up, back, position, scale: focalLength / distance };
  }

  function clip(points: readonly Point[], { min, max }: Bounds) {
    // Clip a convex face even when all its vertices are outside the window.
    for (const axis of [0, 1, 2] as const) {
      for (const [boundary, direction] of [
        [min[axis], 1],
        [max[axis], -1],
      ] as const) {
        const next: Point[] = [];
        for (let i = 0; i < points.length; i++) {
          const a = points[i],
            b = points[(i + 1) % points.length];
          const inside = (a[axis] - boundary) * direction >= 0;
          if (inside) next.push(a);
          if (inside !== (b[axis] - boundary) * direction >= 0) {
            const t = (boundary - a[axis]) / (b[axis] - a[axis]);
            next.push([
              a[0] + (b[0] - a[0]) * t,
              a[1] + (b[1] - a[1]) * t,
              a[2] + (b[2] - a[2]) * t,
            ]);
          }
        }
        points = next;
      }
    }
    return points;
  }

  function normalOf(face: readonly Point[]): Point {
    const [a, b, c] = face;
    const u = b.map((v, i) => v - a[i]),
      v = c.map((v, i) => v - a[i]);
    const n: Point = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...n) || 1;
    return [n[0] / length, n[1] / length, n[2] / length];
  }

  function lit(normal: Point, color: Rgb): Rgb {
    const light = 0.8 + 0.18 * Math.abs(dot(normal, [0.3, 0.89, -0.34]));
    return [color[0] * light, color[1] * light, color[2] * light];
  }

  function path(points: readonly Point[]) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  }

  function stroke(style: Stroke) {
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width ?? 1;
    ctx.setLineDash(Array.from(style.dash ?? []));
    ctx.stroke();
  }

  function disc([x, y]: Point, radius: number, paint: Paint) {
    ctx.globalAlpha = paint.opacity ?? 1;
    ctx.fillStyle = paint.color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function label(at: Point, item: Extract<Drawable, { kind: 'label' }>) {
    const { width, height } = state.viewport;
    const [x, y] = at;
    const { marker } = item;
    if (marker && (x < 0 || x > width || y < 0 || y > height)) return;
    if (marker) {
      if (item.halo) disc(at, 5, { color: item.halo });
      disc(at, 3.5, marker);
    }
    ctx.globalAlpha = 1;
    ctx.font = marker ? '600 12px system-ui' : '12px system-ui';
    const textWidth = ctx.measureText(item.text).width;
    const tx = marker
      ? Math.max(
          5,
          Math.min(width - textWidth - 5, marker.align === 'right' ? x - textWidth - 9 : x + 9),
        )
      : x + (item.offset?.[0] ?? 0) - (item.align === 'right' ? textWidth : 0);
    const ty = marker ? (y < 21 ? y + 17 : y - 8) : y + (item.offset?.[1] ?? 0);
    if (item.halo) {
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = item.halo;
      ctx.strokeText(item.text, tx, ty);
    }
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, tx, ty);
  }

  function prepare(mesh: Mesh) {
    let faces = prepared.get(mesh);
    if (faces) return faces;
    faces = [];
    for (const face of mesh.faces) {
      const points = mesh.clip ? clip(face, mesh.clip) : face;
      if (points.length >= 3) faces.push({ points, normal: normalOf(face) });
    }
    prepared.set(mesh, faces);
    return faces;
  }

  type Plane = { dx: number; dy: number; normal: Point; color: Rgb; outline: Rgb };
  type Depth = {
    width: number;
    height: number;
    samples: number;
    values: Float32Array;
    owners: Int32Array;
    planes: Plane[];
  };
  const surfaces = new Map<
    1 | 2,
    {
      canvas: HTMLCanvasElement;
      context: CanvasRenderingContext2D;
      image: ImageData;
      depth: Depth;
    }
  >();

  function rasterize(
    depth: Depth,
    a: Point,
    b: Point,
    c: Point,
    material: Omit<Plane, 'dx' | 'dy'>,
  ) {
    const bx = b[0] - a[0],
      by = b[1] - a[1],
      bz = b[2] - a[2];
    const cx = c[0] - a[0],
      cy = c[1] - a[1],
      cz = c[2] - a[2];
    const area = bx * cy - by * cx;
    if (Math.abs(area) < 1e-8) return;
    const minX = Math.max(0, Math.ceil(Math.min(a[0], b[0], c[0]) - 0.5));
    const maxX = Math.min(depth.width - 1, Math.floor(Math.max(a[0], b[0], c[0]) - 0.5));
    const minY = Math.max(0, Math.ceil(Math.min(a[1], b[1], c[1]) - 0.5));
    const maxY = Math.min(depth.height - 1, Math.floor(Math.max(a[1], b[1], c[1]) - 0.5));
    if (minX > maxX || minY > maxY) return;
    const dx = (bz * cy - by * cz) / area;
    const dy = (bx * cz - bz * cx) / area;
    const owner = depth.planes.push({ ...material, dx, dy }) - 1;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5 - a[1];
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - a[0];
        const u = (px * cy - py * cx) / area;
        const v = (bx * py - by * px) / area;
        if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
        const z = a[2] + dx * px + dy * py;
        const index = y * depth.width + x;
        if (z > depth.values[index]) {
          depth.values[index] = z;
          depth.owners[index] = owner;
        }
      }
    }
  }

  function drawContours(
    objects: readonly Drawable[],
    project: (point: Point) => Point,
    scale: number,
  ) {
    const contours = objects.filter(
      (item) => item.kind === 'mesh' && item.space !== 'screen' && item.material.kind === 'contour',
    );
    if (!contours.length) return;
    const samples = state.contourSamples ?? 2;
    const width = Math.ceil(state.viewport.width * samples);
    const height = Math.ceil(state.viewport.height * samples);
    let surface = surfaces.get(samples);
    if (!surface || surface.depth.width !== width || surface.depth.height !== height) {
      const layer = canvas.ownerDocument.createElement('canvas');
      layer.width = width;
      layer.height = height;
      const context = layer.getContext('2d');
      if (!context) throw new Error('Canvas 2D is unavailable for the contour layer');
      surface = {
        canvas: layer,
        context,
        image: context.createImageData(width, height),
        depth: {
          width,
          height,
          samples,
          values: new Float32Array(width * height),
          owners: new Int32Array(width * height),
          planes: [],
        },
      };
      surfaces.set(samples, surface);
    }
    const { depth, image } = surface;
    depth.values.fill(-Infinity);
    depth.owners.fill(-1);
    depth.planes.length = 0;
    for (const item of contours) {
      if (item.kind !== 'mesh' || item.material.kind !== 'contour') continue;
      for (const { points, normal } of prepare(item)) {
        const projected = points.map((point): Point => {
          const [x, y, z] = project(point);
          return [x * samples, y * samples, z];
        });
        const color = lit(normal, item.material.color);
        for (let i = 1; i + 1 < projected.length; i++) {
          rasterize(depth, projected[0], projected[i], projected[i + 1], {
            normal,
            color,
            outline: item.material.outline,
          });
        }
      }
    }
    const tolerance = 1.5 / scale;
    function contour(index: number, neighbor: number, dx: number, dy: number) {
      const other = depth.owners[neighbor];
      if (other < 0) return true;
      const owner = depth.owners[index];
      if (owner === other) return false;
      const plane = depth.planes[owner];
      // Compare on the same ray to avoid outlining a steep but continuous face.
      const gap = depth.values[index] + plane.dx * dx + plane.dy * dy - depth.values[neighbor];
      if (Math.abs(gap) > tolerance) return gap > 0;
      // A crease belongs to one side of the shared edge. Depth steps above already pick the front.
      return neighbor > index && Math.abs(dot(plane.normal, depth.planes[other].normal)) < 0.86;
    }
    const edgeWithin = (x: number, y: number, index: number, step: number) =>
      (x >= step && contour(index, index - step, -step, 0)) ||
      (x + step < width && contour(index, index + step, step, 0)) ||
      (y >= step && contour(index, index - step * width, 0, -step)) ||
      (y + step < height && contour(index, index + step * width, 0, step));
    for (let y = 0, index = 0; y < height; y++) {
      for (let x = 0; x < width; x++, index++) {
        if (depth.owners[index] < 0) {
          image.data[index * 4 + 3] = 0;
          continue;
        }
        const plane = depth.planes[depth.owners[index]];
        const coverage = edgeWithin(x, y, index, 1)
          ? samples === 2
            ? 1
            : 0.8
          : samples === 2 && edgeWithin(x, y, index, 2)
            ? 0.5
            : 0;
        const offset = index * 4;
        image.data[offset] = plane.color[0] + (plane.outline[0] - plane.color[0]) * coverage;
        image.data[offset + 1] = plane.color[1] + (plane.outline[1] - plane.color[1]) * coverage;
        image.data[offset + 2] = plane.color[2] + (plane.outline[2] - plane.color[2]) * coverage;
        image.data[offset + 3] = 255;
      }
    }
    surface.context.putImageData(image, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(surface.canvas, 0, 0, width / samples, height / samples);
    return depth;
  }

  function occluded(depth: Depth, [x, y, z]: Point, bias: number) {
    const sx = x * depth.samples,
      sy = y * depth.samples;
    const ix = Math.floor(sx),
      iy = Math.floor(sy);
    if (ix < 0 || iy < 0 || ix >= depth.width || iy >= depth.height) return false;
    const index = iy * depth.width + ix;
    const plane = depth.planes[depth.owners[index]];
    if (!plane) return false;
    return depth.values[index] + plane.dx * (sx - ix - 0.5) + plane.dy * (sy - iy - 0.5) > z + bias;
  }

  function interpolate(a: Point, b: Point, t: number): Point {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function screenRange(a: Point, b: Point, depth: Depth) {
    let lo = 0,
      hi = 1;
    for (const axis of [0, 1] as const) {
      const limit = (axis === 0 ? depth.width : depth.height) / depth.samples;
      const delta = b[axis] - a[axis];
      if (delta === 0) {
        if (a[axis] < -1 || a[axis] > limit + 1) return;
        continue;
      }
      const near = (-1 - a[axis]) / delta,
        far = (limit + 1 - a[axis]) / delta;
      lo = Math.max(lo, Math.min(near, far));
      hi = Math.min(hi, Math.max(near, far));
    }
    if (lo < hi) return [lo, hi] as const;
  }

  function arrowhead(
    spans: readonly (readonly [Point, Point])[],
    style: Paint | undefined,
    outline?: Stroke,
  ) {
    const lengths = spans.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
    const total = lengths.reduce((sum, n) => sum + n, 0);
    if (total < 15) return false;
    let remaining = total * 0.72;
    for (const [i, [a, b]] of spans.entries()) {
      const length = lengths[i];
      if (remaining > length || length === 0) {
        remaining -= length;
        continue;
      }
      const tip = interpolate(a, b, remaining / length);
      const dx = (b[0] - a[0]) / length,
        dy = (b[1] - a[1]) / length;
      const x = tip[0] - 7 * dx,
        y = tip[1] - 7 * dy;
      path([[x - dy * 4, y + dx * 4, tip[2]], tip, [x + dy * 4, y - dx * 4, tip[2]]]);
      if (outline) stroke({ color: outline.color, opacity: outline.opacity, width: 4 });
      if (style) stroke({ color: style.color, opacity: style.opacity, width: 2 });
      return true;
    }
    return false;
  }

  function drawLine(
    item: Extract<Drawable, { kind: 'line' }>,
    points: readonly Point[],
    depth: Depth | undefined,
    bias: number,
  ) {
    if (points.length < 2) return;
    function drawWholeLine() {
      path(points);
      if (item.outline) stroke(item.outline);
      stroke(item.stroke);
      if (item.arrow)
        arrowhead(
          points.slice(1).map((point, i) => [points[i], point]),
          { color: item.arrow.color, opacity: item.stroke.opacity },
          item.outline,
        );
    }
    if (!depth) {
      drawWholeLine();
      return;
    }
    const visible: [Point, Point][] = [],
      hidden: [Point, Point][] = [];
    const hide = state.occlusion === 'hide';
    let hasHidden = false;
    function append(run: [Point, Point][], a: Point, b: Point, start: number, end: number) {
      if (run === hidden) {
        hasHidden = true;
        // Hidden spans can still position an arrow outline.
        if (hide && !(item.arrow && item.outline)) return;
      }
      run.push([interpolate(a, b, start), interpolate(a, b, end)]);
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      const range = screenRange(a, b, depth);
      if (!range) continue;
      const stepCount = Math.max(
        1,
        Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * (range[1] - range[0])),
      );
      const dt = (range[1] - range[0]) / stepCount;
      let start = range[0];
      let run = occluded(depth, interpolate(a, b, start + dt / 2), bias) ? hidden : visible;
      for (let step = 1; step < stepCount; step++) {
        const t = range[0] + step * dt;
        const next = occluded(depth, interpolate(a, b, t + dt / 2), bias) ? hidden : visible;
        if (next === run) continue;
        append(run, a, b, start, t);
        start = t;
        run = next;
      }
      append(run, a, b, start, range[1]);
    }
    if (!hasHidden) {
      drawWholeLine();
      return;
    }
    const dash = [4, 3];
    for (const spans of hide ? [visible] : [hidden, visible]) {
      if (!spans.length) continue;
      ctx.beginPath();
      let end: Point | undefined;
      for (const [a, b] of spans) {
        if (!end || Math.hypot(end[0] - a[0], end[1] - a[1]) > 1e-6) ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        end = b;
      }
      if (spans === hidden) {
        if (item.outline)
          stroke({ ...item.outline, dash, opacity: (item.outline.opacity ?? 1) * 0.55 });
        stroke({
          ...item.stroke,
          dash,
          width: Math.max(1.15, item.stroke.width ?? 1),
          opacity: (item.stroke.opacity ?? 1) * 0.72,
        });
      } else {
        if (item.outline) stroke(item.outline);
        stroke(item.stroke);
      }
    }
    if (item.arrow) {
      const arrow = { color: item.arrow.color, opacity: item.stroke.opacity };
      if (!arrowhead(visible, arrow, item.outline)) {
        const fill = hide ? undefined : { ...arrow, opacity: (arrow.opacity ?? 1) * 0.72 };
        arrowhead(hidden, fill, item.outline);
      }
    }
  }

  /** Contour meshes form the depth layer. Remaining objects are drawn in order. */
  function render(objects: readonly Drawable[]) {
    const { width, height, pixelRatio } = state.viewport;
    if (width <= 0 || height <= 0) return;
    if (canvas.width !== Math.round(width * pixelRatio))
      canvas.width = Math.round(width * pixelRatio);
    if (canvas.height !== Math.round(height * pixelRatio))
      canvas.height = Math.round(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const { right, up, back, position, scale } = frame();
    const world = (point: Point): Point => {
      const local: Point = [point[0] - position[0], point[1] - position[1], point[2] - position[2]];
      return [
        width / 2 + dot(right, local) * scale,
        height / 2 - dot(up, local) * scale,
        dot(back, local),
      ];
    };
    const contourStart = performance.now();
    const depth = drawContours(objects, world, scale);
    const contourMs = performance.now() - contourStart;
    const bias = 0.75 / scale;
    for (const item of objects) {
      const project = item.space === 'screen' ? (point: Point) => point : world;
      switch (item.kind) {
        case 'point': {
          const at = project(item.at);
          const behind = depth && item.space !== 'screen' && occluded(depth, at, bias);
          if (behind && state.occlusion === 'hide') break;
          const fade = behind ? 0.5 : 1;
          if (item.outline)
            disc(at, item.radius + (item.outline.width ?? 1), {
              ...item.outline,
              opacity: (item.outline.opacity ?? 1) * fade,
            });
          disc(at, item.radius, { ...item, opacity: (item.opacity ?? 1) * fade });
          break;
        }
        case 'line':
          drawLine(
            item,
            item.points.map(project),
            item.space === 'screen' || item.alwaysRender ? undefined : depth,
            bias,
          );
          break;
        case 'mesh': {
          const material = item.material;
          if (material.kind === 'contour' && item.space !== 'screen') break;
          const faces = prepare(item).map(({ points, normal }) => {
            const projected = points.map(project);
            const depth = projected.reduce((sum, p) => sum + p[2], 0) / projected.length;
            const color =
              material.kind === 'flat'
                ? material.color
                : `rgb(${lit(normal, material.color).map(Math.round).join(',')})`;
            return { projected, color, depth };
          });
          if (item.space !== 'screen') faces.sort((a, b) => a.depth - b.depth);
          for (const { projected, color } of faces) {
            path(projected);
            ctx.closePath();
            ctx.globalAlpha = material.kind === 'contour' ? 1 : (material.opacity ?? 1);
            ctx.fillStyle = color;
            ctx.fill();
            if (material.kind === 'flat' && material.outline) stroke(material.outline);
          }
          break;
        }
        case 'label':
          label(project(item.at), item);
          break;
      }
    }
    ctx.globalAlpha = 1;
    return { contourMs };
  }

  return { state, frame, render };
}
