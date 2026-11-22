use crate::{geometry::*, types::*};

pub struct World {
    pub physical: Physical,
    ground: Vec<[Point; 3]>,
    ground_index: Index,
    collision: Vec<[Point; 3]>,
    collision_index: Index,
}
impl World {
    pub fn new(mut physical: Physical) -> Result<Self, String> {
        if physical.locomotion.speed <= 0.
            || physical.ground.options.profile.radius < 0.
            || physical.ground.options.profile.height < 2. * physical.ground.options.profile.radius
        {
            return Err("Invalid movement profile".into());
        }
        let model = &physical.movement.model;
        if model.gravity <= 0.
            || model.falling_gravity <= 0.
            || model.max_falling_speed <= 0.
            || model.max_jump_height < 0.
            || model.apex_time < 0.
            || physical.movement.run_air_speed < 0.
            || model.max_horizontal_speed < 0.
        {
            return Err("Invalid jump model".into());
        }
        let ground: Vec<_> = physical
            .ground
            .surfaces
            .iter()
            .flat_map(|s| {
                (1..s.vertices.len().saturating_sub(1))
                    .map(|i| [s.vertices[0], s.vertices[i], s.vertices[i + 1]])
            })
            .collect();
        let positions = &physical.collision.positions;
        if positions.len() % 3 != 0
            || physical.collision.indices.len() % 3 != 0
            || physical
                .collision
                .indices
                .iter()
                .any(|i| *i >= positions.len() / 3)
        {
            return Err("Invalid collision indices".into());
        }
        let collision: Vec<_> = physical
            .collision
            .indices
            .chunks_exact(3)
            .map(|ids| {
                std::array::from_fn(|i| {
                    [
                        positions[ids[i] * 3],
                        positions[ids[i] * 3 + 1],
                        positions[ids[i] * 3 + 2],
                    ]
                })
            })
            .collect();
        // The spatial index owns decoded triangles; retaining the serialized
        // buffers here would keep a second full collision mesh alive.
        physical.collision.positions = Vec::new();
        physical.collision.indices = Vec::new();
        let ground_index =
            Index::new(&ground.iter().map(|t| Bounds::points(t)).collect::<Vec<_>>());
        let collision_index = Index::new(
            &collision
                .iter()
                .map(|t| Bounds::points(t))
                .collect::<Vec<_>>(),
        );
        Ok(Self {
            physical,
            ground,
            ground_index,
            collision,
            collision_index,
        })
    }
    pub fn project(&self, p: Point, tolerance: f64) -> Option<Point> {
        let mut best = None;
        let mut delta = tolerance + 1e-9;
        self.ground_index.query(
            Bounds {
                min: [p[0] - 1e-8, p[1] - tolerance, p[2] - 1e-8],
                max: [p[0] + 1e-8, p[1] + tolerance, p[2] + 1e-8],
            },
            |i| {
                if let Some(y) = triangle_height(p, self.ground[i]) {
                    let d = (y - p[1]).abs();
                    if d < delta {
                        delta = d;
                        best = Some([p[0], y, p[2]]);
                    }
                }
                false
            },
        );
        // Navigation and collision heights can differ. The complete projection,
        // including standing clearance, must respect the caller's tolerance.
        best.and_then(|point| self.standing(point))
            .filter(|point| (point[1] - p[1]).abs() <= tolerance + 1e-6)
    }
    pub fn standing(&self, p: Point) -> Option<Point> {
        if self.collision.is_empty() {
            return Some(p);
        }
        let mut best = None;
        let mut error = 0.31;
        self.collision_index.query(
            Bounds {
                min: [p[0] - 1e-8, p[1] - 0.31, p[2] - 1e-8],
                max: [p[0] + 1e-8, p[1] + 0.31, p[2] + 1e-8],
            },
            |i| {
                let t = self.collision[i];
                let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
                if n[1] > 0.
                    && (n[0].hypot(n[2]) / n[1]).atan().to_degrees()
                        <= self.physical.movement.max_slope
                {
                    if let Some(y) = triangle_height(p, t) {
                        if (y - p[1]).abs() < error {
                            error = (y - p[1]).abs();
                            best = Some([p[0], y + 0.005, p[2]]);
                        }
                    }
                }
                false
            },
        );
        best
    }
    pub fn blocked(&self, a: Point, b: Point, inflation: f64) -> bool {
        let profile = &self.physical.ground.options.profile;
        let radius = profile.radius + inflation;
        let axis = [
            add(a, [0., profile.radius, 0.]),
            add(a, [0., profile.height - profile.radius, 0.]),
            add(b, [0., profile.height - profile.radius, 0.]),
            add(b, [0., profile.radius, 0.]),
        ];
        let bounds = Bounds::points(&axis).expand(radius);
        let walls = self
            .physical
            .rounded_walls
            .as_ref()
            .unwrap_or(&self.physical.ground.options.walls);
        // Enclosing boxes conservatively cover shaped walls in this first slice.
        if walls.iter().any(|w| {
            w.state != "inactive"
                && Bounds {
                    min: w.min,
                    max: w.max,
                }
                .expand(w.padding)
                .overlaps(bounds)
        }) {
            return true;
        }
        self.collision_index.query(bounds, |i| {
            let t = self.collision[i];
            triangle_distance([axis[0], axis[1], axis[2]], t)
                .min(triangle_distance([axis[0], axis[2], axis[3]], t))
                < radius - 1e-6
        })
    }
    fn supported_chord(&self, a: Point, b: Point) -> bool {
        let mut intervals = Vec::new();
        let (index, triangles) = if self.collision.is_empty() {
            (&self.ground_index, &self.ground)
        } else {
            (&self.collision_index, &self.collision)
        };
        index.query(Bounds::points(&[a, b]).expand(0.02), |i| {
            let t = triangles[i];
            let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
            if n[1].abs() < 1e-10 || (!self.collision.is_empty() && n[1] < 0.) {
                return false;
            }
            let slope = (n[0].hypot(n[2]) / n[1].abs()).atan().to_degrees();
            if slope > self.physical.movement.max_slope {
                return false;
            }
            let mut lo: f64 = 0.;
            let mut hi: f64 = 1.;
            for j in 0..3 {
                let x = t[j];
                let y = t[(j + 1) % 3];
                let side = |p: Point| {
                    ((y[0] - x[0]) * (p[2] - x[2]) - (y[2] - x[2]) * (p[0] - x[0]))
                        * (-n[1]).signum()
                };
                let first = side(a);
                let last = side(b);
                if first < -1e-8 && last < -1e-8 {
                    return false;
                }
                if first < 0. {
                    lo = lo.max(first / (first - last));
                }
                if last < 0. {
                    hi = hi.min(first / (first - last));
                }
            }
            if lo <= hi {
                let height_error = |p: Point| dot(sub(p, t[0]), n).abs() / n[1].abs();
                if height_error(lerp(a, b, lo)) <= 0.02 && height_error(lerp(a, b, hi)) <= 0.02 {
                    intervals.push((lo, hi));
                }
            }
            false
        });
        intervals.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
        let mut end: f64 = 0.;
        for (lo, hi) in intervals {
            if lo > end + 1e-7 {
                return false;
            }
            end = end.max(hi);
        }
        end >= 1. - 1e-7
    }
    pub fn walk(&self, a: Point, b: Point) -> Option<Segment> {
        let distance_xz = horizontal(a, b);
        if distance_xz < 1e-9 && (a[1] - b[1]).abs() > 1e-7 {
            return None;
        }
        let count = (distance_xz / 0.4).ceil().max(1.) as usize;
        let mut points = vec![a];
        let mut times = vec![0.];
        let mut cost = 0.;
        for i in 1..=count {
            let expected = lerp(a, b, i as f64 / count as f64);
            let point = if i == count {
                b
            } else {
                self.project(expected, 0.5)?
            };
            let previous = *points.last().unwrap();
            if !self.supported_chord(previous, point) || self.blocked(previous, point, 0.) {
                return None;
            }
            cost += distance(previous, point) / self.physical.locomotion.speed;
            points.push(point);
            times.push(cost);
        }
        Some(Segment {
            mode: "walk",
            points,
            times,
            flight: None,
            gait: Some("run"),
        })
    }
    pub fn action(&self, a: Point, b: Point) -> Option<Segment> {
        self.walk(a, b).or_else(|| self.jump(a, b, None))
    }
    pub fn goals(&self, query: &Query) -> Vec<Point> {
        let Some(interaction) = &query.interaction else {
            return self
                .project(query.goal, self.physical.ground.options.max_vertical)
                .into_iter()
                .collect();
        };
        if interaction.airborne {
            return Vec::new();
        }
        let mut result = Vec::new();
        self.ground_index.query(
            Bounds::points(&[query.goal]).expand(interaction.radius),
            |i| {
                let triangle = self.ground[i];
                let mut candidates = triangle.to_vec();
                if let Some(y) = triangle_height(query.goal, triangle) {
                    candidates.push([query.goal[0], y, query.goal[2]]);
                }
                for j in 0..3 {
                    let a = triangle[j];
                    let b = triangle[(j + 1) % 3];
                    let d = sub(b, a);
                    let denominator = dot(d, d);
                    if denominator > 0. {
                        candidates.push(lerp(
                            a,
                            b,
                            (dot(sub(query.goal, a), d) / denominator).clamp(0., 1.),
                        ));
                    }
                }
                if let Some(point) = candidates
                    .into_iter()
                    .filter(|p| crate::flight::hit(*p, *p, query.goal, interaction).is_some())
                    .min_by(|a, b| distance(*a, query.goal).total_cmp(&distance(*b, query.goal)))
                {
                    if let Some(point) = self.standing(point) {
                        if crate::flight::hit(point, point, query.goal, interaction).is_some()
                            && !self.blocked(point, point, 0.)
                        {
                            result.push(point);
                        }
                    }
                }
                false
            },
        );
        result.sort_by(|a, b| distance(*a, query.goal).total_cmp(&distance(*b, query.goal)));
        result.dedup_by(|a, b| distance(*a, *b) < 1e-6);
        result
    }
}
