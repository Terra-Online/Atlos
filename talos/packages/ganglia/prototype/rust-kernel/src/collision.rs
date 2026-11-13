use napi::bindgen_prelude::{Float64Array, Uint32Array};
use napi::{Error, Result};
use napi_derive::napi;
use std::cmp::Ordering;

type Point = [f64; 3];
type Triangle = [Point; 3];
type Bounds = [f64; 6];

struct Node {
    bounds: Bounds,
    start: usize,
    end: usize,
    children: Option<(usize, usize)>,
}

#[napi]
pub struct CollisionIndex {
    positions: Vec<f64>,
    indices: Vec<u32>,
    original_ids: Vec<u32>,
    bounds: Vec<Bounds>,
    order: Vec<usize>,
    nodes: Vec<Node>,
    scope: Option<[f64; 4]>,
}

fn invalid(message: &str) -> Error {
    Error::from_reason(message)
}

fn point(values: &[f64], message: &str) -> Result<Point> {
    if values.len() != 3 || values.iter().any(|v| !v.is_finite()) {
        return Err(invalid(message));
    }
    Ok([values[0], values[1], values[2]])
}

fn rectangle(values: &[f64], message: &str) -> Result<[f64; 4]> {
    if values.len() != 4
        || values.iter().any(|v| !v.is_finite())
        || values[0] > values[2]
        || values[1] > values[3]
    {
        return Err(invalid(message));
    }
    Ok([values[0], values[1], values[2], values[3]])
}

// Rust's f64::min/max discard NaN; JavaScript's Math.min/max propagate it.
// Degenerate or overflowing geometry must therefore reach the same query error.
fn minimum(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else {
            a.min(b)
        }
    })
}

fn maximum(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::NEG_INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else {
            a.max(b)
        }
    })
}

fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: Point, b: Point) -> Point {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn mix(a: Point, b: Point, t: f64) -> Point {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn squared(a: Point, b: Point) -> f64 {
    let x = a[0] - b[0];
    let y = a[1] - b[1];
    let z = a[2] - b[2];
    x * x + y * y + z * z
}

fn point_segment(p: Point, a: Point, b: Point) -> f64 {
    let d = sub(b, a);
    let length = dot(d, d);
    let t = if length != 0.0 && !length.is_nan() {
        maximum(&[0.0, minimum(&[1.0, dot(sub(p, a), d) / length])])
    } else {
        0.0
    };
    squared(p, mix(a, b, t))
}

fn segment_segment(a: Point, b: Point, c: Point, d: Point) -> f64 {
    let mut best = minimum(&[
        point_segment(a, c, d),
        point_segment(b, c, d),
        point_segment(c, a, b),
        point_segment(d, a, b),
    ]);
    let u = sub(b, a);
    let v = sub(d, c);
    let w = sub(c, a);
    let n = cross(u, v);
    let denom = dot(n, n);
    if denom > 0.0 {
        let s = dot(cross(w, v), n) / denom;
        let t = dot(cross(w, u), n) / denom;
        if (0.0..=1.0).contains(&s) && (0.0..=1.0).contains(&t) {
            best = minimum(&[best, squared(mix(a, b, s), mix(c, d, t))]);
        }
    }
    best
}

fn inside(p: Point, triangle: Triangle, n: Point) -> bool {
    for i in 0..3 {
        let a = triangle[i];
        let side = dot(cross(sub(triangle[(i + 1) % 3], a), sub(p, a)), n);
        if side.is_nan() || side < 0.0 {
            return false;
        }
    }
    true
}

fn point_triangle(p: Point, triangle: Triangle, n: Point) -> f64 {
    let area = dot(n, n);
    if area > 0.0 {
        let distance = dot(sub(p, triangle[0]), n) / area;
        let projected = [
            p[0] - n[0] * distance,
            p[1] - n[1] * distance,
            p[2] - n[2] * distance,
        ];
        if inside(projected, triangle, n) {
            return squared(p, projected);
        }
    }
    minimum(&[
        point_segment(p, triangle[0], triangle[1]),
        point_segment(p, triangle[1], triangle[2]),
        point_segment(p, triangle[2], triangle[0]),
    ])
}

fn segment_triangle(a: Point, b: Point, triangle: Triangle) -> f64 {
    let n = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]));
    let da = dot(sub(a, triangle[0]), n);
    let db = dot(sub(b, triangle[0]), n);
    if da != db {
        let t = da / (da - db);
        if (0.0..=1.0).contains(&t) && inside(mix(a, b, t), triangle, n) {
            return 0.0;
        }
    }
    minimum(&[
        point_triangle(a, triangle, n),
        point_triangle(b, triangle, n),
        segment_segment(a, b, triangle[0], triangle[1]),
        segment_segment(a, b, triangle[1], triangle[2]),
        segment_segment(a, b, triangle[2], triangle[0]),
    ])
}

