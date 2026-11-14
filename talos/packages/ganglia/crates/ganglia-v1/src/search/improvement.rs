//! Shared bounded candidate queue. Failed geometry does not retire the source's
//! other landing witnesses. Only proved actions enter the resource graph.
use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn discover(
    graph: &mut Graph,
    world: &crate::world::World,
    origins: &[Point],
    goal: Point,
    budget: usize,
    max_links: usize,
    speed: f64,
    authority: &str,
    truncated: &mut bool,
) -> Result<usize, String> {
    let began = std::time::Instant::now();
    let count = graph.points.len();
    let components = graph
        .points
        .iter()
        .map(|&p| {
            world.project(p, None).ok().and_then(|hits| {
                hits.first()
                    .and_then(|p| world.support_component(&p.surface))
            })
        })
        .collect::<Vec<_>>();
    let eligible = vec![true; count];
    let mut actions = Vec::new();
    for (from, edges) in graph.edges.iter().enumerate() {
        for edge in edges {
            actions.push((
                graph.points[from],
                graph.points[edge.to],
                edge.segment.times.last().copied().unwrap_or(0.) * speed,
            ));
        }
    }
    let fields = world.discovery_fields(origins, goal, &actions)?;
    let costs = graph
        .points
        .iter()
        .map(|&p| fields.costs(p))
        .collect::<Result<Vec<_>, _>>()?;
    profile("improvement-fields", &began, costs.len());
    let mut sources = (0..count).collect::<Vec<_>>();
    sources.sort_by(|&a, &b| costs[a].0.total_cmp(&costs[b].0).then(a.cmp(&b)));
    let mut candidates = Vec::new();
    for from in sources {
        crate::cancel::check()?;
        let start = graph.points[from];
        let head = costs[from].0 / speed;
        let targets = rank_action_targets(graph, from, world, 1., &components, &eligible)?;
        let mut landings = targets
            .into_iter()
            .take(32)
            .map(|id| (graph.points[id], costs[id].1))
            .collect::<Vec<_>>();
        landings.extend(continuous_landings(
            world,
            start,
            goal,
            max_links,
            &|surface, p| fields.surface_costs(surface, p).1,
        )?);
        for (end, tail) in landings {
            for mode in [crate::model::Mode::Drop, crate::model::Mode::Jump] {
                if !free_flight_reaches(world, start, end, mode, 1.)? {
                    continue;
                }
                if let Some(duration) = world.flight_duration(start[1], end[1], mode)? {
                    // Ranking is deliberately non-authoritative. The 3D tail
                    // distinguishes a nearby upper floor from a useful descent.
                    let score = head + duration + tail / speed;
                    candidates.push((score, from, end, mode));
                }
            }
        }
    }
    profile("improvement-proposals", &began, candidates.len());
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let diameter = (world.movement.profile.radius * 2.).max(0.25);
    let cell = |p: Point| p.map(|v| (v / diameter).floor() as i64);
    // Keep the TS hierarchy: fine witnesses within a launch/landing cell,
    // destinations within a launch, then spatially interleaved launches. A
    // dense nearby railing must not consume every physical attempt.
    let mut pairs = Vec::<Vec<_>>::new();
    let mut pair_ids = std::collections::HashMap::new();
    let mut seen = std::collections::HashSet::new();
    for candidate in candidates {
        let (_, from, end, mode) = candidate;
        if !seen.insert((
            graph.points[from].map(f64::to_bits),
            end.map(f64::to_bits),
            matches!(mode, crate::model::Mode::Jump),
        )) {
            continue;
        }
        let key = (cell(graph.points[from]), cell(end));
        let id = *pair_ids.entry(key).or_insert_with(|| {
            pairs.push(Vec::new());
            pairs.len() - 1
        });
        if pairs[id].len() < 20 {
            pairs[id].push(candidate);
        }
    }
    let mut launches = Vec::<Vec<usize>>::new();
    let mut launch_ids = std::collections::HashMap::new();
    for (id, pair) in pairs.iter().enumerate() {
        let key = cell(graph.points[pair[0].1]);
        let launch = *launch_ids.entry(key).or_insert_with(|| {
            launches.push(Vec::new());
            launches.len() - 1
        });
        launches[launch].push(id);
    }
    let ordered = spread_launches(
        &launches,
        &pairs,
        graph,
        world.movement.max_horizontal_distance / 2.,
        diameter,
    );
    let mut selected = Vec::new();
    for rank in 0..launches.iter().map(Vec::len).max().unwrap_or(0) {
        for &launch in &ordered {
            if let Some(&pair) = launches[launch].get(rank) {
                selected.push(pair);
            }
        }
    }
    selected.truncate(max_links.saturating_mul(2).min(budget));
    let mut queue = Vec::new();
    for rank in 0..selected
        .iter()
        .map(|&id| pairs[id].len())
        .max()
        .unwrap_or(0)
    {
        for &pair in &selected {
            if let Some(&candidate) = pairs[pair].get(rank) {
                queue.push((pair, candidate));
            }
        }
    }
    profile("improvement-queue", &began, queue.len());
    let mut accepted = std::collections::HashSet::new();
    let mut attempts = 0;
    let before = graph.generated.len();
    for (pair, (_, from, end, mode)) in queue {
        if accepted.contains(&pair) {
            continue;
        }
        if attempts == budget || accepted.len() == max_links {
            *truncated = true;
            break;
        }
        let Some(end) = optional_proof(world.standing_foot(end), truncated)? else {
            continue;
        };
        attempts += 1;
        if let Some(connection) =
            optional_proof(world.flight(graph.points[from], end, mode), truncated)?
        {
            let mut segment: Segment = serde_json::from_value(
                serde_json::to_value(connection).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            classify_flight(&mut segment, world.movement.run_air_speed);
            graph.generated(from, segment, false, None, authority)?;
            accepted.insert(pair);
        }
    }
    if std::env::var_os("GANGLIA_PROFILE").is_some() {
        eprintln!(
            "{}",
            json!({"native":"search","phase":"shared-candidates",
            "sources":count,"attempts":attempts,"accepted":graph.generated.len()-before})
        );
    }
    Ok(attempts)
}

// Recursively visit coarse regions before refining neighboring body-sized cells.
fn spread_launches(
    launches: &[Vec<usize>],
    pairs: &[Vec<(f64, usize, Point, crate::model::Mode)>],
    graph: &Graph,
    size: f64,
    diameter: f64,
) -> Vec<usize> {
    fn spread(ids: Vec<usize>, points: &[Point], size: f64, diameter: f64) -> Vec<usize> {
        if ids.len() < 2 || size <= diameter {
            return ids;
        }
        let mut groups = Vec::<Vec<usize>>::new();
        let mut keys = std::collections::HashMap::new();
        for id in ids {
            let key = points[id].map(|v| (v / size).floor() as i64);
            let group = *keys.entry(key).or_insert_with(|| {
                groups.push(Vec::new());
                groups.len() - 1
            });
            groups[group].push(id);
        }
        let groups = groups
            .into_iter()
            .map(|ids| spread(ids, points, size / 2., diameter))
            .collect::<Vec<_>>();
        let mut result = Vec::new();
        for rank in 0..groups.iter().map(Vec::len).max().unwrap_or(0) {
            for group in &groups {
                if let Some(&id) = group.get(rank) {
                    result.push(id);
                }
            }
        }
        result
    }
    let points = launches
        .iter()
        .map(|launch| graph.points[pairs[launch[0]][0].1])
        .collect::<Vec<_>>();
    spread((0..launches.len()).collect(), &points, size, diameter)
}

// Continuous face witnesses follow the TS landing generator: nearest launch,
// nearest goal, center, and inset intersections with the flight envelope.
fn continuous_landings(
    world: &crate::world::World,
    start: Point,
    goal: Point,
    limit: usize,
    tail: &impl Fn(&str, Point) -> f64,
) -> Result<Vec<(Point, f64)>, String> {
    let reach = free_flight_range(
        world,
        start[1],
        start[1] - world.movement.max_drop,
        crate::model::Mode::Jump,
        1.,
    )?
    .unwrap_or(0.);
    let mut result = Vec::new();
    let mut surfaces = Vec::new();
    for owner in world.surface_candidates(&crate::model::Bounds {
        min: [start[0] - reach, start[2] - reach],
        max: [start[0] + reach, start[2] + reach],
    }) {
        let surface = &world.surfaces[owner];
        let height = surface
            .vertices
            .iter()
            .map(|p| p[1])
            .fold(f64::INFINITY, f64::min);
        if height > start[1] + world.movement.model.max_jump_height
            || start[1] - height > world.movement.max_drop
        {
            continue;
        }
        let Some(reach) = free_flight_range(world, start[1], height, crate::model::Mode::Jump, 1.)?
        else {
            continue;
        };
        let min = [0, 2].map(|axis| {
            surface
                .vertices
                .iter()
                .map(|p| p[axis])
                .fold(f64::INFINITY, f64::min)
        });
        let max = [0, 2].map(|axis| {
            surface
                .vertices
                .iter()
                .map(|p| p[axis])
                .fold(f64::NEG_INFINITY, f64::max)
        });
        let gap = |p: Point| {
            (min[0] - p[0])
                .max(p[0] - max[0])
                .max(0.)
                .hypot((min[1] - p[2]).max(p[2] - max[1]).max(0.))
        };
        if gap(start) > reach + EPS {
            continue;
        }
        let duration = world
            .flight_duration(start[1], height, crate::model::Mode::Jump)?
            .unwrap_or(f64::INFINITY);
        surfaces.push((duration + gap(goal) / world.movement.speed, owner, reach));
    }
    surfaces.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    // Bounded neighbor work precedes endpoint projection and physical controls,
    // as in TS's landing query. Mesh density cannot allocate millions of pairs.
    for (_, owner, reach) in surfaces.into_iter().take(limit) {
        let surface = &world.surfaces[owner];
        let center = std::array::from_fn(|axis| {
            surface.vertices.iter().map(|p| p[axis]).sum::<f64>() / surface.vertices.len() as f64
        });
        for seed in [start, goal, center] {
            if let Some(p) = crate::mesh::closest_on_surface(surface, seed)
                && horizontal(start, p) <= reach + EPS
            {
                result.push((p, tail(&surface.id, p)));
            }
        }
        for (i, &a) in surface.vertices.iter().enumerate() {
            let b = surface.vertices[(i + 1) % surface.vertices.len()];
            let dx = b[0] - a[0];
            let dz = b[2] - a[2];
            let squared = dx * dx + dz * dz;
            if squared == 0. {
                continue;
            }
            let x = a[0] - start[0];
            let z = a[2] - start[2];
            let linear = 2. * (x * dx + z * dz);
            let discriminant = linear * linear - 4. * squared * (x * x + z * z - reach * reach);
            if discriminant < 0. {
                continue;
            }
            let roots = [
                (-linear - discriminant.sqrt()) / (2. * squared),
                (-linear + discriminant.sqrt()) / (2. * squared),
            ];
            for root in roots {
                if !(0. ..=1.).contains(&root) {
                    continue;
                }
                for clearance in [
                    world.movement.profile.radius / 4.,
                    world.movement.profile.radius / 2.,
                ] {
                    let middle = (roots[0] + roots[1]) / 2.;
                    let fraction = (root
                        + (middle - root).signum()
                            * (middle - root).abs().min(clearance / squared.sqrt()))
                    .clamp(0., 1.);
                    let p = crate::geometry::mix(a, b, fraction);
                    let span = horizontal(p, center);
                    let inset = if span == 0. {
                        0.
                    } else {
                        (clearance / span).min(1.)
                    };
                    let p = crate::geometry::mix(p, center, inset);
                    result.push((p, tail(&surface.id, p)));
                }
            }
        }
    }
    Ok(result)
}
