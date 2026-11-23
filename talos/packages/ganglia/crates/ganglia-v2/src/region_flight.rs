use crate::{flight, geometry::*, types::*, world::World};
use serde::Serialize;
use std::time::Instant;

// Local refinement for a pair of support patches. Bound physical checks even
// when the annotated footprints are wide or collision rejects every candidate.
const GRID_STEPS: usize = 8;
const SWEEPS: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Search {
    departure_contacts: usize,
    landing_contacts: usize,
    candidates: usize,
    sweeps: usize,
    attachment_rejections: usize,
    elapsed_ms: f64,
    witness: Option<Witness>,
}

#[derive(Serialize)]
struct Witness {
    from: Point,
    to: Point,
    mode: &'static str,
}

#[derive(Clone, Copy)]
enum Motion {
    Drop,
    Jump,
}

impl Motion {
    fn time(self, model: &Model, from: f64, to: f64) -> Option<f64> {
        match self {
            Self::Drop => flight::drop_duration(model, from, to),
            Self::Jump => flight::duration(model, from, to),
        }
    }

    fn prove(self, world: &World, from: Point, to: Point) -> Option<Segment> {
        match self {
            Self::Drop => world.drop(from, to),
            Self::Jump => world.jump(from, to, None),
        }
    }
}

fn contacts(world: &World, bounds: Bounds) -> Vec<Point> {
    if !bounds.min.iter().zip(bounds.max).all(|(&lo, hi)| lo <= hi) {
        return Vec::new();
    }
    let spacing = world.physical.ground.options.profile.radius.max(0.1);
    let coordinates = |axis: usize| {
        let (lo, hi) = (bounds.min[axis], bounds.max[axis]);
        let steps = (((hi - lo) / spacing).ceil() as usize).min(GRID_STEPS);
        (0..=steps).map(move |i| {
            let t = i as f64 / steps.max(1) as f64;
            lo * (1. - t) + hi * t
        })
    };
    let y = bounds.min[1] * 0.5 + bounds.max[1] * 0.5;
    let tolerance = bounds.max[1] - y;
    coordinates(0)
        .flat_map(|x| coordinates(2).map(move |z| [x, y, z]))
        .filter_map(|point| world.project(point, tolerance))
        .filter(|&point| {
            bounds.overlaps(Bounds::points(&[point])) && !world.blocked(point, point, 0.)
        })
        .collect()
}

pub(super) fn find(world: &World, from_bounds: Bounds, to: Bounds) -> (Option<Segment>, Search) {
    let (action, search) = find_attached(world, from_bounds, to, |_| Some(()));
    (action.map(|(action, ())| action), search)
}

pub(super) fn find_attached<T>(
    world: &World,
    from_bounds: Bounds,
    to: Bounds,
    mut attach: impl FnMut(&Segment) -> Option<T>,
) -> (Option<(Segment, T)>, Search) {
    let started = Instant::now();
    let departure_center = lerp(from_bounds.min, from_bounds.max, 0.5);
    let landing_center = lerp(to.min, to.max, 0.5);
    let starts = contacts(world, from_bounds);
    let ends = contacts(world, to);
    let model = &world.physical.movement.model;
    let speed = model
        .max_horizontal_speed
        .min(world.physical.movement.run_air_speed);
    let motions = [Motion::Drop, Motion::Jump];
    let index = Index::new(
        &starts
            .iter()
            .map(|p| Bounds::points(&[*p]))
            .collect::<Vec<_>>(),
    );
    let highest = starts
        .iter()
        .map(|p| p[1])
        .fold(f64::NEG_INFINITY, f64::max);
    let mut candidates = [Vec::new(), Vec::new()];
    for to in ends.iter().copied() {
        // From this landing, the highest departure gives an upper bound on
        // airtime. Look backwards within that horizontal range, then compute
        // the tighter range at each proposed takeoff's actual height.
        let range = motions
            .iter()
            .filter_map(|motion| motion.time(model, highest, to[1]))
            .fold(0., f64::max)
            .min(60.)
            * speed
            + 1e-9;
        let mut envelope = Bounds::points(&[to]).expand(range);
        envelope.min[1] = to[1] - model.max_jump_height - 1e-9;
        envelope.max[1] = highest;
        index.query(envelope, |i| {
            let from = starts[i];
            let span = horizontal(from, to);
            for (kind, motion) in motions.into_iter().enumerate() {
                if let Some(time) = motion.time(model, from[1], to[1])
                    && time > 0.
                    && time <= 60.
                    && span <= time * speed + 1e-9
                {
                    let required_speed = span / time;
                    let rank = match motion {
                        Motion::Drop => {
                            // A slow exit can hit the takeoff ledge immediately
                            // after falling. Try the side facing the landing
                            // and faster horizontal separation first.
                            let lip = [
                                to[0].clamp(from_bounds.min[0], from_bounds.max[0]),
                                from[1],
                                to[2].clamp(from_bounds.min[2], from_bounds.max[2]),
                            ];
                            (horizontal(from, lip), -required_speed)
                        }
                        // Samples at both facing edges can run into a barrier
                        // before gaining height. Start inside the patches.
                        Motion::Jump => (
                            horizontal(from, departure_center) + horizontal(to, landing_center),
                            time,
                        ),
                    };
                    candidates[kind].push((rank, motion, from, to));
                }
            }
            false
        });
    }
    let candidate_count = candidates.iter().map(Vec::len).sum();
    for group in &mut candidates {
        group.sort_unstable_by(|(a, ..), (b, ..)| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    }
    // Direct falls and jumps clear different obstacles. Give both a chance
    // before either can exhaust the collision budget.
    let [mut drops, mut jumps] = candidates.each_ref().map(|group| group.iter());
    let mut sweeps = 0;
    let mut attachment_rejections = 0;
    let action = (0..SWEEPS)
        .flat_map(|_| [drops.next(), jumps.next()].into_iter().flatten())
        .take(SWEEPS)
        .find_map(|&(_, motion, from, to)| {
            sweeps += 1;
            let flight = motion.prove(world, from, to)?;
            let attachment = attach(&flight);
            attachment_rejections += usize::from(attachment.is_none());
            attachment.map(|value| (flight, value))
        });
    let stats = Search {
        departure_contacts: starts.len(),
        landing_contacts: ends.len(),
        candidates: candidate_count,
        sweeps,
        attachment_rejections,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.,
        witness: action.as_ref().map(|(action, _)| Witness {
            from: action.start(),
            to: action.end(),
            mode: action.mode,
        }),
    };
    (action, stats)
}