fn triangle_triangle(a: Triangle, b: Triangle) -> f64 {
    minimum(&[
        segment_triangle(a[0], a[1], b),
        segment_triangle(a[1], a[2], b),
        segment_triangle(a[2], a[0], b),
        segment_triangle(b[0], b[1], a),
        segment_triangle(b[1], b[2], a),
        segment_triangle(b[2], b[0], a),
    ])
}

fn overlaps(a: Bounds, b: Bounds) -> bool {
    a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2]
}

// Preserve V8 Math.hypot's scaled, compensated three-component sum, including
// its tie rounding: the selected support normal participates in later geometry.
fn hypot(n: Point) -> f64 {
    let [x, y, z] = n.map(f64::abs);
    if x.is_infinite() || y.is_infinite() || z.is_infinite() {
        return f64::INFINITY;
    }
    let m = maximum(&[x, y, z]);
    if m == 0.0 {
        return 0.0;
    }
    let a = (x / m) * (x / m);
    let b = (y / m) * (y / m);
    let compensation = (a + b) - a - b;
    let c = (z / m) * (z / m) - compensation;
    (a + b + c).sqrt() * m
}

fn sphere_support(position: Point, face: Triangle, normal: Point, radius: f64) -> f64 {
    let plane_height = face[0][1]
        - (normal[0] * (position[0] - face[0][0]) + normal[2] * (position[2] - face[0][2]))
            / normal[1];
    let contact = [
        position[0] - radius * normal[0],
        plane_height + radius / normal[1] - radius * normal[1],
        position[2] - radius * normal[2],
    ];
    let mut best = if inside(contact, face, normal) {
        plane_height + radius * (1.0 / normal[1] - 1.0)
    } else {
        f64::NEG_INFINITY
    };
    for index in 0..3 {
        let a = face[index];
        let b = face[(index + 1) % 3];
        let dx = b[0] - a[0];
        let dz = b[2] - a[2];
        let dy = b[1] - a[1];
        let length_squared = dx * dx + dz * dz;
        if length_squared == 0.0 {
            continue;
        }
        let x = position[0] - a[0];
        let z = position[2] - a[2];
        let projection = (x * dx + z * dz) / length_squared;
        let px = x - projection * dx;
        let pz = z - projection * dz;
        let perpendicular_squared = px * px + pz * pz;
        let reach_squared = radius * radius - perpendicular_squared;
        if reach_squared < 0.0 {
            continue;
        }
        let fraction = maximum(&[
            0.0,
            minimum(&[
                1.0,
                projection
                    + dy * (reach_squared / (length_squared * (length_squared + dy * dy))).sqrt(),
            ]),
        ]);
        let hx = x - fraction * dx;
        let hz = z - fraction * dz;
        let horizontal_squared = hx * hx + hz * hz;
        if horizontal_squared <= radius * radius {
            best = maximum(&[
                best,
                a[1] + fraction * dy + (radius * radius - horizontal_squared).sqrt() - radius,
            ]);
        }
    }
    best
}

#[napi]
impl CollisionIndex {
    #[napi(constructor)]
    pub fn new(
        positions: Float64Array,
        indices: Uint32Array,
        bounds: Float64Array,
    ) -> Result<Self> {
        if !positions.len().is_multiple_of(3) || !indices.len().is_multiple_of(3) {
            return Err(invalid("Invalid collision geometry"));
        }
        if positions.iter().any(|v| !v.is_finite()) {
            return Err(invalid("Non-finite collision vertex"));
        }
        if indices.iter().any(|&i| i as usize >= positions.len() / 3) {
            return Err(invalid("Invalid collision index"));
        }
        let scope = if bounds.is_empty() {
            None
        } else {
            Some(rectangle(&bounds, "Invalid collision XZ bounds")?)
        };
        let mut index = Self {
            positions: positions.to_vec(),
            indices: Vec::new(),
            original_ids: Vec::new(),
            bounds: Vec::new(),
            order: Vec::new(),
            nodes: Vec::new(),
            scope,
        };
        for (id, vertices) in indices.as_chunks::<3>().0.iter().enumerate() {
            let mut box_ = [0.0; 6];
            for axis in 0..3 {
                let a = index.positions[vertices[0] as usize * 3 + axis];
                let b = index.positions[vertices[1] as usize * 3 + axis];
                let c = index.positions[vertices[2] as usize * 3 + axis];
                box_[axis] = minimum(&[a, b, c]);
                box_[axis + 3] = maximum(&[a, b, c]);
            }
            if let Some(scope) = scope
                && !(box_[3] >= scope[0]
                    && box_[0] <= scope[2]
                    && box_[5] >= scope[1]
                    && box_[2] <= scope[3])
            {
                continue;
            }
            index.order.push(index.original_ids.len());
            index.original_ids.push(id as u32);
            index.indices.extend_from_slice(vertices);
            index.bounds.push(box_);
        }
        if !index.order.is_empty() {
            index.build(0, index.order.len(), None);
        }
        Ok(index)
    }

