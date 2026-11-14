//! Native route search. Geometry, action discovery and continuation-state resource
//! scheduling live behind one solve interface; JSON is confined to this seam.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::cmp::Ordering;
use std::collections::BinaryHeap;
#[path = "search/geometry.rs"]
mod geometry;
#[path = "search/locomotion.rs"]
mod locomotion;
use geometry::{EPS, distance, lerp};
type Point = [f64; 3];
fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn point(v: &Value) -> Result<Point, String> {
    let p = array(v);
    if p.len() != 3 {
        return Err("expected finite xyz point".into());
    }
    let mut a = [0.; 3];
    for i in 0..3 {
        a[i] = p[i]
            .as_f64()
            .filter(|x| x.is_finite())
            .ok_or("expected finite xyz point")?;
    }
    Ok(a)
}
fn number(v: &Value, key: &str, default: f64) -> Result<f64, String> {
    if v[key].is_null() {
        return Ok(default);
    }
    v[key]
        .as_f64()
        .filter(|x| x.is_finite())
        .ok_or_else(|| format!("invalid {key}"))
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    mode: String,
    points: Vec<Point>,
    times: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gait: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    required_gait: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    traversal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    boost: Option<BoostUse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flight: Option<Value>,
    #[serde(flatten)]
    extra: std::collections::BTreeMap<String, Value>,
}
#[derive(Clone, Serialize, Deserialize)]
struct BoostUse {
    id: String,
    multiplier: f64,
    duration: f64,
}
struct Boost {
    usage: BoostUse,
    position: Point,
    interaction: Value,
}
struct Edge {
    to: usize,
    segment: Segment,
    terminal: bool,
    required_boost: Option<String>,
}
struct Graph {
    points: Vec<Point>,
    edges: Vec<Vec<Edge>>,
    generated: Vec<Value>,
}
impl Graph {
    fn node(&mut self, p: Point) -> usize {
        if let Some(i) = self.points.iter().position(|q| distance(p, *q) < EPS) {
            return i;
        }
        let i = self.points.len();
        self.points.push(p);
        self.edges.push(Vec::new());
        i
    }
    fn edge(
        &mut self,
        from: usize,
        to: usize,
        segment: Segment,
        terminal: bool,
        required_boost: Option<String>,
    ) {
        self.edges[from].push(Edge {
            to,
            segment,
            terminal,
            required_boost,
        });
    }
}
#[derive(Clone)]
struct Label {
    node: usize,
    stage: usize,
    cost: f64,
    arrival: f64,
    origin: usize,
    state: locomotion::State,
    parent: Option<usize>,
    segments: Vec<Segment>,
    boost: Option<usize>,
    remaining: f64,
    used_boost: Option<usize>,
    minimum: f64,
    dashes: usize,
    schedule: Option<Value>,
    active: bool,
}
#[derive(Clone, Copy)]
struct Queue {
    cost: f64,
    label: usize,
}
impl PartialEq for Queue {
    fn eq(&self, b: &Self) -> bool {
        self.cost == b.cost && self.label == b.label
    }
}
impl Eq for Queue {}
impl PartialOrd for Queue {
    fn partial_cmp(&self, b: &Self) -> Option<Ordering> {
        Some(self.cmp(b))
    }
}
impl Ord for Queue {
    fn cmp(&self, b: &Self) -> Ordering {
        b.cost
            .total_cmp(&self.cost)
            .then_with(|| b.label.cmp(&self.label))
    }
}

