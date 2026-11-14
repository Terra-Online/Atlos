//! Continuous support for a finite-radius foot. The horizontal footprint is
//! exact; vertical tolerance only broadens the contact envelope. Actual feet
//! and collision remain the walking proof's responsibility.
use crate::geometry::{cross, dot, hypot, sub};
use crate::model::Vec3;

#[derive(Clone, Copy)]
struct Range(f64, f64);
impl Range {
    fn clip(&mut self, first: f64, last: f64) {
        if first < 0. && last < 0. {
            self.1 = -1.;
        } else if first < 0. {
            self.0 = self.0.max(first / (first - last));
        } else if last < 0. {
            self.1 = self.1.min(first / (first - last));
        }
    }
    fn intersect(self, other: Self) -> Self {
        Self(self.0.max(other.0), self.1.min(other.1))
    }
    fn valid(self) -> bool {
        self.0 <= self.1
    }
}
fn ball(offset: Vec3, velocity: Vec3, radius: f64) -> Range {
    let a = dot(velocity, velocity);
    let b = dot(offset, velocity);
    let c = dot(offset, offset) - radius * radius;
    if a == 0. {
        return if c <= 0. {
            Range(0., 1.)
        } else {
            Range(1., 0.)
        };
    }
    let discriminant = b * b - a * c;
    if discriminant < 0. {
        return Range(1., 0.);
    }
    let root = discriminant.sqrt();
    Range(0., 1.).intersect(Range((-b - root) / a, (-b + root) / a))
}
fn tube(a: Vec3, b: Vec3, p: Vec3, q: Vec3, radius: f64) -> [Range; 3] {
    let direction = sub(q, p);
    let velocity = sub(b, a);
    let offset = sub(a, p);
    let squared = dot(direction, direction);
    let mut ranges = [
        ball(offset, velocity, radius),
        ball(sub(a, q), velocity, radius),
        Range(1., 0.),
    ];
    if squared > 0. {
        let first = dot(offset, direction) / squared;
        let change = dot(velocity, direction) / squared;
        let mut range = ball(
            std::array::from_fn(|i| offset[i] - first * direction[i]),
            std::array::from_fn(|i| velocity[i] - change * direction[i]),
            radius,
        );
        range.clip(first, first + change);
        range.clip(1. - first, 1. - first - change);
        ranges[2] = range;
    }
    ranges
}

pub(super) fn intervals(
    a: Vec3,
    b: Vec3,
    triangle: [Vec3; 3],
    radius: f64,
    tolerance: f64,
    output: &mut Vec<(f64, f64)>,
) {
    let [p, q, r] = triangle;
    let u = sub(q, p);
    let v = sub(r, p);
    let determinant = u[0] * v[2] - u[2] * v[0];
    if determinant.abs() < 1e-12 {
        return;
    }
    let weights = |point: Vec3| {
        let x = point[0] - p[0];
        let z = point[2] - p[2];
        let beta = (x * v[2] - z * v[0]) / determinant;
        let gamma = (u[0] * z - u[2] * x) / determinant;
        [1. - beta - gamma, beta, gamma]
    };
    let face = |first, last| {
        let start = weights(first);
        let end = weights(last);
        let mut range = Range(0., 1.);
        for i in 0..3 {
            range.clip(start[i] + 1e-9, end[i] + 1e-9);
        }
        range
    };
    let normal = cross(u, v);
    let length = hypot(normal);
    let unit = normal.map(|x| x / length);
    let centers = [a, b].map(|p| [p[0], p[1] + radius, p[2]]);
    let distances = centers.map(|point| dot(sub(point, p), unit));
    let projected = [0, 1].map(|j| std::array::from_fn(|i| centers[j][i] - distances[j] * unit[i]));
    let mut plane = face(projected[0], projected[1]);
    plane.clip(distances[0], distances[1]);
    plane.clip(
        radius + tolerance - distances[0],
        radius + tolerance - distances[1],
    );
    // A triangle contributes at most one face interval and three finite tubes.
    // Fixed arrays avoid allocating geometry fragments during each ground proof.
    let mut footprint = [Range(1., 0.); 10];
    let mut contact = footprint;
    footprint[0] = face(a, b);
    contact[0] = plane;
    let flat = |p: Vec3| [p[0], 0., p[2]];
    for i in 0..3 {
        let start = triangle[i];
        let end = triangle[(i + 1) % 3];
        footprint[1 + i * 3..4 + i * 3].copy_from_slice(&tube(
            flat(a),
            flat(b),
            flat(start),
            flat(end),
            radius,
        ));
        contact[1 + i * 3..4 + i * 3].copy_from_slice(&tube(
            centers[0],
            centers[1],
            start,
            end,
            radius + tolerance,
        ));
    }
    // The horizontal rounded triangle is convex, so its line intersection is
    // a single interval. Merge spatial features before emitting coverage; this
    // avoids a Cartesian product of duplicate face/edge/corner intervals.
    let horizontal = footprint
        .into_iter()
        .filter(|r| r.valid())
        .fold(Range(1., 0.), |range, next| {
            Range(range.0.min(next.0), range.1.max(next.1))
        });
    if !horizontal.valid() {
        return;
    }
    contact.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
    let mut merged = Range(1., 0.);
    for range in contact
        .into_iter()
        .map(|r| r.intersect(horizontal))
        .filter(|r| r.valid())
    {
        if !merged.valid() {
            merged = range;
        } else if range.0 <= merged.1 {
            merged.1 = merged.1.max(range.1);
        } else {
            output.push((merged.0, merged.1));
            merged = range;
        }
    }
    if merged.valid() {
        output.push((merged.0, merged.1));
    }
}
