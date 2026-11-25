use crate::{flight::hit, geometry::*, types::*};
use serde::Serialize;

const EPSILON: f64 = 1e-9;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Controls {
    pub allow_sprint: bool,
    pub allow_dash: bool,
}

#[derive(Clone)]
pub struct State {
    pub energy: f64,
    pub minimum: f64,
    delay: f64,
    sprinting: bool,
    activated: bool,
    velocity: f64,
    direction: Option<Point>,
    cooldown: f64,
    dash_remaining: f64,
    pub dashes: usize,
}

#[derive(Clone)]
pub struct Scheduled {
    pub segments: Vec<Segment>,
    pub controls: Controls,
    pub state: State,
    pub duration: f64,
    pub boosts: Vec<Pickup>,
}

#[derive(Clone, Serialize)]
pub struct Pickup {
    #[serde(flatten)]
    usage: BoostUse,
    position: Point,
    elapsed: f64,
}

struct Boost {
    goal: Mark,
    usage: BoostUse,
}

struct BoostClock<'a> {
    sources: &'a [Boost],
    consumed: Vec<bool>,
    active: Option<(BoostUse, f64)>,
    pickups: Vec<Pickup>,
}
impl BoostClock<'_> {
    fn next(&self, a: Point, b: Point) -> Option<(usize, f64, Point)> {
        self.sources
            .iter()
            .enumerate()
            .filter(|(i, _)| !self.consumed[*i])
            .filter_map(|(i, boost)| {
                hit(a, b, boost.goal.position, &boost.goal.interaction).map(|(t, p)| (i, t, p))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
    }
    fn pickup(&mut self, index: usize, position: Point, elapsed: f64) {
        let usage = self.sources[index].usage.clone();
        self.consumed[index] = true;
        self.active = Some((usage.clone(), elapsed + usage.duration));
        self.pickups.push(Pickup {
            usage,
            position,
            elapsed,
        });
    }
    fn expire(&mut self, elapsed: f64) {
        if self
            .active
            .as_ref()
            .is_some_and(|(_, end)| *end - elapsed <= EPSILON)
        {
            self.active = None;
        }
    }
    fn multiplier(&self) -> f64 {
        self.active
            .as_ref()
            .map_or(1., |(usage, _)| usage.multiplier)
    }
    fn remaining(&self, elapsed: f64) -> f64 {
        self.active
            .as_ref()
            .map_or(f64::INFINITY, |(_, end)| end - elapsed)
    }
    fn crossing(&mut self, segment: &Segment, elapsed: f64) {
        let mut events = Vec::new();
        for (index, boost) in self.sources.iter().enumerate() {
            if self.consumed[index] {
                continue;
            }
            for (chord, pair) in segment.points.windows(2).enumerate() {
                if let Some((fraction, point)) = hit(
                    pair[0],
                    pair[1],
                    boost.goal.position,
                    &boost.goal.interaction,
                ) {
                    events.push((
                        segment.times[chord]
                            + fraction * (segment.times[chord + 1] - segment.times[chord]),
                        index,
                        point,
                    ));
                    break;
                }
            }
        }
        events.sort_by(|a, b| a.0.total_cmp(&b.0));
        for (time, index, point) in events {
            self.pickup(index, point, elapsed + time);
        }
    }
}

pub fn validate(model: &Locomotion) -> Result<(), String> {
    let sprint = model.sprint_speed.unwrap_or(model.speed);
    let acceleration = model.sprint_acceleration.unwrap_or(1.);
    if !model.speed.is_finite()
        || model.speed <= 0.
        || !sprint.is_finite()
        || sprint < model.speed
        || !acceleration.is_finite()
        || acceleration <= 0.
    {
        return Err("Invalid locomotion speeds".into());
    }
    if let Some(stamina) = &model.stamina {
        if ![
            stamina.capacity,
            stamina.initial,
            stamina.activation_cost,
            stamina.sprint_drain,
            stamina.recovery_rate,
            stamina.recovery_delay,
            stamina.reserve,
        ]
        .iter()
        .all(|x| x.is_finite())
            || stamina.capacity <= 0.
            || stamina.initial < 0.
            || stamina.initial > stamina.capacity
            || stamina.activation_cost < 0.
            || stamina.sprint_drain < 0.
            || stamina.recovery_rate < 0.
            || stamina.recovery_delay < 0.
            || stamina.reserve < 0.
            || stamina.reserve > stamina.capacity
        {
            return Err("Invalid stamina policy".into());
        }
    }
    if let Some(dash) = &model.dash {
        if model.stamina.is_none()
            || ![dash.speed, dash.duration, dash.cooldown, dash.cost]
                .iter()
                .all(|x| x.is_finite() && *x > 0.)
            || dash.speed < sprint
            || dash.cooldown < dash.duration
        {
            return Err("Invalid dash policy".into());
        }
    }
    Ok(())
}

fn sprint_time(length: f64, speed: f64, cap: f64, acceleration: f64) -> f64 {
    let time = ((cap - speed) / acceleration).max(0.);
    let accelerated = (speed + cap) * time / 2.;
    if length <= accelerated {
        2. * length / ((speed * speed + 2. * acceleration * length).sqrt() + speed)
    } else {
        time + (length - accelerated) / cap
    }
}

fn sprint_distance(time: f64, speed: f64, cap: f64, acceleration: f64) -> f64 {
    let accelerated = time.min(((cap - speed) / acceleration).max(0.));
    speed * accelerated + acceleration * accelerated * accelerated / 2. + cap * (time - accelerated)
}

fn append(
    output: &mut Vec<Segment>,
    current: &mut Option<usize>,
    source: &Segment,
    gait: &'static str,
    a: Point,
    b: Point,
    elapsed: f64,
    boost: Option<&BoostUse>,
) {
    if current.is_none_or(|i| output[i].gait != Some(gait) || output[i].boost.as_ref() != boost) {
        let mut next = source.clone();
        next.gait = Some(gait);
        next.points = vec![a];
        next.times = vec![0.];
        next.boost = boost.cloned();
        *current = Some(output.len());
        output.push(next);
    }
    let active = &mut output[current.unwrap()];
    active.points.push(b);
    active.times.push(active.cost() + elapsed);
}

fn schedule(
    path: &[Segment],
    model: &Locomotion,
    controls: Controls,
    sources: &[Boost],
) -> Option<Scheduled> {
    let energy = model.stamina.as_ref().map_or(0., |s| s.initial);
    let mut state = State {
        energy,
        minimum: energy,
        delay: 0.,
        sprinting: false,
        activated: false,
        velocity: model.speed,
        direction: None,
        cooldown: 0.,
        dash_remaining: 0.,
        dashes: 0,
    };
    let mut output = Vec::new();
    let mut elapsed = 0.;
    let mut boosts = BoostClock {
        sources,
        consumed: vec![false; sources.len()],
        active: None,
        pickups: Vec::new(),
    };
    let speed = model.speed;
    let acceleration = model.sprint_acceleration.unwrap_or(1.);
    let stamina = model.stamina.as_ref();
    let drain = stamina.map_or(0., |s| s.sprint_drain);
    let activation = stamina.map_or(0., |s| s.activation_cost);
    let recovery = stamina.map_or(0., |s| s.recovery_rate);
    let reserve = stamina.map_or(0., |s| s.reserve);
    let delay = stamina.map_or(0., |s| s.recovery_delay);
    let capacity = stamina.map_or(0., |s| s.capacity);
    let recovering_sprint = stamina.is_some_and(|s| s.recovery_during_sprint);
    for segment in path {
        boosts.expire(elapsed);
        if !controls.allow_sprint {
            if state.dash_remaining > EPSILON {
                return None;
            }
            if state.sprinting && drain > 0. {
                state.delay = delay;
            }
            state.sprinting = false;
            state.velocity = speed * boosts.multiplier();
        }
        if segment.mode != "walk" {
            let duration = segment.cost();
            if segment.required_gait.is_some() || segment.boost.is_some() {
                if segment.required_gait == Some("sprint") && !state.sprinting {
                    return None;
                }
                if let Some(required) = &segment.boost {
                    let (active, expires) = boosts.active.as_ref()?;
                    if active != required || *expires - elapsed + EPSILON < duration {
                        return None;
                    }
                    // A new source can replace the modifier partway through
                    // this flight. Defer that piecewise family until supported.
                    if sources.iter().enumerate().any(|(index, source)| {
                        !boosts.consumed[index]
                            && segment.points.windows(2).any(|pair| {
                                hit(
                                    pair[0],
                                    pair[1],
                                    source.goal.position,
                                    &source.goal.interaction,
                                )
                                .is_some()
                            })
                    }) {
                        return None;
                    }
                }
                let delta = sub(segment.end(), segment.start());
                let span = delta[0].hypot(delta[2]);
                if span > EPSILON {
                    let previous = state.direction?;
                    let previous_span = previous[0].hypot(previous[2]);
                    if previous_span <= EPSILON {
                        return None;
                    }
                    let alignment =
                        (previous[0] * delta[0] + previous[2] * delta[2]) / (previous_span * span);
                    let multiplier = boosts.multiplier();
                    let run = speed * multiplier;
                    let sprint = model.sprint_speed.unwrap_or(speed) * multiplier;
                    // Walking speed is measured along the 3D support path;
                    // only its horizontal component can authorize air speed.
                    let carried = state.velocity.clamp(run, sprint) * previous_span;
                    let aligned = alignment >= (std::f64::consts::PI / 6.).cos();
                    let available = if aligned { carried } else { run.min(carried) };
                    // The authored launch impulse is available from an aligned
                    // sprint at the sustained air cap. Only the jump supplies
                    // the excess speed, not the ground approach.
                    let mut required = span / duration;
                    if segment.mode == "jump"
                        && segment.required_gait == Some("sprint")
                        && let Some(flight) = &segment.flight
                        && required > flight.model.max_horizontal_speed + EPSILON
                    {
                        if !aligned {
                            return None;
                        }
                        required = flight.model.max_horizontal_speed;
                    }
                    if available + EPSILON < required {
                        return None;
                    }
                }
            }
            boosts.crossing(segment, elapsed);
            elapsed += duration;
            boosts.expire(elapsed);
            state.cooldown = (state.cooldown - duration).max(0.);
            state.dash_remaining = 0.;
            output.push(segment.clone());
            if stamina.is_some_and(|s| s.recovery_during_non_walk) {
                let recovering = (duration - state.delay).max(0.);
                state.delay = (state.delay - duration).max(0.);
                state.energy = capacity.min(state.energy + recovering * recovery);
            }
            state.sprinting &= model.sprint_through.iter().any(|mode| mode == segment.mode);
            state.velocity = speed;
            state.direction = None;
            continue;
        }
        let before = output.len();
        let mut current = None;
        for pair in segment.points.windows(2) {
            let a = pair[0];
            let b = pair[1];
            let length = distance(a, b);
            if length <= EPSILON {
                continue;
            }
            let direction = scale(sub(b, a), 1. / length);
            if let Some(previous) = state.direction {
                let alignment = dot(previous, direction);
                if alignment < (std::f64::consts::PI / 6.).cos() {
                    state.velocity = speed * boosts.multiplier();
                }
                if alignment < 1. - 1e-6 {
                    state.dash_remaining = 0.;
                }
            }
            state.direction = Some(direction);
            let mut travelled = 0.;
            while length - travelled > EPSILON {
                boosts.expire(elapsed);
                let mut limit = length;
                if let Some((index, fraction, point)) =
                    boosts.next(lerp(a, b, travelled / length), b)
                {
                    let step = (length - travelled) * fraction;
                    if step <= EPSILON {
                        boosts.pickup(index, point, elapsed);
                        current = None;
                        continue;
                    }
                    limit = travelled + step;
                }
                let multiplier = boosts.multiplier();
                let speed = model.speed * multiplier;
                let sprint = model.sprint_speed.unwrap_or(model.speed) * multiplier;
                // Pickup and expiry change the admissible gait range at this
                // instant. Never carry a boosted velocity beyond its expiry.
                state.velocity = state.velocity.clamp(speed, sprint);
                let boost = boosts.active.as_ref().map(|(usage, _)| usage.clone());
                let expires = boosts.remaining(elapsed);
                if controls.allow_dash
                    && state.dash_remaining <= EPSILON
                    && state.cooldown <= EPSILON
                {
                    if let Some(dash) = &model.dash {
                        if state.energy + EPSILON >= reserve + dash.cost {
                            state.energy = reserve.max(state.energy - dash.cost);
                            state.minimum = state.minimum.min(state.energy);
                            state.delay = delay;
                            state.cooldown = dash.cooldown;
                            state.dash_remaining = dash.duration;
                            state.dashes += 1;
                            state.sprinting = true;
                            state.activated = true;
                            current = None;
                        }
                    }
                }
                if state.dash_remaining > EPSILON {
                    let dash = model.dash.as_ref()?;
                    let dash_speed = dash.speed * multiplier;
                    let duration = state
                        .dash_remaining
                        .min((limit - travelled) / dash_speed)
                        .min(expires);
                    let start = lerp(a, b, travelled / length);
                    travelled = limit.min(travelled + dash_speed * duration);
                    append(
                        &mut output,
                        &mut current,
                        segment,
                        "dash",
                        start,
                        lerp(a, b, travelled / length),
                        duration,
                        boost.as_ref(),
                    );
                    elapsed += duration;
                    state.dash_remaining = (state.dash_remaining - duration).max(0.);
                    state.cooldown = (state.cooldown - duration).max(0.);
                    state.delay = (state.delay - duration).max(0.);
                    state.velocity = sprint;
                    continue;
                }
                let mut dash_boundary = f64::INFINITY;
                if let Some(dash) = &model.dash {
                    if controls.allow_dash && reserve + dash.cost <= capacity {
                        let recharge = (reserve + dash.cost - state.energy).max(0.);
                        let recovery_time = if recharge > EPSILON {
                            if recovery > 0. && recovering_sprint {
                                state.delay + recharge / recovery
                            } else {
                                f64::INFINITY
                            }
                        } else {
                            0.
                        };
                        dash_boundary = state.cooldown.max(recovery_time);
                        if dash_boundary <= EPSILON {
                            dash_boundary = f64::INFINITY;
                        }
                    }
                }
                let net_drain = drain
                    - if recovering_sprint && state.delay <= EPSILON {
                        recovery
                    } else {
                        0.
                    };
                if net_drain > 0. && state.sprinting && state.energy - reserve <= EPSILON {
                    state.sprinting = false;
                    state.delay = delay;
                    state.velocity = speed;
                }
                if !state.sprinting {
                    let required = if drain > 0. || activation > 0. {
                        reserve + activation + if state.activated { drain } else { 0. }
                    } else {
                        0.
                    };
                    if controls.allow_sprint
                        && sprint > speed
                        && state.energy + EPSILON >= required
                        && (drain <= 0. || state.energy - reserve - activation > EPSILON)
                    {
                        state.energy = (state.energy - activation).max(0.);
                        state.minimum = state.minimum.min(state.energy);
                        state.sprinting = true;
                        state.activated = true;
                        state.delay = delay;
                        continue;
                    }
                    let mut duration = ((limit - travelled) / speed)
                        .min(dash_boundary)
                        .min(expires);
                    let restart = reserve + activation + drain;
                    if controls.allow_sprint
                        && stamina.is_some()
                        && sprint > speed
                        && restart <= capacity
                        && recovery > 0.
                    {
                        duration = duration
                            .min(state.delay + ((restart - state.energy) / recovery).max(0.));
                    }
                    if duration <= 0. || !duration.is_finite() {
                        return None;
                    }
                    let start = lerp(a, b, travelled / length);
                    travelled = limit.min(travelled + speed * duration);
                    append(
                        &mut output,
                        &mut current,
                        segment,
                        "run",
                        start,
                        lerp(a, b, travelled / length),
                        duration,
                        boost.as_ref(),
                    );
                    elapsed += duration;
                    if stamina.is_some() {
                        let recovering = (duration - state.delay).max(0.);
                        state.delay = (state.delay - duration).max(0.);
                        state.energy = capacity.min(state.energy + recovering * recovery);
                    }
                    state.cooldown = (state.cooldown - duration).max(0.);
                    state.velocity = speed;
                    continue;
                }
                let available = if net_drain > 0. {
                    ((state.energy - reserve) / net_drain).max(0.)
                } else {
                    f64::INFINITY
                };
                let recovery_boundary = if recovering_sprint && state.delay > EPSILON {
                    state.delay
                } else {
                    f64::INFINITY
                };
                let duration = sprint_time(limit - travelled, state.velocity, sprint, acceleration)
                    .min(available)
                    .min(recovery_boundary)
                    .min(dash_boundary)
                    .min(expires);
                if duration <= 0. || !duration.is_finite() {
                    return None;
                }
                let accelerated = duration.min((sprint - state.velocity) / acceleration);
                let count = (accelerated / 0.1).ceil() as usize;
                let mut samples: Vec<f64> = (1..=count)
                    .map(|i| accelerated * i as f64 / count as f64)
                    .collect();
                if samples.last().is_none_or(|last| duration - last > EPSILON) {
                    samples.push(duration);
                }
                let initial_distance = travelled;
                let mut previous = 0.;
                for time in samples {
                    let start = lerp(a, b, travelled / length);
                    travelled = limit.min(
                        initial_distance
                            + sprint_distance(time, state.velocity, sprint, acceleration),
                    );
                    append(
                        &mut output,
                        &mut current,
                        segment,
                        "sprint",
                        start,
                        lerp(a, b, travelled / length),
                        time - previous,
                        boost.as_ref(),
                    );
                    previous = time;
                }
                elapsed += duration;
                state.cooldown = (state.cooldown - duration).max(0.);
                state.velocity = sprint.min(state.velocity + acceleration * duration);
                if stamina.is_some() {
                    let recovering = if recovering_sprint {
                        (duration - state.delay).max(0.)
                    } else {
                        0.
                    };
                    state.delay = (state.delay - duration).max(0.);
                    state.energy = capacity
                        .min((state.energy - duration * drain + recovering * recovery).max(0.));
                    state.minimum = state.minimum.min(state.energy);
                }
            }
            while let Some((index, _, point)) = boosts.next(b, b) {
                boosts.pickup(index, point, elapsed);
            }
        }
        // Retain a stationary endpoint witness if this entire intent was a no-op.
        if output.len() == before {
            output.push(segment.clone());
        }
    }
    let duration = output.iter().map(Segment::cost).sum();
    Some(Scheduled {
        segments: output,
        controls,
        state,
        duration,
        boosts: boosts.pickups,
    })
}

pub fn best(path: &[Segment], physical: &Physical) -> Option<Scheduled> {
    let sources: Vec<_> = physical
        .devices
        .iter()
        .flat_map(|facts| &facts.devices)
        .filter_map(|device| {
            Some(Boost {
                goal: device.goal.clone()?,
                usage: crate::devices::boost_usage(device)?,
            })
        })
        .collect();
    [(false, false), (true, false), (true, true)]
        .into_iter()
        .filter_map(|(allow_sprint, allow_dash)| {
            schedule(
                path,
                &physical.locomotion,
                Controls {
                    allow_sprint,
                    allow_dash,
                },
                &sources,
            )
        })
        .min_by(|a, b| a.duration.total_cmp(&b.duration))
}
