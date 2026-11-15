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
    if budget == 0 {
        return Ok(0);
    }
    let original = graph.points.len();
    let mut used = batch(
        graph,
        world,
        origins,
        goal,
        Batch {
            sources: 0..original,
            attempts: budget,
            links: max_links,
            candidates: max_links.saturating_mul(2),
            refining: false,
        },
        speed,
        authority,
        truncated,
    )?;
    let remaining = budget - used;
    if remaining >= 2 {
        let points = fine_departures(
            graph,
            world,
            origins,
            goal,
            speed,
            max_links.saturating_mul(2),
            truncated,
        )?;
        let first = graph.points.len();
        for point in points {
            graph.node(point);
        }
        let end = graph.points.len();
        if first < end {
            used += batch(
                graph,
                world,
                origins,
                goal,
                Batch {
                    sources: first..end,
                    attempts: remaining,
                    links: max_links.div_ceil(8),
                    candidates: max_links.saturating_mul(2).min(remaining / 2),
                    refining: true,
                },
                speed,
                authority,
                truncated,
            )?;
        }
    }
    Ok(used)
}
fn fields<'a>(
    graph: &Graph,
    world: &'a crate::world::World,
    origins: &[Point],
    goal: Point,
    speed: f64,
) -> Result<crate::world::discovery::Fields<'a>, String> {
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
    world.discovery_fields(origins, goal, &actions)
}

// TS local refinement keeps fine launch witnesses separate from the broad seed
// pool. Rank nav proposals first; standing and swept-flight proofs still decide
// admission. This phase only consumes attempts left by the retained broad queue.
#[allow(clippy::too_many_arguments)]
fn fine_departures(
    graph: &Graph,
    world: &crate::world::World,
    origins: &[Point],
    goal: Point,
    speed: f64,
    limit: usize,
    truncated: &mut bool,
) -> Result<Vec<Point>, String> {
    let fields = fields(graph, world, origins, goal, speed)?;
    let radius = world.movement.profile.radius;
    let diameter = (radius * 2.).max(0.25);
    let margin = world.movement.model.max_horizontal_speed.max(diameter);
    let bounds = crate::model::Bounds {
        min: [0, 2].map(|axis| {
            origins
                .iter()
                .map(|p| p[axis])
                .chain(std::iter::once(goal[axis]))
                .fold(f64::INFINITY, f64::min)
                - margin
        }),
        max: [0, 2].map(|axis| {
            origins
                .iter()
                .map(|p| p[axis])
                .chain(std::iter::once(goal[axis]))
                .fold(f64::NEG_INFINITY, f64::max)
                + margin
        }),
    };
    let mut cells = std::collections::BTreeMap::new();
    for boundary in world.support_boundaries(bounds)? {
        crate::cancel::check()?;
        let [a, b] = boundary.points;
        if origins
            .iter()
            .map(|p| (p[1] - a[1]).abs().min((p[1] - b[1]).abs()))
            .fold(f64::INFINITY, f64::min)
            > world.movement.model.max_jump_height.max(3.)
        {
            continue;
        }
        let d = geometry::sub(b, a);
        let squared = d[0] * d[0] + d[2] * d[2];
        let count = (squared.sqrt() / diameter.max(0.5)).ceil().max(1.) as usize;
        let mut fractions = (0..=count)
            .map(|i| i as f64 / count as f64)
            .collect::<Vec<_>>();
        for p in origins.iter().chain(std::iter::once(&goal)) {
            if squared > 0. {
                fractions
                    .push((((p[0] - a[0]) * d[0] + (p[2] - a[2]) * d[2]) / squared).clamp(0., 1.));
            }
        }
        for fraction in fractions {
            let p = crate::geometry::mix(a, b, fraction);
            for inset in [
                0.,
                radius,
                1.,
                2.,
                3.,
                0.5,
                1.5,
                2.5,
                radius * 0.5,
                radius * 0.25,
            ] {
                let p = std::array::from_fn(|axis| p[axis] + boundary.inward[axis] * inset);
                let (head, tail) = fields.surface_costs(&boundary.surface, p);
                let score = head + tail;
                if !score.is_finite() {
                    continue;
                }
                let key = p.map(|v| (v / diameter).floor() as i64);
                let entry = cells.entry(key).or_insert((score, p));
                if score < entry.0 {
                    *entry = (score, p);
                }
            }
        }
    }
    let mut seeds = cells.into_values().collect::<Vec<_>>();
    seeds.sort_by(|a, b| {
        a.0.total_cmp(&b.0)
            .then_with(|| a.1[0].total_cmp(&b.1[0]))
            .then_with(|| a.1[2].total_cmp(&b.1[2]))
    });
    let points = seeds.into_iter().map(|(_, p)| p).collect::<Vec<_>>();
    let mut result = Vec::new();
    for id in spread((0..points.len()).collect(), &points, margin, diameter) {
        if result.len() == limit {
            *truncated = true;
            break;
        }
        if let Some(p) = optional_proof(world.standing_foot(points[id]), truncated)? {
            result.push(p);
        }
    }
    Ok(result)
}

