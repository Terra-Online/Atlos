use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlightControl {
    pub mode: Mode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit: Option<[f64; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_fraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_split: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_waypoint: Option<[f64; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expire_after: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expired_horizontal_speed: Option<f64>,
}
impl Default for FlightControl {
    fn default() -> Self {
        Self {
            mode: Mode::Jump,
            exit: None,
            speed_fraction: None,
            terminal: None,
            horizontal_split: None,
            horizontal_waypoint: None,
            expire_after: None,
            expired_horizontal_speed: None,
        }
    }
}
#[derive(Clone, Copy)]
struct Phase {
    y: f64,
    v: f64,
    a: f64,
    time: f64,
}
fn phases(start: f64, end: f64, m: &JumpModel, mode: Mode) -> Result<Option<Vec<Phase>>, String> {
    if !matches!(mode, Mode::Jump | Mode::Drop)
        || [
            start,
            end,
            m.gravity,
            m.falling_gravity,
            m.max_jump_height,
            m.max_falling_speed,
            m.apex_time,
            m.max_horizontal_speed,
        ]
        .iter()
        .any(|v| !v.is_finite())
        || m.gravity <= 0.
        || m.falling_gravity <= 0.
        || m.max_jump_height < 0.
        || m.max_falling_speed <= 0.
        || m.apex_time < 0.
        || m.max_horizontal_speed < 0.
    {
        return Err("Invalid flight model".into());
    }
    if mode == Mode::Jump && m.max_jump_height == 0. {
        return Ok(None);
    }
    let peak = start
        + if mode == Mode::Jump {
            m.max_jump_height
        } else {
            0.
        };
    if end > peak {
        return Ok(None);
    }
    let mut out = vec![];
    if mode == Mode::Jump {
        let v = (2. * m.gravity * m.max_jump_height).sqrt();
        out.push(Phase {
            y: start,
            v,
            a: -m.gravity,
            time: v / m.gravity,
        });
        if m.apex_time > 0. {
            out.push(Phase {
                y: peak,
                v: 0.,
                a: 0.,
                time: m.apex_time,
            });
        }
    }
    let fall = peak - end;
    let terminal = m.max_falling_speed / m.falling_gravity;
    let d = m.max_falling_speed * terminal / 2.;
    if fall > 0. {
        if fall <= d {
            out.push(Phase {
                y: peak,
                v: 0.,
                a: -m.falling_gravity,
                time: (2. * fall / m.falling_gravity).sqrt(),
            });
        } else {
            out.push(Phase {
                y: peak,
                v: 0.,
                a: -m.falling_gravity,
                time: terminal,
            });
            out.push(Phase {
                y: peak - d,
                v: -m.max_falling_speed,
                a: 0.,
                time: (fall - d) / m.max_falling_speed,
            });
        }
    }
    let time: f64 = out.iter().map(|p| p.time).sum();
    if !time.is_finite() || time / 0.025 > 100_000. {
        return Err("Flight exceeds sweep budget".into());
    }
    Ok(if time > 0. { Some(out) } else { None })
}
pub(super) fn duration(
    start: f64,
    end: f64,
    m: &JumpModel,
    mode: Mode,
) -> Result<Option<f64>, String> {
    Ok(phases(start, end, m, mode)?.map(|p| p.iter().map(|p| p.time).sum()))
}
fn travel(initial: f64, cap: f64, deceleration: f64, time: f64) -> f64 {
    if initial <= cap {
        return initial * time;
    }
    let braking = time.min((initial - cap) / deceleration);
    initial * braking - deceleration * braking * braking / 2. + cap * (time - braking)
}
fn expired_travel(initial: f64, time: f64, m: &JumpModel, c: &FlightControl) -> f64 {
    let brake = m.air_overspeed_deceleration.unwrap_or(1.);
    if let Some(expiry) = c.expire_after
        && time > expiry
    {
        let speed = initial
            .min(m.max_horizontal_speed)
            .max(initial - brake * expiry);
        return travel(initial, m.max_horizontal_speed, brake, expiry)
            + travel(
                speed,
                c.expired_horizontal_speed.unwrap_or(m.max_horizontal_speed),
                brake,
                time - expiry,
            );
    }
    travel(initial, m.max_horizontal_speed, brake, time)
}
#[derive(Clone, Copy)]
struct Leg {
    distance: f64,
    rise: f64,
    coast: f64,
    fall: f64,
    peak: f64,
    accel: f64,
    decel: f64,
}
impl Leg {
    fn new(d: f64, m: &JumpModel) -> Option<Self> {
        let a = m.air_acceleration?;
        let b = m.air_deceleration?;
        if a <= 0. || b <= 0. {
            return None;
        }
        let peak = m
            .max_horizontal_speed
            .min((2. * d / (1. / a + 1. / b)).sqrt());
        if d > 0. && peak == 0. {
            return None;
        }
        let rise = peak / a;
        let fall = peak / b;
        Some(Self {
            distance: d,
            rise,
            coast: if peak > 0. {
                (d / peak - (rise + fall) / 2.).max(0.)
            } else {
                0.
            },
            fall,
            peak,
            accel: a,
            decel: b,
        })
    }
    fn duration(&self) -> f64 {
        self.rise + self.coast + self.fall
    }
    fn at(&self, t: f64) -> f64 {
        if t <= 0. {
            0.
        } else if t >= self.duration() {
            self.distance
        } else if t < self.rise {
            self.accel * t * t / 2.
        } else if t < self.rise + self.coast {
            self.peak * (t - self.rise / 2.)
        } else {
            self.distance - self.decel * (self.duration() - t).powi(2) / 2.
        }
    }
}
impl World {
    pub fn flight_duration(&self, start: f64, end: f64, mode: Mode) -> Result<Option<f64>, String> {
        Ok(phases(start, end, &self.movement.model, mode)?.map(|p| p.iter().map(|p| p.time).sum()))
    }
    pub fn flight(&self, start: Vec3, end: Vec3, mode: Mode) -> Result<Option<Connection>, String> {
        self.flight_with_control(
            start,
            end,
            &self.movement.model,
            &FlightControl {
                mode,
                ..Default::default()
            },
        )
    }
    pub fn flight_with_control(
        &self,
        start: Vec3,
        end: Vec3,
        model: &JumpModel,
        control: &FlightControl,
    ) -> Result<Option<Connection>, String> {
        if !finite(start) || !finite(end) {
            return Err("Invalid flight endpoints".into());
        }
        if control.exit.is_some() || control.speed_fraction.is_some() || control.terminal.is_some()
        {
            return self.run_off(start, end, model, control);
        }
        let Some(phases) = phases(start[1], end[1], model, control.mode)? else {
            return Ok(None);
        };
        let duration: f64 = phases.iter().map(|p| p.time).sum();
        let horizontal = (end[0] - start[0]).hypot(end[2] - start[2]);
        let overspeed =
            horizontal / duration > model.max_horizontal_speed || control.expire_after.is_some();
        if model
            .start_horizontal_speed
            .is_some_and(|v| !v.is_finite() || v < 0.)
            || model
                .air_overspeed_deceleration
                .is_some_and(|v| !v.is_finite() || v <= 0.)
            || control
                .expire_after
                .is_some_and(|v| !v.is_finite() || v < 0.)
            || control
                .expired_horizontal_speed
                .is_some_and(|v| !v.is_finite() || v < 0. || v > model.max_horizontal_speed)
        {
            return Err("Invalid flight speed control".into());
        }
        let mut initial = 0.;
        let mut horizontal_acceleration = 0.;
        if overspeed {
            if control.mode != Mode::Jump
                || control.horizontal_split.is_some()
                || control.horizontal_waypoint.is_some()
                || model.start_horizontal_speed.is_none()
                || model.air_overspeed_deceleration.is_none()
            {
                return Ok(None);
            }
            let mut low = if control.expire_after.is_some() {
                0.
            } else {
                model.max_horizontal_speed
            };
            let mut high = model
                .start_horizontal_speed
                .unwrap()
                .max(model.max_horizontal_speed);
            if expired_travel(high, duration, model, control) < horizontal {
                return Ok(None);
            }
            for _ in 0..40 {
                let mid = (low + high) / 2.;
                if expired_travel(mid, duration, model, control) < horizontal {
                    low = mid
                } else {
                    high = mid
                }
            }
            initial = high;
            horizontal_acceleration = model.air_overspeed_deceleration.unwrap();
        }
        let mut legs = None;
        if control.horizontal_split.is_some() || control.horizontal_waypoint.is_some() {
            if control
                .horizontal_split
                .is_some_and(|v| !v.is_finite() || !(0. ..=1.).contains(&v))
                || control
                    .horizontal_waypoint
                    .is_some_and(|v| v.iter().any(|v| !v.is_finite()))
            {
                return Err("Invalid horizontal control".into());
            }
            let split = control.horizontal_split.unwrap_or(0.5);
            let mid = control.horizontal_waypoint.unwrap_or([
                start[0] + (end[0] - start[0]) * split,
                start[2] + (end[2] - start[2]) * split,
            ]);
            let Some(a) = Leg::new((mid[0] - start[0]).hypot(mid[1] - start[2]), model) else {
                return Err("Horizontal control needs positive accelerations".into());
            };
            let Some(b) = Leg::new((end[0] - mid[0]).hypot(end[2] - mid[1]), model) else {
                return Err("Horizontal control needs positive accelerations".into());
            };
            if a.duration() + b.duration() > duration {
                return Ok(None);
            }
            horizontal_acceleration = model
                .air_acceleration
                .unwrap()
                .max(model.air_deceleration.unwrap());
            legs = Some((mid, a, b));
        }
        let horizontal_at = |time: f64| -> [f64; 2] {
            if let Some((mid, a, b)) = legs {
                let x = if a.distance == 0. {
                    1.
                } else {
                    a.at(time) / a.distance
                };
                let y = if b.distance == 0. {
                    1.
                } else {
                    b.at(time - (duration - b.duration())) / b.distance
                };
                [
                    start[0] + (mid[0] - start[0]) * x + (end[0] - mid[0]) * y,
                    start[2] + (mid[1] - start[2]) * x + (end[2] - mid[1]) * y,
                ]
            } else {
                let fraction = if overspeed && horizontal > 0. {
                    expired_travel(initial, time, model, control) / horizontal
                } else {
                    time / duration
                };
                [
                    start[0] + (end[0] - start[0]) * fraction,
                    start[2] + (end[2] - start[2]) * fraction,
                ]
            }
        };
        if !self.clear(start, start, 0.)? || !self.clear(end, end, 0.)? {
            return Ok(None);
        }
        let mut points = vec![start];
        let mut times = vec![0.];
        let mut elapsed = 0.;
        for (i, phase) in phases.iter().enumerate() {
            let count = (phase.time / 0.025).ceil() as usize;
            for step in 1..=count {
                let low = phase.time * (step - 1) as f64 / count as f64;
                let high = phase.time * step as f64 / count as f64;
                let last = i + 1 == phases.len() && step == count;
                if !advance(
                    self,
                    *phase,
                    elapsed,
                    low,
                    high,
                    last,
                    end,
                    horizontal_acceleration,
                    &horizontal_at,
                    &mut points,
                    &mut times,
                )? {
                    return Ok(None);
                }
            }
            elapsed += phase.time;
        }
        let mut c = Connection::new("flight".into(), control.mode, points, times);
        c.endpoint_tolerance = Some(self.movement.profile.radius);
        let mut witness_model = serde_json::to_value(model).map_err(|e| e.to_string())?;
        if let Some(obj) = witness_model.as_object_mut() {
            obj.retain(|_, v| !v.is_null());
            obj.insert(
                "profile".into(),
                serde_json::to_value(self.movement.profile).unwrap(),
            );
        }
        c.extra.insert("flight".into(),serde_json::json!({"kind":"flight","start":start,"end":end,"model":witness_model,"control":control}));
        Ok(Some(c))
    }
    /// Walk to the first unsupported foot before starting the free-fall family.
    /// This preserves the supported prefix instead of falling through its floor.
    pub fn run_off(
        &self,
        start: Vec3,
        end: Vec3,
        model: &JumpModel,
        control: &FlightControl,
    ) -> Result<Option<Connection>, String> {
        let exit = control.exit.unwrap_or([end[0], end[2]]);
        let dx = exit[0] - start[0];
        let dz = exit[1] - start[2];
        let span = dx.hypot(dz);
        if span == 0. {
            return Ok(None);
        }
        let direction = [dx / span, dz / span];
        let limit = if control.exit.is_some() {
            span + self.movement.profile.radius
        } else {
            span
        };
        let spacing = self.movement.profile.radius / 4.;
        if spacing <= 0. {
            return Ok(None);
        }
        if limit / spacing > 100_000. {
            return Err("Run-off exceeds budget".into());
        }
        let support_at = |d: f64, previous: Vec3| -> Result<Option<Vec3>, String> {
            let seed = [
                start[0] + direction[0] * d,
                previous[1] - 0.005,
                start[2] + direction[1] * d,
            ];
            let reach =
                spacing * self.movement.max_slope.to_radians().tan() + self.movement.profile.radius;
            Ok(self
                .ground_at(seed, reach, reach, self.movement.profile.radius)?
                .map(|h| [h.position[0], h.position[1] + 0.005, h.position[2]]))
        };
        let mut points = vec![start];
        let mut distances = vec![0.];
        let mut travelled = 0.;
        let mut launch = None;
        while travelled < limit {
            let next_distance = (travelled + spacing).min(limit);
            if let Some(next) = support_at(next_distance, *points.last().unwrap())? {
                if !append_support(
                    self,
                    next_distance,
                    next,
                    spacing,
                    &support_at,
                    &mut points,
                    &mut distances,
                )? {
                    return Ok(None);
                }
                travelled = next_distance;
            } else {
                let mut low = travelled;
                let mut high = next_distance;
                let mut foot = *points.last().unwrap();
                for _ in 0..12 {
                    let mid = (low + high) / 2.;
                    if let Some(p) = support_at(mid, foot)? {
                        low = mid;
                        foot = p;
                    } else {
                        high = mid;
                    }
                }
                if low > travelled
                    && !append_support(
                        self,
                        low,
                        foot,
                        spacing,
                        &support_at,
                        &mut points,
                        &mut distances,
                    )?
                {
                    return Ok(None);
                }
                launch = Some(foot);
                break;
            }
        }
        let Some(launch) = launch else {
            return Ok(None);
        };
        let plain = FlightControl {
            mode: Mode::Drop,
            horizontal_split: control.horizontal_split,
            horizontal_waypoint: control.horizontal_waypoint,
            ..Default::default()
        };
        let mut times;
        let mut arc;
        if control.exit.is_none() {
            let Some(a) = self.flight_with_control(launch, end, model, &plain)? else {
                return Ok(None);
            };
            arc = a;
            let duration = arc.duration();
            let whole = (end[0] - start[0]).hypot(end[2] - start[2]);
            let air_speed = (whole - distances.last().unwrap()) / duration;
            if air_speed <= 0. || air_speed > model.max_horizontal_speed {
                return Ok(None);
            }
            times = distances.iter().map(|d| d / air_speed).collect::<Vec<_>>();
        } else {
            let Some(phases) = phases(launch[1], end[1], model, Mode::Drop)? else {
                return Ok(None);
            };
            let duration: f64 = phases.iter().map(|p| p.time).sum();
            let average = [
                (end[0] - launch[0]) / duration,
                (end[2] - launch[2]) / duration,
            ];
            let length = average[0].hypot(average[1]);
            let cap = model.max_horizontal_speed;
            if length > cap {
                return Ok(None);
            }
            let speed = cap * control.speed_fraction.unwrap_or(1.);
            if !speed.is_finite() || speed <= 0. {
                return Ok(None);
            }
            let initial = direction.map(|v| v * speed);
            let terminal = match control.terminal.as_deref() {
                Some("average") => average,
                Some("balanced") => std::array::from_fn(|i| 2. * average[i] - initial[i]),
                _ => average.map(|v| if length > 0. { v * cap / length } else { 0. }),
            };
            let middle: [f64; 2] =
                std::array::from_fn(|i| 3. * average[i] - initial[i] - terminal[i]);
            let peak = initial[0]
                .hypot(initial[1])
                .max(middle[0].hypot(middle[1]))
                .max(terminal[0].hypot(terminal[1]));
            let acceleration = 2. / duration
                * (middle[0] - initial[0])
                    .hypot(middle[1] - initial[1])
                    .max((terminal[0] - middle[0]).hypot(terminal[1] - middle[1]));
            if peak > cap || acceleration > model.air_acceleration.unwrap_or(0.) {
                return Ok(None);
            }
            let at = |time: f64| {
                let t = time / duration;
                std::array::from_fn(|i| {
                    launch[i * 2]
                        + duration
                            * (initial[i] * t
                                + (middle[i] - initial[i]) * t * t
                                + (terminal[i] - 2. * middle[i] + initial[i]) * t * t * t / 3.)
                })
            };
            let mut air_points = vec![launch];
            let mut air_times = vec![0.];
            let mut elapsed = 0.;
            for (i, phase) in phases.iter().enumerate() {
                let count = (phase.time / 0.025).ceil() as usize;
                for step in 1..=count {
                    if !advance(
                        self,
                        *phase,
                        elapsed,
                        phase.time * (step - 1) as f64 / count as f64,
                        phase.time * step as f64 / count as f64,
                        i + 1 == phases.len() && step == count,
                        end,
                        acceleration,
                        &at,
                        &mut air_points,
                        &mut air_times,
                    )? {
                        return Ok(None);
                    }
                }
                elapsed += phase.time;
            }
            arc = Connection::new("run-off-air".into(), Mode::Drop, air_points, air_times);
            times = distances.iter().map(|d| d / speed).collect::<Vec<_>>();
        }
        let offset = *times.last().unwrap();
        points.extend(arc.points.drain(1..));
        times.extend(arc.times.drain(1..).map(|t| t + offset));
        let mut c = Connection::new("run-off".into(), Mode::Drop, points, times);
        let mut m = serde_json::to_value(model).unwrap();
        m.as_object_mut().unwrap().retain(|_, v| !v.is_null());
        m["profile"] = serde_json::to_value(self.movement.profile).unwrap();
        m["maxSlope"] = serde_json::json!(self.movement.max_slope);
        c.extra.insert("flight".into(),serde_json::json!({"kind":"run-off","start":start,"end":end,"model":m,"control":control}));
        Ok(Some(c))
    }
}
#[allow(clippy::too_many_arguments)]
fn advance(
    w: &World,
    phase: Phase,
    elapsed: f64,
    low: f64,
    high: f64,
    last: bool,
    end: Vec3,
    horizontal_acceleration: f64,
    horizontal_at: &impl Fn(f64) -> [f64; 2],
    points: &mut Vec<Vec3>,
    times: &mut Vec<f64>,
) -> Result<bool, String> {
    let t = elapsed + high;
    let xz = horizontal_at(t);
    let point = if last {
        end
    } else {
        [
            xz[0],
            phase.y + phase.v * high + phase.a * high * high / 2.,
            xz[1],
        ]
    };
    let inflation = phase.a.hypot(horizontal_acceleration) * (high - low).powi(2) / 8.;
    if !w.clear(*points.last().unwrap(), point, inflation)? {
        if high - low <= 0.025 / 16. {
            return Ok(false);
        }
        let mid = (low + high) / 2.;
        return Ok(advance(
            w,
            phase,
            elapsed,
            low,
            mid,
            false,
            end,
            horizontal_acceleration,
            horizontal_at,
            points,
            times,
        )? && advance(
            w,
            phase,
            elapsed,
            mid,
            high,
            last,
            end,
            horizontal_acceleration,
            horizontal_at,
            points,
            times,
        )?);
    }
    points.push(point);
    times.push(t);
    Ok(true)
}

fn append_support(
    w: &World,
    d: f64,
    p: Vec3,
    spacing: f64,
    support_at: &impl Fn(f64, Vec3) -> Result<Option<Vec3>, String>,
    points: &mut Vec<Vec3>,
    distances: &mut Vec<f64>,
) -> Result<bool, String> {
    let previous = *points.last().unwrap();
    let low = *distances.last().unwrap();
    if !w.clear(previous, p, 0.)? {
        if d - low <= spacing / 128. {
            return Ok(false);
        }
        let mid = (d + low) / 2.;
        let Some(q) = support_at(mid, previous)? else {
            return Ok(false);
        };
        return Ok(
            append_support(w, mid, q, spacing, support_at, points, distances)?
                && append_support(w, d, p, spacing, support_at, points, distances)?,
        );
    }
    points.push(p);
    distances.push(d);
    Ok(true)
}