/// Solve an immutable prepared World using native search only.
/// Physical proofs and canonical paths come from World; all labels are query-local.
pub fn solve(world: &crate::world::World, query: &Value, config: &Value) -> Result<Value, String> {
    let mut best = solve_world(world, query, config)?;
    // Refinement repairs absent navigation coverage. A failed connection between
    // supported endpoints calls for action/window discovery, not rebuilding the
    // same raw geometry on every orchestration stage.
    let mut missing_support = false;
    if best["route"]["status"] != "complete"
        && world.snapshot()["kind"] == "physical"
        && config["physicalWork"]["step"].as_u64().unwrap_or(2) >= 2
        && budget(config, "maxCandidates", 8_000)? > 0
    {
        for start in array(&query["starts"]) {
            missing_support |= world.project(point(&start["position"])?, None)?.is_empty();
        }
        missing_support |= world.project(point(&query["goal"])?, None)?.is_empty();
        for waypoint in array(&query["waypoints"]) {
            missing_support |= world.project(point(waypoint)?, None)?.is_empty();
        }
    }
    if missing_support {
        let mut points = vec![point(&query["goal"])?];
        for s in array(&query["starts"]) {
            points.push(point(&s["position"])?);
        }
        for p in array(&query["waypoints"]) {
            points.push(point(p)?);
        }
        let margin = number(config, "margin", 2.)?.max(0.);
        let bounds = crate::model::Bounds {
            min: std::array::from_fn(|i| {
                points
                    .iter()
                    .map(|p| p[i * 2])
                    .fold(f64::INFINITY, f64::min)
                    - margin
            }),
            max: std::array::from_fn(|i| {
                points
                    .iter()
                    .map(|p| p[i * 2])
                    .fold(f64::NEG_INFINITY, f64::max)
                    + margin
            }),
        };
        let refined = world.refine(bounds)?;
        let candidate = solve_world(&refined, query, config)?;
        if better(&candidate, &best) {
            best = candidate;
        }
    }
    if best["route"]["status"] == "complete" {
        return Ok(best);
    }
    let mut placements = 0;
    let mut placement_truncated = false;
    let max_placements = budget(config, "maxShortcutCandidates", 64)?;
    'placements: for device in &world.devices.following_supports {
        let positions = following_positions(
            world,
            device,
            query,
            number(config, "sampleSpacing", 2.)?,
            max_placements.saturating_sub(placements) + 1,
        )?;
        for position in positions {
            if placements >= max_placements {
                placement_truncated = true;
                break 'placements;
            }
            placements += 1;
            if let Some(placed) = world.place_following(&device.id, position)? {
                // solve_world is the non-recursive core: this immutable pose is
                // evaluated once and cannot start another placement search.
                let mut candidate = solve_world(&placed, query, config)?;
                if candidate["route"]["status"] == "complete" {
                    candidate["route"]["placements"] =
                        json!([{"device":device.id,"position":position}]);
                    if better(&candidate, &best) {
                        best = candidate;
                    }
                }
            }
        }
    }
    if placement_truncated {
        best["diagnostics"]["truncated"] = json!(true);
        if best["route"]["search"].is_object() {
            best["route"]["search"]["truncated"] = json!(true);
        }
    }
    Ok(best)
}
fn following_positions(
    world: &crate::world::World,
    device: &crate::model::FollowingSupport,
    query: &Value,
    spacing: f64,
    limit: usize,
) -> Result<Vec<Point>, String> {
    if spacing <= 0. {
        return Err("invalid placement sample spacing".into());
    }
    let mut positions = vec![device.spawn];
    let radius = device.max_distance;
    let bottom = device
        .bodies
        .iter()
        .flatten()
        .map(|p| p[1])
        .fold(f64::INFINITY, f64::min)
        - device.spawn[1];
    let mut add = |mut p: Point| {
        // A candidate pose rests on real support. Query heights describe feet
        // on the destination, which can be above the movable body's base.
        if let Ok(Some(ground)) =
            world.ground_at(p, world.movement.max_vertical, world.movement.max_drop, 0.)
        {
            p[1] = ground.position[1] - bottom;
        }
        if positions.len() < limit
            && distance(p, device.spawn) <= radius + EPS
            && !positions.iter().any(|&q| distance(p, q) < 1e-5)
        {
            positions.push(p);
        }
    };
    let goal = point(&query["goal"])?;
    let constrained = |p: Point| {
        let d = distance(p, device.spawn);
        if d > radius && d > EPS {
            lerp(device.spawn, p, radius / d)
        } else {
            p
        }
    };
    add(constrained(goal));
    for start in array(&query["starts"]) {
        if start["state"] != "available" {
            continue;
        }
        let from = point(&start["position"])?;
        add(constrained(from));
        let mut path = vec![from];
        for p in array(&query["waypoints"]) {
            path.push(point(p)?);
        }
        path.push(goal);
        if let Some(canonical) = world.ground_path(from, goal)? {
            path.extend(canonical.points);
        }
        for pair in path.windows(2) {
            let delta = geometry::sub(pair[1], pair[0]);
            let squared = geometry::dot(delta, delta);
            if squared < EPS * EPS {
                continue;
            }
            let offset = geometry::sub(pair[0], device.spawn);
            let mid = (-geometry::dot(offset, delta) / squared).clamp(0., 1.);
            add(constrained(lerp(pair[0], pair[1], mid)));
            let bb = 2. * geometry::dot(offset, delta);
            let cc = geometry::dot(offset, offset) - radius * radius;
            let disc = bb * bb - 4. * squared * cc;
            if disc < 0. {
                continue;
            }
            let lo = ((-bb - disc.sqrt()) / (2. * squared)).max(0.);
            let hi = ((-bb + disc.sqrt()) / (2. * squared)).min(1.);
            if lo > hi {
                continue;
            }
            let count = (((hi - lo) * squared.sqrt() / spacing).ceil() as usize)
                .max(1)
                .min(limit.max(1));
            for i in 0..=count {
                add(lerp(
                    pair[0],
                    pair[1],
                    lo + (hi - lo) * i as f64 / count as f64,
                ));
            }
        }
    }
    Ok(positions)
}
fn better(candidate: &Value, current: &Value) -> bool {
    candidate["route"]["status"] == "complete"
        && (current["route"]["status"] != "complete"
            || candidate["route"]["cost"].as_f64().unwrap_or(f64::INFINITY)
                < current["route"]["cost"].as_f64().unwrap_or(f64::INFINITY))
}

