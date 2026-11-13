use napi::bindgen_prelude::Float64Array;
use napi::{Error, Result};
use napi_derive::napi;
use std::cmp::Ordering;

const EPSILON: f64 = 1e-9;
type Point = [f64; 3];

#[napi(object)]
pub struct ScheduleBoost {
    pub multiplier: f64,
}

#[napi(object)]
pub struct ScheduleSegment {
    pub mode: String,
    pub points: Vec<Vec<f64>>,
    pub times: Vec<f64>,
    pub boost: Option<ScheduleBoost>,
    pub required_gait: Option<String>,
}

#[napi(object)]
pub struct ScheduleBlock {
    pub segments: Vec<ScheduleSegment>,
}

#[napi(object)]
pub struct ScheduleStamina {
    pub capacity: f64,
    pub initial: f64,
    pub activation_cost: Option<f64>,
    pub sprint_drain: Option<f64>,
    pub recovery_rate: f64,
    pub recovery_delay: f64,
    pub reserve: f64,
    pub recovery_during_sprint: Option<bool>,
    pub recovery_during_non_walk: Option<bool>,
}

#[napi(object)]
pub struct ScheduleDash {
    pub speed: f64,
    pub duration: f64,
    pub cooldown: f64,
    pub cost: f64,
}

#[napi(object)]
pub struct ScheduleOptions {
    pub speed: f64,
    pub sprint_speed: f64,
    pub sprint_acceleration: f64,
    pub stamina: Option<ScheduleStamina>,
    pub dash: Option<ScheduleDash>,
    pub sprint_through: Option<Vec<String>>,
    pub turn_cosine: f64,
    pub max_labels: Option<u32>,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Walk,
    Jump,
    Drop,
    Rope,
    Launch,
}

impl Mode {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "walk" => Ok(Self::Walk),
            "jump" => Ok(Self::Jump),
            "drop" => Ok(Self::Drop),
            "rope" => Ok(Self::Rope),
            "launch" => Ok(Self::Launch),
            _ => Err(invalid()),
        }
    }
}

struct Span {
    length: f64,
    direction: Point,
}

struct Segment {
    mode: Mode,
    spans: Vec<Span>,
    duration: f64,
    multiplier: f64,
    required_sprint: bool,
}

struct Block {
    segments: Vec<Segment>,
}

#[derive(Clone, Copy)]
struct State {
    energy: f64,
    delay: f64,
    sprinting: bool,
    has_activated: bool,
    velocity: f64,
    previous_direction: Option<Point>,
    dash_cooldown: f64,
    dash_remaining: f64,
}

#[derive(Clone)]
struct Label {
    state: State,
    duration: f64,
    previous: Option<usize>,
    allow_sprint: bool,
    allow_dash: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Gait {
    Run,
    Sprint,
    Dash,
}

fn invalid() -> Error {
    Error::from_reason("Invalid native locomotion schedule")
}

// JavaScript propagates NaN through Math.min/max. Rust's f64 methods discard it.
fn minimum<const N: usize>(values: [f64; N]) -> f64 {
    values.into_iter().fold(f64::INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else {
            a.min(b)
        }
    })
}

fn maximum<const N: usize>(values: [f64; N]) -> f64 {
    values.into_iter().fold(f64::NEG_INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else {
            a.max(b)
        }
    })
}

