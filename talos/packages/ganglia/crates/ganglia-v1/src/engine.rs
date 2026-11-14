//! Native query orchestration. The host retains opaque sources and asynchronous I/O.
//!
//! Protocol (all positions are metre-valued `[x,y,z]` arrays):
//! * `new(config, {kind:"scene",scene:{scene,walls,navigation},locomotion})`, or
//!   `new(config, {kind:"physical"|"surfaces",input:<World snapshot>})`.
//! * `start({starts:[{id,position,cost,state}],goal,interaction?,waypoints?})`
//!   returns `{type:"complete",result:<RouteResult>}` or
//!   `{type:"load",effect:{id,kind:"terminals",query}}` or
//!   `{type:"load",effect:{id,kind:"window",scene,start,target,margin,corridor}}`.
//! * Resume a terminal load with `{id,terminals:[{id,route,supportBoxes?}]}`.
//!   Resume a window load with `{id,snapshot:<World snapshot>,revision:<JSON>,
//!   coverage:{kind:"complete"|"sparse",...}}`. Revision must bind ALL physical
//!   facts, model/body/walls/device state and build settings, not just ground.
//!   Coverage must identify the actual covered region/tiles even when sparse.
//!   `snapshot:{cached:true}` reuses an exact resident revision/coverage key.
//!   The cache is a four-entry LRU, hits refresh order. A miss returns
//!   `Native snapshot cache miss` without consuming the pending effect, permitting
//!   a full-snapshot resend with the same id. New worlds receive both revision
//!   and coverage at the envelope's top level, including sparse coverage holes.
//!   A load failure is `{id,error:"message"}`. Pending jobs stay in the host;
//!   resume only when a load has settled. The host never invokes a TS solver.
//! * An effect may include `partial:<RouteResult>` for candidate publication.
//!   A partial has a physically verified target approach but no requested start.
//!   Valid terminal approaches are retained before coarse planning; alternatives
//!   and available-arrival trials share the query's candidate budget.
//! * Internal window arrivals carry `continuation:{resource,boost?,usedBoost?}`.
//!   Resource fields match Search's exact stamina/gait/dash continuation. Active
//!   boosts include immutable trigger facts for sparse windows that omit them.
//!   Completed results expose continuation from the selected recomposed trace.
//!   Following bindings likewise persist per query without changing cached Worlds.
//!
//! Only one query may be in flight per Engine. Batch lanes own separate engines.
//! `cancel()` completes a suspended query; `close()` is idempotent and releases
//! native preparation. Worlds are immutable and reused by exact revision AND
//! coverage identity. There is no query-result or cross-query failure cache.
//! `catalog("train"|"freeze"|"stats"|"clear")` controls verified connection
//! training. Train before the declared workload, freeze before measured service.

use crate::{search, world::World};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::sync::Arc;

#[path = "engine/proposal.rs"]
mod proposal;
#[path = "engine/schedule.rs"]
mod schedule;

type Point = [f64; 3];
type Solve = fn(&World, &Value, &Value) -> Result<Value, String>;

struct Cached {
    key: String,
    world: Arc<World>,
}

#[derive(Default)]
struct Catalog {
    frozen: bool,
    training: bool,
    revision: u64,
    // Revisions and coverage are part of the key. An action witnessed in one
    // sparse window cannot silently become evidence in another window.
    banks: BTreeMap<String, BTreeMap<String, Value>>,
}

pub struct Engine {
    config: Value,
    input: Value,
    navigation: proposal::Navigation,
    cache: VecDeque<Cached>,
    catalog: Catalog,
    query: Option<Query>,
    next_id: u64,
    closed: bool,
    solve: Solve,
}

struct Query {
    original: Value,
    terminal: Option<Value>,
    terminals: VecDeque<Terminal>,
    awaiting_terminals: bool,
    pending: Option<u64>,
    partial: Option<Value>,
    incumbent: Option<Value>,
    boost_facts: BTreeMap<String, Value>,
    following_facts: BTreeMap<String, Value>,
    excluded_arrivals: HashSet<String>,
    excluded_edges: HashSet<String>,
    attempt: usize,
    truncated: bool,
    last_reason: String,
    proposal: Option<proposal::Proposal>,
    window: Option<Window>,
    // First solve the bounded target-side approach. A failure there must not
    // reject an otherwise usable global proposal.
    tail: bool,
    tail_covers_start: bool,
}

struct Terminal {
    asset: Option<Value>,
    excluded_arrivals: HashSet<String>,
    excluded_edges: HashSet<String>,
}

struct Window {
    points: Vec<Point>,
    cursor: usize,
    end: Option<usize>,
    position: Point,
    arrival: Value,
    stage: usize,
    expansion: usize,
    pieces: Vec<Value>,
    support: Vec<Value>,
    connections: Vec<Value>,
    failures: HashSet<String>,
    waypoint: usize,
    continuation: Option<Value>,
    proofs: Vec<(Arc<World>, Value)>,
}

impl Engine {
    pub fn new(config: Value, input: Value) -> Result<Self, String> {
        Self::with_search(config, input, search::solve)
    }