    #[napi]
    pub fn triangles_in_bounds(&self, bounds: Float64Array) -> Result<Uint32Array> {
        let rectangle = rectangle(&bounds, "Invalid collision triangle rectangle")?;
        let box_ = [
            rectangle[0],
            f64::NEG_INFINITY,
            rectangle[1],
            rectangle[2],
            f64::INFINITY,
            rectangle[3],
        ];
        self.require_scope(box_)?;
        let mut result = Vec::new();
        let mut stack = self.stack();
        while let Some(slot) = stack.pop() {
            let node = &self.nodes[slot];
            if !overlaps(box_, node.bounds) {
                continue;
            }
            if let Some((left, right)) = node.children {
                stack.extend([left, right]);
                continue;
            }
            for &id in &self.order[node.start..node.end] {
                if overlaps(box_, self.bounds[id]) {
                    result.push(self.original_ids[id]);
                }
            }
        }
        result.sort_unstable();
        Ok(result.into())
    }

    #[napi]
    pub fn sweep_capsule(
        &self,
        start: Float64Array,
        end: Float64Array,
        radius: f64,
        height: f64,
        inflation: f64,
    ) -> Result<Float64Array> {
        let start = point(&start, "Invalid capsule sweep")?;
        let end = point(&end, "Invalid capsule sweep")?;
        if [radius, height, inflation].iter().any(|v| !v.is_finite())
            || radius < 0.0
            || height <= 0.0
            || height < 2.0 * radius
            || inflation < 0.0
        {
            return Err(invalid("Invalid capsule sweep"));
        }
        let r = radius + inflation;
        let box_ = [
            start[0].min(end[0]) - r,
            start[1].min(end[1]) - inflation,
            start[2].min(end[2]) - r,
            start[0].max(end[0]) + r,
            start[1].max(end[1]) + height + inflation,
            start[2].max(end[2]) + r,
        ];
        if box_.iter().any(|v| !v.is_finite()) {
            return Err(invalid("Non-finite capsule bounds"));
        }
        self.require_scope(box_)?;
        let a = [start[0], start[1] + radius, start[2]];
        let b = [start[0], start[1] + height - radius, start[2]];
        let c = [end[0], end[1] + radius, end[2]];
        let d = [end[0], end[1] + height - radius, end[2]];
        let mut stack = self.stack();
        while let Some(slot) = stack.pop() {
            let node = &self.nodes[slot];
            if !overlaps(box_, node.bounds) {
                continue;
            }
            if let Some((left, right)) = node.children {
                stack.extend([left, right]);
                continue;
            }
            for &id in &self.order[node.start..node.end] {
                if !overlaps(box_, self.bounds[id]) {
                    continue;
                }
                let face = self.triangle(id);
                let distance = minimum(&[
                    triangle_triangle([a, b, d], face),
                    triangle_triangle([a, d, c], face),
                ]);
                if !distance.is_finite() {
                    return Err(invalid("Non-finite collision distance"));
                }
                if distance <= r * r {
                    return Ok(vec![self.original_ids[id] as f64, distance.sqrt()].into());
                }
            }
        }
        Ok(Vec::new().into())
    }

