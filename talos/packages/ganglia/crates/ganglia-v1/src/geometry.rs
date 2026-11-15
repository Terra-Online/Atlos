//! Continuous capsule geometry adapted from the audited Rust prototype.
//! This module owns its implementation and has no prototype or N-API dependency.
use crate::model::*;
type Point = Vec3;
pub(crate) type Triangle = [Vec3; 3];
type Bounds3 = [f64; 6];
type Bounds = Bounds3;
// Rust's f64::min/max discard NaN; JavaScript's Math.min/max propagate it.
// Degenerate or overflowing geometry must therefore reach the same query error.
pub(crate) fn minimum(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else {
            a.min(b)
        }
    })
}

pub(crate) fn maximum(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::NEG_INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else {
            a.max(b)
        }
    })
}

pub(crate) fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub(crate) fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(crate) fn cross(a: Point, b: Point) -> Point {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub(crate) fn mix(a: Point, b: Point, t: f64) -> Point {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

pub(crate) fn squared(a: Point, b: Point) -> f64 {
    let x = a[0] - b[0];
    let y = a[1] - b[1];
    let z = a[2] - b[2];
    x * x + y * y + z * z
}

pub(crate) fn point_segment(p: Point, a: Point, b: Point) -> f64 {
    let d = sub(b, a);
    let length = dot(d, d);
    let t = if length != 0.0 && !length.is_nan() {
        maximum(&[0.0, minimum(&[1.0, dot(sub(p, a), d) / length])])
    } else {
        0.0
    };
    squared(p, mix(a, b, t))
}

pub(crate) fn segment_segment(a: Point, b: Point, c: Point, d: Point) -> f64 {
    let u = sub(b, a);
    let v = sub(d, c);
    let w = sub(a, c);
    let uu = dot(u, u);
    let vv = dot(v, v);
    let uw = dot(u, w);
    let vw = dot(v, w);
    let uv = dot(u, v);
    let (s, t) = if uu == 0. && vv == 0. {
        (0., 0.)
    } else if uu == 0. {
        (0., (vw / vv).clamp(0., 1.))
    } else if vv == 0. {
        ((-uw / uu).clamp(0., 1.), 0.)
    } else {
        let normal = cross(u, v);
        let denominator = dot(normal, normal);
        let mut s = if denominator > 0. {
            (dot(cross(sub(c, a), v), normal) / denominator).clamp(0., 1.)
        } else {
            0.
        };
        let mut t = (uv * s + vw) / vv;
        if t < 0. {
            t = 0.;
            s = (-uw / uu).clamp(0., 1.);
        } else if t > 1. {
            t = 1.;
            s = ((uv - uw) / uu).clamp(0., 1.);
        }
        (s, t)
    };
    squared(mix(a, b, s), mix(c, d, t))
}

pub(crate) fn inside(p: Point, triangle: Triangle, n: Point) -> bool {
    for i in 0..3 {
        let a = triangle[i];
        let side = dot(cross(sub(triangle[(i + 1) % 3], a), sub(p, a)), n);
        if side.is_nan() || side < 0.0 {
            return false;
        }
    }
    true
}

pub(crate) fn point_triangle(p: Point, triangle: Triangle, n: Point) -> f64 {
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

pub(crate) fn segment_triangle(a: Point, b: Point, triangle: Triangle) -> f64 {
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

pub(crate) fn triangle_triangle(a: Triangle, b: Triangle) -> f64 {
    minimum(&[
        segment_triangle(a[0], a[1], b),
        segment_triangle(a[1], a[2], b),
        segment_triangle(a[2], a[0], b),
        segment_triangle(b[0], b[1], a),
        segment_triangle(b[1], b[2], a),
        segment_triangle(b[2], b[0], a),
    ])
}

pub(crate) fn overlaps(a: Bounds, b: Bounds) -> bool {
    a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2]
}

// Preserve V8 Math.hypot's scaled, compensated three-component sum, including
// its tie rounding: the selected support normal participates in later geometry.
pub(crate) fn hypot(n: Point) -> f64 {
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

pub(crate) fn sphere_support(position: Point, face: Triangle, normal: Point, radius: f64) -> f64 {
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

#[derive(Clone, Debug)]
struct Node {
    bounds: Bounds3,
    left: Option<(usize, usize)>,
    faces: Vec<usize>,
}
#[derive(Clone, Debug)]
pub(crate) struct Index {
    pub faces: Vec<Triangle>,
    normals: Vec<Vec3>,
    nodes: Vec<Node>,
    pub scope: Option<crate::model::Bounds>,
}
#[derive(Clone, Debug)]
pub struct Hit {
    pub triangle: usize,
    pub distance: f64,
}
#[derive(Clone, Debug)]
pub struct GroundHit {
    pub position: Vec3,
    pub triangle: usize,
    pub normal: Vec3,
}
fn bounds(face: &Triangle) -> Bounds3 {
    std::array::from_fn(|i| {
        if i < 3 {
            face.iter().map(|p| p[i]).fold(f64::INFINITY, f64::min)
        } else {
            face.iter()
                .map(|p| p[i - 3])
                .fold(f64::NEG_INFINITY, f64::max)
        }
    })
}
impl Index {
    pub fn new(
        geometry: &CollisionGeometry,
        scope: Option<crate::model::Bounds>,
    ) -> Result<Self, String> {
        if !geometry.positions.len().is_multiple_of(3)
            || !geometry.indices.len().is_multiple_of(3)
            || geometry.positions.iter().any(|v| !v.is_finite())
            || geometry
                .indices
                .iter()
                .any(|&v| v >= geometry.positions.len() / 3)
        {
            return Err("Invalid collision geometry".into());
        }
        let faces = geometry
            .indices
            .as_chunks::<3>()
            .0
            .iter()
            .map(|ids| {
                std::array::from_fn(|i| std::array::from_fn(|a| geometry.positions[ids[i] * 3 + a]))
            })
            .collect();
        Self::from_faces(faces, scope)
    }
    pub fn from_faces(
        faces: Vec<Triangle>,
        scope: Option<crate::model::Bounds>,
    ) -> Result<Self, String> {
        if let Some(b) = &scope
            && (0..2).any(|i| !b.min[i].is_finite() || !b.max[i].is_finite() || b.min[i] > b.max[i])
        {
            return Err("Invalid coverage bounds".into());
        }
        let normals = faces
            .iter()
            .map(|face| {
                let normal = cross(sub(face[1], face[0]), sub(face[2], face[0]));
                let length = hypot(normal);
                if length == 0. {
                    [0.; 3]
                } else {
                    normal.map(|v| v / length)
                }
            })
            .collect();
        let mut index = Self {
            faces,
            normals,
            nodes: vec![],
            scope,
        };
        if !index.faces.is_empty() {
            index.build((0..index.faces.len()).collect())?;
        }
        Ok(index)
    }
    fn build(&mut self, mut ids: Vec<usize>) -> Result<usize, String> {
        crate::cancel::check()?;
        let mut b = [
            f64::INFINITY,
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for (offset, &id) in ids.iter().enumerate() {
            if offset % 1024 == 0 {
                crate::cancel::check()?;
            }
            let f = bounds(&self.faces[id]);
            for a in 0..3 {
                b[a] = b[a].min(f[a]);
                b[a + 3] = b[a + 3].max(f[a + 3]);
            }
        }
        let slot = self.nodes.len();
        self.nodes.push(Node {
            bounds: b,
            left: None,
            faces: vec![],
        });
        if ids.len() <= 8 {
            self.nodes[slot].faces = ids;
        } else {
            let axis = (0..3)
                .max_by(|&a, &c| (b[a + 3] - b[a]).total_cmp(&(b[c + 3] - b[c])))
                .unwrap();
            let middle = ids.len() / 2;
            ids.select_nth_unstable_by(middle, |&a, &c| {
                let a = bounds(&self.faces[a]);
                let c = bounds(&self.faces[c]);
                (a[axis] + a[axis + 3]).total_cmp(&(c[axis] + c[axis + 3]))
            });
            let right = ids.split_off(ids.len() / 2);
            let l = self.build(ids)?;
            let r = self.build(right)?;
            self.nodes[slot].left = Some((l, r));
        }
        Ok(slot)
    }
    pub fn normal(&self, triangle: usize) -> Vec3 {
        self.normals[triangle]
    }
    pub fn candidates(&self, b: Bounds3) -> Vec<usize> {
        let mut result = self.unordered_candidates(b);
        result.sort_unstable();
        result
    }
    // Predicate queries need every candidate, but do not need triangle-ID order.
    pub fn unordered_candidates(&self, b: Bounds3) -> Vec<usize> {
        let mut result = vec![];
        let mut stack = if self.nodes.is_empty() {
            vec![]
        } else {
            vec![0]
        };
        while let Some(i) = stack.pop() {
            let n = &self.nodes[i];
            if !overlaps(b, n.bounds) {
                continue;
            }
            if let Some((l, r)) = n.left {
                stack.extend([l, r]);
            } else {
                result.extend(
                    n.faces
                        .iter()
                        .copied()
                        .filter(|&id| overlaps(b, bounds(&self.faces[id]))),
                );
            }
        }
        result
    }
    pub fn require_scope(&self, b: Bounds3) -> Result<(), String> {
        if b.iter().any(|v| !v.is_finite()) {
            return Err("Non-finite collision bounds".into());
        }
        if let Some(s) = &self.scope
            && (b[0] < s.min[0] || b[2] < s.min[1] || b[3] > s.max[0] || b[5] > s.max[1])
        {
            return Err("Collision query exceeds indexed XZ bounds".into());
        }
        Ok(())
    }
    pub fn sweep(
        &self,
        start: Vec3,
        end: Vec3,
        p: Profile,
        inflation: f64,
    ) -> Result<Option<Hit>, String> {
        if start.iter().chain(end.iter()).any(|v| !v.is_finite())
            || !p.radius.is_finite()
            || p.radius < 0.
            || !p.height.is_finite()
            || p.height <= 0.
            || p.height < 2. * p.radius
            || !inflation.is_finite()
            || inflation < 0.
        {
            return Err("Invalid capsule sweep".into());
        }
        let r = p.radius + inflation;
        let b = [
            start[0].min(end[0]) - r,
            start[1].min(end[1]) - inflation,
            start[2].min(end[2]) - r,
            start[0].max(end[0]) + r,
            start[1].max(end[1]) + p.height + inflation,
            start[2].max(end[2]) + r,
        ];
        self.require_scope(b)?;
        let a = [start[0], start[1] + p.radius, start[2]];
        let b = [start[0], start[1] + p.height - p.radius, start[2]];
        let c = [end[0], end[1] + p.radius, end[2]];
        let d = [end[0], end[1] + p.height - p.radius, end[2]];
        let query = [
            start[0].min(end[0]) - r,
            start[1].min(end[1]) - inflation,
            start[2].min(end[2]) - r,
            start[0].max(end[0]) + r,
            start[1].max(end[1]) + p.height + inflation,
            start[2].max(end[2]) + r,
        ];
        let coordinate_scale = start
            .iter()
            .chain(end.iter())
            .map(|v| v.abs())
            .fold(p.height + r + 1., f64::max);
        for id in self.unordered_candidates(query) {
            let face = self.faces[id];
            // A separating plane also separates the finite triangle. Most
            // walking candidates are supporting floors below the capsule;
            // exclude them before the much costlier edge-distance tests.
            let normal = self.normal(id);
            let first = dot(sub(a, face[0]), normal);
            let last = dot(sub(c, face[0]), normal);
            let vertical = (p.height - 2. * p.radius) * normal[1];
            let near = first.min(last) + vertical.min(0.);
            let far = first.max(last) + vertical.max(0.);
            let scale = face
                .iter()
                .flatten()
                .map(|v| v.abs())
                .fold(coordinate_scale, f64::max);
            let separation = r + 64. * f64::EPSILON * scale;
            if first.is_finite()
                && last.is_finite()
                && vertical.is_finite()
                && (near > separation || far < -separation)
            {
                continue;
            }
            let distance =
                triangle_triangle([a, b, d], face).min(triangle_triangle([a, d, c], face));
            if !distance.is_finite() {
                return Err("Non-finite collision distance".into());
            }
            if distance <= r * r {
                return Ok(Some(Hit {
                    triangle: id,
                    distance: distance.sqrt(),
                }));
            }
        }
        Ok(None)
    }
    pub fn ground(
        &self,
        p: Vec3,
        up: f64,
        down: f64,
        slope: f64,
        radius: f64,
    ) -> Result<Option<GroundHit>, String> {
        if p.iter().any(|v| !v.is_finite())
            || [up, down, slope, radius].iter().any(|v| !v.is_finite())
            || up < 0.
            || down < 0.
            || radius < 0.
            || slope <= 0.
            || slope >= 90.
        {
            return Err("Invalid ground query".into());
        }
        let b = [
            p[0] - radius,
            p[1] - down - radius,
            p[2] - radius,
            p[0] + radius,
            p[1] + up + radius,
            p[2] + radius,
        ];
        self.require_scope(b)?;
        let mut best: Option<GroundHit> = None;
        for id in self.candidates(b) {
            let f = self.faces[id];
            let normal = self.normals[id];
            if normal[1] < slope.to_radians().cos() {
                continue;
            }
            let y = if radius > 0. {
                sphere_support(p, f, normal, radius)
            } else {
                let x = p[0] - f[0][0];
                let z = p[2] - f[0][2];
                let ab = sub(f[1], f[0]);
                let ac = sub(f[2], f[0]);
                let n = cross(ab, ac);
                let u = (x * ac[2] - z * ac[0]) / -n[1];
                let v = (ab[0] * z - ab[2] * x) / -n[1];
                if u < -1e-10 || v < -1e-10 || u + v > 1. + 1e-10 {
                    continue;
                }
                f[0][1] + u * ab[1] + v * ac[1]
            };
            if !y.is_finite() || y < p[1] - down || y > p[1] + up {
                continue;
            }
            let better = best.as_ref().is_none_or(|q| {
                if radius > 0. {
                    y > q.position[1]
                } else {
                    (y - p[1]).abs() < (q.position[1] - p[1]).abs()
                        || ((y - p[1]).abs() == (q.position[1] - p[1]).abs() && y > q.position[1])
                }
            });
            if better {
                best = Some(GroundHit {
                    position: [p[0], y, p[2]],
                    triangle: id,
                    normal,
                });
            }
        }
        Ok(best)
    }
}

pub(crate) fn distance(a: Vec3, b: Vec3) -> f64 {
    squared(a, b).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_projection_agrees_with_endpoint_and_interior_minima() {
        fn reference(a: Point, b: Point, c: Point, d: Point) -> f64 {
            let mut best = point_segment(a, c, d)
                .min(point_segment(b, c, d))
                .min(point_segment(c, a, b))
                .min(point_segment(d, a, b));
            let u = sub(b, a);
            let v = sub(d, c);
            let w = sub(c, a);
            let n = cross(u, v);
            let denominator = dot(n, n);
            if denominator > 0. {
                let s = dot(cross(w, v), n) / denominator;
                let t = dot(cross(w, u), n) / denominator;
                if (0. ..=1.).contains(&s) && (0. ..=1.).contains(&t) {
                    best = best.min(squared(mix(a, b, s), mix(c, d, t)));
                }
            }
            best
        }
        let mut seed = 97u64;
        let mut random = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            (seed >> 32) as f64 / u32::MAX as f64 * 20. - 10.
        };
        for case in 0..400 {
            let a = [random(), random(), random()];
            let b = if case % 11 == 0 {
                a
            } else {
                [random(), random(), random()]
            };
            let c = [random(), random(), random()];
            let d = match case % 13 {
                0 => c,
                1 => std::array::from_fn(|i| c[i] + b[i] - a[i]),
                2 => std::array::from_fn(|i| c[i] + b[i] - a[i] + if i == 1 { 1e-10 } else { 0. }),
                _ => [random(), random(), random()],
            };
            let expected = reference(a, b, c, d);
            let actual = segment_segment(a, b, c, d);
            assert!(
                (actual - expected).abs() <= 1e-9 * (1. + expected),
                "case {case}: {actual} vs {expected}"
            );
        }
    }

    #[test]
    fn capsule_plane_rejection_preserves_unculled_contacts() {
        let profile = Profile {
            radius: 0.35,
            height: 1.8,
        };
        let mut seed = 73u64;
        let mut random = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            (seed >> 32) as f64 / u32::MAX as f64 * 4. - 2.
        };
        for case in 0..160 {
            let origin = if case % 7 == 0 { 1e9 } else { 0. };
            let face = if case < 8 {
                let mut floor = [[-3., 0., -3.], [3., 0., -3.], [0., 0., 3.]];
                if case % 2 == 1 {
                    floor.reverse();
                }
                floor
            } else {
                std::array::from_fn(|_| [random(), random(), random()])
            }
            .map(|p| p.map(|v| v + origin));
            let start = if case < 8 {
                [origin, origin + [-1e-8, 0., 1e-8, 0.005][case / 2], origin]
            } else {
                [random(), random(), random()].map(|v| v + origin)
            };
            let end = if case < 8 {
                [start[0] + 0.5, start[1], start[2]]
            } else {
                [random(), random(), random()].map(|v| v + origin)
            };
            let a = [start[0], start[1] + profile.radius, start[2]];
            let b = [
                start[0],
                start[1] + profile.height - profile.radius,
                start[2],
            ];
            let c = [end[0], end[1] + profile.radius, end[2]];
            let d = [end[0], end[1] + profile.height - profile.radius, end[2]];
            // The unculled narrow phase is the oracle for the new broad phase.
            let expected =
                triangle_triangle([a, b, d], face).min(triangle_triangle([a, d, c], face));
            let actual = Index::from_faces(vec![face], None)
                .unwrap()
                .sweep(start, end, profile, 0.)
                .unwrap();
            assert_eq!(
                actual.is_some(),
                expected <= profile.radius * profile.radius,
                "case {case}"
            );
            if let Some(hit) = actual {
                assert_eq!(hit.distance, expected.sqrt());
            }
        }
    }
}