    fn with_search(mut config: Value, input: Value, solve: Solve) -> Result<Self, String> {
        if !config.is_object() {
            return Err("Solver config must be an object".into());
        }
        for (key, default) in [
            ("maxCandidates", 8000.),
            ("maxShortcutCandidates", 512.),
            ("maxLinks", 64.),
            ("sampleSpacing", 1.),
            ("batchConcurrency", 1.),
            ("maxAttempts", 6.),
            ("tileSpan", 38.4),
            ("gridSpan", 32.),
            ("maxTiles", 16.),
            ("margin", 8.),
            ("maxTargetError", 3.),
        ] {
            if config.get(key).is_none() {
                config[key] = json!(default);
            }
        }
        for key in [
            "maxCandidates",
            "maxShortcutCandidates",
            "maxLinks",
            "maxAttempts",
            "batchConcurrency",
            "maxTiles",
        ] {
            let n = number(&config, key, f64::NAN);
            let min = if ["maxCandidates", "maxShortcutCandidates"].contains(&key) {
                0.
            } else {
                1.
            };
            if !n.is_finite()
                || n < min
                || n > 9_007_199_254_740_991.
                || n.fract() != 0.
                || (key == "maxTiles" && n > 512.)
            {
                return Err(format!("Invalid {key}"));
            }
            // serde_json distinguishes 6.0 from an integer even though JS does
            // not. Native search budget readers consume integral JSON numbers.
            config[key] = json!(n as u64);
        }
        for key in [
            "sampleSpacing",
            "tileSpan",
            "gridSpan",
            "margin",
            "maxTargetError",
        ] {
            let n = number(&config, key, f64::NAN);
            if !n.is_finite() || n < 0. || (key != "maxTargetError" && n == 0.) {
                return Err(format!("Invalid {key}"));
            }
        }
        let kind = input["kind"]
            .as_str()
            .ok_or("Missing input kind")?
            .to_string();
        if !["scene", "physical", "surfaces"].contains(&kind.as_str()) {
            return Err("Unknown input kind".into());
        }
        let navigation = proposal::Navigation::new(&input["scene"]["navigation"])?;
        let mut engine = Self {
            config,
            input,
            navigation,
            cache: VecDeque::new(),
            catalog: Catalog::default(),
            query: None,
            next_id: 0,
            closed: false,
            solve,
        };
        if kind != "scene" {
            let snapshot = engine.input.clone();
            // This slot is engine-local and permanently bound to one immutable
            // direct input, so no serialization-sized key or host ID is needed.
            let revision = engine
                .input
                .get("revision")
                .cloned()
                .unwrap_or(json!("immutable-direct-input"));
            let coverage = engine
                .input
                .get("coverage")
                .cloned()
                .unwrap_or(json!({"kind":"complete"}));
            engine.world(&snapshot, &revision, &coverage)?;
            engine.input["input"] = Value::Null;
        }
        Ok(engine)
    }

    pub fn start(&mut self, query: Value) -> Result<Value, String> {
        if self.closed {
            return Err("Route solver is closed".into());
        }
        if self.query.is_some() {
            return Err("Engine query already running".into());
        }
        validate_query(&query)?;
        if self.input["kind"] != "scene" {
            let world = self
                .cache
                .front()
                .ok_or("Missing prepared world")?
                .world
                .clone();
            let key = self.cache.front().unwrap().key.clone();
            let result = (self.solve)(&world, &query, &self.search_config(2, Some(&key)))?;
            self.learn(&key, &result);
            return Ok(json!({"type":"complete","result":result}));
        }
        let airborne = query["interaction"]["airborne"] == true;
        let mut boost_facts = BTreeMap::new();
        for arrival in query["starts"].as_array().unwrap() {
            let active = &arrival["continuation"]["boost"];
            if active["position"].is_array() && active["interaction"].is_object() {
                let fact: crate::model::Boost = serde_json::from_value(active.clone())
                    .map_err(|e| format!("Invalid carried boost: {e}"))?;
                let value = serde_json::to_value(&fact).map_err(|e| e.to_string())?;
                if boost_facts
                    .get(&fact.effect.id)
                    .is_some_and(|previous| *previous != value)
                {
                    return Err("Conflicting carried boost facts".into());
                }
                boost_facts.insert(fact.effect.id, value);
            }
        }
        self.query = Some(Query {
            original: query,
            terminal: None,
            terminals: VecDeque::new(),
            awaiting_terminals: airborne,
            pending: None,
            partial: None,
            incumbent: None,
            boost_facts,
            following_facts: BTreeMap::new(),
            excluded_arrivals: HashSet::new(),
            excluded_edges: HashSet::new(),
            attempt: 0,
            truncated: false,
            last_reason: "no-available-arrival".into(),
            proposal: None,
            window: None,
            tail: false,
            tail_covers_start: false,
        });
        if airborne {
            let original = self.query.as_ref().unwrap().original.clone();
            return Ok(self.effect(json!({"kind":"terminals","query":original})));
        }
        let result = self.drive();
        self.recover(result)
    }

