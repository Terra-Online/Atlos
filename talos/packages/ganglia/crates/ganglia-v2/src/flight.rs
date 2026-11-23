use crate::{geometry::*, types::*, world::World};

pub(super) struct PreparedFlight {
    pub action: Segment,
    requirement: FlightRequirement,
}

impl PreparedFlight {
    pub fn variants<'a>(
        &'a self,
        base: &'a Model,
        boosts: &'a [BoostUse],
    ) -> impl Iterator<Item = Segment> + 'a {
        self.requirement.modifiers(boosts).map(|boost| {
            let mut action = self.action.clone();
            let flight = action.flight.as_mut().unwrap();
            flight.model = self.requirement.model(base, boost);
            action.required_gait = self.requirement.sprints(boost).then_some("sprint");
            action.boost = boost.cloned();
            action
        })
    }
}

struct FlightRequirement {
    speed: f64,
    duration: f64,
    run: f64,
    base_cap: f64,
}

impl FlightRequirement {
    fn modifiers<'a>(
        &'a self,
        boosts: &'a [BoostUse],
    ) -> impl Iterator<Item = Option<&'a BoostUse>> {
        (self.speed <= self.base_cap + 1e-9)
            .then_some(None)
            .into_iter()
            .chain(
                boosts
                    .iter()
                    .filter(|usage| {
                        self.duration <= usage.duration + 1e-9
                            && self.speed <= self.base_cap * usage.multiplier + 1e-9
                    })
                    .map(Some),
            )
    }

    fn sprints(&self, boost: Option<&BoostUse>) -> bool {
        self.speed > self.run * boost.map_or(1., |usage| usage.multiplier) + 1e-9
    }

    fn model(&self, base: &Model, boost: Option<&BoostUse>) -> Model {
        let multiplier = boost.map_or(1., |usage| usage.multiplier);
        let mut model = base.clone();
        model.max_horizontal_speed = multiplier
            * if self.sprints(boost) {
                self.base_cap
            } else {
                self.run
            };
        model.start_horizontal_speed = base
            .start_horizontal_speed
            .map(|speed| (speed * multiplier).min(model.max_horizontal_speed));
        model
    }
}

struct Phase {
    y: f64,
    velocity: f64,
    acceleration: f64,
    duration: f64,
}

fn lift_off_speed(model: &Model) -> f64 {
    (2. * model.gravity * model.max_jump_height).sqrt()
}

fn descent_times(model: &Model, fall: f64) -> (f64, f64) {
    let terminal_time = model.max_falling_speed / model.falling_gravity;
    let terminal_distance = model.max_falling_speed * terminal_time / 2.;
    (
        (2. * fall / model.falling_gravity)
            .sqrt()
            .min(terminal_time),
        (fall - terminal_distance).max(0.) / model.max_falling_speed,
    )
}

pub fn duration(model: &Model, start_y: f64, end_y: f64) -> Option<f64> {
    let fall = start_y + model.max_jump_height - end_y;
    if fall < 0. || model.max_jump_height <= 0. {
        return None;
    }
    let (descent, coast) = descent_times(model, fall);
    Some(lift_off_speed(model) / model.gravity + model.apex_time + descent + coast)
}

pub(super) fn drop_duration(model: &Model, start_y: f64, end_y: f64) -> Option<f64> {
    if end_y >= start_y - 1e-6 {
        return None;
    }
    let (descent, coast) = descent_times(model, start_y - end_y);
    Some(descent + coast)
}

