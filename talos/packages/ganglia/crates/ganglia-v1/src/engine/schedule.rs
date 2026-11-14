//! Whole-route resource allocation. Labels compare exact continuation states;
//! extra energy alone is unsafe dominance with automatic sprint restart.
use super::{Point, complete, distance, lerp, number, point, route_points};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet, VecDeque};
const EPS: f64 = 1e-9;

#[derive(Clone, PartialEq)]
struct State {
    energy: f64,
    minimum: f64,
    delay: f64,
    sprinting: bool,
    activated: bool,
    velocity: f64,
    direction: Option<Point>,
    cooldown: f64,
    dash: f64,
    dashes: usize,
}
#[derive(Clone)]
struct Label {
    state: State,
    duration: f64,
    segments: Vec<Value>,
    decisions: Vec<Value>,
    // Absolute first trigger time on this label's retimed trace. Device rides
    // advance duration even when they carry no character-speed annotation.
    boost_pickups: BTreeMap<String, f64>,
}

#[cfg(test)]
pub(super) fn compose(pieces: &[Value], options: &Value) -> Result<Option<Value>, String> {
    compose_with_boosts(pieces, options, &[])
}

pub(super) fn compose_with_boosts(
    pieces: &[Value],
    options: &Value,
    boost_facts: &[Value],
) -> Result<Option<Value>, String> {
    let Some(first) = pieces.first() else {
        return Ok(None);
    };
    let mut source = vec![];
    let mut points = route_points(first)?;
    let mut goal_hit = None;
    let mut expanded = 0.;
    let mut max_expanded = 0.;
    let mut max_labels: f64 = 0.;
    let mut truncated = false;
    let mut has_search = false;
    let mut placements = vec![];
    for (i, piece) in pieces.iter().enumerate() {
        if !complete(piece) {
            return Ok(None);
        }
        let p = route_points(piece)?;
        if i > 0 {
            if distance(*points.last().unwrap(), p[0]) > 1e-6 {
                return Ok(None);
            }
            points.extend_from_slice(&p[1..]);
        }
        if !piece["goalHit"].is_null() {
            let mut hit = piece["goalHit"].clone();
            hit["segment"] = json!(source.len() + hit["segment"].as_u64().unwrap_or(0) as usize);
            goal_hit = Some(hit);
        }
        source.extend(
            piece["segments"]
                .as_array()
                .ok_or("Route requires segments")?
                .clone(),
        );
        if let Some(v) = piece["placements"].as_array() {
            placements.extend(v.clone());
        }
        if !piece["search"].is_null() {
            has_search = true;
            let s = &piece["search"];
            truncated |= s["truncated"] == true;
            expanded += number(s, "expanded", 0.);
            max_expanded += number(s, "maxExpanded", 0.);
            max_labels = max_labels.max(number(s, "maxLabels", 0.));
        }
    }
    let mut blocks: Vec<Vec<Value>> = vec![];
    let mut endpoint = points[0];
    for mut segment in source.clone() {
        let path = segment["points"]
            .as_array()
            .ok_or("Segment requires points")?
            .iter()
            .map(point)
            .collect::<Result<Vec<_>, _>>()?;
        if path.len() < 2 || distance(endpoint, path[0]) > 1e-6 {
            return Ok(None);
        }
        endpoint = *path.last().unwrap();
        validate_times(&segment, path.len())?;
        segment
            .as_object_mut()
            .ok_or("Invalid segment")?
            .remove("gait");
        if segment["mode"] == "walk"
            && blocks
                .last()
                .map(|b| b[0]["mode"] == "walk" && b[0]["boost"] == segment["boost"])
                .unwrap_or(false)
        {
            blocks.last_mut().unwrap().push(segment);
        } else {
            blocks.push(vec![segment]);
        }
    }
    if distance(endpoint, *points.last().unwrap()) > 1e-6 {
        return Ok(None);
    }
    if options.is_null() {
        // Without a movement policy only authored clocks can be composed. Native
        // physical inputs normally provide locomotion; no game defaults are made.
        let duration = source.iter().map(duration).sum::<f64>();
        let mut route = first.clone();
        route["points"] = json!(points);
        route["segments"] = json!(source);
        route["cost"] = json!(number(first, "arrivalCost", 0.) + duration);
        route["length"] = json!(points.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>());
        if let Some(hit) = goal_hit {
            route["goalHit"] = hit;
        }
        return Ok(Some(route));
    }
    let speed = number(options, "speed", f64::NAN);
    let sprint = number(options, "sprintSpeed", f64::NAN);
    let acceleration = number(options, "sprintAcceleration", f64::NAN);
    if !speed.is_finite()
        || speed <= 0.
        || !sprint.is_finite()
        || sprint < speed
        || !acceleration.is_finite()
        || acceleration <= 0.
    {
        return Err("Invalid locomotion speeds".into());
    }
    if !options["dash"].is_null() {
        blocks = split_dash(blocks, options)?;
    }
    let initial = number(&options["stamina"], "initial", 0.);
    let state = State {
        energy: initial,
        minimum: initial,
        delay: 0.,
        sprinting: false,
        activated: false,
        velocity: speed,
        direction: None,
        cooldown: 0.,
        dash: 0.,
        dashes: 0,
    };
    let initial_label = Label {
        state,
        duration: 0.,
        segments: vec![],
        decisions: vec![],
        boost_pickups: BTreeMap::new(),
    };
    // Supplied decision seams may spend stamina only near a required-sprint
    // takeoff. Merging adjacent walks for optional optimization must not erase
    // that already feasible control sequence. Replay all pieces from one entry
    // state, rather than trusting their independently reset resource reports.
    let incumbent = replay_provided(pieces, options, initial_label.clone(), boost_facts)?;
    let mut labels = vec![initial_label];
    let limit = 256;
    let mut schedule_truncated = false;
    for block in blocks {
        let mut next: Vec<Label> = vec![];
        let controls = if block[0]["mode"] == "walk" {
            if options["dash"].is_null() {
                vec![(true, false), (false, false)]
            } else {
                vec![(true, true), (true, false), (false, false)]
            }
        } else {
            vec![(true, false)]
        };
        for label in &labels {
            for &(sprint, dash) in &controls {
                let Some(candidate) =
                    schedule_block(label, &block, options, sprint, dash, boost_facts)?
                else {
                    continue;
                };
                if next.iter().any(|n| {
                    same_state(&n.state, &candidate.state)
                        && n.boost_pickups == candidate.boost_pickups
                        && n.duration <= candidate.duration + EPS
                }) {
                    continue;
                }
                next.retain(|n| {
                    !(same_state(&n.state, &candidate.state)
                        && n.boost_pickups == candidate.boost_pickups
                        && candidate.duration <= n.duration + EPS)
                });
                next.push(candidate);
            }
        }
        if next.is_empty() {
            labels.clear();
            break;
        }
        if next.len() > limit {
            next.sort_by(|a, b| a.duration.total_cmp(&b.duration));
            let mut other = next.split_off(limit / 2);
            other.sort_by(|a, b| {
                b.state
                    .energy
                    .total_cmp(&a.state.energy)
                    .then_with(|| a.duration.total_cmp(&b.duration))
            });
            other.truncate(limit / 2);
            next.extend(other);
            schedule_truncated = true;
        }
        labels = next;
    }
    let best = labels.into_iter().chain(incumbent).min_by(|a, b| {
        a.duration
            .total_cmp(&b.duration)
            .then_with(|| a.state.energy.total_cmp(&b.state.energy))
    });
    let Some(best) = best else { return Ok(None) };
    let used = best
        .segments
        .iter()
        .filter_map(|s| s["boost"]["id"].as_str())
        .collect::<HashSet<_>>();
    let boosts=boost_facts.iter().filter(|fact|fact["id"].as_str().is_some_and(|id|used.contains(id))).filter_map(|fact|{
        let pickup=best.boost_pickups.get(fact["id"].as_str()?)?;
        Some(json!({"id":fact["id"],"duration":fact["duration"],"multiplier":fact["multiplier"],"position":fact["position"],
            "elapsed":(best.duration-pickup).max(0.).min(number(fact,"duration",0.))}))
    }).collect::<Vec<_>>();
    let mut output_points = vec![points[0]];
    for segment in &best.segments {
        for v in segment["points"].as_array().unwrap().iter().skip(1) {
            let p = point(v)?;
            if distance(*output_points.last().unwrap(), p) > EPS {
                output_points.push(p);
            }
        }
    }
    let mut route = json!({"status":"complete","start":first["start"],"arrivalCost":first["arrivalCost"],
        "cost":number(first,"arrivalCost",0.)+best.duration,"points":output_points,"segments":best.segments,
        "length":output_points.windows(2).map(|p|distance(p[0],p[1])).sum::<f64>(),
        "schedule":best.decisions,"boosts":boosts});
    if !placements.is_empty() {
        route["placements"] = json!(placements);
    }
    if has_search {
        route["search"] = json!({"truncated":truncated,"expanded":expanded,"maxExpanded":max_expanded,"maxLabels":max_labels});
    }
    if !options["stamina"].is_null() {
        route["locomotion"] =
            json!({"initial":initial,"final":best.state.energy,"minimum":best.state.minimum});
        if !options["dash"].is_null() {
            route["locomotion"]["dashes"] = json!(best.state.dashes);
            route["locomotion"]["dash"] = options["dash"].clone();
        }
    }
    if schedule_truncated {
        route["locomotion"]["search"] = json!({"truncated":true,"maxLabels":limit});
    }
    if let Some(hit) = goal_hit {
        route["goalHit"] = map_hit(hit, &source, route["segments"].as_array().unwrap())?;
    }
    Ok(Some(route))
}