fn prepare(blocks: Vec<ScheduleBlock>) -> Result<Vec<Block>> {
    blocks
        .into_iter()
        .map(|block| {
            if block.segments.is_empty() {
                return Err(invalid());
            }
            let segments = block
                .segments
                .into_iter()
                .map(|segment| {
                    let mode = Mode::parse(&segment.mode)?;
                    if segment.points.len() < 2
                        || segment.times.len() != segment.points.len()
                        || segment.times.iter().any(|v| !v.is_finite())
                        || segment
                            .points
                            .iter()
                            .any(|p| p.len() != 3 || p.iter().any(|v| !v.is_finite()))
                    {
                        return Err(invalid());
                    }
                    let multiplier = segment.boost.map(|boost| boost.multiplier).unwrap_or(1.0);
                    if !multiplier.is_finite() || multiplier < 1.0 {
                        return Err(invalid());
                    }
                    let required_sprint = match segment.required_gait.as_deref() {
                        None => false,
                        Some("sprint") => true,
                        _ => return Err(invalid()),
                    };
                    let mut spans = Vec::new();
                    if mode == Mode::Walk {
                        for pair in segment.points.windows(2) {
                            let a = [pair[0][0], pair[0][1], pair[0][2]];
                            let b = [pair[1][0], pair[1][1], pair[1][2]];
                            let length = if (0..3).any(|axis| (a[axis] - b[axis]).is_infinite()) {
                                f64::INFINITY
                            } else {
                                super::distance(a, b)
                            };
                            if length <= EPSILON {
                                continue;
                            }
                            spans.push(Span {
                                length,
                                direction: [
                                    (b[0] - a[0]) / length,
                                    (b[1] - a[1]) / length,
                                    (b[2] - a[2]) / length,
                                ],
                            });
                        }
                    }
                    Ok(Segment {
                        mode,
                        spans,
                        duration: *segment.times.last().expect("validated times"),
                        multiplier,
                        required_sprint,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(Block { segments })
        })
        .collect()
}

fn validate_options(options: &ScheduleOptions) -> Result<()> {
    if [
        options.speed,
        options.sprint_speed,
        options.sprint_acceleration,
    ]
    .iter()
    .any(|&v| !v.is_finite() || v <= 0.0)
        || options.sprint_speed < options.speed
        || !options.turn_cosine.is_finite()
        || options
            .max_labels
            .map(|limit| limit < 2 || limit % 2 != 0)
            .unwrap_or(false)
    {
        return Err(invalid());
    }
    if let Some(stamina) = &options.stamina
        && ([
            stamina.capacity,
            stamina.initial,
            stamina.activation_cost.unwrap_or(0.0),
            stamina.sprint_drain.unwrap_or(0.0),
            stamina.recovery_rate,
            stamina.recovery_delay,
            stamina.reserve,
        ]
        .iter()
        .any(|v| !v.is_finite())
            || stamina.capacity <= 0.0
            || stamina.initial < 0.0
            || stamina.initial > stamina.capacity
            || stamina.activation_cost.unwrap_or(0.0) < 0.0
            || stamina.sprint_drain.unwrap_or(0.0) < 0.0
            || stamina.recovery_rate < 0.0
            || stamina.recovery_delay < 0.0
            || stamina.reserve < 0.0
            || stamina.reserve > stamina.capacity)
    {
        return Err(invalid());
    }
    if let Some(dash) = &options.dash
        && ([dash.speed, dash.duration, dash.cooldown, dash.cost]
            .iter()
            .any(|&v| !v.is_finite() || v <= 0.0)
            || dash.speed < options.sprint_speed
            || dash.cooldown < dash.duration
            || options.stamina.is_none())
    {
        return Err(invalid());
    }
    if let Some(modes) = &options.sprint_through {
        for mode in modes {
            if Mode::parse(mode)? == Mode::Walk {
                return Err(invalid());
            }
        }
    }
    Ok(())
}

fn sprint_time(length: f64, speed: f64, cap: f64, acceleration: f64) -> f64 {
    let acceleration_time = maximum([0.0, (cap - speed) / acceleration]);
    let acceleration_distance = ((speed + cap) * acceleration_time) / 2.0;
    if length <= acceleration_distance {
        (2.0 * length) / ((speed * speed + 2.0 * acceleration * length).sqrt() + speed)
    } else {
        acceleration_time + (length - acceleration_distance) / cap
    }
}

fn sprint_distance(seconds: f64, speed: f64, cap: f64, acceleration: f64) -> f64 {
    let accelerated = minimum([seconds, maximum([0.0, (cap - speed) / acceleration])]);
    speed * accelerated
        + (acceleration * accelerated * accelerated) / 2.0
        + cap * (seconds - accelerated)
}

#[derive(Default)]
struct Clocks {
    completed: f64,
    output: Option<(Gait, f64)>,
}

impl Clocks {
    fn end_output(&mut self) {
        if let Some((_, duration)) = self.output.take() {
            self.completed += duration;
        }
    }

    fn append(&mut self, gait: Gait, elapsed: f64) {
        if self.output.is_some_and(|(previous, _)| previous != gait) {
            self.end_output();
        }
        let output = self.output.get_or_insert((gait, 0.0));
        output.1 += elapsed;
    }

    fn finish(mut self) -> f64 {
        self.end_output();
        self.completed
    }
}

fn schedule(
    block: &Block,
    options: &ScheduleOptions,
    mut state: State,
    allow_sprint: bool,
    allow_dash: bool,
) -> Option<(State, f64)> {
    let stamina = options.stamina.as_ref();
    let dash = options.dash.as_ref();
    let speed = options.speed * block.segments[0].multiplier;
    let sprint_speed = options.sprint_speed * block.segments[0].multiplier;
    let acceleration = options.sprint_acceleration;
    let drain = stamina.and_then(|s| s.sprint_drain).unwrap_or(0.0);
    let draining = drain > 0.0;
    let activation_cost = stamina.and_then(|s| s.activation_cost).unwrap_or(0.0);
    let recovery_rate = stamina.map(|s| s.recovery_rate).unwrap_or(0.0);
    let reserve = stamina.map(|s| s.reserve).unwrap_or(0.0);
    let recovery_delay = stamina.map(|s| s.recovery_delay).unwrap_or(0.0);
    let recovery_during_sprint = stamina
        .and_then(|s| s.recovery_during_sprint)
        .unwrap_or(false);
    if !allow_sprint && state.dash_remaining > EPSILON {
        return None;
    }
    if !allow_sprint {
        if state.sprinting && draining {
            state.delay = recovery_delay;
        }
        state.sprinting = false;
        state.velocity = speed;
    }
    // Keep each output's clock, including zero-time additions and original
    // segment/dash boundaries. Summing phase durations changes rounding and ties.
    let mut clocks = Clocks::default();
    for segment in &block.segments {
        clocks.end_output();
        if segment.mode != Mode::Walk {
            if segment.required_sprint && !state.sprinting {
                return None;
            }
            state.dash_cooldown = maximum([0.0, state.dash_cooldown - segment.duration]);
            state.dash_remaining = 0.0;
            clocks.completed += segment.duration;
            if stamina
                .and_then(|s| s.recovery_during_non_walk)
                .unwrap_or(false)
            {
                let recovering = maximum([0.0, segment.duration - state.delay]);
                state.delay = maximum([0.0, state.delay - segment.duration]);
                state.energy = minimum([
                    stamina.expect("validated stamina").capacity,
                    state.energy + recovering * recovery_rate,
                ]);
            }
            state.sprinting = state.sprinting
                && options
                    .sprint_through
                    .as_ref()
                    .map(|modes| {
                        modes
                            .iter()
                            .any(|mode| Mode::parse(mode).ok() == Some(segment.mode))
                    })
                    .unwrap_or(false);
            state.velocity = speed;
            state.previous_direction = None;
            continue;
        }
        for span in &segment.spans {
            let length = span.length;
            if let Some(previous) = state.previous_direction {
                let mut alignment = 0.0;
                for (direction, previous) in span.direction.iter().zip(previous) {
                    alignment += direction * previous;
                }
                if alignment < options.turn_cosine {
                    state.velocity = speed;
                }
                if alignment < 1.0 - 1e-6 {
                    state.dash_remaining = 0.0;
                }
            }
            state.previous_direction = Some(span.direction);
            let mut travelled = 0.0;
            while length - travelled > EPSILON {
                if let Some(dash) = dash
                    && allow_dash
                    && state.dash_remaining <= EPSILON
                    && state.dash_cooldown <= EPSILON
                    && state.energy + EPSILON >= reserve + dash.cost
                {
                    state.energy = maximum([reserve, state.energy - dash.cost]);
                    state.delay = recovery_delay;
                    state.dash_cooldown = dash.cooldown;
                    state.dash_remaining = dash.duration;
                    state.sprinting = true;
                    state.has_activated = true;
                    clocks.end_output();
                }
                if state.dash_remaining > EPSILON {
                    let dash_speed = dash.expect("active dash").speed * segment.multiplier;
                    let duration =
                        minimum([state.dash_remaining, (length - travelled) / dash_speed]);
                    travelled = minimum([length, travelled + dash_speed * duration]);
                    clocks.append(Gait::Dash, duration);
                    state.dash_remaining = maximum([0.0, state.dash_remaining - duration]);
                    state.dash_cooldown = maximum([0.0, state.dash_cooldown - duration]);
                    state.delay = maximum([0.0, state.delay - duration]);
                    state.velocity = sprint_speed;
                    continue;
                }
                let mut dash_boundary = f64::INFINITY;
                if let Some(dash) = dash
                    && allow_dash
                    && reserve + dash.cost <= stamina.expect("validated stamina").capacity
                {
                    let recharge = maximum([0.0, reserve + dash.cost - state.energy]);
                    let recovery =
                        if recharge > EPSILON && recovery_rate > 0.0 && recovery_during_sprint {
                            state.delay + recharge / recovery_rate
                        } else if recharge > EPSILON {
                            f64::INFINITY
                        } else {
                            0.0
                        };
                    dash_boundary = maximum([state.dash_cooldown, recovery]);
                    if dash_boundary <= EPSILON {
                        dash_boundary = f64::INFINITY;
                    }
                }
                let recovering_sprint = recovery_during_sprint && state.delay <= EPSILON;
                let net_drain = drain
                    - if recovering_sprint {
                        recovery_rate
                    } else {
                        0.0
                    };
                if net_drain > 0.0 && state.sprinting && state.energy - reserve <= EPSILON {
                    state.sprinting = false;
                    state.delay = recovery_delay;
                    state.velocity = speed;
                }
                if !state.sprinting {
                    let required = if draining || activation_cost > 0.0 {
                        reserve + activation_cost + if state.has_activated { drain } else { 0.0 }
                    } else {
                        0.0
                    };
                    let enough_energy = state.energy + EPSILON >= required
                        && (!draining || state.energy - reserve - activation_cost > EPSILON);
                    if allow_sprint && sprint_speed > speed && enough_energy {
                        state.energy = maximum([0.0, state.energy - activation_cost]);
                        state.sprinting = true;
                        state.has_activated = true;
                        state.delay = recovery_delay;
                        continue;
                    }
                    let remaining_time = (length - travelled) / speed;
                    let mut duration = minimum([remaining_time, dash_boundary]);
                    let restart_energy = reserve + activation_cost + drain;
                    if allow_sprint
                        && stamina.is_some()
                        && sprint_speed > speed
                        && restart_energy <= stamina.expect("present stamina").capacity
                        && recovery_rate > 0.0
                    {
                        let recharge_time = state.delay
                            + maximum([0.0, restart_energy - state.energy]) / recovery_rate;
                        duration = minimum([duration, recharge_time]);
                    }
                    travelled = minimum([length, travelled + speed * duration]);
                    clocks.append(Gait::Run, duration);
                    if let Some(stamina) = stamina {
                        let recovering = maximum([0.0, duration - state.delay]);
                        state.delay = maximum([0.0, state.delay - duration]);
                        state.energy =
                            minimum([stamina.capacity, state.energy + recovering * recovery_rate]);
                    }
                    state.dash_cooldown = maximum([0.0, state.dash_cooldown - duration]);
                    state.velocity = speed;
                    continue;
                }
                let available_time = if net_drain > 0.0 {
                    maximum([0.0, (state.energy - reserve) / net_drain])
                } else {
                    f64::INFINITY
                };
                let recovery_boundary = if recovery_during_sprint && state.delay > EPSILON {
                    state.delay
                } else {
                    f64::INFINITY
                };
                let duration = minimum([
                    sprint_time(
                        length - travelled,
                        state.velocity,
                        sprint_speed,
                        acceleration,
                    ),
                    available_time,
                    recovery_boundary,
                    dash_boundary,
                ]);
                let acceleration_time =
                    minimum([duration, (sprint_speed - state.velocity) / acceleration]);
                let count = (acceleration_time / 0.1).ceil();
                let initial_distance = travelled;
                let mut previous_time = 0.0;
                let mut advance_sample = |sample, previous_time: &mut f64| {
                    clocks.append(Gait::Sprint, sample - *previous_time);
                    *previous_time = sample;
                };
                let mut sample = 1.0;
                while sample <= count {
                    advance_sample((acceleration_time * sample) / count, &mut previous_time);
                    sample += 1.0;
                }
                if sample == 1.0 || duration - previous_time > EPSILON {
                    advance_sample(duration, &mut previous_time);
                }
                // Only the last sample's position survives this phase. Keep all
                // clock additions and use its emitted time: epsilon can omit
                // the duration sample, leaving a short span still to traverse.
                travelled = minimum([
                    length,
                    initial_distance
                        + sprint_distance(
                            previous_time,
                            state.velocity,
                            sprint_speed,
                            acceleration,
                        ),
                ]);
                state.dash_cooldown = maximum([0.0, state.dash_cooldown - duration]);
                state.velocity = minimum([sprint_speed, state.velocity + acceleration * duration]);
                if let Some(stamina) = stamina {
                    let recovering = if recovery_during_sprint {
                        maximum([0.0, duration - state.delay])
                    } else {
                        0.0
                    };
                    state.delay = maximum([0.0, state.delay - duration]);
                    state.energy = minimum([
                        stamina.capacity,
                        maximum([
                            0.0,
                            state.energy - duration * drain + recovering * recovery_rate,
                        ]),
                    ]);
                }
            }
        }
    }
    // Minimum energy and dash count are diagnostics, reconstructed by winner
    // replay. Neither participates in feasibility, dominance or the terminal tie.
    Some((state, clocks.finish()))
}

fn same_continuation(a: State, b: State) -> bool {
    if (a.dash_cooldown - b.dash_cooldown).abs() > EPSILON
        || (a.dash_remaining - b.dash_remaining).abs() > EPSILON
    {
        return false;
    }
    if a.sprinting != b.sprinting
        || a.has_activated != b.has_activated
        || (a.velocity - b.velocity).abs() > EPSILON
    {
        return false;
    }
    match (a.previous_direction, b.previous_direction) {
        (None, None) => true,
        (Some(a), Some(b)) => (0..3).all(|axis| (a[axis] - b[axis]).abs() <= EPSILON),
        _ => false,
    }
}

fn no_worse_resources(a: &Label, b: &Label) -> bool {
    a.duration <= b.duration + EPSILON
        && a.state.energy >= b.state.energy - EPSILON
        && a.state.delay <= b.state.delay + EPSILON
}

fn numeric_order(delta: f64) -> Ordering {
    if delta < 0.0 {
        Ordering::Less
    } else if delta > 0.0 {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}

#[napi]
pub fn choose_schedule(
    blocks: Vec<ScheduleBlock>,
    options: ScheduleOptions,
) -> Result<Float64Array> {
    validate_options(&options)?;
    let blocks = prepare(blocks)?;
    let max_labels = options.max_labels.unwrap_or(256) as usize;
    let initial = State {
        energy: options.stamina.as_ref().map(|s| s.initial).unwrap_or(0.0),
        delay: 0.0,
        sprinting: false,
        has_activated: false,
        velocity: options.speed,
        previous_direction: None,
        dash_cooldown: 0.0,
        dash_remaining: 0.0,
    };
    let mut arena = vec![Label {
        state: initial,
        duration: 0.0,
        previous: None,
        allow_sprint: false,
        allow_dash: false,
    }];
    let mut labels = vec![0];
    let mut truncated = false;
    let mut removals = Vec::new();
    let mut next: Vec<Label> = Vec::new();
    for block in &blocks {
        let walk = block.segments[0].mode == Mode::Walk;
        let sprint_choices: &[bool] = if walk { &[true, false] } else { &[true] };
        for &parent in &labels {
            let label = &arena[parent];
            for &allow_sprint in sprint_choices {
                let dash_choices: &[bool] = if options.dash.is_some() && allow_sprint && walk {
                    &[true, false]
                } else {
                    &[false]
                };
                for &allow_dash in dash_choices {
                    let Some((state, duration)) =
                        schedule(block, &options, label.state, allow_sprint, allow_dash)
                    else {
                        continue;
                    };
                    let candidate = Label {
                        state,
                        duration: label.duration + duration,
                        previous: Some(parent),
                        allow_sprint,
                        allow_dash,
                    };
                    removals.clear();
                    let mut dominated = false;
                    for (index, other) in next.iter().enumerate() {
                        if !same_continuation(other.state, candidate.state) {
                            continue;
                        }
                        if no_worse_resources(other, &candidate) {
                            dominated = true;
                            break;
                        }
                        if no_worse_resources(&candidate, other) {
                            removals.push(index);
                        }
                    }
                    if dominated {
                        continue;
                    }
                    // EPS dominance can hold in both directions. Defer removals
                    // until the candidate survives, retaining the first old tie
                    // and the exact insertion order used by subsequent labels.
                    if !removals.is_empty() {
                        let mut removed = removals.iter().copied().peekable();
                        let mut index = 0;
                        next.retain(|_| {
                            let keep = removed.peek() != Some(&index);
                            if !keep {
                                removed.next();
                            }
                            index += 1;
                            keep
                        });
                    }
                    next.push(candidate);
                }
            }
        }
        if next.is_empty() {
            return Ok(Vec::new().into());
        }
        if next.len() > max_labels {
            // Both sorts are stable, including equal-energy/equal-duration ties.
            // Persist only survivors: discarded candidates never enter the arena.
            next.sort_by(|a, b| numeric_order(a.duration - b.duration));
            let half = max_labels / 2;
            next[half..].sort_by(|a, b| {
                let energy = b.state.energy - a.state.energy;
                if energy != 0.0 && !energy.is_nan() {
                    numeric_order(energy)
                } else {
                    numeric_order(a.duration - b.duration)
                }
            });
            next.truncate(max_labels);
            truncated = true;
        }
        labels.clear();
        for label in next.drain(..) {
            labels.push(arena.len());
            arena.push(label);
        }
    }
    let Some((&first, rest)) = labels.split_first() else {
        return Ok(Vec::new().into());
    };
    let mut best = first;
    for &candidate in rest {
        let label = &arena[candidate];
        let chosen = &arena[best];
        if label.duration < chosen.duration - EPSILON
            || ((label.duration - chosen.duration).abs() <= EPSILON
                && label.state.energy < chosen.state.energy - EPSILON)
        {
            best = candidate;
        }
    }
    let mut controls = Vec::with_capacity(blocks.len() * 2);
    while let Some(parent) = arena[best].previous {
        controls.push(if arena[best].allow_dash { 1.0 } else { 0.0 });
        controls.push(if arena[best].allow_sprint { 1.0 } else { 0.0 });
        best = parent;
    }
    controls.reverse();
    let mut result = Vec::with_capacity(controls.len() + 1);
    result.push(if truncated { 1.0 } else { 0.0 });
    result.extend(controls);
    Ok(result.into())
}