fn collection_targets(start: Point, goal: Point, y: f64, interaction: &Interaction) -> Vec<Point> {
    let center = [goal[0], y, goal[2]];
    let radius = (interaction.radius.powi(2) - (y - goal[1]).powi(2))
        .max(0.)
        .sqrt();
    let length = horizontal(start, center);
    let mut targets = Vec::new();
    if length > 0. && radius > 0. {
        let towards_start = [start[0], y, start[2]];
        targets.push(lerp(
            center,
            towards_start,
            (0.99 * radius / length).min(1.),
        ));
    }
    targets.push(center);
    if let (Some(facing), Some(angle)) = (interaction.facing, interaction.half_angle) {
        let length = facing[0].hypot(facing[2]);
        if radius > 0. && length > 0. {
            for turn in [0., angle * 0.8, -angle * 0.8] {
                let (sin, cos) = turn.to_radians().sin_cos();
                let x = facing[0] * cos - facing[2] * sin;
                let z = facing[0] * sin + facing[2] * cos;
                targets.push(add(center, scale([x, 0., z], 0.7 * radius / length)));
            }
        }
    }
    targets
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
        let forward_x = facing[0] / length;
        let forward_z = facing[2] / length;
        let (sin, cos) = angle.to_radians().sin_cos();
        let cos = if angle == 90. { 0. } else { cos };
        for sign in [-1., 1.] {
            let plane = |p: Point| {
                let x = p[0] - goal[0];
                let z = p[2] - goal[2];
                (x * forward_x + z * forward_z) * sin + sign * (x * forward_z - z * forward_x) * cos
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
    let fraction = fraction.min(far);
    Some((fraction, lerp(a, b, fraction)))
}
impl World {
    pub fn collect(&self, start: Point, goal: Point, interaction: &Interaction) -> Option<Segment> {
        let mut model = self.physical.movement.model.clone();
        model.max_horizontal_speed = model
            .max_horizontal_speed
            .min(self.physical.movement.run_air_speed);
        model.start_horizontal_speed = model
            .start_horizontal_speed
            .map(|speed| speed.min(model.max_horizontal_speed));
        self.collect_drop(start, goal, interaction, model.clone())
            .or_else(|| self.collect_with_model(start, goal, interaction, model))
    }

    /// An authored target may lie just beyond ordinary run-air reach.
    /// Preserve the higher cap only when whole-route replay proves the approach.
    pub(super) fn collect_sprinting(
        &self,
        start: Point,
        goal: Point,
        interaction: &Interaction,
    ) -> Option<Segment> {
        let model = &self.physical.movement.model;
        let run = self.physical.movement.run_air_speed;
        if model.max_horizontal_speed <= run + 1e-9 {
            return None;
        }
        let mut action = self
            .collect_drop(start, goal, interaction, model.clone())
            .or_else(|| self.collect_with_model(start, goal, interaction, model.clone()))?;
        if horizontal(start, action.end()) <= run * action.cost() + 1e-9 {
            return None;
        }
        action.required_gait = Some("sprint");
        Some(action)
    }

    fn collect_drop(
        &self,
        start: Point,
        goal: Point,
        interaction: &Interaction,
        model: Model,
    ) -> Option<Segment> {
        let half_height = interaction
            .radius
            .min(interaction.max_vertical.unwrap_or(f64::INFINITY));
        let lower = goal[1] - half_height;
        let upper = (start[1] - 1e-6).min(goal[1] + half_height);
        if lower > upper || hit(start, start, goal, interaction).is_some() {
            return None;
        }
        for y in [upper, goal[1].clamp(lower, upper), lower] {
            let (fall, coast) = descent_times(&model, start[1] - y);
            let duration = fall + coast;
            if duration <= 0. || duration > 60. {
                continue;
            }
            for target in collection_targets(start, goal, y, interaction) {
                if horizontal(start, target) <= model.max_horizontal_speed * duration + 1e-9 {
                    if let Some(action) = self.flight_mode(
                        start,
                        target,
                        Some((&goal, interaction)),
                        model.clone(),
                        "drop",
                    ) {
                        return Some(action);
                    }
                }
            }
        }
        None
    }

    pub fn collect_with_model(
        &self,
        start: Point,
        goal: Point,
        interaction: &Interaction,
        model: Model,
    ) -> Option<Segment> {
        let peak = start[1] + model.max_jump_height;
        let half_height = interaction
            .radius
            .min(interaction.max_vertical.unwrap_or(f64::INFINITY));
        let lower = goal[1] - half_height;
        let upper = peak.min(goal[1] + half_height);
        if model.max_jump_height <= 0.
            || lower > upper
            || self.blocked(start, start, 0.)
            || hit(start, start, goal, interaction).is_some()
        {
            return None;
        }
        let speed = model.max_horizontal_speed;
        let lift_off = lift_off_speed(&model);
        let apex_end = lift_off / model.gravity + model.apex_time;
        // A sampled point in the goal volume can occur on ascent or descent.
        // Project its horizontal velocity to the end of an authored jump; the
        // sweep finds the first collection hit and checks only the flight prefix.
        let mut witnesses = Vec::new();
        let center = goal[1].min(upper);
        let span = upper - lower;
        let heights = [
            center,
            upper,
            lower,
            lower + span * 0.25,
            lower + span * 0.5,
            lower + span * 0.75,
        ];
        for (index, &y) in heights.iter().enumerate() {
            if heights[..index].contains(&y) {
                continue;
            }
            let fall = peak - y;
            let rise = y - start[1];
            let ascent = 2. * rise / (lift_off + (2. * model.gravity * fall).sqrt());
            let (fall_time, coast_time) = descent_times(&model, fall);
            let descent = apex_end + fall_time + coast_time;
            for target in collection_targets(start, goal, y, interaction) {
                for (time, duration, end_y) in [(ascent, apex_end, peak), (descent, descent, y)] {
                    if time <= 0. || duration > 60. {
                        continue;
                    }
                    let dx = target[0] - start[0];
                    let dz = target[2] - start[2];
                    let distance = dx.hypot(dz);
                    let reachable = (1. - 1e-12) * speed * time;
                    let fraction = if distance > reachable {
                        reachable / distance
                    } else {
                        1.
                    };
                    let point = [start[0] + dx * fraction, y, start[2] + dz * fraction];
                    if hit(point, point, goal, interaction).is_some() {
                        let scale = fraction * (duration / time);
                        let end = [start[0] + dx * scale, end_y, start[2] + dz * scale];
                        witnesses.push((time, end));
                    }
                }
            }
        }
        witnesses.sort_by(|a, b| a.0.total_cmp(&b.0));
        witnesses.dedup_by(|a, b| a.1 == b.1);
        witnesses
            .into_iter()
            .find_map(|(_, end)| self.flight(start, end, Some((&goal, interaction)), model.clone()))
    }

    /// Prove one trace per motion. The source modifiers share its points and
    /// times, and are materialized only for reachable edges during search.
    pub fn conditional_flights(
        &self,
        start: Point,
        end: Point,
        boosts: &[BoostUse],
    ) -> [Option<PreparedFlight>; 2] {
        let base = &self.physical.movement.model;
        let run = base
            .max_horizontal_speed
            .min(self.physical.movement.run_air_speed);
        let span = horizontal(start, end);
        ["jump", "drop"].map(|mode| {
            let duration = if mode == "jump" {
                duration(base, start[1], end[1])
            } else {
                drop_duration(base, start[1], end[1])
            }
            .filter(|time| *time > 0. && *time <= 60.)?;
            let speed = span / duration;
            if speed <= run + 1e-9 {
                return None;
            }
            let requirement = FlightRequirement {
                speed,
                duration,
                run,
                base_cap: base.max_horizontal_speed,
            };
            let modifier = requirement.modifiers(boosts).next()?;
            let mut action =
                self.flight_mode(start, end, None, requirement.model(base, modifier), mode)?;
            if mode == "drop" {
                action.connection = self.drop_source(start, end);
            }
            Some(PreparedFlight {
                action,
                requirement,
            })
        })
    }

    pub fn jump(
        &self,
        start: Point,
        end: Point,
        collection: Option<(&Point, &Interaction)>,
    ) -> Option<Segment> {
        let mut model = self.physical.movement.model.clone();
        model.max_horizontal_speed = model
            .max_horizontal_speed
            .min(self.physical.movement.run_air_speed);
        model.start_horizontal_speed = model
            .start_horizontal_speed
            .map(|speed| speed.min(model.max_horizontal_speed));
        self.flight(start, end, collection, model)
    }

    pub fn flight(
        &self,
        start: Point,
        end: Point,
        collection: Option<(&Point, &Interaction)>,
        model: Model,
    ) -> Option<Segment> {
        self.flight_mode(start, end, collection, model, "jump")
    }

    pub fn drop(&self, start: Point, end: Point) -> Option<Segment> {
        if end[1] >= start[1] - 1e-6 {
            return None;
        }
        let supported = self.standing(end)?;
        if distance(supported, end) > 0.025 {
            return None;
        }
        let mut model = self.physical.movement.model.clone();
        model.max_horizontal_speed = model
            .max_horizontal_speed
            .min(self.physical.movement.run_air_speed);
        model.start_horizontal_speed = model
            .start_horizontal_speed
            .map(|speed| speed.min(model.max_horizontal_speed));
        let mut action = self.flight_mode(start, end, None, model, "drop")?;
        // Optimized falls retain source provenance only when both endpoints
        // still satisfy that authored pair's actual interaction volumes.
        action.connection = self.drop_source(start, end);
        Some(action)
    }

    fn flight_mode(
        &self,
        start: Point,
        end: Point,
        collection: Option<(&Point, &Interaction)>,
        model: Model,
        mode: &'static str,
    ) -> Option<Segment> {
        if self.blocked(start, start, 0.) {
            return None;
        }
        let jumping = mode == "jump";
        let peak = start[1] + if jumping { model.max_jump_height } else { 0. };
        if end[1] > peak || (jumping && model.max_jump_height <= 0.) {
            return None;
        }
        let mut phases = Vec::new();
        if jumping {
            let velocity = lift_off_speed(&model);
            phases.push(Phase {
                y: start[1],
                velocity,
                acceleration: -model.gravity,
                duration: velocity / model.gravity,
            });
        }
        if jumping && model.apex_time > 0. {
            phases.push(Phase {
                y: peak,
                velocity: 0.,
                acceleration: 0.,
                duration: model.apex_time,
            });
        }
        let fall = peak - end[1];
        if fall > 0. {
            let (descent, coast) = descent_times(&model, fall);
            phases.push(Phase {
                y: peak,
                velocity: 0.,
                acceleration: -model.falling_gravity,
                duration: descent,
            });
            if coast > 0. {
                phases.push(Phase {
                    y: peak - model.max_falling_speed * descent / 2.,
                    velocity: -model.max_falling_speed,
                    acceleration: 0.,
                    duration: coast,
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
                    if let Some((mut fraction, mut clipped)) =
                        hit(previous, point, *goal, interaction)
                    {
                        // Preserve an inside witness across JSON and different
                        // floating-point summation orders. This sub-micrometre
                        // advance remains on the swept chord and within the
                        // independent first-event tolerance.
                        let advanced =
                            (fraction + 1e-8 / distance(previous, point).max(1e-12)).min(1.);
                        let inside = lerp(previous, point, advanced);
                        if hit(inside, inside, *goal, interaction).is_some() {
                            fraction = advanced;
                            clipped = inside;
                        }
                        if hit(clipped, clipped, *goal, interaction).is_none() {
                            // An interpolated entry can round outside the volume.
                            // Advance slightly on the chord and require an inside witness.
                            (fraction, clipped) = (0..=12)
                                .map(|i| {
                                    let t = (fraction + f64::EPSILON * (1 << i) as f64).min(1.);
                                    (t, lerp(previous, point, t))
                                })
                                .find(|&(t, p)| {
                                    t > fraction && hit(p, p, *goal, interaction).is_some()
                                })?;
                        }
                        point = clipped;
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
            required_gait: None,
            boost: None,
            mode,
            points,
            times,
            connection: None,
            flight: Some(Flight {
                kind: "flight",
                start,
                end,
                model,
                control: Control { mode },
            }),
            gait: None,
            traversal: None,
        })
    }
}
