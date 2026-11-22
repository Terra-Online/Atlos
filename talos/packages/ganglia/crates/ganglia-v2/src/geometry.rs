use crate::types::Point;

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

#[derive(Clone, Copy)]
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
}
struct Node {
    bounds: Bounds,
    children: Option<(usize, usize)>,
    items: Vec<usize>,
}
impl Index {
    pub fn new(bounds: &[Bounds]) -> Self {
        let mut result = Self { nodes: Vec::new() };
        if !bounds.is_empty() {
            result.build((0..bounds.len()).collect(), bounds);
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
    pub fn query(&self, bounds: Bounds, mut visit: impl FnMut(usize) -> bool) -> bool {
        if self.nodes.is_empty() {
            return false;
        }
        let mut pending = vec![0];
        while let Some(id) = pending.pop() {
            let node = &self.nodes[id];
            if !node.bounds.overlaps(bounds) {
                continue;
            }
            if let Some((a, b)) = node.children {
                pending.push(a);
                pending.push(b);
            } else {
                for &item in &node.items {
                    if visit(item) {
                        return true;
                    }
                }
            }
        }
        false
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
fn point_segment(p: Point, a: Point, b: Point) -> f64 {
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
fn segment_segment(a: Point, b: Point, c: Point, d: Point) -> f64 {
    let u = sub(b, a);
    let v = sub(d, c);
    let w = sub(a, c);
    let aa = dot(u, u);
    let bb = dot(u, v);
    let cc = dot(v, v);
    let dd = dot(u, w);
    let ee = dot(v, w);
    let den = aa * cc - bb * bb;
    let mut result = point_segment(a, c, d)
        .min(point_segment(b, c, d))
        .min(point_segment(c, a, b))
        .min(point_segment(d, a, b));
    if den > 1e-20 {
        let s = (bb * ee - cc * dd) / den;
        let t = (aa * ee - bb * dd) / den;
        if (0. ..=1.).contains(&s) && (0. ..=1.).contains(&t) {
            result = result.min(distance(lerp(a, b, s), lerp(c, d, t)));
        }
    }
    result
}
fn point_triangle(p: Point, t: [Point; 3]) -> f64 {
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
fn segment_triangle(a: Point, b: Point, t: [Point; 3]) -> f64 {
    let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    let den = dot(sub(b, a), n);
    if den.abs() > 1e-15 {
        let f = dot(sub(t[0], a), n) / den;
        if (0. ..=1.).contains(&f) && point_triangle(lerp(a, b, f), t) < 1e-9 {
            return 0.;
        }
    }
    let mut result = point_triangle(a, t).min(point_triangle(b, t));
    for i in 0..3 {
        result = result.min(segment_segment(a, b, t[i], t[(i + 1) % 3]));
    }
    result
}
pub fn triangle_distance(a: [Point; 3], b: [Point; 3]) -> f64 {
    let mut result = f64::INFINITY;
    for i in 0..3 {
        result = result
            .min(segment_triangle(a[i], a[(i + 1) % 3], b))
            .min(segment_triangle(b[i], b[(i + 1) % 3], a));
    }
    result
}