pub fn solve_snapshot(snapshot: &Value, query: &Value, config: &Value) -> Result<Value, String> {
    let input = if snapshot["kind"].is_string() {
        snapshot.clone()
    } else {
        json!({"kind":"surfaces","input":snapshot})
    };
    let world = crate::world::World::new(input)?;
    solve(&world, query, config)
}
fn solve_world(
    world: &crate::world::World,
    query: &Value,
    config: &Value,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let m = &world.movement;
    let snapshot = json!({"movement":{"speed":m.speed,"maxVertical":m.max_vertical,"profile":m.profile,"model":m.model,"locomotion":world.locomotion,"runAirSpeed":m.run_air_speed,"maxSlope":m.max_slope,"maxDrop":m.max_drop,"maxHorizontalDistance":m.max_horizontal_distance,"activeBoost":m.active_boost},"boosts":world.boosts});
    let geometry = geometry::Geometry::new(world)?;
    let stage = config["physicalWork"]["step"].as_u64().unwrap_or(2);
    let movement = &snapshot["movement"];
    let speed = number(movement, "speed", 1.)?;
    if speed <= 0. {
        return Err("movement speed must be positive".into());
    }
    let tolerance = number(movement, "maxVertical", 0.5)?;
    if tolerance < 0. {
        return Err("negative projection tolerance".into());
    }
    let has_locomotion = movement["locomotion"].is_object();
    let options: locomotion::ScheduleOptions = if has_locomotion {
        serde_json::from_value(movement["locomotion"].clone()).map_err(|e| e.to_string())?
    } else {
        serde_json::from_value(json!({"speed":speed,"sprintSpeed":speed,"sprintAcceleration":1.}))
            .map_err(|e| e.to_string())?
    };
    locomotion::validate_options(&options)?;
    let goal = point(&query["goal"])?;
    let interaction = &query["interaction"];
    validate_interaction(interaction)?;
    let mut waypoints = array(&query["waypoints"])
        .iter()
        .map(point)
        .collect::<Result<Vec<_>, _>>()?;
    for p in &mut waypoints {
        if let Some(q) = geometry.project(*p, tolerance) {
            *p = q;
        }
    }
    let mut boosts = Vec::new();
    for b in array(&snapshot["boosts"]).iter().filter(|_| stage >= 1) {
        validate_interaction(&b["interaction"])?;
        let usage: BoostUse = serde_json::from_value(b.clone()).map_err(|e| e.to_string())?;
        if usage.duration <= 0. || usage.multiplier <= 1. {
            return Err("invalid boost".into());
        }
        boosts.push(Boost {
            usage,
            position: point(&b["position"])?,
            interaction: b["interaction"].clone(),
        });
    }
    let mut graph = Graph {
        points: Vec::new(),
        edges: Vec::new(),
        generated: Vec::new(),
    };
    let starts = array(&query["starts"]);
    let mut seeds = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for (i, s) in starts.iter().enumerate() {
        let id = s["id"].as_str().ok_or("arrival id missing")?;
        if !ids.insert(id) {
            return Err("duplicate arrival id".into());
        }
        let cost = number(s, "cost", 0.)?;
        if cost < 0. {
            return Err("negative arrival cost".into());
        }
        let p = point(&s["position"])?;
        if !matches!(
            s["state"].as_str(),
            Some("available" | "locked" | "unknown")
        ) {
            return Err("invalid arrival state".into());
        }
        if s["state"] != "available" {
            continue;
        }
        if let Some(p) = geometry.project(p, tolerance)
            && geometry.clear(p, p, 0.)
        {
            seeds.push((graph.node(p), i, cost));
        }
    }
    let mut targets = Vec::new();
    if interaction["airborne"] == true {
        targets.push(graph.node(goal));
    } else if interaction.is_object() {
        for p in geometry.interaction(goal, interaction)? {
            if hit(p, p, goal, interaction).is_some() {
                targets.push(graph.node(p));
            }
        }
    } else if let Some(p) = geometry.project(goal, tolerance) {
        targets.push(graph.node(p));
    }
    for p in &waypoints {
        if let Some(q) = geometry.project(*p, tolerance) {
            graph.node(q);
        }
    }
    for b in &boosts {
        for p in geometry.interaction(b.position, &b.interaction)? {
            if hit(p, p, b.position, &b.interaction).is_some() {
                graph.node(p);
            }
        }
    }
    // Boundary samples supply takeoffs, landings and turns. Endpoints are retained
    // independently of polygon representatives, avoiding centre-only device detours.
    let spacing = number(config, "sampleSpacing", 2.)?;
    if spacing <= 0. {
        return Err("invalid sample spacing".into());
    }
    let max_candidates = if stage >= 2 {
        budget(config, "maxCandidates", 256)?
    } else {
        0
    };
    let max_links = budget(config, "maxLinks", 64)?.max(1);
    // Work and retained geometry are different budgets. Dense detail meshes
    // must not turn a bounded trajectory search into an all-pairs mesh graph.
    let sample_budget = max_candidates.min(max_links.saturating_mul(2));
    let mut truncated = false;
    let mut samples = 0;
    let anchors = graph.points.clone();
    let center = |s: &crate::model::Surface| {
        std::array::from_fn(|axis| {
            s.vertices.iter().map(|p| p[axis]).sum::<f64>() / s.vertices.len() as f64
        })
    };
    let proximity = |p: Point| {
        let near = anchors
            .iter()
            .map(|&q| distance(p, q))
            .fold(f64::INFINITY, f64::min);
        let mut corridor = f64::INFINITY;
        for arrival in starts.iter().filter(|a| a["state"] == "available") {
            if let Ok(mut from) = point(&arrival["position"]) {
                for to in waypoints.iter().copied().chain(std::iter::once(goal)) {
                    let delta = geometry::sub(to, from);
                    let length = geometry::dot(delta, delta);
                    let t = if length > 0. {
                        (geometry::dot(geometry::sub(p, from), delta) / length).clamp(0., 1.)
                    } else {
                        0.
                    };
                    corridor = corridor.min(distance(p, lerp(from, to, t)));
                    from = to;
                }
            }
        }
        corridor + near * 0.05
    };
    // Retain spatially diverse support interfaces instead of filling the graph
    // with adjacent detail triangles around an endpoint. Connectivity is part of
    // each key, so nearby disconnected narrow supports keep representatives.
    let mut regions = std::collections::BTreeMap::new();
    let sampling = if sample_budget > 0 {
        world.surfaces.as_slice()
    } else {
        &[]
    };
    for surface in sampling {
        let p = center(surface);
        let key = (
            (p[0] / 4.).floor() as i64,
            (p[1] / 3.).floor() as i64,
            (p[2] / 4.).floor() as i64,
            world.support_component(&surface.id).unwrap_or(usize::MAX),
        );
        let score = proximity(p);
        let candidate = (score, surface);
        let entry = regions.entry(key).or_insert(candidate);
        if score < entry.0 {
            *entry = candidate;
        }
    }
    let mut selected = regions.into_values().collect::<Vec<_>>();
    selected.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)));
    let face_budget = sample_budget.div_ceil(4);
    if selected.len() > face_budget {
        truncated |= stage >= 2;
        selected.truncate(face_budget);
    }
    let surfaces = selected
        .into_iter()
        .map(|(_, surface)| surface)
        .collect::<Vec<_>>();
    let centers = surfaces
        .iter()
        .map(|s| {
            std::array::from_fn(|i| {
                s.vertices.iter().map(|p| p[i]).sum::<f64>() / s.vertices.len() as f64
            })
        })
        .collect::<Vec<Point>>();
    let mut candidates = centers.clone();
    // Nearby supported takeoffs matter more than spending the whole budget on
    // one large polygon's perimeter. Radial candidates let a grounded approach
    // clear the side of an elevated landing or movable body before contact.
    let airtime = world
        .flight_duration(0., 0., crate::model::Mode::Jump)?
        .unwrap_or(0.);
    let reach = (airtime * world.movement.model.max_horizontal_speed * 0.65)
        .max(world.movement.profile.radius * 2.);
    let direction = anchors
        .first()
        .map(|a| [goal[0] - a[0], goal[2] - a[2]])
        .unwrap_or([1., 0.]);
    let length = direction[0].hypot(direction[1]);
    let direction = if length > EPS {
        direction.map(|x| x / length)
    } else {
        [1., 0.]
    };
    for direction in [direction, direction.map(|x| -x)] {
        for center in &centers {
            candidates.push([
                center[0] + direction[0] * reach,
                center[1],
                center[2] + direction[1] * reach,
            ]);
        }
    }
    let vertices = surfaces
        .iter()
        .map(|s| {
            let mut points = s.vertices.clone();
            points.sort_by(|&a, &b| proximity(a).total_cmp(&proximity(b)));
            points
        })
        .collect::<Vec<_>>();
    for i in 0..vertices.iter().map(Vec::len).max().unwrap_or(0) {
        for s in &vertices {
            if let Some(&p) = s.get(i) {
                candidates.push(p);
            }
        }
    }
    // The perimeter stage is lazy and independently bounded by the same budget.
    'samples: for p in candidates {
        if samples >= sample_budget {
            truncated = true;
            break 'samples;
        }
        if let Some(p) = world.standing_foot(p)? {
            let before = graph.points.len();
            graph.node(p);
            if graph.points.len() > before {
                samples += 1;
            }
        }
    }
    'perimeters: for s in surfaces {
        for i in 0..s.vertices.len() {
            let a = s.vertices[i];
            let b = s.vertices[(i + 1) % s.vertices.len()];
            let count = (distance(a, b) / spacing).ceil().max(1.) as usize;
            for k in 1..count {
                if samples >= sample_budget {
                    truncated = true;
                    break 'perimeters;
                }
                if let Some(p) = world.standing_foot(lerp(a, b, k as f64 / count as f64))? {
                    let before = graph.points.len();
                    graph.node(p);
                    if graph.points.len() > before {
                        samples += 1;
                    }
                }
            }
        }
    }
    // World ground paths already traverse the full portal graph. Portal vertices
    // are not extra search actions and do not enter this bounded action graph.
    let mut known_actions = world
        .known_actions()
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if stage == 0 {
        known_actions.clear();
    }
    if stage >= 1 {
        for connection in array(&config["catalogConnections"]) {
            if !known_actions.iter().any(|c| c["id"] == connection["id"]) {
                known_actions.push(connection.clone());
            }
        }
    }
    let mut known = Vec::new();
    let mut connection_ids = std::collections::HashSet::new();
    for c in &known_actions {
        let id = c["id"].as_str().ok_or("connection id missing")?;
        if !connection_ids.insert(id) {
            return Err("duplicate connection id".into());
        }
        let mut segment: Segment = serde_json::from_value(c.clone()).map_err(|e| e.to_string())?;
        validate_segment(&segment)?;
        if c["state"] != "open" {
            continue;
        }
        if segment.required_gait.is_some() && !has_locomotion {
            continue;
        }
        let a = segment.points[0];
        let b = *segment.points.last().unwrap();
        let terminal = c["terminal"] == true;
        let endpoint = number(c, "endpointTolerance", 1e-6)?;
        if endpoint < 0. || endpoint > tolerance.min(geometry.radius).max(1e-6) {
            return Err("invalid connection endpoint tolerance".into());
        }
        if geometry.project(a, endpoint).is_none()
            || (!terminal && geometry.project(b, endpoint).is_none())
        {
            continue;
        }
        if !segment
            .points
            .windows(2)
            .all(|p| geometry.clear(p[0], p[1], 0.))
        {
            continue;
        }
        let from = graph.node(a);
        let to = graph.node(b);
        segment.connection = Some(id.into());
        graph.edge(
            from,
            to,
            segment,
            terminal,
            c["requiredBoost"].as_str().map(str::to_owned),
        );
        known.push(c.clone());
    }
    let count = graph.points.len();
    profile("nodes", &started, count);
    let max_attempts = max_candidates;
    profile("graph", &started, count);
    let mut attempts = 0;
    if stage >= 2 && movement["model"].is_object() {
        'actions: for a in 0..count {
            if geometry.project(graph.points[a], 0.02).is_none() {
                continue;
            }
            let remaining = max_attempts.saturating_sub(attempts);
            if remaining == 0 {
                truncated = true;
                break;
            }
            let source_end = attempts + (remaining / (count - a).max(1)).max(1);
            let limit = ((source_end - attempts) / 2).max(1);
            let action_targets = graph.points[..count]
                .iter()
                .copied()
                .filter(|&p| {
                    graph.points[a][1] - p[1] <= world.movement.max_drop
                        && horizontal(graph.points[a], p) <= world.movement.max_horizontal_distance
                })
                .collect::<Vec<_>>();
            let discovery = world.discover_actions(graph.points[a], &action_targets, limit)?;
            attempts += discovery.attempts;
            truncated |= discovery.truncated;
            for connection in discovery.connections {
                let raw = serde_json::to_value(connection).map_err(|e| e.to_string())?;
                let mut segment: Segment =
                    serde_json::from_value(raw.clone()).map_err(|e| e.to_string())?;
                if segment.points.len() < 2 {
                    continue;
                }
                let end = *segment.points.last().unwrap();
                let terminal = interaction["airborne"] == true
                    && segment_hit(&segment, goal, interaction).is_some();
                classify_flight(&mut segment, world.movement.run_air_speed);
                if !terminal && geometry.project(end, 0.02).is_none() {
                    continue;
                }
                if terminal {
                    let Some(trimmed) = trim(segment, goal, interaction) else {
                        continue;
                    };
                    segment = trimmed;
                }
                if segment.required_gait.is_some() && !has_locomotion {
                    continue;
                }
                let to = graph.node(*segment.points.last().unwrap());
                let id = format!("rust/discovered/{a}/{}", graph.generated.len());
                segment.connection = Some(id.clone());
                let mut emitted = serde_json::to_value(&segment).map_err(|e| e.to_string())?;
                emitted["id"] = json!(id);
                emitted["state"] = json!("open");
                emitted["terminal"] = json!(terminal);
                graph.generated.push(emitted);
                graph.edge(a, to, segment, terminal, None);
            }
            'targets: for b in 0..count {
                if a == b {
                    continue;
                }
                let terminal = interaction["airborne"] == true && targets.contains(&b);
                if !terminal && geometry.project(graph.points[b], 0.02).is_none() {
                    continue;
                }
                for boost in std::iter::once(None).chain((0..boosts.len()).map(Some)) {
                    let multiplier = boost.map(|i| boosts[i].usage.multiplier).unwrap_or(1.);
                    let limit = number(movement, "maxHorizontalDistance", f64::MAX)? * multiplier;
                    if horizontal(graph.points[a], graph.points[b]) > limit {
                        continue;
                    }
                    for mode in ["drop", "jump"] {
                        if attempts >= max_attempts {
                            truncated = true;
                            break 'actions;
                        }
                        if attempts >= source_end {
                            truncated = true;
                            break 'targets;
                        }
                        if let Some(mut segment) = flight(
                            graph.points[a],
                            graph.points[b],
                            mode,
                            movement,
                            multiplier,
                            &geometry,
                            &mut attempts,
                            source_end,
                            if interaction["airborne"] == true {
                                Some((goal, interaction))
                            } else {
                                None
                            },
                        )? {
                            let terminal = terminal
                                || (interaction["airborne"] == true
                                    && segment_hit(&segment, goal, interaction).is_some());
                            if terminal {
                                let Some(trimmed) = trim(segment, goal, interaction) else {
                                    continue;
                                };
                                segment = trimmed;
                            }
                            let end = *segment.points.last().unwrap();
                            let to = graph.node(end);
                            let id = format!(
                                "rust/{a}/{b}/{mode}/{}",
                                boost.map(|i| i + 1).unwrap_or(0)
                            );
                            segment.connection = Some(id.clone());
                            let required = boost.map(|i| boosts[i].usage.id.clone());
                            let mut emitted =
                                serde_json::to_value(&segment).map_err(|e| e.to_string())?;
                            emitted["id"] = json!(id);
                            emitted["state"] = json!("open");
                            emitted["terminal"] = json!(terminal);
                            emitted["requiredBoost"] = json!(required);
                            graph.generated.push(emitted);
                            graph.edge(a, to, segment, terminal, required);
                        }
                    }
                }
            }
        }
    }
    let max_labels = budget(&movement["locomotion"]["search"], "maxLabels", 256)?.max(2);
    profile("actions", &started, attempts);
    let max_expanded = budget(&movement["locomotion"]["search"], "maxExpanded", 100_000)?;
    let mut arena = Vec::<Label>::new();
    let mut rows = vec![Vec::<usize>::new(); graph.points.len()];
    let mut queue = BinaryHeap::new();
    for (node, origin, cost) in seeds {
        let state = locomotion::initial(&options);
        let stage = advance_stage(&[graph.points[node]], 0, &waypoints);
        let label = Label {
            node,
            stage,
            cost,
            arrival: cost,
            origin,
            state,
            parent: None,
            segments: vec![],
            boost: None,
            remaining: 0.,
            used_boost: None,
            minimum: state.energy,
            dashes: 0,
            schedule: None,
            active: true,
        };
        insert(
            label,
            &mut arena,
            &mut rows,
            &mut queue,
            max_labels,
            &mut truncated,
        );
    }
    let mut expanded = 0;
    let mut winner = None;
    let mut walked = vec![false; graph.points.len()];
    while let Some(item) = queue.pop() {
        if !arena[item.label].active {
            continue;
        }
        let label = arena[item.label].clone();
        if label.stage == waypoints.len()
            && goal_at(
                graph.points[label.node],
                goal,
                interaction,
                &geometry,
                tolerance,
            )
        {
            winner = Some(item.label);
            break;
        }
        if expanded >= max_expanded {
            truncated = true;
            break;
        }
        expanded += 1;
        // A pickup is a zero-time state transition. A route can consume one pickup;
        // revisiting its trigger cannot mint unlimited duration or reset resources.
        if label.used_boost.is_none() {
            for (i, b) in boosts.iter().enumerate() {
                if hit(
                    graph.points[label.node],
                    graph.points[label.node],
                    b.position,
                    &b.interaction,
                )
                .is_some()
                {
                    let mut next = label.clone();
                    next.parent = Some(item.label);
                    next.segments.clear();
                    next.schedule = None;
                    next.boost = Some(i);
                    next.used_boost = Some(i);
                    next.remaining = b.usage.duration;
                    insert(
                        next,
                        &mut arena,
                        &mut rows,
                        &mut queue,
                        max_labels,
                        &mut truncated,
                    );
                }
            }
        }
        if !walked[label.node] {
            walked[label.node] = true;
            let p = graph.points[label.node];
            // Ground successors are materialized only from reached action nodes.
            // Resource labels reuse the same physical path proof without sharing
            // their entry energy, gait or cooldown state.
            for b in 0..graph.points.len() {
                if b == label.node {
                    continue;
                }
                let q = graph.points[b];
                if let Some(points) = geometry.path(p, q) {
                    if points.first().is_none_or(|a| distance(*a, p) > 1e-5)
                        || points.last().is_none_or(|b| distance(*b, q) > 1e-5)
                    {
                        continue;
                    }
                    graph.edge(
                        label.node,
                        b,
                        Segment {
                            mode: "walk".into(),
                            times: walk_times(&points, speed),
                            points,
                            ..Default::default()
                        },
                        false,
                        None,
                    );
                }
            }
        }
        for edge in &graph.edges[label.node] {
            if let Some(required) = &edge.required_boost
                && world.movement.active_boost.as_ref() != Some(required)
                && !label.boost.is_some_and(|i| boosts[i].usage.id == *required)
            {
                continue;
            }
            let mut segment = edge.segment.clone();
            if let Some(i) = label.boost {
                segment.boost = Some(BoostUse {
                    duration: label.remaining,
                    ..boosts[i].usage.clone()
                });
            }
            let choices: &[(bool, bool)] = if segment.mode == "walk" && has_locomotion {
                if options.dash.is_some() {
                    &[(true, true), (true, false), (false, false)]
                } else {
                    &[(true, false), (false, false)]
                }
            } else {
                &[(true, false)]
            };
            for &(sprint, dash) in choices {
                let Some((state, duration, segments, schedule)) = transition(
                    &segment,
                    &options,
                    label.state,
                    sprint,
                    dash,
                    label.boost.map(|_| label.remaining),
                    world,
                    if edge.terminal {
                        Some((goal, interaction))
                    } else {
                        None
                    },
                )?
                else {
                    continue;
                };
                let trace = segments
                    .iter()
                    .flat_map(|s| s.points.iter().copied())
                    .collect::<Vec<_>>();
                let stage = advance_stage(&trace, label.stage, &waypoints);
                if edge.terminal
                    && (stage != waypoints.len()
                        || !goal_at(
                            *trace.last().unwrap_or(&graph.points[label.node]),
                            goal,
                            interaction,
                            &geometry,
                            tolerance,
                        ))
                {
                    continue;
                }
                let remaining = (label.remaining - duration).max(0.);
                let boost = if remaining > EPS { label.boost } else { None };
                let dashes = state.dash_count;
                let next = Label {
                    node: edge.to,
                    stage,
                    cost: label.cost + duration,
                    arrival: label.arrival,
                    origin: label.origin,
                    state,
                    parent: Some(item.label),
                    segments,
                    boost,
                    remaining,
                    used_boost: label.used_boost,
                    minimum: state.minimum,
                    dashes,
                    schedule: Some(Value::Array(schedule)),
                    active: true,
                };
                insert(
                    next,
                    &mut arena,
                    &mut rows,
                    &mut queue,
                    max_labels,
                    &mut truncated,
                );
            }
        }
    }
    let search = json!({"truncated":truncated,"expanded":expanded,"maxLabels":max_labels,"maxExpanded":max_expanded});
    let mut connections = known;
    connections.extend(graph.generated);
    profile("resources", &started, expanded);
    let Some(winner) = winner else {
        return Ok(
            json!({"route":{"status":if arena.is_empty()||targets.is_empty(){"unmapped"}else{"no-verified-route"},"search":search},"connections":connections,"diagnostics":{"truncated":truncated,"candidateAttempts":attempts}}),
        );
    };
    let chosen = &arena[winner];
    let mut chain = Vec::new();
    let mut cursor = Some(winner);
    while let Some(i) = cursor {
        chain.push(i);
        cursor = arena[i].parent;
    }
    chain.reverse();
    let segments: Vec<Segment> = chain
        .iter()
        .flat_map(|&i| arena[i].segments.clone())
        .collect();
    let mut points = vec![graph.points[arena[chain[0]].node]];
    for s in &segments {
        for &p in s.points.iter().skip(1) {
            if distance(*points.last().unwrap(), p) > EPS {
                points.push(p);
            }
        }
    }
    let length = segments
        .iter()
        .map(|s| {
            s.points
                .windows(2)
                .map(|p| distance(p[0], p[1]))
                .sum::<f64>()
        })
        .sum::<f64>();
    let mut route = json!({"status":"complete","start":starts[chosen.origin]["id"],"cost":chosen.cost,"arrivalCost":chosen.arrival,"length":length,"points":points,"segments":segments,"schedule":chain.iter().flat_map(|&i|arena[i].schedule.as_ref().map(array).unwrap_or(&[]).iter().cloned()).collect::<Vec<_>>(),"placements":[],"search":search});
    if has_locomotion {
        route["locomotion"] = json!({"initial":locomotion::initial(&options).energy,"final":chosen.state.energy,"minimum":chosen.minimum,"dashes":chosen.dashes,"search":{"truncated":truncated,"maxLabels":max_labels}});
    }
    if interaction["airborne"] == true
        && let Some((index, (p, t))) = segments
            .iter()
            .enumerate()
            .filter(|(_, s)| s.mode != "walk")
            .find_map(|(i, s)| segment_hit(s, goal, interaction).map(|hit| (i, hit)))
    {
        route["goalHit"] = json!({"segment":index,"position":p,"time":t});
    }
    if let Some(i) = chosen.used_boost {
        let b = &boosts[i];
        route["boosts"] = json!([{"id":b.usage.id,"duration":b.usage.duration,"multiplier":b.usage.multiplier,"position":b.position,"elapsed":b.usage.duration-chosen.remaining}]);
    }
    Ok(
        json!({"route":route,"connections":connections,"diagnostics":{"truncated":truncated,"candidateAttempts":attempts},"arrival":starts[chosen.origin],"groundedTarget":points.last()}),
    )
}
fn profile(phase: &str, started: &std::time::Instant, count: usize) {
    if std::env::var_os("GANGLIA_PROFILE").is_some() {
        eprintln!(
            "{}",
            json!({"native":"search","phase":phase,"elapsedMs":started.elapsed().as_secs_f64()*1000.,"count":count})
        );
    }
}
fn budget(v: &Value, key: &str, default: usize) -> Result<usize, String> {
    if v[key].is_null() {
        Ok(default)
    } else {
        v[key]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| format!("invalid {key} budget"))
    }
}
fn insert(
    candidate: Label,
    arena: &mut Vec<Label>,
    rows: &mut [Vec<usize>],
    queue: &mut BinaryHeap<Queue>,
    max: usize,
    truncated: &mut bool,
) {
    let row = &mut rows[candidate.node];
    let comparable = |a: &Label, b: &Label| {
        a.stage == b.stage
            && a.boost == b.boost
            && a.used_boost == b.used_boost
            && (a.remaining - b.remaining).abs() < EPS
            && locomotion::continuation(a.state, b.state)
    };
    let dominates = |a: &Label, b: &Label| {
        // Automatic sprint restart makes extra energy non-monotone. Only an
        // identical resource continuation can replace a more costly prefix.
        a.cost <= b.cost + EPS && a.state.energy == b.state.energy && a.state.delay == b.state.delay
    };
    if row.iter().any(|&i| {
        arena[i].active && comparable(&arena[i], &candidate) && dominates(&arena[i], &candidate)
    }) {
        return;
    }
    for &i in row.iter() {
        if arena[i].active && comparable(&candidate, &arena[i]) && dominates(&candidate, &arena[i])
        {
            arena[i].active = false;
        }
    }
    row.retain(|&i| arena[i].active);
    let index = arena.len();
    queue.push(Queue {
        cost: candidate.cost,
        label: index,
    });
    arena.push(candidate);
    row.push(index);
    if row.len() > max {
        *truncated = true;
        row.sort_by(|&a, &b| arena[a].cost.total_cmp(&arena[b].cost));
        let half = max / 2;
        row[half..].sort_by(|&a, &b| {
            arena[b]
                .state
                .energy
                .total_cmp(&arena[a].state.energy)
                .then(arena[a].cost.total_cmp(&arena[b].cost))
        });
        for &i in &row[max..] {
            arena[i].active = false;
        }
        row.truncate(max);
    }
}
fn horizontal(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}
fn validate_segment(s: &Segment) -> Result<(), String> {
    if !matches!(s.mode.as_str(), "jump" | "drop" | "rope" | "launch")
        || s.points.len() < 2
        || s.points.len() != s.times.len()
        || s.points.iter().flatten().any(|x| !x.is_finite())
        || s.times.first() != Some(&0.)
        || s.times.iter().any(|x| !x.is_finite())
        || s.times.windows(2).any(|p| p[1] <= p[0])
        || s.required_gait.as_ref().is_some_and(|g| g != "sprint")
    {
        return Err("invalid authored trajectory".into());
    }
    Ok(())
}
fn validate_interaction(v: &Value) -> Result<(), String> {
    if v.is_null() {
        return Ok(());
    }
    let radius = number(v, "radius", -1.)?;
    if radius < 0. || number(v, "maxVertical", 0.)? < 0. {
        return Err("invalid interaction".into());
    }
    if !v["facing"].is_null() {
        let p = point(&v["facing"])?;
        let angle = number(v, "halfAngle", 0.)?;
        if horizontal(p, [0.; 3]) <= 0. || angle <= 0. || angle > 90. {
            return Err("invalid facing cone".into());
        }
    } else if !v["halfAngle"].is_null() {
        return Err("facing missing".into());
    }
    Ok(())
}
// Intersect the segment parameter with sphere, height slab and the two planes
// of a horizontal facing cone, retaining the earliest admissible point.
fn hit(a: Point, b: Point, target: Point, v: &Value) -> Option<f64> {
    let r = v["radius"].as_f64().unwrap_or(1e-5);
    let d = geometry::sub(b, a);
    let p = geometry::sub(a, target);
    let aa = geometry::dot(d, d);
    let bb = 2. * geometry::dot(p, d);
    let cc = geometry::dot(p, p) - r * r;
    let mut lo: f64 = 0.;
    let mut hi: f64 = 1.;
    if aa < EPS * EPS {
        if cc > EPS * EPS {
            return None;
        }
    } else {
        let disc = bb * bb - 4. * aa * cc;
        if disc < 0. {
            return None;
        }
        let root = disc.sqrt();
        lo = lo.max((-bb - root) / (2. * aa));
        hi = hi.min((-bb + root) / (2. * aa));
    }
    let mut clip = |a: f64, b: f64| {
        if b.abs() < 1e-14 {
            return a <= EPS;
        }
        let t = -a / b;
        if b > 0. {
            hi = hi.min(t);
        } else {
            lo = lo.max(t);
        }
        lo <= hi + EPS
    };
    if let Some(h) = v["maxVertical"].as_f64()
        && (!clip(p[1] - h, d[1]) || !clip(-p[1] - h, -d[1]))
    {
        return None;
    }
    if let Ok(f) = point(&v["facing"]) {
        let len = horizontal(f, [0.; 3]);
        let angle = v["halfAngle"].as_f64()?.to_radians();
        let forward = [f[0] / len, 0., f[2] / len];
        let side = [-forward[2], 0., forward[0]];
        for sign in [-1., 1.] {
            let normal = geometry::sub(
                geometry::scale(side, sign * angle.cos()),
                geometry::scale(forward, angle.sin()),
            );
            if !clip(geometry::dot(p, normal), geometry::dot(d, normal)) {
                return None;
            }
        }
    }
    if lo <= hi + EPS && hi >= -EPS && lo <= 1. + EPS {
        Some(lo.clamp(0., 1.))
    } else {
        None
    }
}
fn advance_stage(points: &[Point], mut stage: usize, waypoints: &[Point]) -> usize {
    if points.len() == 1 {
        while stage < waypoints.len() && distance(points[0], waypoints[stage]) < 1e-5 {
            stage += 1;
        }
        return stage;
    }
    for p in points.windows(2) {
        let mut from = 0.;
        while stage < waypoints.len() {
            let Some(t) = hit(lerp(p[0], p[1], from), p[1], waypoints[stage], &Value::Null) else {
                break;
            };
            from = from + (1. - from) * t;
            stage += 1;
        }
    }
    stage
}
fn goal_at(
    p: Point,
    goal: Point,
    interaction: &Value,
    g: &geometry::Geometry,
    tolerance: f64,
) -> bool {
    if interaction.is_object() {
        hit(p, p, goal, interaction).is_some()
    } else {
        g.project(goal, tolerance)
            .is_some_and(|q| distance(p, q) < 1e-5)
    }
}
fn segment_hit(s: &Segment, target: Point, v: &Value) -> Option<(Point, f64)> {
    for (i, p) in s.points.windows(2).enumerate() {
        if let Some(f) = hit(p[0], p[1], target, v) {
            return Some((
                lerp(p[0], p[1], f),
                s.times[i] + f * (s.times[i + 1] - s.times[i]),
            ));
        }
    }
    None
}
fn trim(mut s: Segment, target: Point, v: &Value) -> Option<Segment> {
    let (_, t) = segment_hit(&s, target, v)?;
    if t <= EPS {
        return None;
    }
    let t = (t + 1e-10).min(*s.times.last()?);
    let i = s
        .times
        .partition_point(|&x| x < t)
        .clamp(1, s.times.len() - 1);
    let span = s.times[i] - s.times[i - 1];
    let p = lerp(
        s.points[i - 1],
        s.points[i],
        if span > 0. {
            (t - s.times[i - 1]) / span
        } else {
            1.
        },
    );
    let count = s.times.partition_point(|&x| x < t);
    s.times.truncate(count);
    s.points.truncate(count);
    s.times.push(t);
    s.points.push(p);
    Some(s)
}