    pub fn resume(&mut self, response: Value) -> Result<Value, String> {
        let q = self.query.as_ref().ok_or("No suspended query")?;
        let id = response["id"]
            .as_u64()
            .ok_or("Load response requires effect id")?;
        if q.pending != Some(id) {
            return Err("Stale or mismatched load response".into());
        }
        if response
            .get("error")
            .is_some_and(|error| !error.is_string())
        {
            return Err("Load error must be a string".into());
        }
        // Validate the response before consuming it. Malformed data can be fixed
        // by the host without losing the suspended query.
        if response.get("error").is_none() && !q.awaiting_terminals {
            if response.get("revision").is_none() || response["revision"].is_null() {
                return Err("Window response requires full physical revision".into());
            }
            if !matches!(
                response["coverage"]["kind"].as_str(),
                Some("complete" | "sparse")
            ) {
                return Err("Window response requires complete or sparse coverage identity".into());
            }
            if !response["snapshot"].is_object() {
                return Err("Window response requires snapshot".into());
            }
        }
        if q.awaiting_terminals
            && response.get("error").is_none()
            && !response["terminals"].is_array()
        {
            return Err("Terminal response requires terminals array".into());
        }
        let loaded_world = if !q.awaiting_terminals && response.get("error").is_none() {
            Some(self.world(
                &response["snapshot"],
                &response["revision"],
                &response["coverage"],
            )?)
        } else {
            None
        };
        self.query.as_mut().unwrap().pending = None;
        if self.query.as_ref().unwrap().awaiting_terminals {
            let locomotion = &self.input["locomotion"];
            let speed =
                number(locomotion, "sprintSpeed", number(locomotion, "speed", 1.)).max(1e-9);
            let q = self.query.as_mut().unwrap();
            if let Some(message) = response["error"].as_str() {
                return Ok(self.finish(message, true));
            }
            let mut assets = vec![];
            for (order, terminal) in response["terminals"].as_array().unwrap().iter().enumerate() {
                let route = &terminal["route"];
                if !complete(route) {
                    continue;
                }
                let points = route_points(route)?;
                let endpoint = *points.last().unwrap();
                if crate::search::hit(
                    endpoint,
                    endpoint,
                    point(&q.original["goal"])?,
                    &q.original["interaction"],
                )
                .is_none()
                {
                    continue;
                }
                let entry = points[0];
                let estimate = q.original["starts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|a| a["state"] == "available")
                    .map(|a| {
                        number(a, "cost", 0.)
                            + distance(point(&a["position"]).unwrap(), entry) / speed
                    })
                    .fold(f64::INFINITY, f64::min)
                    + number(route, "cost", 0.);
                assets.push((estimate, order, terminal.clone()));
            }
            assets.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
            let limit = number(&self.config, "maxAttempts", 6.) as usize;
            q.truncated |= assets.len() > limit;
            assets.truncate(limit);
            // A verified terminal remains useful even when no global prefix can
            // be proposed. Keep it before any coarse-planning early return.
            if let Some((_, _, terminal)) = assets.first() {
                q.partial = Some(json!({"route":terminal["route"],"connections":[],
                    "supportBoxes":terminal["supportBoxes"].as_array().cloned().unwrap_or_default(),
                    "partial":true,"diagnostics":{"truncated":q.truncated,"candidateAttempts":0}}));
            }
            for (_, _, terminal) in assets {
                q.terminals.push_back(Terminal {
                    asset: Some(terminal),
                    excluded_arrivals: HashSet::new(),
                    excluded_edges: HashSet::new(),
                });
            }
            // Authored approaches do not exclude a naturally discovered direct
            // approach. All terminal/arrival trials share maxAttempts.
            if q.terminals.len() < limit {
                q.terminals.push_back(Terminal {
                    asset: None,
                    excluded_arrivals: HashSet::new(),
                    excluded_edges: HashSet::new(),
                });
            } else {
                q.truncated = true;
            }
            if let Some(terminal) = q.terminals.pop_front() {
                q.terminal = terminal.asset;
            }
            q.awaiting_terminals = false;
        } else if let Some(error) = response["error"].as_str() {
            self.fail_candidate(error)?;
        } else {
            if let Err(error) = self.solve_window(loaded_world.unwrap()) {
                return self.recover(Err(error));
            }
        }
        let result = self.drive();
        self.recover(result)
    }

    pub fn cancel(&mut self) -> Result<Value, String> {
        if self.query.is_none() {
            return Err("No active query".into());
        }
        Ok(self.finish("aborted", true))
    }

    pub fn close(&mut self) {
        self.closed = true;
        self.query = None;
        self.cache.clear();
        self.catalog.banks.clear();
        self.navigation.clear();
        self.input = Value::Null;
    }

    pub fn catalog(&mut self, action: &str) -> Result<Value, String> {
        if self.closed {
            return Err("Route solver is closed".into());
        }
        if self.query.is_some() {
            return Err("Catalog lifecycle cannot change during a query".into());
        }
        match action {
            "train" => {
                if self.catalog.frozen {
                    return Err("Catalog is frozen".into());
                }
                self.catalog.training = true;
            }
            "freeze" => {
                self.catalog.frozen = true;
                self.catalog.training = false;
            }
            "clear" => {
                self.catalog = Catalog::default();
            }
            "stats" => (),
            _ => return Err("Unknown catalog action".into()),
        }
        Ok(
            json!({"frozen":self.catalog.frozen,"training":self.catalog.training,
            "revision":self.catalog.revision,"actions":self.catalog.banks.values().map(|b|b.len()).sum::<usize>(),
            "banks":self.catalog.banks.len(),"worlds":self.cache.len()}),
        )
    }

    fn world(
        &mut self,
        snapshot: &Value,
        revision: &Value,
        coverage: &Value,
    ) -> Result<Arc<World>, String> {
        let key = serde_json::to_string(&json!([revision, coverage])).map_err(|e| e.to_string())?;
        if let Some(index) = self.cache.iter().position(|entry| entry.key == key) {
            let entry = self.cache.remove(index).unwrap();
            let world = entry.world.clone();
            self.cache.push_front(entry);
            return Ok(world);
        }
        if snapshot["cached"] == true {
            return Err("Native snapshot cache miss".into());
        }
        let mut bound = snapshot.clone();
        bound["revision"] = revision.clone();
        bound["coverage"] = if coverage["kind"] == "complete" {
            json!("complete")
        } else {
            coverage.clone()
        };
        let world = Arc::new(World::new(bound)?);
        self.cache.push_front(Cached {
            key,
            world: world.clone(),
        });
        // Bounded prepared-world ownership. Active queries hold their own Arc.
        while self.cache.len() > 4 {
            self.cache.pop_back();
        }
        Ok(world)
    }

    fn search_config(&self, stage: usize, key: Option<&str>) -> Value {
        let mut config = self.config.clone();
        // Native search consumes the same PhysicalWork stage as V1. Catalog
        // entries are verified connections, never cached completed routes.
        config["physicalWork"] = json!({"version":1,"step":stage});
        if let Some(bank) = key.and_then(|k| self.catalog.banks.get(k)) {
            config["catalogConnections"] = json!(bank.values().collect::<Vec<_>>());
        }
        config
    }

    fn learn(&mut self, key: &str, result: &Value) {
        if !self.catalog.training {
            return;
        }
        if let Some(connections) = result["connections"].as_array() {
            let bank = self.catalog.banks.entry(key.into()).or_default();
            for connection in connections
                .iter()
                .filter(|c| c["state"] == "open" && c["terminal"] != true)
            {
                let identity = connection["id"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| serde_json::to_string(connection).unwrap());
                if bank.get(&identity) != Some(connection) {
                    bank.insert(identity, connection.clone());
                    self.catalog.revision += 1;
                }
            }
        }
    }

    fn recover(&mut self, result: Result<Value, String>) -> Result<Value, String> {
        match result {
            Ok(value) => Ok(value),
            Err(error) => {
                if self
                    .query
                    .as_ref()
                    .and_then(|q| q.incumbent.as_ref().or(q.partial.as_ref()))
                    .is_some()
                {
                    Ok(self.finish(&error, true))
                } else {
                    self.query = None;
                    Err(error)
                }
            }
        }
    }

    fn effect(&mut self, mut effect: Value) -> Value {
        self.next_id += 1;
        effect["id"] = json!(self.next_id);
        let q = self.query.as_mut().unwrap();
        q.pending = Some(self.next_id);
        if let Some(partial) = &q.partial {
            effect["partial"] = partial.clone();
        }
        json!({"type":"load","effect":effect})
    }

    fn drive(&mut self) -> Result<Value, String> {
        loop {
            if self.query.as_ref().unwrap().proposal.is_none() {
                let q = self.query.as_mut().unwrap();
                if q.attempt >= number(&self.config, "maxAttempts", 6.) as usize {
                    return Ok(self.finish("candidate-budget", true));
                }
                let goal = if let Some(t) = &q.terminal {
                    route_points(&t["route"])?[0]
                } else {
                    point(&q.original["goal"])?
                };
                let starts = q.original["starts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|a| !q.excluded_arrivals.contains(a["id"].as_str().unwrap_or("")))
                    .cloned()
                    .collect::<Vec<_>>();
                if !starts.iter().any(|a| a["state"] == "available") {
                    let reason = q.last_reason.clone();
                    if self.next_terminal(false) {
                        continue;
                    }
                    return Ok(self.finish(&reason, false));
                }
                q.attempt += 1;
                let stops = q.original["waypoints"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                let mut targets = stops.iter().map(point).collect::<Result<Vec<_>, _>>()?;
                targets.push(goal);
                let mut proposal = None;
                let mut leg_starts = starts;
                for target in targets {
                    let Some(mut leg) =
                        self.navigation
                            .plan(&leg_starts, target, &q.excluded_edges)?
                    else {
                        proposal = None;
                        break;
                    };
                    leg_starts = vec![
                        json!({"id":leg.arrival["id"],"position":target,"cost":0,"state":"available"}),
                    ];
                    if let Some(joined) = proposal.as_mut() {
                        let joined: &mut proposal::Proposal = joined;
                        joined.points.extend(leg.points.drain(1..));
                        joined.protected.extend(leg.protected);
                        joined.edges.extend(leg.edges);
                    } else {
                        proposal = Some(leg);
                    }
                }
                let Some(proposal) = proposal else {
                    if self.next_terminal(false) {
                        continue;
                    }
                    return Ok(self.finish("no-global-candidate", false));
                };
                let points = densify(
                    &proposal.points,
                    &proposal.protected,
                    number(&self.config, "tileSpan", 38.4) / 2.,
                );
                let arrival = proposal.arrival.clone();
                q.proposal = Some(proposal);
                q.tail = q.partial.is_none();
                let mut first = points.len() - 1;
                if q.tail {
                    while first > 0
                        && tile_count(
                            &points[first - 1..],
                            number(&self.config, "margin", 8.),
                            &self.config,
                        ) <= number(&self.config, "maxTiles", 16.) as usize
                    {
                        first -= 1;
                    }
                    if first == points.len() - 1 {
                        q.tail = false;
                    }
                }
                q.tail_covers_start = first == 0
                    && arrival.get("groundRange").is_none()
                    && point(&arrival["position"])? == points[0];
                let mut local_arrival = arrival;
                let selected = if q.tail {
                    local_arrival = json!({"id":"target-approach","position":points[first],"cost":0,"state":"available"});
                    points[first..].to_vec()
                } else {
                    points
                };
                q.window = Some(Window::new(selected, local_arrival)?);
            }
            let done = {
                let q = self.query.as_mut().unwrap();
                let w = q.window.as_mut().unwrap();
                while w.cursor + 1 < w.points.len()
                    && distance(w.position, w.points[w.cursor]) <= 1e-6
                {
                    w.cursor += 1;
                }
                w.cursor >= w.points.len()
            };
            if done {
                let q = self.query.as_mut().unwrap();
                let w = q.window.as_ref().unwrap();
                let mut pieces = w.pieces.clone();
                if !q.tail
                    && let Some(t) = &q.terminal
                {
                    pieces.push(t["route"].clone());
                }
                match schedule::compose_state(
                    &pieces,
                    &self.input["locomotion"],
                    &q.boost_facts.values().cloned().collect::<Vec<_>>(),
                    &w.arrival["continuation"],
                )? {
                    Some(composed) => {
                        let route = composed.route;
                        q.truncated |= route["search"]["truncated"] == true
                            || route["locomotion"]["search"]["truncated"] == true;
                        let mut result = json!({"route":route,"continuation":composed.continuation,"connections":w.connections,"supportBoxes":w.support,
                            "arrival":q.proposal.as_ref().unwrap().arrival,"partial":q.tail,
                            "diagnostics":{"truncated":q.truncated,"candidateAttempts":q.attempt}});
                        if q.tail
                            && q.tail_covers_start
                            && w.waypoint == q.original["waypoints"].as_array().map_or(0, Vec::len)
                        {
                            // The tail used the original available start and its
                            // physical projection rules. Canonical supported feet
                            // can differ from raw navigation height; requiring
                            // coordinate equality would repeat the entire solve.
                            // Explicit ground ranges still require the forward pass.
                            let arrival = &q.proposal.as_ref().unwrap().arrival;
                            result["partial"] = json!(false);
                            result["route"]["start"] = arrival["id"].clone();
                            result["route"]["cost"] = json!(
                                number(&result["route"], "cost", 0.)
                                    - number(&result["route"], "arrivalCost", 0.)
                                    + number(arrival, "cost", 0.)
                            );
                            result["route"]["arrivalCost"] = arrival["cost"].clone();
                            if let Some(done) = self.accept_complete(result) {
                                return Ok(done);
                            }
                            continue;
                        }
                        if q.tail {
                            q.partial = Some(result);
                            self.begin_forward()?;
                            continue;
                        }
                        if let Some(t) = &q.terminal
                            && let Some(boxes) = t["supportBoxes"].as_array()
                        {
                            result["supportBoxes"]
                                .as_array_mut()
                                .unwrap()
                                .extend(boxes.clone());
                        }
                        if let Some(done) = self.accept_complete(result) {
                            return Ok(done);
                        }
                        continue;
                    }
                    None => {
                        self.fail_candidate("resource-schedule")?;
                        continue;
                    }
                }
            }
            let q = self.query.as_mut().unwrap();
            let w = q.window.as_mut().unwrap();
            let margin = number(&self.config, "margin", 8.) * (w.expansion + 1) as f64;
            if w.end.is_none() {
                let mut end = w.cursor;
                while end + 1 < w.points.len() {
                    let mut bounds = vec![w.position];
                    bounds.extend_from_slice(&w.points[w.cursor..=end + 1]);
                    if tile_count(&bounds, margin, &self.config)
                        > number(&self.config, "maxTiles", 16.) as usize
                    {
                        break;
                    }
                    end += 1;
                }
                w.end = Some(end);
            }
            let end = w.end.unwrap();
            let mut path = vec![w.position];
            path.extend_from_slice(&w.points[w.cursor..=end]);
            if tile_count(&path, margin, &self.config)
                > number(&self.config, "maxTiles", 16.) as usize
            {
                self.fail_candidate("coverage-budget")?;
                continue;
            }
            let signature =
                serde_json::to_string(&json!([w.position, w.points[end], margin, w.stage]))
                    .unwrap();
            if w.failures.contains(&signature) {
                self.fail_candidate("repeated-window-failure")?;
                continue;
            }
            let corridor = corridor(&path, margin, &self.config);
            let start = w.position;
            let target = w.points[end];
            let mut arrival = w.arrival.clone();
            arrival["position"] = json!(start);
            if !w.pieces.is_empty() {
                arrival["cost"] = json!(0);
                arrival.as_object_mut().unwrap().remove("groundRange");
            }
            if let Some(continuation) = &w.continuation {
                arrival["continuation"] = continuation.clone();
            }
            let interaction = if end + 1 == w.points.len() && q.terminal.is_none() {
                q.original["interaction"].clone()
            } else {
                Value::Null
            };
            let waypoints = q.original["waypoints"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .skip(w.waypoint)
                .collect::<Vec<_>>();
            return Ok(
                self.effect(json!({"kind":"window","scene":self.input["scene"]["scene"],
                "start":start,"target":target,"margin":margin,"corridor":corridor,
                "arrival":arrival,"interaction":interaction,"waypoints":waypoints})),
            );
        }
    }

    fn begin_forward(&mut self) -> Result<(), String> {
        let q = self.query.as_mut().unwrap();
        q.tail = false;
        let p = q.proposal.as_ref().unwrap();
        let points = densify(
            &p.points,
            &p.protected,
            number(&self.config, "tileSpan", 38.4) / 2.,
        );
        q.window = Some(Window::new(points, p.arrival.clone())?);
        Ok(())
    }

    fn solve_window(&mut self, base_world: Arc<World>) -> Result<(), String> {
        let world = base_world.clone();
        let facts = &mut self.query.as_mut().unwrap().boost_facts;
        for boost in &world.boosts {
            let value = serde_json::to_value(boost).map_err(|e| e.to_string())?;
            if facts
                .get(&boost.effect.id)
                .is_some_and(|previous| *previous != value)
            {
                return Err("Boost facts changed during scene query".into());
            }
            facts.insert(boost.effect.id.clone(), value);
        }
        let following = &mut self.query.as_mut().unwrap().following_facts;
        for device in &world.devices.following_supports {
            let value = serde_json::to_value(device).map_err(|e| e.to_string())?;
            if following
                .get(&device.id)
                .is_some_and(|previous| *previous != value)
            {
                return Err("Following support facts changed during scene query".into());
            }
            following.insert(device.id.clone(), value);
        }
        let q = self.query.as_ref().unwrap();
        let w = q.window.as_ref().unwrap();
        let end = w.end.unwrap();
        let final_window = end + 1 == w.points.len();
        let mut fixed = route_placements(&w.pieces)?;
        if let Some(terminal) = &q.terminal {
            merge_placements(
                &mut fixed,
                terminal["route"]["placements"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
            )?;
        }
        let world = placed_world(base_world.clone(), &fixed, &q.following_facts)?;
        let mut arrival = w.arrival.clone();
        arrival["position"] = json!(w.position);
        if !w.pieces.is_empty() {
            arrival["cost"] = json!(0);
            arrival.as_object_mut().unwrap().remove("groundRange");
        }
        if let Some(continuation) = &w.continuation {
            arrival["continuation"] = continuation.clone();
        }
        let waypoints = q.original["waypoints"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        // Ordered waypoints are consumed as the route advances, never restarted
        // from the first waypoint for every physical window.
        let mut supported = w.points[end];
        if !final_window {
            let vertical = number(&self.config, "maxTargetError", 3.);
            let allowance = serde_json::from_value::<crate::model::Interaction>(
                json!({"radius":vertical.hypot(0.5),"maxVertical":vertical}),
            )
            .map_err(|e| e.to_string())?;
            if let Some(hit) = world
                .project_with_tolerance(supported, vertical, Some(&allowance))?
                .into_iter()
                .find(|hit| {
                    horizontal(hit.position, supported) <= 0.5
                        && (hit.position[1] - supported[1]).abs() <= vertical
                })
            {
                supported = hit.position;
            }
        }
        let mut local = json!({"starts":[arrival],"goal":supported});
        let pending = waypoints
            .iter()
            .skip(w.waypoint)
            .take_while(|v| {
                point(v)
                    .map(|p| near_path(p, &w.points[w.cursor..=end], 3.))
                    .unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();
        local["waypoints"] = json!(pending);
        if final_window && q.terminal.is_none() {
            local["interaction"] = q.original["interaction"].clone();
        }
        let key = self.cache.front().unwrap().key.clone();
        let mut config = self.search_config(w.stage, Some(&key));
        config["fixedPlacements"] = json!(fixed);
        let mut result = (self.solve)(&world, &local, &config)?;
        if complete(&result["route"]) && w.stage < 2 {
            // Feasibility does not make walking or a known device the fastest
            // route. Compare a bounded full-action alternative in the same
            // immutable world before accepting this window.
            let mut improvement = self.search_config(2, Some(&key));
            improvement["fixedPlacements"] = json!(fixed);
            improvement["maxCandidates"] =
                json!(number(&self.config, "maxCandidates", 0.).min(640.) as u64);
            let candidate = (self.solve)(&world, &local, &improvement)?;
            let incomplete = truncated(&result) || truncated(&candidate);
            if complete(&candidate["route"])
                && number(&candidate["route"], "cost", f64::INFINITY)
                    < number(&result["route"], "cost", f64::INFINITY)
            {
                result = candidate;
            }
            result["diagnostics"]["truncated"] = json!(incomplete);
        }
        if std::env::var_os("GANGLIA_PROFILE").is_some() {
            eprintln!(
                "{}",
                json!({"native":"engine","phase":"window",
                "start":arrival["position"],"target":supported,"stage":w.stage,
                "status":result["route"]["status"],"cost":result["route"]["cost"],
                "groundAttempts":result["diagnostics"]["groundAttempts"]})
            );
        }
        let mut merged = fixed.clone();
        if complete(&result["route"]) {
            if merge_placements(
                &mut merged,
                result["route"]["placements"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
            )
            .is_err()
            {
                return self.fail_candidate("conflicting-following-placement");
            }
            result["route"]["placements"] = json!(merged);
        }
        let mut composed = if complete(&result["route"]) {
            let mut pieces = w.pieces.clone();
            pieces.push(result["route"].clone());
            schedule::compose_state(
                &pieces,
                &self.input["locomotion"],
                &q.boost_facts.values().cloned().collect::<Vec<_>>(),
                &w.arrival["continuation"],
            )?
        } else {
            None
        };
        if merged != fixed {
            // Newly selected static placements apply to the whole route. Their
            // collision cannot invalidate an earlier independently proved piece.
            for (proof_world, proof_route) in &w.proofs {
                let configured = placed_world(proof_world.clone(), &merged, &q.following_facts)?;
                if !trace_clear(&configured, proof_route)? {
                    return self.fail_candidate("placement-invalidates-prefix");
                }
            }
        }
        let q = self.query.as_mut().unwrap();
        let w = q.window.as_mut().unwrap();
        q.truncated |= truncated(&result);
        let route = &result["route"];
        let margin = number(&self.config, "margin", 8.) * (w.expansion + 1) as f64;
        let signature =
            serde_json::to_string(&json!([w.position, w.points[end], margin, w.stage])).unwrap();
        let mut reason = result["reason"]
            .as_str()
            .unwrap_or("no-verified-route")
            .to_string();
        if complete(route) && composed.is_some() {
            let points = route_points(route)?;
            let entry = points[0];
            let exit = *points.last().unwrap();
            if !w.pieces.is_empty() && distance(entry, w.position) > 1e-4 {
                return self.fail_candidate("entry-discontinuity");
            }
            let goal = w.points[end];
            let reaches = if final_window && q.terminal.is_none() {
                if q.original["interaction"].is_null() {
                    horizontal(exit, goal) <= 1e-6
                        && (exit[1] - goal[1]).abs() <= world.movement.max_vertical + 1e-6
                } else {
                    crate::search::hit(
                        exit,
                        exit,
                        point(&q.original["goal"])?,
                        &q.original["interaction"],
                    )
                    .is_some()
                }
            } else if final_window {
                distance(exit, goal) <= 1e-6
            } else {
                (exit[1] - goal[1]).abs() <= number(&self.config, "maxTargetError", 3.)
                    && horizontal(exit, goal) <= 0.5
            };
            if !reaches {
                reason = "target-projection-error".into();
            } else {
                w.waypoint = consume_waypoints(
                    &points,
                    &waypoints,
                    w.waypoint,
                    1e-6,
                    world.movement.max_vertical + 1e-6,
                )?;
                if final_window && !q.tail && w.waypoint < waypoints.len() {
                    reason = "ordered-waypoint-unreached".into();
                } else {
                    let composed = composed.take().unwrap();
                    w.pieces = vec![composed.route];
                    w.continuation = Some(composed.continuation);
                    w.proofs.push((base_world, route.clone()));
                    if let Some(v) = result["supportBoxes"].as_array() {
                        w.support.extend(v.clone());
                    }
                    if let Some(v) = result["connections"].as_array() {
                        w.connections.extend(v.clone());
                    }
                    w.position = exit;
                    w.cursor = end + 1;
                    w.end = None;
                    w.stage = 0;
                    w.expansion = 0;
                    self.learn(&key, &result);
                    return Ok(());
                }
            }
        }
        if complete(route) && composed.is_none() {
            reason = "resource-schedule".into();
        }
        w.failures.insert(signature);
        if w.stage < 2 {
            w.stage += 1;
            return Ok(());
        }
        if w.expansion == 0 {
            w.expansion = 1;
            w.stage = 0;
            w.end = None;
            return Ok(());
        }
        if end > w.cursor {
            w.end = Some((end + w.cursor) / 2);
            w.stage = 0;
            return Ok(());
        }
        self.fail_candidate(&reason)
    }

    fn fail_candidate(&mut self, reason: &str) -> Result<(), String> {
        if self.query.as_ref().unwrap().tail {
            return self.begin_forward();
        }
        let q = self.query.as_mut().unwrap();
        q.last_reason = reason.into();
        let p = q.proposal.as_ref().unwrap();
        let w = q.window.as_ref().unwrap();
        // A whole-route resource failure happens after all windows finish.
        // It has no active spatial witness; reject the arrival rather than
        // indexing past the guide or closing an unrelated transfer edge.
        let failed = if w.cursor < w.points.len() {
            &w.points[w.cursor..=w.end.unwrap_or(w.cursor)]
        } else {
            &[]
        };
        if let Some(edge) = p.edges.iter().find(|e| {
            e.unresolved
                && !q.excluded_edges.contains(&e.key)
                && e.points
                    .iter()
                    .any(|a| failed.iter().any(|b| distance(*a, *b) < 1e-5))
        }) {
            q.excluded_edges.insert(edge.key.clone());
        } else {
            q.excluded_arrivals
                .insert(p.arrival["id"].as_str().unwrap_or("").into());
        }
        q.proposal = None;
        q.window = None;
        self.next_terminal(true);
        Ok(())
    }

    fn next_terminal(&mut self, retain: bool) -> bool {
        let q = self.query.as_mut().unwrap();
        let Some(next) = q.terminals.pop_front() else {
            return false;
        };
        if retain {
            q.terminals.push_back(Terminal {
                asset: q.terminal.take(),
                excluded_arrivals: std::mem::take(&mut q.excluded_arrivals),
                excluded_edges: std::mem::take(&mut q.excluded_edges),
            });
        }
        q.terminal = next.asset;
        q.excluded_arrivals = next.excluded_arrivals;
        q.excluded_edges = next.excluded_edges;
        q.proposal = None;
        q.window = None;
        true
    }

    fn accept_complete(&mut self, result: Value) -> Option<Value> {
        let q = self.query.as_mut().unwrap();
        if q.incumbent.as_ref().is_none_or(|best| {
            number(&result["route"], "cost", f64::INFINITY)
                < number(&best["route"], "cost", f64::INFINITY)
        }) {
            q.incumbent = Some(result);
        }
        let arrival = q.proposal.as_ref().unwrap().arrival["id"]
            .as_str()
            .unwrap_or("")
            .to_string();
        q.excluded_arrivals.insert(arrival);
        q.proposal = None;
        q.window = None;
        let cost = number(
            &q.incumbent.as_ref().unwrap()["route"],
            "cost",
            f64::INFINITY,
        );
        // Arrival overhead alone is an admissible lower bound even for devices
        // with zero traversal time. Proposal penalties never prune alternatives.
        let remaining = q.original["starts"].as_array().unwrap().iter().any(|a| {
            a["state"] == "available"
                && !q.excluded_arrivals.contains(a["id"].as_str().unwrap_or(""))
                && number(a, "cost", 0.) < cost
        });
        let alternatives = !q.terminals.is_empty();
        if (remaining || alternatives)
            && q.attempt < number(&self.config, "maxAttempts", 6.) as usize
        {
            self.next_terminal(remaining);
            return None;
        }
        let limited = remaining || alternatives;
        Some(self.finish("candidate-budget", limited))
    }

    fn finish(&mut self, reason: &str, limited: bool) -> Value {
        let q = self.query.take().unwrap();
        let completed = q.incumbent.is_some();
        let mut result = q
            .incumbent
            .or(q.partial)
            .unwrap_or_else(|| json!({"route":{"status":"no-verified-route"},"connections":[]}));
        if !completed {
            result["reason"] = json!(reason);
        }
        result["diagnostics"] =
            json!({"truncated":q.truncated||limited,"candidateAttempts":q.attempt});
        json!({"type":"complete","result":result})
    }
}

impl Window {
    fn new(points: Vec<Point>, arrival: Value) -> Result<Self, String> {
        Ok(Self {
            points,
            cursor: 0,
            end: None,
            position: point(&arrival["position"])?,
            arrival,
            stage: 0,
            expansion: 0,
            pieces: vec![],
            support: vec![],
            connections: vec![],
            failures: HashSet::new(),
            waypoint: 0,
            continuation: None,
            proofs: vec![],
        })
    }
}

fn merge_placements(placements: &mut Vec<Value>, additions: &[Value]) -> Result<(), String> {
    for addition in additions {
        let id = addition["device"]
            .as_str()
            .ok_or("Placement requires device")?;
        let position = point(&addition["position"])?;
        if let Some(previous) = placements.iter().find(|p| p["device"] == id) {
            if distance(point(&previous["position"])?, position) > 1e-6 {
                return Err("Conflicting support placements".into());
            }
        } else {
            placements.push(addition.clone());
        }
    }
    Ok(())
}
fn route_placements(pieces: &[Value]) -> Result<Vec<Value>, String> {
    let mut placements = vec![];
    for piece in pieces {
        merge_placements(
            &mut placements,
            piece["placements"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        )?;
    }
    Ok(placements)
}
fn placed_world(
    mut world: Arc<World>,
    placements: &[Value],
    following: &BTreeMap<String, Value>,
) -> Result<Arc<World>, String> {
    if placements.is_empty() {
        return Ok(world);
    }
    let mut devices = world
        .devices
        .following_supports
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut changed = false;
    for placement in placements {
        let id = placement["device"]
            .as_str()
            .ok_or("Placement requires device")?;
        if !devices.iter().any(|d| d["id"] == id) {
            devices.push(
                following
                    .get(id)
                    .ok_or("Missing carried following support facts")?
                    .clone(),
            );
            changed = true;
        }
    }
    if changed {
        // Missing device metadata in a later sparse window does not erase an
        // already selected pose. Enrich only query-local facts; keep this window's
        // exact coverage and raw collision snapshot intact.
        let mut bound = world.snapshot().clone();
        bound["input"]["devices"]["followingSupports"] = json!(devices);
        world = Arc::new(World::new(bound)?);
    }
    Ok(Arc::new(
        world
            .with_placements(placements)?
            .ok_or("Carried following placement is unavailable")?,
    ))
}
fn trace_clear(world: &World, route: &Value) -> Result<bool, String> {
    for segment in route["segments"]
        .as_array()
        .ok_or("Route requires segments")?
    {
        let points = route_points(segment)?;
        for pair in points.windows(2) {
            if !world.clear(pair[0], pair[1], 0.)? {
                return Ok(false);
            }
            if segment["mode"] == "walk" {
                let Some(path) = world.ground_path(pair[0], pair[1])? else {
                    return Ok(false);
                };
                if distance(path.points[0], pair[0]) > 1e-6
                    || distance(*path.points.last().unwrap(), pair[1]) > 1e-6
                    || (path.length - distance(pair[0], pair[1])).abs() > 1e-6
                {
                    return Ok(false);
                }
            }
        }
    }
    Ok(true)
}

fn validate_query(q: &Value) -> Result<(), String> {
    point(&q["goal"])?;
    let starts = q["starts"]
        .as_array()
        .ok_or("Query requires starts array")?;
    for a in starts {
        point(&a["position"])?;
        if a["id"].as_str().is_none()
            || !number(a, "cost", f64::NAN).is_finite()
            || number(a, "cost", -1.) < 0.
            || !matches!(
                a["state"].as_str(),
                Some("available" | "locked" | "unknown")
            )
        {
            return Err("Invalid arrival".into());
        }
    }
    if let Some(waypoints) = q.get("waypoints") {
        let points = waypoints.as_array().ok_or("Waypoints must be an array")?;
        if points.len() > 128 {
            return Err("At most 128 waypoints are supported".into());
        }
        for v in points {
            point(v)?;
        }
    }
    Ok(())
}

fn point(v: &Value) -> Result<Point, String> {
    let a = v
        .as_array()
        .filter(|a| a.len() == 3)
        .ok_or("Expected finite Vec3")?;
    let mut p = [0.; 3];
    for i in 0..3 {
        p[i] = a[i]
            .as_f64()
            .filter(|n| n.is_finite())
            .ok_or("Expected finite Vec3")?;
    }
    Ok(p)
}
fn number(v: &Value, key: &str, default: f64) -> f64 {
    v[key].as_f64().unwrap_or(default)
}
fn distance(a: Point, b: Point) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}
fn horizontal(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}
fn complete(route: &Value) -> bool {
    route["status"] == "complete"
}
fn route_points(route: &Value) -> Result<Vec<Point>, String> {
    let p = route["points"]
        .as_array()
        .ok_or("Route requires points")?
        .iter()
        .map(point)
        .collect::<Result<Vec<_>, _>>()?;
    if p.is_empty() {
        return Err("Empty completed route".into());
    }
    Ok(p)
}
fn truncated(r: &Value) -> bool {
    r["diagnostics"]["truncated"] == true
        || r["route"]["search"]["truncated"] == true
        || r["route"]["locomotion"]["search"]["truncated"] == true
}
fn lerp(a: Point, b: Point, t: f64) -> Point {
    std::array::from_fn(|i| a[i] + (b[i] - a[i]) * t)
}
fn densify(points: &[Point], protected: &[[Point; 2]], span: f64) -> Vec<Point> {
    let mut result = vec![];
    for (i, p) in points.iter().enumerate() {
        if i > 0 && !protected.contains(&[points[i - 1], *p]) {
            let steps = (horizontal(points[i - 1], *p) / span).ceil().max(1.) as usize;
            for n in 1..steps {
                result.push(lerp(points[i - 1], *p, n as f64 / steps as f64));
            }
        }
        result.push(*p);
    }
    result
}
fn bounds(points: &[Point], margin: f64, config: &Value) -> ([f64; 2], [f64; 2]) {
    let grid = number(config, "gridSpan", 32.);
    let min = std::array::from_fn(|i| {
        ((points
            .iter()
            .map(|p| p[i * 2])
            .fold(f64::INFINITY, f64::min)
            - margin)
            / grid)
            .floor()
            * grid
    });
    let max = std::array::from_fn(|i| {
        ((points
            .iter()
            .map(|p| p[i * 2])
            .fold(f64::NEG_INFINITY, f64::max)
            + margin)
            / grid)
            .ceil()
            * grid
    });
    (min, max)
}
fn tile_count(points: &[Point], margin: f64, config: &Value) -> usize {
    let (min, max) = bounds(points, margin, config);
    let span = number(config, "tileSpan", 38.4);
    (0..2)
        .map(|i| ((max[i] / span).ceil() - (min[i] / span).floor()).max(0.) as usize)
        .product()
}
fn corridor(points: &[Point], margin: f64, config: &Value) -> Value {
    let (min, max) = bounds(points, margin, config);
    let span = number(config, "tileSpan", 38.4);
    let mut tiles = vec![];
    for x in (min[0] / span).floor() as i64..(max[0] / span).ceil() as i64 {
        for z in (min[1] / span).floor() as i64..(max[1] / span).ceil() as i64 {
            tiles.push(json!({"x":x,"z":z}));
        }
    }
    json!({"kind":"corridor-proposal","bounds":{"min":min,"max":max},"tiles":tiles,
        "coarse":{"regions":0,"edges":0,"path":points,"halo":margin}})
}
fn near_path(p: Point, path: &[Point], radius: f64) -> bool {
    path.iter().any(|q| distance(p, *q) <= radius)
}
fn consume_waypoints(
    path: &[Point],
    waypoints: &[Value],
    mut next: usize,
    radius: f64,
    vertical: f64,
) -> Result<usize, String> {
    let mut segment = 0;
    let mut earliest: f64 = 0.;
    while next < waypoints.len() {
        let p = point(&waypoints[next])?;
        let mut found = false;
        while segment + 1 < path.len() {
            let a = path[segment];
            let b = path[segment + 1];
            let dx = b[0] - a[0];
            let dz = b[2] - a[2];
            let squared = dx * dx + dz * dz;
            let mut lo = earliest;
            let mut hi: f64 = 1.;
            if squared > 0. {
                let center = ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / squared;
                let gap = (a[0] + center * dx - p[0]).hypot(a[2] + center * dz - p[2]);
                if gap > radius {
                    segment += 1;
                    earliest = 0.;
                    continue;
                }
                // Projection avoids cancellation in a long span's quadratic
                // discriminant when the waypoint cylinder is only micrometres wide.
                let half = ((radius * radius - gap * gap).max(0.) / squared).sqrt();
                lo = lo.max(center - half);
                hi = hi.min(center + half);
            } else if horizontal(a, p) > radius {
                segment += 1;
                earliest = 0.;
                continue;
            }
            let dy = b[1] - a[1];
            if dy.abs() <= 1e-12 {
                if (a[1] - p[1]).abs() > vertical {
                    segment += 1;
                    earliest = 0.;
                    continue;
                }
            } else {
                let t1 = (p[1] - vertical - a[1]) / dy;
                let t2 = (p[1] + vertical - a[1]) / dy;
                lo = lo.max(t1.min(t2));
                hi = hi.min(t1.max(t2));
            }
            if lo <= hi + 1e-12 && lo <= 1. && hi >= 0. {
                earliest = lo.clamp(0., 1.);
                found = true;
                break;
            }
            segment += 1;
            earliest = 0.;
        }
        if !found {
            break;
        }
        next += 1;
    }
    Ok(next)
}

#[cfg(test)]
#[path = "engine/tests.rs"]
mod tests;
