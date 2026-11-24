use crate::types::Point;
use std::sync::Arc;

pub fn add(a: Point, b: Point) -> Point {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn scale(a: Point, s: f64) -> Point {
    [a[0] * s, a[1] * s, a[2] * s]
}
pub fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: Point, b: Point) -> Point {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn distance(a: Point, b: Point) -> f64 {
    dot(sub(a, b), sub(a, b)).sqrt()
}
pub fn lerp(a: Point, b: Point, t: f64) -> Point {
    add(a, scale(sub(b, a), t))
}
pub fn horizontal(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}

#[derive(Clone, Copy, serde::Deserialize)]
pub struct Bounds {
    pub min: Point,
    pub max: Point,
}
impl Bounds {
    pub fn points(points: &[Point]) -> Self {
        let mut bounds = Self {
            min: [f64::INFINITY; 3],
            max: [f64::NEG_INFINITY; 3],
        };
        for p in points {
            for (axis, value) in p.iter().enumerate() {
                bounds.min[axis] = bounds.min[axis].min(*value);
                bounds.max[axis] = bounds.max[axis].max(*value);
            }
        }
        bounds
    }
    fn union(self, other: Self) -> Self {
        Self {
            min: std::array::from_fn(|i| self.min[i].min(other.min[i])),
            max: std::array::from_fn(|i| self.max[i].max(other.max[i])),
        }
    }
    pub fn expand(self, r: f64) -> Self {
        Self {
            min: self.min.map(|v| v - r),
            max: self.max.map(|v| v + r),
        }
    }
    pub fn overlaps(self, other: Self) -> bool {
        (0..3).all(|i| self.min[i] <= other.max[i] && self.max[i] >= other.min[i])
    }
}
pub struct Index {
    nodes: Vec<Node>,
    item_bounds: Arc<[Bounds]>,
}
struct Node {
    bounds: Bounds,
    children: Option<(usize, usize)>,
    items: Vec<usize>,
}
impl Index {
    pub fn new(bounds: &[Bounds]) -> Self {
        Self::with_items(Arc::from(bounds), (0..bounds.len()).collect())
    }

    pub fn select(&self, include: impl FnMut(&usize) -> bool) -> Self {
        Self::with_items(
            self.item_bounds.clone(),
            (0..self.item_bounds.len()).filter(include).collect(),
        )
    }

    fn with_items(bounds: Arc<[Bounds]>, items: Vec<usize>) -> Self {
        let mut result = Self {
            nodes: Vec::new(),
            item_bounds: bounds.clone(),
        };
        if !items.is_empty() {
            result.build(items, &bounds);
        }
        result
    }
    fn build(&mut self, mut items: Vec<usize>, bounds: &[Bounds]) -> usize {
        let envelope = items
            .iter()
            .fold(bounds[items[0]], |a, &i| a.union(bounds[i]));
        let id = self.nodes.len();
        self.nodes.push(Node {
            bounds: envelope,
            children: None,
            items: Vec::new(),
        });
        if items.len() <= 8 {
            self.nodes[id].items = items;
        } else {
            let axis = (0..3)
                .max_by(|&a, &b| {
                    (envelope.max[a] - envelope.min[a])
                        .total_cmp(&(envelope.max[b] - envelope.min[b]))
                })
                .unwrap();
            items.sort_unstable_by(|&a, &b| {
                (bounds[a].min[axis] + bounds[a].max[axis])
                    .total_cmp(&(bounds[b].min[axis] + bounds[b].max[axis]))
            });
            let right = items.split_off(items.len() / 2);
            let a = self.build(items, bounds);
            let b = self.build(right, bounds);
            self.nodes[id].children = Some((a, b));
        }
        id
    }
    pub fn query(&self, bounds: Bounds, visit: impl FnMut(usize) -> bool) -> bool {
        self.query_where(|candidate| candidate.overlaps(bounds), visit)
    }

    /// A rejected bounds test must exclude every item enclosed by those bounds.
    pub fn query_where(
        &self,
        mut intersects: impl FnMut(Bounds) -> bool,
        mut visit: impl FnMut(usize) -> bool,
    ) -> bool {
        !self.nodes.is_empty() && self.visit(0, &mut intersects, &mut visit)
    }

    fn visit(
        &self,
        id: usize,
        intersects: &mut impl FnMut(Bounds) -> bool,
        visit: &mut impl FnMut(usize) -> bool,
    ) -> bool {
        let node = &self.nodes[id];
        if !intersects(node.bounds) {
            return false;
        }
        // Median splits bound recursion depth. Visit right first to preserve
        // the order used by support projection when candidates tie.
        if let Some((a, b)) = node.children {
            self.visit(b, intersects, visit) || self.visit(a, intersects, visit)
        } else {
            node.items
                .iter()
                .any(|&item| intersects(self.item_bounds[item]) && visit(item))
        }
    }
}
pub fn triangle_height(p: Point, t: [Point; 3]) -> Option<f64> {
    let [a, b, c] = t;
    let det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if det.abs() < 1e-12 {
        return None;
    }
    let u = ((b[2] - c[2]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[2] - c[2])) / det;
    let v = ((c[2] - a[2]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[2] - c[2])) / det;
    (u >= -1e-8 && v >= -1e-8 && u + v <= 1. + 1e-8)
        .then_some(u * a[1] + v * b[1] + (1. - u - v) * c[1])
}

pub fn sphere_support(p: Point, triangle: [Point; 3], normal: Point, radius: f64) -> Option<f64> {
    let contact = sub(p, scale(normal, radius));
    if let Some(height) = triangle_height(contact, triangle) {
        return Some(height + radius * (normal[1] - 1.));
    }
    // Outside the face, the highest sphere contact lies on an edge or corner.
    // The contact height along an edge is concave, so clamp its stationary point
    // to the edge and let the endpoints account for the corners.
    let radius_squared = radius * radius;
    (0..3)
        .filter_map(|i| {
            let a = triangle[i];
            let [dx, dy, dz] = sub(triangle[(i + 1) % 3], a);
            let [x, _, z] = sub(p, a);
            let length_squared = dx * dx + dz * dz;
            let projection = (x * dx + z * dz) / length_squared;
            let distance_squared = (x - projection * dx).powi(2) + (z - projection * dz).powi(2);
            let reach_squared = radius_squared - distance_squared;
            if reach_squared < 0. {
                return None;
            }
            let fraction = (projection
                + dy * (reach_squared / (length_squared * (length_squared + dy * dy))).sqrt())
            .clamp(0., 1.);
            let distance_squared = (x - fraction * dx).powi(2) + (z - fraction * dz).powi(2);
            (distance_squared <= radius_squared)
                .then(|| a[1] + fraction * dy + (radius_squared - distance_squared).sqrt() - radius)
        })
        .max_by(f64::total_cmp)
}

pub type Interval = [f64; 2];
const SPAN: Interval = [0., 1.];
const EMPTY: Interval = [1., 0.];

fn clip_positive(interval: &mut Interval, first: f64, last: f64) {
    if first < 0. && last < 0. {
        *interval = EMPTY;
    } else if first < 0. {
        interval[0] = interval[0].max(first / (first - last));
    } else if last < 0. {
        interval[1] = interval[1].min(first / (first - last));
    }
}

fn face_interval([a, b]: [Point; 2], triangle: [Point; 3]) -> Interval {
    let winding = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]))[1];
    let mut interval = SPAN;
    for i in 0..3 {
        let p = triangle[i];
        let edge = sub(triangle[(i + 1) % 3], p);
        let side = |point| cross(edge, sub(point, p))[1] / winding + 1e-9;
        clip_positive(&mut interval, side(a), side(b));
    }
    interval
}

