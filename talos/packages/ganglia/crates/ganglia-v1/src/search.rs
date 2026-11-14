//! Native route search. Geometry, action discovery and continuation-state resource
//! scheduling live behind one solve interface.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
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
// Optional proposals may reach unloaded space. Only World's unavailable-coverage
// category drops that witness; malformed facts, controls and work-budget errors
// retain their existing explicit error behavior. Accepted proofs are unchanged.
fn optional_proof<T>(
    proof: Result<Option<T>, String>,
    truncated: &mut bool,
) -> Result<Option<T>, String> {
    match proof {
        Err(error) if crate::world::is_coverage_error(&error) => {
            *truncated = true;
            Ok(None)
        }
        other => other,
    }
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
struct Entry {
    state: locomotion::State,
    boost: Option<usize>,
    remaining: f64,
    used_boost: Option<String>,
}
fn merge_carried_boost(
    active: &Value,
    world_facts: &Value,
    boosts: &mut Vec<Boost>,
) -> Result<(), String> {
    let usage: BoostUse = serde_json::from_value(active.clone()).map_err(|e| e.to_string())?;
    if !usage.multiplier.is_finite()
        || !usage.duration.is_finite()
        || usage.multiplier <= 1.
        || usage.duration <= 0.
    {
        return Err("invalid carried boost".into());
    }
    let fact = array(world_facts).iter().find(|b| b["id"] == usage.id);
    let position = active
        .get("position")
        .or_else(|| fact.and_then(|f| f.get("position")))
        .ok_or("carried boost position missing")?;
    let interaction = active
        .get("interaction")
        .or_else(|| fact.and_then(|f| f.get("interaction")))
        .ok_or("carried boost interaction missing")?;
    validate_interaction(interaction)?;
    let interaction = serde_json::to_value(
        serde_json::from_value::<crate::model::Interaction>(interaction.clone())
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let position = point(position)?;
    if let Some(fact) = fact {
        let authored: BoostUse = serde_json::from_value(fact.clone()).map_err(|e| e.to_string())?;
        if usage.multiplier != authored.multiplier
            || usage.duration != authored.duration
            || point(&fact["position"])? != position
            || fact["interaction"] != interaction
        {
            return Err("conflicting carried boost fact".into());
        }
    }
    if let Some(existing) = boosts.iter().find(|b| b.usage.id == usage.id) {
        if existing.usage.multiplier != usage.multiplier
            || existing.usage.duration != usage.duration
            || existing.position != position
            || existing.interaction != interaction
        {
            return Err("conflicting carried boost fact".into());
        }
    } else {
        boosts.push(Boost {
            usage,
            position,
            interaction,
        });
    }
    Ok(())
}
fn read_entry(
    start: &Value,
    options: &locomotion::ScheduleOptions,
    boosts: &[Boost],
) -> Result<Entry, String> {
    let raw = &start["continuation"];
    if raw.is_null() {
        return Ok(Entry {
            state: locomotion::initial(options),
            boost: None,
            remaining: 0.,
            used_boost: None,
        });
    }
    if !raw.is_object() {
        return Err("invalid arrival continuation".into());
    }
    let state = locomotion::read_state(&raw["resource"], options)?;
    let mut used_boost = if raw["usedBoost"].is_null() {
        None
    } else {
        Some(
            raw["usedBoost"]
                .as_str()
                .ok_or("invalid used boost")?
                .to_owned(),
        )
    };
    let (boost, remaining) = if raw["boost"].is_null() {
        (None, 0.)
    } else {
        let active = &raw["boost"];
        let id = active["id"].as_str().ok_or("invalid carried boost")?;
        let i = boosts
            .iter()
            .position(|b| b.usage.id == id)
            .ok_or("missing carried boost fact")?;
        let remaining = number(active, "remaining", -1.)?;
        if remaining < 0.
            || remaining > boosts[i].usage.duration + EPS
            || used_boost.as_ref().is_some_and(|used| used != id)
        {
            return Err("invalid carried boost lifetime".into());
        }
        used_boost = Some(id.to_owned());
        (if remaining > EPS { Some(i) } else { None }, remaining)
    };
    Ok(Entry {
        state,
        boost,
        remaining,
        used_boost,
    })
}
struct Edge {
    to: usize,
    segment: Arc<Segment>,
    block: locomotion::Block,
    terminal: bool,
    required_boost: Option<String>,
}
struct Graph {
    points: Vec<Point>,
    edges: Vec<Vec<Edge>>,
    generated: Vec<Value>,
    action_ids: std::collections::HashSet<String>,
    anchors: std::collections::HashSet<usize>,
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
    fn anchor(&mut self, p: Point) -> usize {
        let id = self.node(p);
        self.anchors.insert(id);
        id
    }
    fn walking_targets(
        &self,
        from: usize,
        stage: u64,
        degree: usize,
        components: &[Option<usize>],
    ) -> (Vec<usize>, bool) {
        if stage < 2 {
            return (
                (0..self.points.len()).filter(|&id| id != from).collect(),
                false,
            );
        }
        // Essential destinations are never degree-limited, including endpoints
        // promoted after discovery sampling. Every proposal still needs a full
        // World ground-path proof; this only bounds the approximate sample graph.
        let mut targets = (0..self.points.len())
            .filter(|&id| id != from && self.anchors.contains(&id))
            .collect::<Vec<_>>();
        let mut samples = (0..self.points.len())
            .filter(|&id| id != from && !self.anchors.contains(&id))
            .collect::<Vec<_>>();
        let origin = self.points[from];
        samples.sort_by(|&a, &b| {
            let a_delta = geometry::sub(self.points[a], origin);
            let b_delta = geometry::sub(self.points[b], origin);
            geometry::dot(a_delta, a_delta)
                .total_cmp(&geometry::dot(b_delta, b_delta))
                .then(a.cmp(&b))
        });
        let mut selected = Vec::new();
        let mut sectors = std::collections::HashSet::new();
        for &id in &samples {
            if selected.len() >= degree {
                break;
            }
            let delta = geometry::sub(self.points[id], origin);
            let sector = ((delta[2].atan2(delta[0]) + std::f64::consts::PI) * 4.
                / std::f64::consts::PI)
                .floor() as i32;
            if sectors.insert((components[id], sector.clamp(0, 7))) {
                selected.push(id);
            }
        }
        for &id in &samples {
            if selected.len() >= degree {
                break;
            }
            if !selected.contains(&id) {
                selected.push(id);
            }
        }
        let omitted = selected.len() < samples.len();
        targets.extend(selected);
        (targets, omitted)
    }
    fn edge(
        &mut self,
        from: usize,
        to: usize,
        segment: Segment,
        terminal: bool,
        required_boost: Option<String>,
    ) {
        let block = locomotion::compile(&segment).expect("validated graph segment");
        self.edges[from].push(Edge {
            to,
            segment: Arc::new(segment),
            block,
            terminal,
            required_boost,
        });
    }
    fn generated(
        &mut self,
        from: usize,
        mut segment: Segment,
        terminal: bool,
        required_boost: Option<String>,
        authority: &str,
    ) -> Result<(), String> {
        let mut emitted = serde_json::to_value(&segment).map_err(|e| e.to_string())?;
        let fields = emitted.as_object_mut().ok_or("invalid generated action")?;
        // Discovery serials and source connection IDs are query-local metadata.
        // Identity binds the physical trajectory, witness and entry conditions.
        fields.remove("id");
        fields.remove("connection");
        fields.insert("terminal".into(), json!(terminal));
        if let Some(id) = &required_boost {
            fields.insert("requiredBoost".into(), json!(id));
        } else {
            fields.remove("requiredBoost");
        }
        let id = generated_id(&emitted, authority)?;
        if !self.action_ids.insert(id.clone()) {
            return Ok(());
        }
        segment.extra.remove("id");
        segment.extra.insert("nativeGenerated".into(), json!(1));
        segment.connection = Some(id.clone());
        emitted["id"] = json!(id);
        emitted["connection"] = json!(id);
        emitted["state"] = json!("open");
        emitted["nativeGenerated"] = json!(1);
        let to = self.node(*segment.points.last().ok_or("empty generated action")?);
        self.generated.push(emitted);
        self.edge(from, to, segment, terminal, required_boost);
        Ok(())
    }
}
// Content identity is deterministic, not a capability. Admission additionally
// replays the witness using immutable World movement authority and collision.
fn generated_id(value: &Value, authority: &str) -> Result<String, String> {
    let mut value = value.clone();
    let fields = value.as_object_mut().ok_or("invalid generated action")?;
    for key in ["id", "connection", "state", "nativeGenerated"] {
        fields.remove(key);
    }
    let payload = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    let digest = |domain: u8| {
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        "ganglia-motion-v2".hash(&mut hash);
        domain.hash(&mut hash);
        authority.hash(&mut hash);
        payload.hash(&mut hash);
        hash.finish()
    };
    Ok(format!("rust/action/{:016x}{:016x}", digest(0), digest(1)))
}
fn physical_authority(world: &crate::world::World) -> Result<String, String> {
    let m = &world.movement;
    serde_json::to_string(&json!({"revision":world.revision,"profile":m.profile,
        "model":m.model,"speed":m.speed,"runAirSpeed":m.run_air_speed,
        "maxVertical":m.max_vertical,"maxSlope":m.max_slope,"maxDrop":m.max_drop,
        "maxHorizontalDistance":m.max_horizontal_distance,"stepUp":m.step_up,
        "stepDown":m.step_down,"locomotion":world.locomotion}))
    .map_err(|e| e.to_string())
}
fn admit_generated(
    world: &crate::world::World,
    raw: &Value,
    segment: &Segment,
    authority: &str,
    boosts: &[Boost],
) -> Result<bool, String> {
    if raw["terminal"] == true
        || !matches!(segment.mode.as_str(), "jump" | "drop")
        || raw["id"].as_str() != Some(generated_id(raw, authority)?.as_str())
    {
        return Ok(false);
    }
    if segment.boost.is_some()
        || segment.gait.is_some()
        || segment.traversal.is_some()
        || !raw["boostExpiry"].is_null()
    {
        return Ok(false);
    }
    let Some(witness) = &segment.flight else {
        return Ok(false);
    };
    let mut model = world.movement.model.clone();
    let multiplier = if let Some(id) = raw["requiredBoost"].as_str() {
        let Some(boost) = boosts.iter().find(|b| b.usage.id == id) else {
            return Ok(false);
        };
        boost.usage.multiplier
    } else {
        1.
    };
    model.max_horizontal_speed *= multiplier;
    model.start_horizontal_speed = model.start_horizontal_speed.map(|v| v * multiplier);
    let start = point(&witness["start"])?;
    let end = point(&witness["end"])?;
    let control: crate::world::FlightControl =
        serde_json::from_value(witness["control"].clone()).map_err(|e| e.to_string())?;
    // Expiry controls belong to selected schedules, not learned static actions.
    if control.expire_after.is_some() || control.expired_horizontal_speed.is_some() {
        return Ok(false);
    }
    if control.mode
        != if segment.mode == "jump" {
            crate::model::Mode::Jump
        } else {
            crate::model::Mode::Drop
        }
    {
        return Ok(false);
    }
    let replay = match witness["kind"].as_str() {
        Some("flight") => world.flight_with_control(start, end, &model, &control)?,
        Some("run-off") => world.run_off(start, end, &model, &control)?,
        _ => return Ok(false),
    };
    let Some(replay) = replay else {
        return Ok(false);
    };
    let mut expected: Segment =
        serde_json::from_value(serde_json::to_value(replay).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    classify_flight(&mut expected, world.movement.run_air_speed * multiplier);
    // Content IDs bind payloads, but cannot authorize a caller-supplied peak.
    // Legacy omission remains valid; gait is checked against authoritative replay.
    if let Some(peak) = raw.get("peakHorizontalSpeed") {
        let valid = peak
            .as_f64()
            .filter(|v| v.is_finite() && *v >= 0.)
            .zip(
                expected
                    .extra
                    .get("peakHorizontalSpeed")
                    .and_then(Value::as_f64),
            )
            .is_some_and(|(supplied, replay)| (supplied - replay).abs() <= 1e-6);
        if !valid {
            return Ok(false);
        }
    }
    Ok(segment.required_gait == expected.required_gait
        && segment.flight == expected.flight
        && segment.points.len() == expected.points.len()
        && segment.times.len() == expected.times.len()
        && segment
            .points
            .iter()
            .zip(&expected.points)
            .all(|(&a, &b)| distance(a, b) <= EPS)
        && segment
            .times
            .iter()
            .zip(&expected.times)
            .all(|(a, b)| (a - b).abs() <= EPS))
}
#[derive(Clone)]
enum Step {
    Prepared {
        segment: Arc<Segment>,
        sprint: bool,
        dash: bool,
    },
    Materialized(Arc<(Vec<Segment>, Vec<Value>)>),
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
    step: Option<Step>,
    boost: Option<usize>,
    remaining: f64,
    used_boost: Option<String>,
    minimum: f64,
    dashes: usize,
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

struct Resources<'a, 'w> {
    geometry: &'a geometry::Geometry<'w>,
    options: &'a locomotion::ScheduleOptions,
    boosts: &'a [Boost],
    waypoints: &'a [Point],
    goal: Point,
    interaction: &'a Value,
    tolerance: f64,
    has_locomotion: bool,
}
fn edge_successors(
    edge: &Edge,
    label: &Label,
    parent: usize,
    source: Point,
    resources: &Resources<'_, '_>,
    truncated: &mut bool,
) -> Result<Vec<Label>, String> {
    let Resources {
        geometry,
        options,
        boosts,
        waypoints,
        goal,
        interaction,
        tolerance,
        has_locomotion,
    } = *resources;
    let world = geometry.world;
    let mut successors = Vec::new();
    if let Some(required) = &edge.required_boost
        && world.movement.active_boost.as_ref() != Some(required)
        && !label.boost.is_some_and(|i| boosts[i].usage.id == *required)
    {
        return Ok(Vec::new());
    }
    let mut boosted;
    // A character speed boost does not alter a fixed device trajectory.
    // Its clock still advances across the ride, but attaching it to the
    // device would claim boosted execution after the buff has expired.
    let boosted_motion = matches!(edge.segment.mode.as_str(), "walk" | "jump" | "drop")
        || edge.required_boost.is_some();
    let segment = if let Some(i) = label.boost.filter(|_| boosted_motion) {
        boosted = (*edge.segment).clone();
        boosted.boost = Some(BoostUse {
            duration: label.remaining,
            ..boosts[i].usage.clone()
        });
        &boosted
    } else {
        edge.segment.as_ref()
    };
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
        let (state, duration, stage, step) = if label.boost.is_none() {
            let Some((state, duration)) =
                locomotion::evaluate(&edge.block, options, label.state, sprint, dash)
            else {
                continue;
            };
            (
                state,
                duration,
                advance_stage(&segment.points, label.stage, waypoints, tolerance),
                Step::Prepared {
                    segment: edge.segment.clone(),
                    sprint,
                    dash,
                },
            )
        } else {
            let Some((state, duration, segments, schedule)) = optional_proof(
                transition(
                    segment,
                    options,
                    label.state,
                    sprint,
                    dash,
                    Some(label.remaining),
                    world,
                    if edge.terminal {
                        Some((goal, interaction))
                    } else {
                        None
                    },
                ),
                truncated,
            )?
            else {
                continue;
            };
            let trace = segments
                .iter()
                .flat_map(|s| s.points.iter().copied())
                .collect::<Vec<_>>();
            let stage = advance_stage(&trace, label.stage, waypoints, tolerance);
            (
                state,
                duration,
                stage,
                Step::Materialized(Arc::new((segments, schedule))),
            )
        };
        if edge.terminal
            && (stage != waypoints.len()
                || !goal_at(
                    match &step {
                        Step::Prepared { segment, .. } => *segment.points.last().unwrap(),
                        Step::Materialized(output) => *output
                            .0
                            .last()
                            .and_then(|s| s.points.last())
                            .unwrap_or(&source),
                    },
                    goal,
                    interaction,
                    geometry,
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
            parent: Some(parent),
            step: Some(step),
            boost,
            remaining,
            used_boost: label.used_boost.clone(),
            minimum: state.minimum,
            dashes,
            active: true,
        };
        successors.push(next);
    }
    Ok(successors)
}
#[derive(Clone, Copy)]
struct GroundJob {
    lower_bound: f64,
    from: usize,
    to: usize,
}
impl PartialEq for GroundJob {
    fn eq(&self, b: &Self) -> bool {
        self.lower_bound == b.lower_bound && self.from == b.from && self.to == b.to
    }
}
impl Eq for GroundJob {}
impl PartialOrd for GroundJob {
    fn partial_cmp(&self, b: &Self) -> Option<Ordering> {
        Some(self.cmp(b))
    }
}
impl Ord for GroundJob {
    fn cmp(&self, b: &Self) -> Ordering {
        b.lower_bound
            .total_cmp(&self.lower_bound)
            .then_with(|| b.from.cmp(&self.from))
            .then_with(|| b.to.cmp(&self.to))
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
        if array(&config["fixedPlacements"])
            .iter()
            .any(|p| p["device"] == device.id)
        {
            continue;
        }
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
            if let Some(placed) = optional_proof(
                world.place_following(&device.id, position),
                &mut placement_truncated,
            )? {
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
    let authority = physical_authority(world)?;
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
    let waypoints = array(&query["waypoints"])
        .iter()
        .map(point)
        .collect::<Result<Vec<_>, _>>()?;
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
    // A later sparse window may omit the original trigger. Its selected prefix
    // supplies the immutable pickup fact and remaining lifetime without altering
    // the prepared World's raw geometry or movement authority.
    for start in array(&query["starts"])
        .iter()
        .filter(|s| s["state"] == "available")
    {
        let active = &start["continuation"]["boost"];
        if !active.is_null() {
            merge_carried_boost(active, &snapshot["boosts"], &mut boosts)?;
        }
    }
    let mut graph = Graph {
        points: Vec::new(),
        edges: Vec::new(),
        generated: Vec::new(),
        action_ids: std::collections::HashSet::new(),
        anchors: std::collections::HashSet::new(),
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
            seeds.push((graph.anchor(p), i, cost, read_entry(s, &options, &boosts)?));
        }
    }
    let mut targets = Vec::new();
    if interaction["airborne"] == true {
        targets.push(graph.anchor(goal));
    } else if interaction.is_object() {
        for p in geometry.interaction(goal, interaction)? {
            if hit(p, p, goal, interaction).is_some() {
                targets.push(graph.anchor(p));
            }
        }
    } else if let Some(p) = geometry.project(goal, tolerance) {
        targets.push(graph.anchor(p));
    }
    let mut waypoint_nodes = Vec::new();
    for p in &waypoints {
        if let Some(q) = geometry.project(*p, tolerance) {
            waypoint_nodes.push(graph.anchor(q));
        }
    }
    for b in &boosts {
        for p in geometry.interaction(b.position, &b.interaction)? {
            if hit(p, p, b.position, &b.interaction).is_some() {
                graph.anchor(p);
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
    let mut supported_paths = std::collections::HashMap::new();
    let mut repair_spans = Vec::new();
    let mut repair_truncated = false;
    let mut ground_probes = 0;
    let mut route_expanded = 0;
    let mut ground_feedback = Vec::new();
    if sample_budget > 0 {
        let mut pairs = Vec::new();
        for (from, _, _, _) in &seeds {
            if let Some(&to) = waypoint_nodes.first() {
                pairs.push((*from, to));
            } else {
                pairs.extend(targets.iter().map(|&to| (*from, to)));
            }
        }
        pairs.extend(waypoint_nodes.windows(2).map(|p| (p[0], p[1])));
        if let Some(&from) = waypoint_nodes.last() {
            pairs.extend(targets.iter().map(|&to| (from, to)));
        }
        let mut seen = std::collections::HashSet::new();
        pairs.retain(|&(a, b)| a != b && seen.insert((a, b)));
        // Feedback and flights share one physical-attempt pool. Unused
        // feedback allowance remains available to trajectory discovery.
        let limit = (max_candidates / 8).min(max_links.saturating_mul(4));
        let expansion_limit = max_candidates.min(max_links.saturating_mul(max_links));
        for (from, to) in pairs {
            if ground_probes >= limit {
                truncated = true;
                break;
            }
            ground_probes += 1;
            let a = graph.points[from];
            let b = graph.points[to];
            let mut feedback = json!({"from":a,"to":b});
            let Some(probe) = optional_proof(world.probe_ground(a, b).map(Some), &mut truncated)?
            else {
                feedback["direct"] = json!({"kind":"Coverage"});
                ground_feedback.push(feedback);
                continue;
            };
            match probe {
                crate::world::GroundProbe::Supported(path) => {
                    feedback["direct"] = json!({"kind":"Supported"});
                    supported_paths.insert((from, to), path.points);
                }
                crate::world::GroundProbe::Rejected(failure) => {
                    let navigation = matches!(&failure, crate::world::GroundFailure::Navigation);
                    feedback["direct"] = ground_failure(failure, &mut repair_spans, &mut truncated);
                    if navigation {
                        let remaining = limit - ground_probes;
                        let expansions = expansion_limit.saturating_sub(route_expanded);
                        if remaining > 0 && expansions > 0 {
                            // The nav proposal is optimistic and mask/direction
                            // constrained. Its prefix proofs share the remaining
                            // direct-proof budget; no rejection excludes detours.
                            let route = world.probe_ground_route(
                                a,
                                b,
                                crate::world::GroundRouteLimits {
                                    max_expansions: expansions,
                                    max_legs: remaining,
                                },
                            );
                            let Some(route) = optional_proof(route.map(Some), &mut truncated)?
                            else {
                                // An early error cannot report consumed work.
                                // Reserve the entire grant instead of minting
                                // more shared units for later corridor pairs.
                                ground_probes += remaining;
                                route_expanded += expansions;
                                feedback["navigation"] = json!({"unavailable":"coverage",
                                    "proofUnitsReserved":remaining,"expansionUnitsReserved":expansions});
                                ground_feedback.push(feedback);
                                continue;
                            };
                            ground_probes += route.probed;
                            route_expanded += route.expanded;
                            truncated |= route.truncated;
                            let failures = route
                                .failures
                                .into_iter()
                                .map(|f| ground_failure(f, &mut repair_spans, &mut truncated))
                                .collect::<Vec<_>>();
                            feedback["navigation"] = json!({"found":route.navigation.is_some(),
                                "points":route.navigation.as_ref().map_or(0,Vec::len),
                                "supported":route.supported.is_some(),"expanded":route.expanded,
                                "probed":route.probed,"truncated":route.truncated,"failures":failures});
                            if let Some(path) = route.supported {
                                supported_paths.insert((from, to), path.points);
                            }
                        } else {
                            truncated = true;
                            feedback["navigation"] = json!({"skipped":"proof-budget"});
                        }
                    }
                }
            }
            ground_feedback.push(feedback);
        }
        if std::env::var_os("GANGLIA_PROFILE").is_some() {
            eprintln!(
                "{}",
                json!({"native":"search","phase":"ground-feedback",
                "elapsedMs":started.elapsed().as_secs_f64()*1000.,"probed":ground_probes,
                "limit":limit,"expanded":route_expanded,"expansionLimit":expansion_limit,
                "repairRegions":repair_spans.len(),"feedback":ground_feedback})
            );
        }
    }
    let anchors = graph.points.clone();
    let center = |s: &crate::model::Surface| {
        std::array::from_fn(|axis| {
            s.vertices.iter().map(|p| p[axis]).sum::<f64>() / s.vertices.len() as f64
        })
    };
    let proximity = |p: Point| {
        let near = anchors
            .iter()
            .map(|&q| horizontal(p, q))
            .fold(f64::INFINITY, f64::min);
        let mut corridor = f64::INFINITY;
        for arrival in starts.iter().filter(|a| a["state"] == "available") {
            if let Ok(mut from) = point(&arrival["position"]) {
                for to in waypoints.iter().copied().chain(std::iter::once(goal)) {
                    let delta = geometry::sub(to, from);
                    let length = delta[0] * delta[0] + delta[2] * delta[2];
                    let t = if length > 0. {
                        (((p[0] - from[0]) * delta[0] + (p[2] - from[2]) * delta[2]) / length)
                            .clamp(0., 1.)
                    } else {
                        0.
                    };
                    corridor = corridor.min(horizontal(p, lerp(from, to, t)));
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
    let face_budget = sample_budget.div_ceil(4);
    let stratum = world.movement.model.max_jump_height.max(3.);
    let mut bands = std::collections::BTreeMap::<i64, Vec<_>>::new();
    for candidate in regions.into_values() {
        bands
            .entry((center(candidate.1)[1] / stratum).floor() as i64)
            .or_default()
            .push(candidate);
    }
    for band in bands.values_mut() {
        band.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)));
    }
    let mut bands = bands.into_iter().collect::<Vec<_>>();
    let height_distance = |band: i64| {
        anchors
            .iter()
            .map(|p| {
                let lo = band as f64 * stratum;
                let hi = lo + stratum;
                (lo - p[1]).max(p[1] - hi).max(0.)
            })
            .fold(f64::INFINITY, f64::min)
    };
    bands.sort_by(|a, b| {
        height_distance(a.0)
            .total_cmp(&height_distance(b.0))
            .then(a.1[0].0.total_cmp(&b.1[0].0))
            .then(a.0.cmp(&b.0))
    });
    // A descending query's horizontal corridor remains useful on its upper
    // platform. Round-robin height bands instead of following the sloping 3D
    // line, which can rank every upper takeoff below irrelevant middle floors.
    let total = bands.iter().map(|(_, band)| band.len()).sum::<usize>();
    let mut surfaces = Vec::new();
    'bands: for rank in 0..bands.iter().map(|(_, band)| band.len()).max().unwrap_or(0) {
        for (_, band) in &bands {
            if surfaces.len() >= face_budget {
                break 'bands;
            }
            if let Some((_, surface)) = band.get(rank) {
                surfaces.push(*surface);
            }
        }
    }
    if surfaces.len() < total {
        truncated |= stage >= 2;
    }
    // Exposed support intervals are launch interfaces; interior triangle edges
    // are only mesh detail. Keep a separate share of the finite graph for these
    // interfaces before filling it with centers and arbitrary vertices.
    if sample_budget > 0 {
        let margin = world
            .movement
            .model
            .max_horizontal_speed
            .max(world.movement.profile.radius * 2.);
        let bounds = crate::model::Bounds {
            min: [0, 2].map(|axis| {
                anchors
                    .iter()
                    .map(|p| p[axis])
                    .fold(f64::INFINITY, f64::min)
                    - margin
            }),
            max: [0, 2].map(|axis| {
                anchors
                    .iter()
                    .map(|p| p[axis])
                    .fold(f64::NEG_INFINITY, f64::max)
                    + margin
            }),
        };
        let boundary_budget = sample_budget.div_ceil(2);
        let mut streams = Vec::new();
        if !repair_spans.is_empty() {
            // Imported navigation can bridge a raw crack inside a broad face.
            // Local physical rejection exposes launch interfaces, not a proof
            // that no walking detour exists. These points share the existing
            // boundary budget and retain normal nav/standing/flight admission.
            let airtime = world
                .flight_duration(0., 0., crate::model::Mode::Jump)?
                .unwrap_or(0.);
            let reach = (airtime * world.movement.model.max_horizontal_speed)
                .max(world.movement.profile.radius * 2.);
            let mut raw = Vec::new();
            for span in &repair_spans {
                let local = crate::model::Bounds {
                    min: [0, 2].map(|axis| span[0][axis].min(span[1][axis]) - reach),
                    max: [0, 2].map(|axis| span[0][axis].max(span[1][axis]) + reach),
                };
                match world.raw_support_boundaries(local) {
                    Ok(boundaries) => {
                        raw.extend(boundaries.into_iter().map(|b| (b.points, b.inward, None)))
                    }
                    Err(_) => {
                        // Optional repair geometry has its own finite World
                        // work cap. Exhaustion does not remove ordinary detours.
                        truncated = true;
                        repair_truncated = true;
                    }
                }
            }
            streams.push((boundary_budget.div_ceil(2), raw));
        }
        streams.push((
            boundary_budget,
            world
                .support_boundaries(bounds)?
                .into_iter()
                .map(|b| {
                    let component = world.support_component(&b.surface);
                    (b.points, b.inward, component)
                })
                .collect(),
        ));
        for (boundary_limit, boundaries) in streams {
            let mut boundary_regions = std::collections::BTreeMap::new();
            for (points, inward, component) in boundaries {
                let [a, b] = points;
                let delta = geometry::sub(b, a);
                let length = delta[0] * delta[0] + delta[2] * delta[2];
                let mut points = vec![a, b, lerp(a, b, 0.5)];
                // Project query anchors onto the interval as well as sampling its
                // length. This preserves narrow takeoffs between uniform samples.
                if length > EPS * EPS {
                    for anchor in &anchors {
                        let t = (((anchor[0] - a[0]) * delta[0] + (anchor[2] - a[2]) * delta[2])
                            / length)
                            .clamp(0., 1.);
                        points.push(lerp(a, b, t));
                    }
                }
                for arrival in starts.iter().filter(|a| a["state"] == "available") {
                    if let Ok(mut from) = point(&arrival["position"]) {
                        for to in waypoints.iter().copied().chain(std::iter::once(goal)) {
                            let path = geometry::sub(to, from);
                            let cross = |u: Point, v: Point| u[0] * v[2] - u[2] * v[0];
                            let denominator = cross(delta, path);
                            if denominator.abs() > EPS * EPS {
                                let offset = geometry::sub(from, a);
                                let t = cross(offset, path) / denominator;
                                let u = cross(offset, delta) / denominator;
                                if (0. ..=1.).contains(&t) && (0. ..=1.).contains(&u) {
                                    points.push(lerp(a, b, t));
                                }
                            }
                            from = to;
                        }
                    }
                }
                let count = (horizontal(a, b) / spacing.clamp(0.5, 2.)).ceil().max(1.) as usize;
                for k in 1..count {
                    points.push(lerp(a, b, k as f64 / count as f64));
                }
                for p in points {
                    let key = (
                        (p[0] / 2.).floor() as i64,
                        (p[1] / stratum).floor() as i64,
                        (p[2] / 2.).floor() as i64,
                        component,
                        // Raw intervals have no nav owner. Opposing sides of a
                        // narrow crack must retain separate representatives.
                        if component.is_none() {
                            ((inward[2].atan2(inward[0]) + std::f64::consts::PI) * 4.
                                / std::f64::consts::PI)
                                .floor() as i32
                        } else {
                            -1
                        },
                    );
                    let score = proximity(p);
                    let entry = boundary_regions.entry(key).or_insert((score, p, inward));
                    if score < entry.0 {
                        *entry = (score, p, inward);
                    }
                }
            }
            let mut bands = std::collections::BTreeMap::<i64, Vec<_>>::new();
            for (_, candidate) in boundary_regions {
                bands
                    .entry((candidate.1[1] / stratum).floor() as i64)
                    .or_default()
                    .push(candidate);
            }
            for band in bands.values_mut() {
                band.sort_by(|a, b| {
                    a.0.total_cmp(&b.0)
                        .then_with(|| a.1[0].total_cmp(&b.1[0]))
                        .then_with(|| a.1[2].total_cmp(&b.1[2]))
                });
            }
            let mut bands = bands.into_iter().collect::<Vec<_>>();
            bands.sort_by(|a, b| {
                height_distance(a.0)
                    .total_cmp(&height_distance(b.0))
                    .then(a.1[0].0.total_cmp(&b.1[0].0))
                    .then(a.0.cmp(&b.0))
            });
            'boundaries: for rank in 0..bands.iter().map(|(_, b)| b.len()).max().unwrap_or(0) {
                for (_, band) in &bands {
                    if let Some(&(_, p, inward)) = band.get(rank) {
                        for inset in [
                            world.movement.profile.radius * 0.5,
                            world.movement.profile.radius,
                        ] {
                            if samples >= boundary_limit {
                                truncated = true;
                                break 'boundaries;
                            }
                            let p = std::array::from_fn(|i| p[i] + inward[i] * inset);
                            if let Some(p) = optional_proof(world.standing_foot(p), &mut truncated)?
                            {
                                let before = graph.points.len();
                                graph.node(p);
                                if graph.points.len() > before {
                                    samples += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
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
        if let Some(p) = optional_proof(world.standing_foot(p), &mut truncated)? {
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
                if let Some(p) = optional_proof(
                    world.standing_foot(lerp(a, b, k as f64 / count as f64)),
                    &mut truncated,
                )? {
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
    let authored_ids = world
        .known_actions()
        .iter()
        .map(|c| c.id.as_str())
        .collect::<std::collections::HashSet<_>>();
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
        let generated = !authored_ids.contains(id) && c["nativeGenerated"] == 1;
        if generated && !admit_generated(world, c, &segment, &authority, &boosts)? {
            continue;
        }
        // Authored endpoint tolerances remain strict. A generated catalog fact
        // receives the same nav-membership tolerance as fresh discovery only
        // after its authority, identity and full physical trajectory replay pass.
        let endpoint = if generated {
            tolerance
        } else {
            number(c, "endpointTolerance", 1e-6)?
        };
        if !generated && (endpoint < 0. || endpoint > tolerance.min(geometry.radius).max(1e-6)) {
            return Err("invalid connection endpoint tolerance".into());
        }
        let support = |key: &str| -> Result<Option<&str>, String> {
            if c[key].is_null() {
                Ok(None)
            } else {
                c[key]
                    .as_str()
                    .map(Some)
                    .ok_or_else(|| format!("invalid {key}"))
            }
        };
        let from_surface = support("fromSurface")?;
        let to_surface = support("toSurface")?;
        // Invalid support IDs are malformed facts even for terminal collection
        // actions, whose final point does not itself require standing support.
        for id in [from_surface, to_surface].into_iter().flatten() {
            if world.surface(id).is_none() {
                return Err("invalid movement support surface".into());
            }
        }
        if !geometry.endpoint(a, endpoint, from_surface)?
            || (!terminal && !geometry.endpoint(b, endpoint, to_surface)?)
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
        let from = graph.anchor(a);
        let to = graph.anchor(b);
        segment.connection = Some(id.into());
        graph.edge(
            from,
            to,
            segment,
            terminal,
            c["requiredBoost"].as_str().map(str::to_owned),
        );
        graph.action_ids.insert(id.into());
        known.push(c.clone());
    }
    let count = graph.points.len();
    profile("nodes", &started, count);
    let max_attempts = max_candidates;
    profile("graph", &started, count);
    let mut action_components = graph
        .points
        .iter()
        .map(|&p| {
            world
                .project_with_tolerance(p, tolerance, None)
                .ok()
                .and_then(|hits| {
                    hits.first()
                        .and_then(|hit| world.support_component(&hit.surface))
                })
        })
        .collect::<Vec<_>>();
    let largest_multiplier = boosts.iter().map(|b| b.usage.multiplier).fold(1., f64::max);
    let mut attempts = ground_probes;
    let mut action_sources = if stage >= 2 {
        (0..count)
            .filter(|&a| geometry.project(graph.points[a], tolerance).is_some())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let original_sources = action_sources.len();
    let mut target_eligible = vec![true; count];
    let mut interior_landings = std::collections::HashSet::new();
    let mut source_cursor = 0usize;
    if stage >= 2 && movement["model"].is_object() {
        while source_cursor < action_sources.len() {
            let remaining = max_attempts.saturating_sub(attempts);
            if remaining == 0 {
                truncated = true;
                break;
            }
            let a = action_sources[source_cursor];
            source_cursor += 1;
            // FIFO growth shares the remaining work with every pending source,
            // including proved interior landings. No source is rediscovered.
            let pending_sources = action_sources.len() - source_cursor + 1;
            let source_end = attempts + (remaining / pending_sources).max(1);
            let limit = ((source_end - attempts) / 2).max(1);
            let action_targets = rank_action_targets(
                &graph,
                a,
                world,
                largest_multiplier,
                &action_components,
                &target_eligible,
            )?;
            let mut discovered = Vec::new();
            // Recursive landing proposals have a global growth allowance equal
            // to the original supported-source count, rather than a fresh node
            // allowance per newly discovered source.
            let landing_limit = if interior_landings.len() < original_sources {
                ((source_end - attempts) / 3).min(16)
            } else {
                truncated = true;
                0
            };
            if stage >= 2 && landing_limit > 0 {
                for end in
                    landing_proposals(world, graph.points[a], goal, landing_limit, &mut truncated)?
                {
                    if attempts >= source_end {
                        break;
                    }
                    attempts += 1;
                    if let Some(connection) = optional_proof(
                        world.flight(graph.points[a], end, crate::model::Mode::Jump),
                        &mut truncated,
                    )? {
                        discovered.push(connection);
                        break;
                    }
                }
            }
            let direct_end = (attempts + limit).min(source_end);
            'direct: for &b in &action_targets {
                for mode in [crate::model::Mode::Jump, crate::model::Mode::Drop] {
                    if !free_flight_reaches(world, graph.points[a], graph.points[b], mode, 1.)? {
                        continue;
                    }
                    if attempts >= direct_end {
                        truncated = true;
                        break 'direct;
                    }
                    attempts += 1;
                    if let Some(connection) = optional_proof(
                        world.flight(graph.points[a], graph.points[b], mode),
                        &mut truncated,
                    )? {
                        discovered.push(connection);
                    }
                }
            }
            for connection in discovered {
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
                if !terminal && geometry.project(end, tolerance).is_none() {
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
                let before = graph.points.len();
                graph.generated(a, segment, terminal, None, &authority)?;
                if !terminal && graph.points.len() > before {
                    // Nonterminal admission above includes canonical standing
                    // and nav membership, so this is a supported flight source.
                    interior_landings.insert(before);
                    action_sources.push(before);
                }
            }
            'targets: for &b in &action_targets {
                let terminal = interaction["airborne"] == true && targets.contains(&b);
                if !terminal && geometry.project(graph.points[b], tolerance).is_none() {
                    continue;
                }
                for boost in std::iter::once(None).chain((0..boosts.len()).map(Some)) {
                    let multiplier = boost.map(|i| boosts[i].usage.multiplier).unwrap_or(1.);
                    let limit = number(movement, "maxHorizontalDistance", f64::MAX)? * multiplier;
                    if interaction["airborne"] != true
                        && horizontal(graph.points[a], graph.points[b]) > limit
                    {
                        continue;
                    }
                    for mode in ["drop", "jump"] {
                        if attempts >= max_attempts {
                            truncated = true;
                            break 'targets;
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
                            &mut truncated,
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
                            graph.generated(
                                a,
                                segment,
                                terminal,
                                boost.map(|i| boosts[i].usage.id.clone()),
                                &authority,
                            )?;
                        }
                    }
                }
            }
            for id in action_components.len()..graph.points.len() {
                action_components.push(
                    world
                        .project_with_tolerance(graph.points[id], tolerance, None)
                        .ok()
                        .and_then(|hits| {
                            hits.first()
                                .and_then(|p| world.support_component(&p.surface))
                        }),
                );
                target_eligible.push(interior_landings.contains(&id));
            }
        }
    }
    let discovery = json!({"originalSources":original_sources,"processedSources":source_cursor,
        "queuedSources":action_sources.len(),"pendingSources":action_sources.len()-source_cursor,
        "interiorLandings":interior_landings.len(),"maxInteriorLandings":original_sources});
    if std::env::var_os("GANGLIA_PROFILE").is_some() {
        eprintln!(
            "{}",
            json!({"native":"search","phase":"discovery",
            "elapsedMs":started.elapsed().as_secs_f64()*1000.,"worklist":discovery,
            "candidateAttempts":attempts,"maxCandidates":max_attempts})
        );
    }
    let max_labels = budget(&movement["locomotion"]["search"], "maxLabels", 256)?.max(2);
    profile("actions", &started, attempts);
    let max_expanded = budget(&movement["locomotion"]["search"], "maxExpanded", 100_000)?;
    let mut arena = Vec::<Label>::new();
    let mut rows = vec![Vec::<usize>::new(); graph.points.len()];
    let mut queue = BinaryHeap::new();
    let mut initial_labels = Vec::new();
    for (node, origin, cost, entry) in seeds {
        let state = entry.state;
        let stage = advance_stage(&[graph.points[node]], 0, &waypoints, tolerance);
        let label = Label {
            node,
            stage,
            cost,
            arrival: cost,
            origin,
            state,
            parent: None,
            step: None,
            boost: entry.boost,
            remaining: entry.remaining,
            used_boost: entry.used_boost,
            minimum: state.minimum,
            dashes: state.dash_count,
            active: true,
        };
        initial_labels.push(label);
    }
    let mut expanded = 0;
    let mut winner = None;
    let ground_degree = max_links.min(8);
    let components = graph
        .points
        .iter()
        .map(|&p| {
            world
                .project_with_tolerance(p, tolerance, None)
                .ok()
                .and_then(|hits| {
                    hits.first()
                        .and_then(|hit| world.support_component(&hit.surface))
                })
        })
        .collect::<Vec<_>>();
    let mut ground_attempts = 0usize;
    let resources = Resources {
        geometry: &geometry,
        options: &options,
        boosts: &boosts,
        waypoints: &waypoints,
        goal,
        interaction,
        tolerance,
        has_locomotion,
    };
    // Every schedule's 3D walking speed is bounded by its configured gait/dash
    // cap (including any pickup) or a carried entry velocity. Expiry can only
    // lower those caps. This gives geometry jobs an optimistic arrival clock.
    let walking_multiplier = graph
        .edges
        .iter()
        .flatten()
        .filter_map(|e| e.segment.boost.as_ref().map(|b| b.multiplier))
        .fold(largest_multiplier, f64::max);
    let maximum_walk_speed = initial_labels.iter().map(|l| l.state.velocity).fold(
        options
            .speed
            .max(options.sprint_speed)
            .max(options.dash.as_ref().map_or(0., |d| d.speed))
            * walking_multiplier,
        f64::max,
    );
    let mut walking_phases = Vec::new();
    let mut unexplored_detours = 0usize;
    // Stage 2 first searches only direct canonical walking and proved actions.
    // Restart resource labels for detours so earlier dominance cannot suppress
    // paths introduced by the larger graph. Static action blocks remain shared.
    for pass in 0..if stage >= 2 { 2 } else { 1 } {
        let direct_only = stage >= 2 && pass == 0;
        let phase = if direct_only {
            "direct"
        } else if stage >= 2 {
            "detours"
        } else {
            "full"
        };
        let began_expanded = expanded;
        let began_ground = ground_attempts;
        arena.clear();
        for row in &mut rows {
            row.clear();
        }
        queue.clear();
        for label in initial_labels.iter().cloned() {
            insert(
                label,
                &mut arena,
                &mut rows,
                &mut queue,
                max_labels,
                &mut truncated,
            );
        }
        let mut walked = vec![false; graph.points.len()];
        let mut ground_jobs = BinaryHeap::<GroundJob>::new();
        let mut queued_pairs = std::collections::HashSet::new();
        let mut jobs_proved = 0usize;
        let mut jobs_rejected = 0usize;
        loop {
            while queue.peek().is_some_and(|item| !arena[item.label].active) {
                queue.pop();
            }
            let next_label_cost = queue.peek().map_or(f64::INFINITY, |item| item.cost);
            if ground_jobs
                .peek()
                .is_some_and(|job| job.lower_bound <= next_label_cost)
            {
                let job = ground_jobs.pop().unwrap();
                ground_attempts += 1;
                let p = graph.points[job.from];
                let q = graph.points[job.to];
                let profiling = std::env::var_os("GANGLIA_PROFILE").is_some();
                let began = std::time::Instant::now();
                if profiling {
                    eprintln!(
                        "{}",
                        json!({"native":"search","phase":"ground-job-start",
                        "elapsedMs":started.elapsed().as_secs_f64()*1000.,
                        "from":job.from,"to":job.to,"start":p,"target":q,
                        "lowerBound":job.lower_bound,"pending":ground_jobs.len(),
                        "expanded":expanded,"proved":jobs_proved,"rejected":jobs_rejected})
                    );
                }
                let path = geometry.path(p, q).filter(|points| {
                    points.first().is_some_and(|a| distance(*a, p) <= 1e-5)
                        && points.last().is_some_and(|b| distance(*b, q) <= 1e-5)
                });
                if profiling {
                    eprintln!(
                        "{}",
                        json!({"native":"search","phase":"ground-job-end",
                        "elapsedMs":started.elapsed().as_secs_f64()*1000.,
                        "durationMs":began.elapsed().as_secs_f64()*1000.,
                        "from":job.from,"to":job.to,"supported":path.is_some()})
                    );
                }
                let Some(points) = path else {
                    jobs_rejected += 1;
                    continue;
                };
                jobs_proved += 1;
                graph.edge(
                    job.from,
                    job.to,
                    Segment {
                        mode: "walk".into(),
                        times: walk_times(&points, speed),
                        points,
                        ..Default::default()
                    },
                    false,
                    None,
                );
                // Proofs belong to a geometric pair, not a particular gait or
                // waypoint state. Replay the new edge for every live source label.
                let live = rows[job.from]
                    .iter()
                    .copied()
                    .filter(|&i| arena[i].active)
                    .collect::<Vec<_>>();
                let edge = graph.edges[job.from].last().unwrap();
                for i in live {
                    let label = arena[i].clone();
                    for next in edge_successors(edge, &label, i, p, &resources, &mut truncated)? {
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
                continue;
            }
            let Some(item) = queue.pop() else {
                break;
            };
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
            if stage >= 1 && label.used_boost.is_none() {
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
                        next.step = None;
                        next.boost = Some(i);
                        next.used_boost = Some(b.usage.id.clone());
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
                let (targets, omitted) =
                    graph.walking_targets(label.node, stage, ground_degree, &components);
                truncated |= omitted;
                for b in targets {
                    let q = graph.points[b];
                    // A proved direct edge from the first pass already has its
                    // compiled resource block; the fallback only adds missing paths.
                    if graph.edges[label.node]
                        .iter()
                        .any(|e| e.to == b && e.segment.mode == "walk")
                    {
                        continue;
                    }
                    if !direct_only && stage >= 2 && !supported_paths.contains_key(&(label.node, b))
                    {
                        if queued_pairs.insert((label.node, b)) {
                            let source_cost = rows[label.node]
                                .iter()
                                .copied()
                                .filter(|&i| arena[i].active)
                                .map(|i| arena[i].cost)
                                .fold(f64::INFINITY, f64::min);
                            // Endpoint admission allows 1e-5 at either end;
                            // subtract it so normalization cannot raise the bound.
                            let travel = (distance(p, q) - 2e-5).max(0.) / maximum_walk_speed;
                            ground_jobs.push(GroundJob {
                                lower_bound: source_cost + travel,
                                from: label.node,
                                to: b,
                            });
                        }
                        continue;
                    }
                    let path = if let Some(points) = supported_paths.get(&(label.node, b)) {
                        Some(points.clone())
                    } else {
                        ground_attempts += 1;
                        if direct_only {
                            match optional_proof(
                                world.probe_ground(p, q).map(Some),
                                &mut truncated,
                            )? {
                                Some(crate::world::GroundProbe::Supported(path)) => {
                                    Some(path.points)
                                }
                                Some(crate::world::GroundProbe::Rejected(_)) | None => {
                                    unexplored_detours += 1;
                                    None
                                }
                            }
                        } else {
                            geometry.path(p, q)
                        }
                    };
                    if let Some(points) = path {
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
                for next in edge_successors(
                    edge,
                    &label,
                    item.label,
                    graph.points[label.node],
                    &resources,
                    &mut truncated,
                )? {
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
        walking_phases.push(json!({"kind":phase,"expanded":expanded-began_expanded,
            "groundAttempts":ground_attempts-began_ground,"complete":winner.is_some(),
            "groundJobs":{"queued":queued_pairs.len(),"proved":jobs_proved,"rejected":jobs_rejected,"pending":ground_jobs.len()},
            "unexploredDetours":if direct_only { unexplored_detours } else { 0 }}));
        if std::env::var_os("GANGLIA_PROFILE").is_some() {
            eprintln!(
                "{}",
                json!({"native":"search","phase":"walking-pass",
                "elapsedMs":started.elapsed().as_secs_f64()*1000.,
                "result":walking_phases.last()})
            );
        }
        if winner.is_some() {
            // Returning the direct graph's winner avoids all detour proofs.
            // Unexplored alternatives may offer a cheaper route.
            truncated |= direct_only && unexplored_detours > 0;
            break;
        }
        if expanded >= max_expanded {
            break;
        }
    }
    let search = json!({"truncated":truncated,"expanded":expanded,"maxLabels":max_labels,"maxExpanded":max_expanded,"walkingPhases":walking_phases});
    let mut connections = known;
    connections.extend(graph.generated);
    profile("resources", &started, expanded);
    profile("ground", &started, ground_attempts);
    let Some(winner) = winner else {
        return Ok(
            json!({"route":{"status":if arena.is_empty()||targets.is_empty(){"unmapped"}else{"no-verified-route"},"search":search},"connections":connections,"diagnostics":{"truncated":truncated,"candidateAttempts":attempts,"flightAttempts":attempts-ground_probes,"feedbackAttempts":ground_probes,"groundAttempts":ground_attempts,"discovery":discovery,"walkingPhases":walking_phases,"groundDegree":ground_degree,"groundProbes":ground_probes,"repairRegions":repair_spans.len(),"repairTruncated":repair_truncated,"groundRouteExpanded":route_expanded,"groundProbeFeedback":ground_feedback}}),
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
    let mut segments = Vec::new();
    let mut schedule = Vec::new();
    for &i in &chain {
        match &arena[i].step {
            Some(Step::Prepared {
                segment,
                sprint,
                dash,
            }) => {
                let entry = arena[arena[i].parent.expect("traversal parent")].state;
                let (_, _, output) = locomotion::advance(segment, &options, entry, *sprint, *dash)
                    .ok_or("selected schedule failed replay")?;
                segments.extend(output);
                schedule.push(
                    json!({"segments":[segment.as_ref()],"allowSprint":sprint,"allowDash":dash}),
                );
            }
            Some(Step::Materialized(output)) => {
                segments.extend(output.0.iter().cloned());
                schedule.extend(output.1.iter().cloned());
            }
            None => {}
        }
    }
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
    let mut route = json!({"status":"complete","start":starts[chosen.origin]["id"],"cost":chosen.cost,"arrivalCost":chosen.arrival,"length":length,"points":points,"segments":segments,"schedule":schedule,"placements":[],"search":search});
    if has_locomotion {
        route["locomotion"] = json!({"initial":arena[chain[0]].state.energy,"final":chosen.state.energy,"minimum":chosen.minimum,"dashes":chosen.dashes,"search":{"truncated":truncated,"maxLabels":max_labels}});
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
    if let Some(b) = chosen
        .used_boost
        .as_ref()
        .and_then(|id| boosts.iter().find(|b| &b.usage.id == id))
    {
        route["boosts"] = json!([{"id":b.usage.id,"duration":b.usage.duration,"multiplier":b.usage.multiplier,"position":b.position,"elapsed":b.usage.duration-chosen.remaining}]);
    }
    let mut continuation = json!({"resource":chosen.state});
    if let Some(id) = &chosen.used_boost {
        continuation["usedBoost"] = json!(id);
    }
    if let Some(i) = chosen.boost {
        let b = &boosts[i];
        continuation["boost"] = json!({"id":b.usage.id,"multiplier":b.usage.multiplier,
            "duration":b.usage.duration,"remaining":chosen.remaining,
            "position":b.position,"interaction":b.interaction});
    }

    Ok(
        json!({"route":route,"connections":connections,"diagnostics":{"truncated":truncated,"candidateAttempts":attempts,"flightAttempts":attempts-ground_probes,"feedbackAttempts":ground_probes,"groundAttempts":ground_attempts,"discovery":discovery,"walkingPhases":walking_phases,"groundDegree":ground_degree,"groundProbes":ground_probes,"repairRegions":repair_spans.len(),"repairTruncated":repair_truncated,"groundRouteExpanded":route_expanded,"groundProbeFeedback":ground_feedback},"arrival":starts[chosen.origin],"groundedTarget":points.last(),"continuation":continuation}),
    )
}
fn ground_failure(
    failure: crate::world::GroundFailure,
    spans: &mut Vec<[Point; 2]>,
    truncated: &mut bool,
) -> Value {
    use crate::world::GroundFailure;
    match failure {
        GroundFailure::Navigation => json!({"kind":"Navigation"}),
        GroundFailure::PhysicalSupport { span } => {
            spans.push(span);
            json!({"kind":"PhysicalSupport","span":span})
        }
        GroundFailure::Clearance { span } => {
            spans.push(span);
            json!({"kind":"Clearance","span":span})
        }
        GroundFailure::ProofBudget { span } => {
            *truncated = true;
            spans.push(span);
            json!({"kind":"ProofBudget","span":span})
        }
    }
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
    if arena[index].active {
        queue.push(Queue {
            cost: arena[index].cost,
            label: index,
        });
    } else {
        arena.pop();
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
pub(crate) fn hit(a: Point, b: Point, target: Point, v: &Value) -> Option<f64> {
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
fn advance_stage(
    points: &[Point],
    mut stage: usize,
    waypoints: &[Point],
    max_vertical: f64,
) -> usize {
    if points.is_empty() {
        return stage;
    }
    let stationary = [points[0], points[0]];
    let points = if points.len() == 1 {
        &stationary[..]
    } else {
        points
    };
    // Match the independent query evaluator: intersect each original waypoint's
    // horizontal cylinder and vertical slab with a continuous trace span. The
    // earliest admissible fraction preserves order when waypoint volumes overlap.
    for pair in points.windows(2) {
        let a = pair[0];
        let b = pair[1];
        let dx = b[0] - a[0];
        let dz = b[2] - a[2];
        let dy = b[1] - a[1];
        let squared = dx * dx + dz * dz;
        let mut fraction = 0.;
        while let Some(waypoint) = waypoints.get(stage) {
            let mut near: f64 = fraction;
            let mut far: f64 = 1.;
            if squared > 0. {
                let center = ((waypoint[0] - a[0]) * dx + (waypoint[2] - a[2]) * dz) / squared;
                let gap =
                    (a[0] + center * dx - waypoint[0]).hypot(a[2] + center * dz - waypoint[2]);
                if gap > 1e-6 {
                    break;
                }
                let half = ((1e-12 - gap * gap).max(0.) / squared).sqrt();
                near = near.max(center - half);
                far = far.min(center + half);
            } else if (a[0] - waypoint[0]).hypot(a[2] - waypoint[2]) > 1e-6 {
                break;
            }
            let tolerance = max_vertical + 1e-6;
            if dy != 0. {
                let first = (waypoint[1] - tolerance - a[1]) / dy;
                let last = (waypoint[1] + tolerance - a[1]) / dy;
                near = near.max(first.min(last));
                far = far.min(first.max(last));
            } else if (a[1] - waypoint[1]).abs() > tolerance {
                break;
            }
            if near > far {
                break;
            }
            fraction = near;
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
    if !matches!(segment.mode.as_str(), "jump" | "drop") {
        return;
    }
    // World owns the phase/control peak, including cubic run-off control bounds.
    // Constant-speed legacy flights use the same endpoint/time fallback as replay.
    let peak = segment
        .extra
        .get("peakHorizontalSpeed")
        .and_then(Value::as_f64)
        .unwrap_or_else(|| {
            match (
                segment.points.first(),
                segment.points.last(),
                segment.times.last(),
            ) {
                (Some(&start), Some(&end), Some(&duration)) if duration > 0. => {
                    horizontal(start, end) / duration
                }
                _ => 0.,
            }
        });
    if peak > run_speed + 1e-6 {
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
fn free_flight_reaches(
    world: &crate::world::World,
    a: Point,
    b: Point,
    mode: crate::model::Mode,
    multiplier: f64,
) -> Result<bool, String> {
    if a[1] - b[1] > world.movement.max_drop
        || horizontal(a, b) > world.movement.max_horizontal_distance * multiplier
    {
        return Ok(false);
    }
    Ok(free_flight_range(world, a[1], b[1], mode, multiplier)?
        .is_some_and(|reach| horizontal(a, b) <= reach + EPS))
}
fn free_flight_range(
    world: &crate::world::World,
    start: f64,
    end: f64,
    mode: crate::model::Mode,
    multiplier: f64,
) -> Result<Option<f64>, String> {
    let Some(time) = world.flight_duration(start, end, mode)? else {
        return Ok(None);
    };
    let model = &world.movement.model;
    let cap = model.max_horizontal_speed * multiplier;
    let initial = if mode == crate::model::Mode::Jump {
        model
            .start_horizontal_speed
            .unwrap_or(model.max_horizontal_speed)
            .max(model.max_horizontal_speed)
            * multiplier
    } else {
        cap
    };
    let reach = if let Some(decay) = model.air_overspeed_deceleration.filter(|&v| v > 0.) {
        let braking = time.min((initial - cap) / decay);
        cap * time + (initial - cap) * braking - decay * braking * braking / 2.
    } else {
        initial * time
    };
    Ok(Some(
        reach.min(world.movement.max_horizontal_distance * multiplier),
    ))
}
/// Continuous landing points supplement mesh representatives. Projection is
/// geometric only; admission still requires standing support and a full flight.
fn landing_proposals(
    world: &crate::world::World,
    source: Point,
    goal: Point,
    limit: usize,
    truncated: &mut bool,
) -> Result<Vec<Point>, String> {
    let stratum = world.movement.model.max_jump_height.max(3.);
    let mut bands = std::collections::BTreeMap::<i64, Vec<_>>::new();
    for surface in &world.surfaces {
        let y = surface.vertices.iter().map(|p| p[1]).sum::<f64>() / surface.vertices.len() as f64;
        if y >= source[1] - world.movement.max_vertical || source[1] - y > world.movement.max_drop {
            continue;
        }
        let Some(reach) = free_flight_range(world, source[1], y, crate::model::Mode::Jump, 1.)?
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
        let dx = (min[0] - source[0]).max(source[0] - max[0]).max(0.);
        let dz = (min[1] - source[2]).max(source[2] - max[1]).max(0.);
        if dx.hypot(dz) > reach + EPS {
            continue;
        }
        bands
            .entry((y / stratum).floor() as i64)
            .or_default()
            .push((surface, y, min, max));
    }
    let mut bands = bands
        .into_values()
        .map(|band| {
            let score = band
                .iter()
                .map(|(_, y, _, _)| (y - goal[1]).abs())
                .fold(f64::INFINITY, f64::min);
            (score, band)
        })
        .collect::<Vec<_>>();
    bands.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1[0].0.id.cmp(&b.1[0].0.id)));
    let angle = (goal[2] - source[2]).atan2(goal[0] - source[0]);
    let mut proposals = Vec::new();
    for (_, band) in bands {
        let y = band
            .iter()
            .map(|(_, y, _, _)| *y)
            .min_by(|a, b| (a - goal[1]).abs().total_cmp(&(b - goal[1]).abs()))
            .unwrap();
        let Some(reach) = free_flight_range(world, source[1], y, crate::model::Mode::Jump, 1.)?
        else {
            continue;
        };
        for fraction in [0.95, 0.65] {
            for turn in [0., 1., -1., 2., -2., 3., -3., 4.] {
                if proposals.len() >= limit {
                    return Ok(proposals);
                }
                let theta = angle + turn * std::f64::consts::FRAC_PI_4;
                let seed = [
                    source[0] + reach * fraction * theta.cos(),
                    y,
                    source[2] + reach * fraction * theta.sin(),
                ];
                let mut closest = None;
                let mut best = f64::INFINITY;
                for (surface, _, min, max) in &band {
                    let dx = (min[0] - seed[0]).max(seed[0] - max[0]).max(0.);
                    let dz = (min[1] - seed[2]).max(seed[2] - max[1]).max(0.);
                    if dx.hypot(dz) > best {
                        continue;
                    }
                    if let Some(p) = world.project_to_surface(&surface.id, seed)? {
                        let d = distance(seed, p);
                        if d < best {
                            best = d;
                            closest = Some(p);
                        }
                    }
                }
                let Some(p) = closest else { continue };
                if let Some(p) = optional_proof(world.standing_foot(p), truncated)?
                    && free_flight_reaches(world, source, p, crate::model::Mode::Jump, 1.)?
                    && !proposals.iter().any(|&q| distance(q, p) < EPS)
                {
                    proposals.push(p);
                }
            }
        }
    }
    Ok(proposals)
}
fn rank_action_targets(
    graph: &Graph,
    from: usize,
    world: &crate::world::World,
    multiplier: f64,
    components: &[Option<usize>],
    eligible: &[bool],
) -> Result<Vec<usize>, String> {
    let origin = graph.points[from];
    let mut essential = Vec::new();
    let mut samples = Vec::new();
    let mut deferred = Vec::new();
    for (id, &point) in graph.points.iter().enumerate() {
        if !eligible[id] || distance(origin, point) <= EPS {
            continue;
        }
        let reachable =
            free_flight_reaches(world, origin, point, crate::model::Mode::Jump, multiplier)?
                || free_flight_reaches(world, origin, point, crate::model::Mode::Drop, multiplier)?;
        if !reachable {
            deferred.push(id);
        } else if graph.anchors.contains(&id) {
            essential.push(id);
        } else {
            samples.push(id);
        }
    }
    let nearest = |&a: &usize, &b: &usize| {
        distance(origin, graph.points[a])
            .total_cmp(&distance(origin, graph.points[b]))
            .then(a.cmp(&b))
    };
    essential.sort_by(nearest);
    samples.sort_by(nearest);
    deferred.sort_by(nearest);
    let mut ranked = essential;
    let stratum = world.movement.model.max_jump_height.max(3.);
    let mut bands = std::collections::BTreeMap::<i64, Vec<usize>>::new();
    for id in samples {
        let band = ((graph.points[id][1] - origin[1]) / stratum).floor() as i64;
        bands.entry(band).or_default().push(id);
    }
    for band in bands.values_mut() {
        let mut sectors = std::collections::HashSet::new();
        let mut distinct = Vec::new();
        let mut repeated = Vec::new();
        for &id in band.iter() {
            let d = geometry::sub(graph.points[id], origin);
            let sector = ((d[2].atan2(d[0]) + std::f64::consts::PI) * 4. / std::f64::consts::PI)
                .floor() as i32;
            if sectors.insert((components[id], sector.clamp(0, 7))) {
                distinct.push(id);
            } else {
                repeated.push(id);
            }
        }
        distinct.extend(repeated);
        *band = distinct;
    }
    let mut bands = bands.into_values().collect::<Vec<_>>();
    bands.sort_by(|a, b| nearest(&a[0], &b[0]));
    // Reserve early attempts at every reachable elevation. Sorting all cells by
    // 3D distance lets a dense same-floor mesh hide useful descending landings.
    for rank in 0..bands.iter().map(Vec::len).max().unwrap_or(0) {
        for band in &bands {
            if let Some(&id) = band.get(rank) {
                ranked.push(id);
            }
        }
    }
    // Run-off controls include a supported approach, so free-fall duration does
    // not bound their total horizontal distance. Keep these and distant airborne
    // collection endpoints after ordinary reachable landings, without weakening
    // the exact World control/sweep proofs or charging them before useful targets.
    ranked.extend(deferred);
    Ok(ranked)
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
    truncated: &mut bool,
    collection: Option<(Point, &Value)>,
) -> Result<Option<Segment>, String> {
    if collection.is_none() && a[1] - b[1] > g.world.movement.max_drop {
        return Ok(None);
    }
    let free = free_flight_reaches(
        g.world,
        a,
        b,
        if mode == "jump" {
            crate::model::Mode::Jump
        } else {
            crate::model::Mode::Drop
        },
        multiplier,
    )?;
    let mut model = movement["model"].clone();
    for key in ["maxHorizontalSpeed", "startHorizontalSpeed"] {
        if let Some(speed) = model[key].as_f64() {
            model[key] = json!(speed * multiplier);
        }
    }
    let mut controls = Vec::new();
    if free || collection.is_some() {
        controls.push(json!({"mode":mode}));
    }
    if mode == "jump"
        && (free || collection.is_some())
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
        let proof =
            if let (Some((target, _)), Some(interaction)) = (collection, interaction.as_ref()) {
                g.world
                    .flight_to_goal(a, b, &model, &control, target, interaction)
            } else {
                g.world.flight_with_control(a, b, &model, &control)
            };
        let Some(connection) = optional_proof(proof, truncated)? else {
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