fn classify_flight(segment: &mut Segment, run_speed: f64) {
    if segment.mode == "jump"
        && segment.points.windows(2).enumerate().any(|(i, p)| {
            horizontal(p[0], p[1]) > run_speed * (segment.times[i + 1] - segment.times[i]) + EPS
        })
    {
        segment.required_gait = Some("sprint".into());
    }
}
type ScheduledTransition = (locomotion::State, f64, Vec<Segment>, Vec<Value>);
#[allow(clippy::too_many_arguments)]
fn transition(
    segment: &Segment,
    options: &locomotion::ScheduleOptions,
    state: locomotion::State,
    sprint: bool,
    dash: bool,
    remaining: Option<f64>,
    world: &crate::world::World,
    terminal_goal: Option<(Point, &Value)>,
) -> Result<Option<ScheduledTransition>, String> {
    let Some((next, duration, segments)) =
        locomotion::advance(segment, options, state, sprint, dash)
    else {
        return Ok(None);
    };
    let control = |s: &Segment| json!({"segments":[s],"allowSprint":sprint,"allowDash":dash});
    let Some(remaining) = remaining.filter(|&r| duration > r + EPS) else {
        return Ok(Some((next, duration, segments, vec![control(segment)])));
    };
    if segment.mode == "walk" {
        // Split the canonical supported path at buff expiry before scheduling its
        // ordinary-speed continuation. Resource and dash clocks cross that seam.
        let length = segment
            .points
            .windows(2)
            .map(|p| distance(p[0], p[1]))
            .sum::<f64>();
        let mut low = 0.;
        let mut high = length;
        for _ in 0..48 {
            let mid = (low + high) / 2.;
            let (prefix, _) = split_walk(segment, mid);
            if locomotion::advance(&prefix, options, state, sprint, dash)
                .is_some_and(|(_, t, _)| t < remaining)
            {
                low = mid;
            } else {
                high = mid;
            }
        }
        let (prefix, mut suffix) = split_walk(segment, (low + high) / 2.);
        suffix.boost = None;
        let Some((middle, t, mut first)) =
            locomotion::advance(&prefix, options, state, sprint, dash)
        else {
            return Ok(None);
        };
        let Some((last, u, second)) = locomotion::advance(&suffix, options, middle, sprint, dash)
        else {
            return Ok(None);
        };
        first.extend(second);
        return Ok(Some((
            last,
            t + u,
            first,
            vec![control(&prefix), control(&suffix)],
        )));
    }
    if segment.mode == "jump" {
        if let Some(witness) = &segment.flight
            && witness["model"]["airOverspeedDeceleration"]
                .as_f64()
                .is_some_and(|v| v > 0.)
        {
            let model: crate::model::JumpModel =
                serde_json::from_value(witness["model"].clone()).map_err(|e| e.to_string())?;
            let mut raw = witness["control"].clone();
            raw["expireAfter"] = json!(remaining);
            raw["expiredHorizontalSpeed"] = json!(world.movement.model.max_horizontal_speed);
            let control_input: crate::world::FlightControl =
                serde_json::from_value(raw).map_err(|e| e.to_string())?;
            if let Some(c) = world.flight_with_control(
                point(&witness["start"])?,
                point(&witness["end"])?,
                &model,
                &control_input,
            )? {
                let mut revised: Segment =
                    serde_json::from_value(serde_json::to_value(c).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                revised.connection = segment.connection.clone();
                revised.boost = segment.boost.clone();
                revised.required_gait = segment.required_gait.clone();
                revised.extra.insert("boostExpiry".into(), json!(remaining));
                if let Some((goal, interaction)) = terminal_goal {
                    let Some(trimmed) = trim(revised, goal, interaction) else {
                        return Ok(None);
                    };
                    revised = trimmed;
                }
                // An ordinary transfer must still finish at its searched support.
                if terminal_goal.is_none()
                    && distance(
                        *revised.points.last().unwrap(),
                        *segment.points.last().unwrap(),
                    ) > EPS
                {
                    return Ok(None);
                }
                if let Some((next, t, output)) =
                    locomotion::advance(&revised, options, state, sprint, dash)
                {
                    return Ok(Some((next, t, output, vec![control(&revised)])));
                }
            }
        }
        return Ok(None);
    }
    // Fixed device timing does not consume a ground speed multiplier. A boost-
    // conditional device must finish while its stated entry condition is active.
    if segment
        .extra
        .get("requiredBoost")
        .is_some_and(|v| v.is_string())
    {
        return Ok(None);
    }
    Ok(Some((next, duration, segments, vec![control(segment)])))
}
fn split_walk(segment: &Segment, length: f64) -> (Segment, Segment) {
    let mut first = Vec::new();
    let mut second = Vec::new();
    first.push(segment.points[0]);
    let mut travelled = 0.;
    let mut split = false;
    for pair in segment.points.windows(2) {
        let span = distance(pair[0], pair[1]);
        if !split && travelled + span >= length {
            let p = lerp(
                pair[0],
                pair[1],
                if span > EPS {
                    ((length - travelled) / span).clamp(0., 1.)
                } else {
                    0.
                },
            );
            first.push(p);
            second.push(p);
            second.push(pair[1]);
            split = true;
        } else if split {
            second.push(pair[1]);
        } else {
            first.push(pair[1]);
        }
        travelled += span;
    }
    if second.len() < 2 {
        let p = *segment.points.last().unwrap();
        second = vec![p, p];
    }
    let a = Segment {
        times: walk_times(&first, 1.),
        points: first,
        ..segment.clone()
    };
    let b = Segment {
        times: walk_times(&second, 1.),
        points: second,
        ..segment.clone()
    };
    (a, b)
}
fn walk_times(points: &[Point], speed: f64) -> Vec<f64> {
    let mut times = vec![0.];
    for p in points.windows(2) {
        times.push(times.last().unwrap() + distance(p[0], p[1]) / speed);
    }
    times
}
#[allow(clippy::too_many_arguments)]
fn flight(
    a: Point,
    b: Point,
    mode: &str,
    movement: &Value,
    multiplier: f64,
    g: &geometry::Geometry,
    attempts: &mut usize,
    limit: usize,
    collection: Option<(Point, &Value)>,
) -> Result<Option<Segment>, String> {
    if a[1] - b[1] > g.world.movement.max_drop {
        return Ok(None);
    }
    let mut model = movement["model"].clone();
    for key in ["maxHorizontalSpeed", "startHorizontalSpeed"] {
        if let Some(speed) = model[key].as_f64() {
            model[key] = json!(speed * multiplier);
        }
    }
    let mut controls = vec![json!({"mode":mode})];
    if mode == "jump"
        && model["airAcceleration"].as_f64().is_some()
        && model["airDeceleration"].as_f64().is_some()
    {
        for split in [0.5, 0.25, 0.75, 0., 1.] {
            controls.push(json!({"mode":mode,"horizontalSplit":split}));
        }
    }
    if mode == "drop" && model["maxHorizontalSpeed"].as_f64().is_some_and(|v| v > 0.) {
        for speed_fraction in [0.5, 0.25, 1., 0.125] {
            for terminal in ["average", "balanced", "fast"] {
                controls.push(json!({"mode":mode,"exit":[b[0],b[2]],"speedFraction":speed_fraction,"terminal":terminal}));
            }
        }
    }
    let model: crate::model::JumpModel =
        serde_json::from_value(model).map_err(|e| e.to_string())?;
    let interaction: Option<crate::model::Interaction> = collection
        .map(|(_, value)| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|e| e.to_string())?;
    for raw in controls {
        if *attempts >= limit {
            break;
        }
        *attempts += 1;
        let control: crate::world::FlightControl =
            serde_json::from_value(raw).map_err(|e| e.to_string())?;
        let connection =
            if let (Some((target, _)), Some(interaction)) = (collection, interaction.as_ref()) {
                g.world
                    .flight_to_goal(a, b, &model, &control, target, interaction)?
            } else {
                g.world.flight_with_control(a, b, &model, &control)?
            };
        let Some(connection) = connection else {
            continue;
        };
        let value = serde_json::to_value(connection).map_err(|e| e.to_string())?;
        let mut segment: Segment = serde_json::from_value(value).map_err(|e| e.to_string())?;
        let run = number(
            movement,
            "runAirSpeed",
            number(&movement["model"], "maxHorizontalSpeed", 0.)?,
        )? * multiplier;
        classify_flight(&mut segment, run);
        if segment.required_gait.is_some() && !movement["locomotion"].is_object() {
            continue;
        }
        return Ok(Some(segment));
    }
    Ok(None)
}
#[cfg(test)]
#[path = "search/tests.rs"]
mod tests;