pub fn face_support_interval(
    path: [Point; 2],
    triangle: [Point; 3],
    normal: Point,
    radius: f64,
    clearance: f64,
) -> Interval {
    let [first, last] = path.map(|point| {
        let center = add(point, [0., radius, 0.]);
        dot(sub(center, triangle[0]), normal) - radius
    });
    // The signed normal gap is the vertical feet gap scaled by normal.y.
    // At the supported height, the sphere touches the face at this tangent XZ.
    let upper = clearance * normal[1];
    if (first < 0. && last < 0.) || (first > upper && last > upper) {
        return EMPTY;
    }
    let tangent = path.map(|point| sub(point, scale(normal, radius)));
    let mut interval = face_interval(tangent, triangle);
    clip_positive(&mut interval, first, last);
    clip_positive(&mut interval, upper - first, upper - last);
    interval
}

fn ball_interval(offset: Point, velocity: Point, radius: f64) -> Interval {
    let speed_squared = dot(velocity, velocity);
    let along = dot(offset, velocity);
    let separation = dot(offset, offset) - radius * radius;
    if speed_squared == 0. {
        return if separation <= 0. { SPAN } else { EMPTY };
    }
    let discriminant = along * along - speed_squared * separation;
    if discriminant < 0. {
        return EMPTY;
    }
    let root = discriminant.sqrt();
    [
        ((-along - root) / speed_squared).max(0.),
        ((-along + root) / speed_squared).min(1.),
    ]
}

// A finite edge's radius neighbourhood is a cylinder and two end balls.
fn edge_intervals(path: [Point; 2], edge: [Point; 2], radius: f64) -> [Interval; 3] {
    let [a, b] = path;
    let [p, q] = edge;
    let velocity = sub(b, a);
    let direction = sub(q, p);
    let offset = sub(a, p);
    let squared = dot(direction, direction);
    let mut cylinder = EMPTY;
    if squared > 0. {
        let start = dot(offset, direction) / squared;
        let change = dot(velocity, direction) / squared;
        cylinder = ball_interval(
            sub(offset, scale(direction, start)),
            sub(velocity, scale(direction, change)),
            radius,
        );
        clip_positive(&mut cylinder, start, start + change);
        clip_positive(&mut cylinder, 1. - start, 1. - start - change);
    }
    [
        cylinder,
        ball_interval(offset, velocity, radius),
        ball_interval(sub(a, q), velocity, radius),
    ]
}