struct Batch {
    sources: std::ops::Range<usize>,
    attempts: usize,
    links: usize,
    candidates: usize,
    refining: bool,
}

#[allow(clippy::too_many_arguments)]
fn batch(
    graph: &mut Graph,
    world: &crate::world::World,
    origins: &[Point],
    goal: Point,
    work: Batch,
    speed: f64,
    authority: &str,
    truncated: &mut bool,
) -> Result<usize, String> {
    let Batch {
        sources: source_ids,
        attempts: budget,
        links: max_links,
        candidates: candidate_limit,
        refining,
    } = work;
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
    let fields = fields(graph, world, origins, goal, speed)?;
    let costs = graph
        .points
        .iter()
        .map(|&p| fields.costs(p))
        .collect::<Result<Vec<_>, _>>()?;
    profile("improvement-fields", &began, costs.len());
    let bound = if refining {
        fields.costs(goal)?.0 / speed
    } else {
        f64::INFINITY
    };
    let mut sources = source_ids.collect::<Vec<_>>();
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
        landings.extend(continuous_landings(world, start, goal, max_links, &fields)?);
        for (end, tail) in landings {
            for mode in [crate::model::Mode::Drop, crate::model::Mode::Jump] {
                if !free_flight_reaches(world, start, end, mode, 1.)? {
                    continue;
                }
                if let Some(duration) = world.flight_duration(start[1], end[1], mode)? {
                    // Ranking is deliberately non-authoritative. The 3D tail
                    // distinguishes a nearby upper floor from a useful descent.
                    let score = head + duration + tail / speed;
                    // The broad pass already discovers intermediate regions.
                    // This improvement queue spends its bounded control work on
                    // proposals with known approach and departure reachability.
                    if score < bound {
                        candidates.push((score, from, end, mode));
                    }
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
    selected.truncate(candidate_limit.min(budget));
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
    let mut retained = Vec::new();
    for (pair, (score, from, end, mode)) in queue {
        if accepted.contains(&pair) {
            continue;
        }
        if attempts == budget || (!refining && accepted.len() == max_links) {
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
            // TS shortcut refinement discards flights dominated by supported
            // walking. Keep these out of the resource graph as well: each extra
            // action otherwise creates labels and walking proofs downstream.
            if refining
                && let Some(crate::world::GroundProbe::Supported(path)) = optional_proof(
                    world.probe_ground(graph.points[from], end).map(Some),
                    truncated,
                )?
                && path.length / world.movement.speed <= segment.times.last().copied().unwrap_or(0.)
            {
                continue;
            }
            classify_flight(&mut segment, world.movement.run_air_speed);
            if refining {
                retained.push((score, from, segment));
            } else {
                graph.generated(from, segment, false, None, authority)?;
            }
            accepted.insert(pair);
        }
    }
    // Local refinement keeps the best proved actions, rather than the first
    // successes in spatial enumeration. Broad actions remain untouched.
    retained.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (_, from, segment) in retained.into_iter().take(max_links) {
        graph.generated(from, segment, false, None, authority)?;
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
    let points = launches
        .iter()
        .map(|launch| graph.points[pairs[launch[0]][0].1])
        .collect::<Vec<_>>();
    spread((0..launches.len()).collect(), &points, size, diameter)
}

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

// Continuous face witnesses follow the TS landing generator: nearest launch,
// nearest goal, center, and inset intersections with the flight envelope.
fn continuous_landings(
    world: &crate::world::World,
    start: Point,
    goal: Point,
    limit: usize,
    fields: &crate::world::discovery::Fields<'_>,
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
        let face = fields.face(owner);
        let height = face.height;
        if height > start[1] + world.movement.model.max_jump_height
            || start[1] - height > world.movement.max_drop
        {
            continue;
        }
        let Some(reach) = free_flight_range(world, start[1], height, crate::model::Mode::Jump, 1.)?
        else {
            continue;
        };
        let min = face.min;
        let max = face.max;
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
        let center = fields.face(owner).center;
        for seed in [start, goal, center] {
            if let Some(p) = crate::mesh::closest_on_surface(surface, seed)
                && horizontal(start, p) <= reach + EPS
            {
                result.push((p, fields.surface_costs(&surface.id, p).1));
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
                    result.push((p, fields.surface_costs(&surface.id, p).1));
                }
            }
        }
    }
    Ok(result)
}