    #[napi]
    pub fn ground_at(
        &self,
        position: Float64Array,
        max_up: f64,
        max_down: f64,
        max_slope: f64,
        radius: f64,
        minimum_up: f64,
    ) -> Result<Float64Array> {
        let position = point(&position, "Invalid ground support query")?;
        if [max_up, max_down, max_slope, radius]
            .iter()
            .any(|v| !v.is_finite())
            || max_up < 0.0
            || max_down < 0.0
            || max_slope <= 0.0
            || max_slope >= 90.0
            || radius < 0.0
        {
            return Err(invalid("Invalid ground support query"));
        }
        let box_ = [
            position[0] - radius,
            position[1] - max_down - radius,
            position[2] - radius,
            position[0] + radius,
            position[1] + max_up + radius,
            position[2] + radius,
        ];
        if box_.iter().any(|v| !v.is_finite()) {
            return Err(invalid("Non-finite ground support bounds"));
        }
        self.require_scope(box_)?;

        let mut best: Option<(usize, f64, Point)> = None;
        let mut best_offset = f64::INFINITY;
        let mut stack = self.stack();
        while let Some(slot) = stack.pop() {
            let node = &self.nodes[slot];
            if !overlaps(box_, node.bounds) {
                continue;
            }
            if let Some((left, right)) = node.children {
                stack.extend([left, right]);
                continue;
            }
            for &id in &self.order[node.start..node.end] {
                if !overlaps(box_, self.bounds[id]) {
                    continue;
                }
                let face = self.triangle(id);
                let ab = sub(face[1], face[0]);
                let ac = sub(face[2], face[0]);
                let normal = cross(ab, ac);
                let length = hypot(normal);
                if !length.is_finite() {
                    return Err(invalid("Non-finite ground support normal"));
                }
                if length == 0.0 || normal[1] <= 0.0 || normal[1] / length < minimum_up {
                    continue;
                }
                let unit_normal = normal.map(|v| v / length);
                let x = position[0] - face[0][0];
                let z = position[2] - face[0][2];
                let determinant = -normal[1];
                let u = (x * ac[2] - z * ac[0]) / determinant;
                let v = (ab[0] * z - ab[2] * x) / determinant;
                if radius == 0.0 && (u < -1e-10 || v < -1e-10 || u + v > 1.0 + 1e-10) {
                    continue;
                }
                let height = if radius > 0.0 {
                    sphere_support(position, face, unit_normal, radius)
                } else {
                    face[0][1] + u * ab[1] + v * ac[1]
                };
                if height == f64::NEG_INFINITY {
                    continue;
                }
                if !height.is_finite() {
                    return Err(invalid("Non-finite ground support height"));
                }
                if height < position[1] - max_down || height > position[1] + max_up {
                    continue;
                }
                let offset = (height - position[1]).abs();
                let best_height = best
                    .map(|(_, height, _)| height)
                    .unwrap_or(f64::NEG_INFINITY);
                if (radius > 0.0 && (best.is_none() || height > best_height))
                    || (radius == 0.0
                        && (offset < best_offset
                            || (offset == best_offset && height > best_height)))
                {
                    best_offset = offset;
                    best = Some((id, height, unit_normal));
                }
            }
        }
        Ok(match best {
            Some((id, height, normal)) => vec![
                self.original_ids[id] as f64,
                height,
                normal[0],
                normal[1],
                normal[2],
            ],
            None => Vec::new(),
        }
        .into())
    }
}

impl CollisionIndex {
    fn triangle(&self, id: usize) -> Triangle {
        std::array::from_fn(|corner| {
            let offset = self.indices[id * 3 + corner] as usize * 3;
            [
                self.positions[offset],
                self.positions[offset + 1],
                self.positions[offset + 2],
            ]
        })
    }

    fn require_scope(&self, bounds: Bounds) -> Result<()> {
        if let Some(scope) = self.scope
            && (bounds[0] < scope[0]
                || bounds[2] < scope[1]
                || bounds[3] > scope[2]
                || bounds[5] > scope[3])
        {
            return Err(invalid("Collision query exceeds indexed XZ bounds"));
        }
        Ok(())
    }

    fn stack(&self) -> Vec<usize> {
        if self.nodes.is_empty() {
            Vec::new()
        } else {
            vec![0]
        }
    }

    fn build(&mut self, start: usize, end: usize, parent_axis: Option<usize>) -> usize {
        let mut bounds = [
            f64::INFINITY,
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for &id in &self.order[start..end] {
            for axis in 0..3 {
                bounds[axis] = bounds[axis].min(self.bounds[id][axis]);
                bounds[axis + 3] = bounds[axis + 3].max(self.bounds[id][axis + 3]);
            }
        }
        let slot = self.nodes.len();
        self.nodes.push(Node {
            bounds,
            start,
            end,
            children: None,
        });
        if end - start <= 8 {
            if let Some(axis) = parent_axis {
                self.sort(start, end, axis);
            }
        } else {
            let mut axis = 0;
            for other in 1..3 {
                if bounds[other + 3] - bounds[other] > bounds[axis + 3] - bounds[axis] {
                    axis = other;
                }
            }
            // The total comparator gives exactly the TS select's median members.
            // Leaves restore their parent's ordering; full internal ordering does
            // not affect membership, traversal, or first-hit/support tie results.
            self.sort(start, end, axis);
            let middle = (start + end) / 2;
            let left = self.build(start, middle, Some(axis));
            let right = self.build(middle, end, Some(axis));
            self.nodes[slot].children = Some((left, right));
        }
        slot
    }

    fn sort(&mut self, start: usize, end: usize, axis: usize) {
        let bounds = &self.bounds;
        self.order[start..end].sort_unstable_by(|&a, &b| {
            let delta =
                bounds[a][axis] + bounds[a][axis + 3] - (bounds[b][axis] + bounds[b][axis + 3]);
            if delta < 0.0 {
                Ordering::Less
            } else if delta > 0.0 {
                Ordering::Greater
            } else {
                a.cmp(&b)
            }
        });
    }
}