pub fn support_intervals(
    path: [Point; 2],
    triangle: [Point; 3],
    normal: Point,
    radius: f64,
    tolerance: f64,
    intervals: &mut Vec<Interval>,
) {
    let edge = |i| [triangle[i], triangle[(i + 1) % 3]];
    let flat = |[x, _, z]: Point| [x, 0., z];
    let centers = path.map(|p| add(p, [0., radius, 0.]));
    let distances = centers.map(|p| dot(sub(p, triangle[0]), normal));
    let [first, last] = distances;
    let projected = std::array::from_fn(|i| sub(centers[i], scale(normal, distances[i])));
    let mut plane = face_interval(projected, triangle);
    clip_positive(&mut plane, first, last);
    let reach = radius + tolerance;
    clip_positive(&mut plane, reach - first, reach - last);
    let projected_path = face_interval(path, triangle);
    if projected_path == SPAN && plane == SPAN {
        intervals.push(SPAN);
        return;
    }

    // Height tolerance applies to contact, while horizontal reach stays at the
    // physical radius. Intersect the intervals so tolerance cannot bridge a gap.
    let footprint = std::iter::once(projected_path)
        .chain((0..3).flat_map(|i| edge_intervals(path.map(flat), edge(i).map(flat), radius)));
    let mut contact = [EMPTY; 10];
    contact[0] = plane;
    for i in 0..3 {
        contact[1 + i * 3..4 + i * 3].copy_from_slice(&edge_intervals(centers, edge(i), reach));
    }
    for [near, far] in footprint.filter(|interval| interval[0] <= interval[1]) {
        for [start, end] in contact {
            let overlap = [near.max(start), far.min(end)];
            if overlap[0] <= overlap[1] {
                intervals.push(overlap);
            }
        }
    }
}

pub fn point_segment(p: Point, a: Point, b: Point) -> f64 {
    let d = sub(b, a);
    let den = dot(d, d);
    distance(
        p,
        lerp(
            a,
            b,
            if den > 0. {
                (dot(sub(p, a), d) / den).clamp(0., 1.)
            } else {
                0.
            },
        ),
    )
}
fn segments_within(a: Point, b: Point, c: Point, d: Point, limit: f64) -> bool {
    if point_segment(a, c, d) < limit
        || point_segment(b, c, d) < limit
        || point_segment(c, a, b) < limit
        || point_segment(d, a, b) < limit
    {
        return true;
    }
    let u = sub(b, a);
    let v = sub(d, c);
    let w = sub(a, c);
    let aa = dot(u, u);
    let bb = dot(u, v);
    let cc = dot(v, v);
    let dd = dot(u, w);
    let ee = dot(v, w);
    let den = aa * cc - bb * bb;
    if den > 1e-20 {
        let s = (bb * ee - cc * dd) / den;
        let t = (aa * ee - bb * dd) / den;
        if (0. ..=1.).contains(&s) && (0. ..=1.).contains(&t) {
            return distance(lerp(a, b, s), lerp(c, d, t)) < limit;
        }
    }
    false
}
pub fn point_triangle(p: Point, t: [Point; 3]) -> f64 {
    let [a, b, c] = t;
    let n = cross(sub(b, a), sub(c, a));
    let nn = dot(n, n);
    let mut result = point_segment(p, a, b)
        .min(point_segment(p, b, c))
        .min(point_segment(p, c, a));
    if nn > 1e-20 {
        let q = sub(p, scale(n, dot(sub(p, a), n) / nn));
        let signs = [
            dot(cross(sub(b, a), sub(q, a)), n),
            dot(cross(sub(c, b), sub(q, b)), n),
            dot(cross(sub(a, c), sub(q, c)), n),
        ];
        if signs.iter().all(|v| *v >= -1e-12) {
            result = result.min(distance(p, q));
        }
    }
    result
}
fn pierces_triangle(a: Point, b: Point, t: [Point; 3]) -> bool {
    let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    let den = dot(sub(b, a), n);
    if den.abs() > 1e-15 {
        let f = dot(sub(t[0], a), n) / den;
        return (0. ..=1.).contains(&f) && point_triangle(lerp(a, b, f), t) < 1e-9;
    }
    false
}
pub fn triangles_within(a: [Point; 3], b: [Point; 3], limit: f64) -> bool {
    if limit <= 0. {
        return false;
    }
    // Each vertex and edge pair contributes to the same minimum from either
    // direction. Evaluate it once and stop as soon as the body is obstructed.
    for i in 0..3 {
        if pierces_triangle(a[i], a[(i + 1) % 3], b)
            || pierces_triangle(b[i], b[(i + 1) % 3], a)
            || point_triangle(a[i], b) < limit
            || point_triangle(b[i], a) < limit
        {
            return true;
        }
    }
    (0..3)
        .any(|i| (0..3).any(|j| segments_within(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3], limit)))
}