fn observe_pickups(
    pickups: &mut BTreeMap<String, f64>,
    facts: &[Value],
    segment: &Value,
    start: f64,
) -> Result<(), String> {
    if facts.is_empty() {
        return Ok(());
    }
    let points = segment["points"]
        .as_array()
        .ok_or("Segment requires points")?;
    let times = segment["times"]
        .as_array()
        .ok_or("Segment requires times")?;
    for fact in facts {
        let id = fact["id"].as_str().ok_or("Boost fact requires id")?;
        if pickups.contains_key(id) {
            continue;
        }
        let target = point(&fact["position"])?;
        for i in 0..points.len() {
            let previous = i.saturating_sub(1);
            if let Some(fraction) = crate::search::hit(
                point(&points[previous])?,
                point(&points[i])?,
                target,
                &fact["interaction"],
            ) {
                let before = times[previous].as_f64().ok_or("Invalid segment clocks")?;
                let after = times[i].as_f64().ok_or("Invalid segment clocks")?;
                pickups.insert(id.into(), start + before + fraction * (after - before));
                break;
            }
        }
    }
    Ok(())
}

fn schedule_block(
    label: &Label,
    block: &[Value],
    options: &Value,
    sprint: bool,
    dash: bool,
    facts: &[Value],
) -> Result<Option<Label>, String> {
    let mut next = label.clone();
    let mut pending = VecDeque::from(block.to_vec());
    while let Some(mut segment) = pending.pop_front() {
        // Establish a pickup at the entry before validating an annotated motion.
        // Later contacts use actual scheduled sample clocks, rather than source
        // sample times or graph-node arrival times.
        if !facts.is_empty() {
            let entry = segment["points"][0].clone();
            observe_pickups(
                &mut next.boost_pickups,
                facts,
                &json!({"points":[entry],"times":[0.]}),
                next.duration,
            )?;
        }
        let mut remaining = None;
        if let Some(id) = segment["boost"]["id"].as_str() {
            let fact = facts
                .iter()
                .find(|f| f["id"] == id)
                .ok_or("Missing boost pickup facts")?;
            let Some(pickup) = next.boost_pickups.get(id) else {
                return Ok(None);
            };
            let left = pickup + number(fact, "duration", 0.) - next.duration;
            if (number(&segment["boost"], "multiplier", 0.) - number(fact, "multiplier", 0.)).abs()
                > 1e-9
            {
                return Ok(None);
            }
            if left <= EPS {
                if segment["mode"] != "walk" {
                    return Ok(None);
                }
                segment.as_object_mut().unwrap().remove("boost");
            } else {
                // BoostUse.duration is remaining life at segment entry. It is
                // metadata, not another full lifetime from which to subtract
                // accumulated boosted time.
                segment["boost"]["duration"] = json!(left);
                remaining = Some(left);
                if let Some(expiry) = segment["boostExpiry"].as_f64()
                    && (expiry - left).abs() > 1e-6
                {
                    return Ok(None);
                }
            }
        }
        let Some((state, mut output)) = advance(
            std::slice::from_ref(&segment),
            options,
            next.state.clone(),
            sprint,
            dash,
        )?
        else {
            return Ok(None);
        };
        let seconds = output.iter().map(duration).sum::<f64>();
        if let Some(left) = remaining
            && segment["boostExpiry"].is_null()
            && seconds > left + 1e-6
        {
            if segment["mode"] != "walk" {
                return Ok(None);
            }
            let points = route_points(&segment)?;
            let length = points.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>();
            let mut low = 0.;
            let mut high = length;
            for _ in 0..48 {
                let middle = (low + high) / 2.;
                let (prefix, _) = split_walk(&segment, middle, options)?;
                let t = advance(&[prefix], options, next.state.clone(), sprint, dash)?
                    .map(|(_, s)| s.iter().map(duration).sum::<f64>());
                if t.is_some_and(|t| t < left) {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            let (prefix, mut suffix) = split_walk(&segment, (low + high) / 2., options)?;
            suffix.as_object_mut().unwrap().remove("boost");
            pending.push_front(suffix);
            pending.push_front(prefix);
            continue;
        }
        let mut elapsed = next.duration;
        for materialized in &mut output {
            observe_pickups(&mut next.boost_pickups, facts, materialized, elapsed)?;
            if let Some(id) = materialized["boost"]["id"].as_str() {
                let fact = facts.iter().find(|f| f["id"] == id).unwrap();
                let left = next.boost_pickups[id] + number(fact, "duration", 0.) - elapsed;
                materialized["boost"]["duration"] = json!(left.max(0.));
            }
            elapsed += duration(materialized);
        }
        next.duration += seconds;
        next.state = state;
        next.segments.extend(output);
        next.decisions
            .push(json!({"segments":[segment],"allowSprint":sprint,"allowDash":dash}));
    }
    Ok(Some(next))
}

fn split_walk(segment: &Value, at: f64, options: &Value) -> Result<(Value, Value), String> {
    let points = route_points(segment)?;
    let mut first = vec![points[0]];
    let mut second = vec![];
    let mut remaining = at;
    for pair in points.windows(2) {
        let length = distance(pair[0], pair[1]);
        if !second.is_empty() {
            second.push(pair[1]);
        } else if remaining >= length {
            first.push(pair[1]);
            remaining -= length;
        } else {
            let cut = lerp(
                pair[0],
                pair[1],
                if length > 0. { remaining / length } else { 0. },
            );
            first.push(cut);
            second.extend([cut, pair[1]]);
        }
    }
    if second.is_empty() {
        second = vec![*points.last().unwrap(); 2];
    }
    let make = |points: Vec<Point>| {
        let mut times = vec![0.];
        for pair in points.windows(2) {
            times.push(
                times.last().unwrap() + distance(pair[0], pair[1]) / number(options, "speed", 1.),
            );
        }
        let mut result = segment.clone();
        result["points"] = json!(points);
        result["times"] = json!(times);
        result
    };
    Ok((make(first), make(second)))
}

fn replay_provided(
    pieces: &[Value],
    options: &Value,
    mut label: Label,
    boost_facts: &[Value],
) -> Result<Option<Label>, String> {
    for piece in pieces {
        let source = piece["segments"]
            .as_array()
            .ok_or("Route requires segments")?;
        let decisions = if let Some(schedule) = piece["schedule"].as_array() {
            schedule.clone()
        } else {
            // Authored terminal assets can lack an explicit schedule. Non-walk
            // controls preserve the active entry gait; named walking gaits also
            // provide a recoverable control witness. Unspecified walks still use
            // the ordinary bounded scheduler, without inventing an incumbent.
            let mut recovered = vec![];
            for segment in source {
                let (sprint, dash) = if segment["mode"] != "walk" {
                    (true, false)
                } else {
                    match segment["gait"].as_str() {
                        Some("run") => (false, false),
                        Some("sprint") => (true, false),
                        Some("dash") => (true, true),
                        _ => return Ok(None),
                    }
                };
                recovered.push(json!({"segments":[segment],"allowSprint":sprint,"allowDash":dash}));
            }
            recovered
        };
        let mut canonical = vec![];
        for decision in &decisions {
            let segments = decision["segments"]
                .as_array()
                .filter(|s| !s.is_empty())
                .ok_or("Invalid route schedule segments")?;
            for segment in segments {
                let points = segment["points"]
                    .as_array()
                    .ok_or("Schedule segment requires points")?;
                if points.len() < 2 {
                    return Err("Schedule segment requires two points".into());
                }
                for p in points {
                    point(p)?;
                }
                validate_times(segment, points.len())?;
            }
            canonical.extend(segments.clone());
        }
        if !same_trace(source, &canonical)? {
            return Err("Route schedule changes the physical trace".into());
        }
        for decision in decisions {
            let sprint = decision["allowSprint"]
                .as_bool()
                .ok_or("Invalid route schedule sprint control")?;
            let dash = decision["allowDash"]
                .as_bool()
                .ok_or("Invalid route schedule dash control")?;
            let block = decision["segments"].as_array().unwrap();
            let Some(replayed) = schedule_block(&label, block, options, sprint, dash, boost_facts)?
            else {
                return Ok(None);
            };
            label = replayed;
        }
    }
    Ok(Some(label))
}

fn same_trace(actual: &[Value], canonical: &[Value]) -> Result<bool, String> {
    fn runs(segments: &[Value]) -> Result<Vec<(Value, Vec<Point>)>, String> {
        let mut result: Vec<(Value, Vec<Point>)> = vec![];
        for segment in segments {
            let mut identity = segment.clone();
            let points = segment["points"]
                .as_array()
                .ok_or("Segment requires points")?
                .iter()
                .map(point)
                .collect::<Result<Vec<_>, _>>()?;
            let fields = identity.as_object_mut().ok_or("Invalid segment")?;
            fields.remove("gait");
            if segment["mode"] == "walk" {
                fields.remove("points");
                fields.remove("times");
                if let Some((previous, path)) = result.last_mut()
                    && *previous == identity
                {
                    if distance(*path.last().unwrap(), points[0]) > 1e-6 {
                        return Err("Discontinuous route schedule".into());
                    }
                    path.extend_from_slice(&points[1..]);
                    continue;
                }
            }
            result.push((identity, points));
        }
        Ok(result)
    }
    fn corners(points: Vec<Point>) -> Vec<Point> {
        let mut result: Vec<Point> = vec![];
        for point in points {
            if result
                .last()
                .is_some_and(|&last| distance(last, point) <= 1e-9)
            {
                continue;
            }
            while result.len() >= 2 {
                let a = result[result.len() - 2];
                let b = result[result.len() - 1];
                let length = distance(a, point);
                let along = if length > 0. {
                    (0..3)
                        .map(|i| (b[i] - a[i]) * (point[i] - a[i]))
                        .sum::<f64>()
                        / (length * length)
                } else {
                    -1.
                };
                if !(0. ..=1.).contains(&along) || distance(lerp(a, point, along), b) > 1e-7 {
                    break;
                }
                result.pop();
            }
            result.push(point);
        }
        result
    }
    let actual = runs(actual)?;
    let canonical = runs(canonical)?;
    if actual.len() != canonical.len() {
        return Ok(false);
    }
    for ((identity, a), (other, b)) in actual.into_iter().zip(canonical) {
        if identity != other {
            return Ok(false);
        }
        let a = corners(a);
        let b = corners(b);
        if a.len() != b.len() || a.iter().zip(b).any(|(&p, q)| distance(p, q) > 1e-6) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn same_state(a: &State, b: &State) -> bool {
    // Minimum and dash count are reporting values, not continuation inputs.
    a.energy == b.energy
        && a.delay == b.delay
        && a.sprinting == b.sprinting
        && a.activated == b.activated
        && a.velocity == b.velocity
        && a.direction == b.direction
        && a.cooldown == b.cooldown
        && a.dash == b.dash
}
fn validate_times(s: &Value, len: usize) -> Result<(), String> {
    let times = s["times"].as_array().ok_or("Segment requires times")?;
    if times.len() != len || times[0].as_f64() != Some(0.) {
        return Err("Invalid segment clocks".into());
    }
    let mut previous = 0.;
    for t in times {
        let t = t
            .as_f64()
            .filter(|n| n.is_finite() && *n >= previous)
            .ok_or("Invalid segment clocks")?;
        previous = t;
    }
    Ok(())
}
fn duration(s: &Value) -> f64 {
    s["times"]
        .as_array()
        .and_then(|a| a.last())
        .and_then(Value::as_f64)
        .unwrap_or(0.)
}
fn split_dash(blocks: Vec<Vec<Value>>, o: &Value) -> Result<Vec<Vec<Value>>, String> {
    let interval = number(&o["dash"], "speed", 0.) * number(&o["dash"], "duration", 0.);
    if !interval.is_finite() || interval <= 0. {
        return Err("Invalid dash policy".into());
    }
    let mut result = vec![];
    for block in blocks {
        if block[0]["mode"] != "walk" {
            result.push(block);
            continue;
        }
        let mut current = vec![];
        let mut remaining = interval;
        for segment in block {
            let p = segment["points"]
                .as_array()
                .unwrap()
                .iter()
                .map(point)
                .collect::<Result<Vec<_>, _>>()?;
            for edge in p.windows(2) {
                let mut from = edge[0];
                let to = edge[1];
                let mut length = distance(from, to);
                while length > EPS {
                    let step = length.min(remaining);
                    let end = lerp(from, to, step / length);
                    let mut s = segment.clone();
                    s["points"] = json!([from, end]);
                    s["times"] = json!([0., step / number(o, "speed", 1.)]);
                    current.push(s);
                    from = end;
                    length -= step;
                    remaining -= step;
                    if remaining <= EPS {
                        result.push(std::mem::take(&mut current));
                        remaining = interval;
                    }
                }
            }
        }
        if !current.is_empty() {
            result.push(current);
        }
    }
    Ok(result)
}

fn append(
    outputs: &mut Vec<Value>,
    template: &Value,
    gait: &str,
    start: Point,
    end: Point,
    dt: f64,
) {
    let reuse = outputs
        .last()
        .map(|s| {
            s["gait"] == gait
                && s["mode"] == "walk"
                && s["boost"] == template["boost"]
                && s["connection"] == template["connection"]
        })
        .unwrap_or(false);
    if !reuse {
        let mut s = template.clone();
        s["gait"] = json!(gait);
        s["points"] = json!([start]);
        s["times"] = json!([0.]);
        outputs.push(s);
    }
    let s = outputs.last_mut().unwrap();
    let t = duration(s) + dt;
    s["points"].as_array_mut().unwrap().push(json!(end));
    s["times"].as_array_mut().unwrap().push(json!(t));
}

fn advance(
    block: &[Value],
    o: &Value,
    mut s: State,
    allow_sprint: bool,
    allow_dash: bool,
) -> Result<Option<(State, Vec<Value>)>, String> {
    let stamina = &o["stamina"];
    let dash = &o["dash"];
    let has_stamina = !stamina.is_null();
    let multiplier = number(&block[0]["boost"], "multiplier", 1.);
    let speed = number(o, "speed", 1.) * multiplier;
    let cap = number(o, "sprintSpeed", speed) * multiplier;
    let acceleration = number(o, "sprintAcceleration", 1.);
    let drain = number(stamina, "sprintDrain", 0.);
    let activation = number(stamina, "activationCost", 0.);
    let recovery = number(stamina, "recoveryRate", 0.);
    let reserve = number(stamina, "reserve", 0.);
    let delay = number(stamina, "recoveryDelay", 0.);
    let capacity = number(stamina, "capacity", 0.);
    let mut output = vec![];
    if !allow_sprint && s.dash > EPS {
        return Ok(None);
    }
    if !allow_sprint {
        if s.sprinting && drain > 0. {
            s.delay = delay;
        }
        s.sprinting = false;
        s.velocity = speed;
    }
    for segment in block {
        if segment["mode"] != "walk" {
            if segment["requiredGait"] == "sprint" && !s.sprinting {
                return Ok(None);
            }
            let dt = duration(segment);
            s.cooldown = (s.cooldown - dt).max(0.);
            s.dash = 0.;
            output.push(segment.clone());
            if stamina["recoveryDuringNonWalk"] == true {
                s.energy = (s.energy + (dt - s.delay).max(0.) * recovery).min(capacity);
                s.delay = (s.delay - dt).max(0.);
            }
            s.sprinting = s.sprinting
                && o["sprintThrough"]
                    .as_array()
                    .map(|a| a.contains(&segment["mode"]))
                    .unwrap_or(false);
            s.velocity = speed;
            s.direction = None;
            continue;
        }
        let points = segment["points"]
            .as_array()
            .unwrap()
            .iter()
            .map(point)
            .collect::<Result<Vec<_>, _>>()?;
        for edge in points.windows(2) {
            let a = edge[0];
            let b = edge[1];
            let length = distance(a, b);
            if length <= EPS {
                continue;
            }
            let direction = std::array::from_fn(|i| (b[i] - a[i]) / length);
            if let Some(previous) = s.direction {
                let alignment = (0..3).map(|i| direction[i] * previous[i]).sum::<f64>();
                if alignment < (std::f64::consts::PI / 6.).cos() {
                    s.velocity = speed;
                }
                if alignment < 1. - 1e-6 {
                    s.dash = 0.;
                }
            }
            s.direction = Some(direction);
            let mut travelled = 0.;
            while length - travelled > EPS {
                if allow_dash
                    && !dash.is_null()
                    && s.dash <= EPS
                    && s.cooldown <= EPS
                    && s.energy + EPS >= reserve + number(dash, "cost", 0.)
                {
                    s.energy = (s.energy - number(dash, "cost", 0.)).max(reserve);
                    s.minimum = s.minimum.min(s.energy);
                    s.delay = delay;
                    s.cooldown = number(dash, "cooldown", 0.);
                    s.dash = number(dash, "duration", 0.);
                    s.dashes += 1;
                    s.sprinting = true;
                    s.activated = true;
                }
                if s.dash > EPS {
                    let v =
                        number(dash, "speed", speed) * number(&segment["boost"], "multiplier", 1.);
                    let dt = s.dash.min((length - travelled) / v);
                    let start = lerp(a, b, travelled / length);
                    travelled = (travelled + v * dt).min(length);
                    append(
                        &mut output,
                        segment,
                        "dash",
                        start,
                        lerp(a, b, travelled / length),
                        dt,
                    );
                    s.dash = (s.dash - dt).max(0.);
                    s.cooldown = (s.cooldown - dt).max(0.);
                    s.delay = (s.delay - dt).max(0.);
                    s.velocity = cap;
                    continue;
                }
                let mut dash_boundary = f64::INFINITY;
                if allow_dash && !dash.is_null() && reserve + number(dash, "cost", 0.) <= capacity {
                    let recharge = (reserve + number(dash, "cost", 0.) - s.energy).max(0.);
                    let recharge_time = if recharge > EPS {
                        if recovery > 0. && stamina["recoveryDuringSprint"] == true {
                            s.delay + recharge / recovery
                        } else {
                            f64::INFINITY
                        }
                    } else {
                        0.
                    };
                    dash_boundary = s.cooldown.max(recharge_time);
                    if dash_boundary <= EPS {
                        dash_boundary = f64::INFINITY;
                    }
                }
                let net_drain = drain
                    - if stamina["recoveryDuringSprint"] == true && s.delay <= EPS {
                        recovery
                    } else {
                        0.
                    };
                if net_drain > 0. && s.sprinting && s.energy - reserve <= EPS {
                    s.sprinting = false;
                    s.delay = delay;
                    s.velocity = speed;
                }
                if !s.sprinting {
                    let required = if drain > 0. || activation > 0. {
                        reserve + activation + if s.activated { drain } else { 0. }
                    } else {
                        0.
                    };
                    if allow_sprint
                        && cap > speed
                        && s.energy + EPS >= required
                        && (drain <= 0. || s.energy - reserve - activation > EPS)
                    {
                        s.energy = (s.energy - activation).max(0.);
                        s.minimum = s.minimum.min(s.energy);
                        s.sprinting = true;
                        s.activated = true;
                        s.delay = delay;
                        continue;
                    }
                    let mut dt = ((length - travelled) / speed).min(dash_boundary);
                    let restart = reserve + activation + drain;
                    if allow_sprint
                        && has_stamina
                        && cap > speed
                        && restart <= capacity
                        && recovery > 0.
                    {
                        dt = dt.min(s.delay + (restart - s.energy).max(0.) / recovery);
                    }
                    if dt <= 0. || !dt.is_finite() {
                        return Err("Non-progressing run schedule".into());
                    }
                    let start = lerp(a, b, travelled / length);
                    travelled = (travelled + speed * dt).min(length);
                    append(
                        &mut output,
                        segment,
                        "run",
                        start,
                        lerp(a, b, travelled / length),
                        dt,
                    );
                    if has_stamina {
                        s.energy = (s.energy + (dt - s.delay).max(0.) * recovery).min(capacity);
                        s.delay = (s.delay - dt).max(0.);
                    }
                    s.cooldown = (s.cooldown - dt).max(0.);
                    s.velocity = speed;
                    continue;
                }
                let available = if net_drain > 0. {
                    ((s.energy - reserve) / net_drain).max(0.)
                } else {
                    f64::INFINITY
                };
                let boundary = if stamina["recoveryDuringSprint"] == true && s.delay > EPS {
                    s.delay
                } else {
                    f64::INFINITY
                };
                let dt = sprint_time(length - travelled, s.velocity, cap, acceleration)
                    .min(available)
                    .min(boundary)
                    .min(dash_boundary);
                if dt <= 0. || !dt.is_finite() {
                    return Err("Non-progressing sprint schedule".into());
                }
                let accelerate = dt.min((cap - s.velocity).max(0.) / acceleration);
                let count = (accelerate / 0.1).ceil() as usize;
                let mut samples = (1..=count)
                    .map(|i| accelerate * i as f64 / count as f64)
                    .collect::<Vec<_>>();
                if samples.last().map(|t| dt - t > EPS).unwrap_or(true) {
                    samples.push(dt);
                }
                let initial = travelled;
                let mut before = 0.;
                for sample in samples {
                    let start = lerp(a, b, travelled / length);
                    travelled = (initial + sprint_distance(sample, s.velocity, cap, acceleration))
                        .min(length);
                    append(
                        &mut output,
                        segment,
                        "sprint",
                        start,
                        lerp(a, b, travelled / length),
                        sample - before,
                    );
                    before = sample;
                }
                s.cooldown = (s.cooldown - dt).max(0.);
                s.velocity = (s.velocity + acceleration * dt).min(cap);
                if has_stamina {
                    let recovered = if stamina["recoveryDuringSprint"] == true {
                        (dt - s.delay).max(0.) * recovery
                    } else {
                        0.
                    };
                    s.delay = (s.delay - dt).max(0.);
                    s.energy = (s.energy - dt * drain + recovered).max(0.).min(capacity);
                    s.minimum = s.minimum.min(s.energy);
                }
            }
        }
    }
    Ok(Some((s, output)))
}
fn sprint_time(length: f64, speed: f64, cap: f64, a: f64) -> f64 {
    let time = ((cap - speed) / a).max(0.);
    let distance = (speed + cap) * time / 2.;
    if length <= distance {
        2. * length / ((speed * speed + 2. * a * length).sqrt() + speed)
    } else {
        time + (length - distance) / cap
    }
}
fn sprint_distance(time: f64, speed: f64, cap: f64, a: f64) -> f64 {
    let t = time.min(((cap - speed) / a).max(0.));
    speed * t + a * t * t / 2. + cap * (time - t)
}
fn map_hit(mut hit: Value, source: &[Value], segments: &[Value]) -> Result<Value, String> {
    let index = hit["segment"]
        .as_u64()
        .ok_or("Invalid goal event segment")? as usize;
    let original = source.get(index).ok_or("Invalid goal event segment")?;
    if original["mode"] != "walk" {
        let ordinal = source[..=index]
            .iter()
            .filter(|s| s["mode"] != "walk")
            .count()
            - 1;
        let mapped = segments
            .iter()
            .enumerate()
            .filter(|(_, s)| s["mode"] != "walk")
            .nth(ordinal)
            .ok_or("Missing goal event segment")?
            .0;
        hit["segment"] = json!(mapped);
        return Ok(hit);
    }
    let mut remaining = 0.;
    for (j, segment) in source.iter().enumerate().take(index + 1) {
        let p = segment["points"].as_array().unwrap();
        let t = segment["times"].as_array().unwrap();
        for i in 1..p.len() {
            let span = distance(point(&p[i - 1])?, point(&p[i])?);
            if j < index || hit["time"].as_f64().unwrap_or(0.) >= t[i].as_f64().unwrap() {
                remaining += span;
            } else {
                let start = t[i - 1].as_f64().unwrap();
                let end = t[i].as_f64().unwrap();
                if end > start {
                    remaining += span
                        * ((hit["time"].as_f64().unwrap() - start) / (end - start)).clamp(0., 1.);
                }
                break;
            }
        }
    }
    for (index, s) in segments.iter().enumerate() {
        let p = s["points"].as_array().unwrap();
        let t = s["times"].as_array().unwrap();
        for i in 1..p.len() {
            let span = distance(point(&p[i - 1])?, point(&p[i])?);
            if s["mode"] == "walk" && remaining <= span + EPS {
                let fraction = if span > 0. {
                    (remaining / span).clamp(0., 1.)
                } else {
                    0.
                };
                hit["segment"] = json!(index);
                hit["time"] = json!(
                    t[i - 1].as_f64().unwrap()
                        + fraction * (t[i].as_f64().unwrap() - t[i - 1].as_f64().unwrap())
                );
                return Ok(hit);
            }
            remaining -= span;
        }
    }
    Err("Unmapped goal event".into())
}
