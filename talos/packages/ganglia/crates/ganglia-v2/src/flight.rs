use crate::{geometry::*, types::*, world::World};

struct Phase {
    y: f64,
    velocity: f64,
    acceleration: f64,
    duration: f64,
}
pub fn hit(a: Point, b: Point, goal: Point, interaction: &Interaction) -> Option<(f64, Point)> {
    let mut near: f64 = 0.;
    let mut far: f64 = 1.;
    let mut clip = |first: f64, last: f64| {
        if first < 0. && last < 0. {
            return false;
        }
        if first < 0. {
            near = near.max(first / (first - last));
        }
        if last < 0. {
            far = far.min(first / (first - last));
        }
        near <= far
    };
    if let Some(height) = interaction.max_vertical {
        if !clip(a[1] - goal[1] + height, b[1] - goal[1] + height)
            || !clip(goal[1] + height - a[1], goal[1] + height - b[1])
        {
            return None;
        }
    }
    if let (Some(facing), Some(angle)) = (interaction.facing, interaction.half_angle) {
        let length = facing[0].hypot(facing[2]);
        if length == 0. {
            return None;
        }
        let (sin, cos) = angle.to_radians().sin_cos();
        for sign in [-1., 1.] {
            let plane = |p: Point| {
                let x = p[0] - goal[0];
                let z = p[2] - goal[2];
                ((x * facing[0] + z * facing[2]) * sin
                    + sign * (x * facing[2] - z * facing[0]) * cos)
                    / length
            };
            if !clip(plane(a), plane(b)) {
                return None;
            }
        }
    }
    let d = sub(b, a);
    let offset = sub(a, goal);
    let q = dot(d, d);
    let l = dot(d, offset);
    let c = dot(offset, offset) - interaction.radius * interaction.radius;
    if q == 0. {
        return (c <= 0.).then_some((near, a));
    }
    let discriminant = l * l - q * c;
    if discriminant < 0. {
        return None;
    }
    let root = discriminant.sqrt();
    let fraction = near.max((-l - root) / q);
    if fraction > far.min((-l + root) / q) + 1e-9 {
        return None;
    }
    let fraction = (fraction + 1e-12).min(far);
    Some((fraction, lerp(a, b, fraction)))
}
impl World {
    pub fn jump(
        &self,
        start: Point,
        end: Point,
        collection: Option<(&Point, &Interaction)>,
    ) -> Option<Segment> {
        if self.blocked(start, start, 0.) {
            return None;
        }
        let mut model = self.physical.movement.model.clone();
        model.max_horizontal_speed = model
            .max_horizontal_speed
            .min(self.physical.movement.run_air_speed);
        model.start_horizontal_speed = model.start_horizontal_speed.min(model.max_horizontal_speed);
        let peak = start[1] + model.max_jump_height;
        if end[1] > peak || model.max_jump_height <= 0. {
            return None;
        }
        let velocity = (2. * model.gravity * model.max_jump_height).sqrt();
        let mut phases = vec![Phase {
            y: start[1],
            velocity,
            acceleration: -model.gravity,
            duration: velocity / model.gravity,
        }];
        if model.apex_time > 0. {
            phases.push(Phase {
                y: peak,
                velocity: 0.,
                acceleration: 0.,
                duration: model.apex_time,
            });
        }
        let fall = peak - end[1];
        let terminal_time = model.max_falling_speed / model.falling_gravity;
        let terminal_distance = model.max_falling_speed * terminal_time / 2.;
        if fall > 0. {
            let descent = (2. * fall / model.falling_gravity)
                .sqrt()
                .min(terminal_time);
            phases.push(Phase {
                y: peak,
                velocity: 0.,
                acceleration: -model.falling_gravity,
                duration: descent,
            });
            if fall > terminal_distance {
                phases.push(Phase {
                    y: peak - terminal_distance,
                    velocity: -model.max_falling_speed,
                    acceleration: 0.,
                    duration: (fall - terminal_distance) / model.max_falling_speed,
                });
            }
        }
        let duration: f64 = phases.iter().map(|p| p.duration).sum();
        if duration <= 0.
            || duration > 60.
            || horizontal(start, end) > duration * model.max_horizontal_speed + 1e-9
        {
            return None;
        }
        let mut points = vec![start];
        let mut times = vec![0.];
        let mut elapsed = 0.;
        let mut collected = false;
        struct Sweep<'a> {
            world: &'a World,
            start: Point,
            end: Point,
            duration: f64,
            collection: Option<(&'a Point, &'a Interaction)>,
        }
        impl Sweep<'_> {
            fn advance(
                &self,
                phase: &Phase,
                elapsed: f64,
                from: f64,
                to: f64,
                last: bool,
                points: &mut Vec<Point>,
                times: &mut Vec<f64>,
            ) -> Option<bool> {
                let mut time = elapsed + to;
                let mut point = lerp(self.start, self.end, time / self.duration);
                point[1] = phase.y + phase.velocity * to + phase.acceleration * to * to / 2.;
                if last {
                    point = self.end;
                }
                let previous = *points.last().unwrap();
                let mut hit_goal = false;
                if let Some((goal, interaction)) = self.collection {
                    if let Some((fraction, p)) = hit(previous, point, *goal, interaction) {
                        point = p;
                        let previous_time = *times.last().unwrap();
                        time = previous_time + fraction * (time - previous_time);
                        hit_goal = true;
                    }
                }
                let inflation = phase.acceleration.abs() * (to - from).powi(2) / 8.;
                if self.world.blocked(previous, point, inflation) {
                    if to - from <= 0.025 / 16. {
                        return None;
                    }
                    let middle = (from + to) / 2.;
                    if self.advance(phase, elapsed, from, middle, false, points, times)? {
                        return Some(true);
                    }
                    return self.advance(phase, elapsed, middle, to, last, points, times);
                }
                points.push(point);
                times.push(time);
                Some(hit_goal)
            }
        }
        let sweep = Sweep {
            world: self,
            start,
            end,
            duration,
            collection,
        };
        for (i, phase) in phases.iter().enumerate() {
            let count = (phase.duration / 0.025).ceil() as usize;
            for step in 1..=count {
                collected = sweep.advance(
                    phase,
                    elapsed,
                    phase.duration * (step - 1) as f64 / count as f64,
                    phase.duration * step as f64 / count as f64,
                    i + 1 == phases.len() && step == count,
                    &mut points,
                    &mut times,
                )?;
                if collected {
                    break;
                }
            }
            elapsed += phase.duration;
            if collected {
                break;
            }
        }
        if collection.is_some() && !collected {
            return None;
        }
        Some(Segment {
            mode: "jump",
            points,
            times,
            flight: Some(Flight {
                kind: "flight",
                start,
                end,
                model,
                control: Control { mode: "jump" },
            }),
            gait: None,
        })
    }
}
