use super::*;
fn surface(id: &str, x: f64) -> Value {
    json!({"id":id,"vertices":[[x-1.,0.,-1.],[x+1.,0.,-1.],[x+1.,0.,1.],[x-1.,0.,1.]]})
}
fn scene(surfaces: Vec<Value>, connections: Vec<Value>) -> Value {
    let mut positions = Vec::<f64>::new();
    let mut indices = Vec::new();
    for s in &surfaces {
        let base = positions.len() / 3;
        for p in array(&s["vertices"]) {
            positions.extend(point(p).unwrap());
        }
        indices.extend([base, base + 2, base + 1, base, base + 3, base + 2]);
    }
    json!({"surfaces":surfaces,"collision":{"positions":positions,"indices":indices},"walls":[],"connections":connections,"movement":{"speed":2.,"maxVertical":0.5,"profile":{"radius":0.1,"height":1.8},"runAirSpeed":0.,"maxDrop":100.,"maxHorizontalDistance":100.,"model":{"gravity":10.,"fallingGravity":10.,"maxJumpHeight":0.,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":0.}}})
}
fn start(id: &str, x: f64, cost: f64, state: &str) -> Value {
    json!({"id":id,"position":[x,0.,0.],"cost":cost,"state":state})
}
fn connection(id: &str, a: f64, b: f64, duration: f64) -> Value {
    json!({"id":id,"mode":"rope","points":[[a,0.01,0.],[b,0.01,0.]],"times":[0.,duration],"state":"open","endpointTolerance":0.02})
}
fn policy() -> Value {
    json!({"sampleSpacing":100.,"maxCandidates":2000,"maxLinks":32})
}

#[test]
fn staged_work_consumes_snapshot_bound_catalog_actions() {
    let world = scene(vec![surface("a", 0.), surface("b", 10.)], vec![]);
    let query = json!({"starts":[start("a",0.,0.,"available")],"goal":[10.,0.,0.]});
    let mut config = json!({"maxCandidates":0,"physicalWork":{"version":1,"step":0},
        "catalogConnections":[connection("catalog/rope",0.,10.,2.)]});
    assert_ne!(
        solve_snapshot(&world, &query, &config).unwrap()["route"]["status"],
        "complete"
    );
    config["physicalWork"]["step"] = json!(1);
    let result = solve_snapshot(&world, &query, &config).unwrap();
    complete(&result);
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .any(|s| s["connection"] == "catalog/rope")
    );
}

#[test]
fn catalog_library_retrieval_uses_link_allowance_and_reports_omitted_proposals() {
    let world = scene(vec![surface("a", 0.), surface("b", 10.)], vec![]);
    let query = json!({"starts":[start("a",0.,0.,"available")],"goal":[10.,0.,0.]});
    let mut catalog = (0..100)
        .map(|i| connection(&format!("catalog/irrelevant-{i}"), 10., 10.5, 2.))
        .collect::<Vec<_>>();
    catalog.push(connection("catalog/useful", 0., 10., 2.));
    let config = json!({"maxCandidates":0,"maxLinks":1,"physicalWork":{"step":1},
        "catalogConnections":catalog});
    let result = solve_snapshot(&world, &query, &config).unwrap();
    complete(&result);
    assert_eq!(result["diagnostics"]["truncated"], true);
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .any(|s| s["connection"] == "catalog/useful")
    );
}

#[test]
fn resource_queue_reaches_goal_before_spending_its_budget_on_a_cheap_remote_prefix() {
    let mut world = scene(
        vec![
            surface("start", 0.),
            surface("goal", 10.),
            surface("remote", -100.),
        ],
        vec![
            connection("remote-prefix", 0., -100., 1.),
            connection("goal", 0., 10., 2.),
        ],
    );
    world["movement"]["locomotion"] = json!({"speed":2.,"sprintSpeed":2.,"sprintAcceleration":1.,
        "search":{"maxLabels":256,"maxExpanded":1}});
    let query = json!({"starts":[start("player",0.,0.,"available")],"goal":[10.,0.,0.]});
    let result = solve_snapshot(
        &world,
        &query,
        &json!({"maxCandidates":0,"physicalWork":{"step":1}}),
    )
    .unwrap();
    complete(&result);
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .any(|s| s["connection"] == "goal")
    );
}
fn complete(result: &Value) {
    assert_eq!(
        result["route"]["status"], "complete",
        "route={}, diagnostics={}",
        result["route"], result["diagnostics"]
    );
}
#[test]
fn multiple_arrivals_and_multiple_device_hops() {
    let world = scene(
        vec![surface("a", 0.), surface("b", 10.), surface("c", 20.)],
        vec![
            connection("ab", 0., 10., 2.),
            connection("bc", 10., 20., 3.),
        ],
    );
    let query = json!({"starts":[start("locked",20.,0.,"locked"),start("far",0.,4.,"available"),start("near",10.,0.5,"available")],"goal":[20.,0.,0.]});
    let result = solve_snapshot(&world, &query, &policy()).unwrap();
    complete(&result);
    assert_eq!(result["route"]["start"], "near");
    let query = json!({"starts":[start("a",0.,0.,"available")],"goal":[20.,0.,0.]});
    let result = solve_snapshot(&world, &query, &policy()).unwrap();
    complete(&result);
    let ids: Vec<_> = array(&result["route"]["segments"])
        .iter()
        .filter_map(|s| s["connection"].as_str())
        .collect();
    assert_eq!(ids, ["ab", "bc"]);
}
#[test]
fn ordered_waypoints_force_a_return_before_goal() {
    let world = scene(
        vec![json!({"id":"floor","vertices":[[-1.,0.,-2.],[21.,0.,-2.],[21.,0.,2.],[-1.,0.,2.]]})],
        vec![],
    );
    let query = json!({"starts":[start("a",0.,0.,"available")],"waypoints":[[12.,0.01,0.],[4.,0.01,0.]],"goal":[20.,0.,0.]});
    let result = solve_snapshot(&world, &query, &policy()).unwrap();
    complete(&result);
    assert!(result["route"]["length"].as_f64().unwrap() > 35.9);
}
#[test]
fn locked_and_unknown_starts_never_grant_access() {
    let world = scene(vec![surface("a", 0.)], vec![]);
    let q = json!({"starts":[start("a",0.,0.,"unknown")],"goal":[0.,0.,0.]});
    assert_eq!(
        solve_snapshot(&world, &q, &policy()).unwrap()["route"]["status"],
        "unmapped"
    );
}
fn options(extra: Value) -> locomotion::ScheduleOptions {
    let mut v = json!({"speed":2.,"sprintSpeed":5.,"sprintAcceleration":10.,"stamina":{"capacity":10.,"initial":10.,"activationCost":1.,"sprintDrain":2.,"recoveryRate":1.,"recoveryDelay":1.,"reserve":1.}});
    for (k, value) in extra.as_object().unwrap() {
        v[k] = value.clone();
    }
    serde_json::from_value(v).unwrap()
}
fn walk(a: f64, b: f64) -> Segment {
    Segment {
        mode: "walk".into(),
        points: vec![[a, 0.01, 0.], [b, 0.01, 0.]],
        times: vec![0., (b - a).abs() / 2.],
        ..Default::default()
    }
}
#[test]
fn resources_and_dash_pulse_continue_across_navmesh_seams() {
    let opts = options(json!({"dash":{"speed":10.,"duration":1.,"cooldown":3.,"cost":2.}}));
    let initial = locomotion::initial(&opts);
    let (state, first, _) = locomotion::advance(&walk(0., 3.), &opts, initial, true, true).unwrap();
    assert!(state.dash_remaining > 0.69);
    assert_eq!(state.dash_count, 1);
    let (split, last, _) = locomotion::advance(&walk(3., 8.), &opts, state, true, true).unwrap();
    let (whole, time, _) = locomotion::advance(&walk(0., 8.), &opts, initial, true, true).unwrap();
    assert!((first + last - time).abs() < 1e-9);
    assert!((split.energy - whole.energy).abs() < 1e-9);
    assert_eq!(split.dash_count, 1);
}
#[test]
fn depleted_sprint_recovers_without_resetting_at_next_edge() {
    let opts = options(json!({}));
    let initial = locomotion::initial(&opts);
    let (state, _, segments) =
        locomotion::advance(&walk(0., 80.), &opts, initial, true, false).unwrap();
    assert!(state.minimum >= 1. - 1e-8);
    assert!(segments.iter().any(|s| s.gait.as_deref() == Some("run")));
    let (next, _, _) = locomotion::advance(&walk(80., 85.), &opts, state, true, false).unwrap();
    assert!(next.energy <= 10.);
    assert!(next.minimum <= state.minimum);
}
#[test]
fn required_sprint_is_an_entry_condition() {
    let opts = options(json!({}));
    let mut action = Segment {
        mode: "jump".into(),
        points: vec![[0., 0., 0.], [1., 0., 0.]],
        times: vec![0., 1.],
        required_gait: Some("sprint".into()),
        ..Default::default()
    };
    assert!(locomotion::advance(&action, &opts, locomotion::initial(&opts), true, false).is_none());
    let (state, _, _) = locomotion::advance(
        &walk(0., 2.),
        &opts,
        locomotion::initial(&opts),
        true,
        false,
    )
    .unwrap();
    action.points[0] = [2., 0., 0.];
    assert!(locomotion::advance(&action, &opts, state, true, false).is_some());
}
#[test]
fn facing_goal_intersection_preserves_earliest_admissible_time() {
    let v = json!({"radius":2.,"maxVertical":0.2,"facing":[1.,0.,0.],"halfAngle":45.});
    let t = hit([-3., 0., 0.], [3., 0., 0.], [0.; 3], &v).unwrap();
    assert!((t - 0.5).abs() < 1e-8);
    assert!(hit([0., 1., 0.], [3., 1., 0.], [0.; 3], &v).is_none());
}
#[test]
fn terminal_actions_cannot_bridge_to_an_unrelated_goal() {
    let mut c = connection("collect", 0., 10., 1.);
    c["terminal"] = json!(true);
    let world = scene(
        vec![surface("a", 0.), surface("b", 10.), surface("c", 20.)],
        vec![c, connection("bc", 10., 20., 1.)],
    );
    let q = json!({"starts":[start("a",0.,0.,"available")],"goal":[20.,0.,0.]});
    assert_eq!(
        solve_snapshot(&world, &q, &policy()).unwrap()["route"]["status"],
        "no-verified-route"
    );
}

#[test]
fn generated_flights_chain_across_disconnected_platforms() {
    let mut world = scene(
        vec![surface("a", 0.), surface("b", 4.), surface("c", 8.)],
        vec![],
    );
    world["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":4.});
    world["movement"]["runAirSpeed"] = json!(4.);
    let q = json!({"starts":[start("a",0.,0.,"available")],"goal":[8.,0.,0.]});
    let result = solve_snapshot(&world, &q, &policy()).unwrap();
    complete(&result);
    let flights: Vec<_> = array(&result["route"]["segments"])
        .iter()
        .filter(|s| s["mode"] == "jump")
        .collect();
    assert!(flights.len() >= 2, "{result}");
    assert!(flights.iter().all(|s| s["flight"]["kind"] == "flight"));
    assert!(!array(&result["route"]["schedule"]).is_empty());
}
#[test]
fn boost_expiry_keeps_an_ordinary_speed_ground_continuation() {
    let mut world = scene(
        vec![json!({"id":"floor","vertices":[[-1.,0.,-2.],[21.,0.,-2.],[21.,0.,2.],[-1.,0.,2.]]})],
        vec![],
    );
    world["boosts"] = json!([{"id":"fast","position":[0.,0.01,0.],"interaction":{"radius":0.2},"multiplier":2.,"duration":1.}]);
    let q = json!({"starts":[start("a",0.,0.,"available")],"goal":[20.,0.,0.]});
    let result = solve_snapshot(&world, &q, &policy()).unwrap();
    complete(&result);
    assert!(
        (result["route"]["cost"].as_f64().unwrap() - 9.).abs() < 1e-6,
        "route={}, diagnostics={}",
        result["route"],
        result["diagnostics"]
    );
    let schedule = array(&result["route"]["schedule"]);
    assert!(
        schedule
            .iter()
            .any(|c| c["segments"][0]["boost"]["id"] == "fast")
    );
    assert!(schedule.iter().any(|c| c["segments"][0]["boost"].is_null()));
}
#[test]
fn airborne_collection_trims_flight_and_carries_witness() {
    let mut world = scene(vec![surface("a", 0.)], vec![]);
    world["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":2.,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":3.});
    world["movement"]["runAirSpeed"] = json!(3.);
    let q = json!({"starts":[start("a",0.,0.,"available")],"goal":[0.,1.5,0.],"interaction":{"airborne":true,"radius":0.1}});
    let result = solve_snapshot(&world, &q, &policy()).unwrap();
    complete(&result);
    assert!(!result["route"]["goalHit"].is_null(), "{}", result["route"]);
    let last = array(&result["route"]["segments"]).last().unwrap();
    assert!(!last["flight"].is_null());
    assert!(
        last["points"].as_array().unwrap().last().unwrap()[1]
            .as_f64()
            .unwrap()
            > 1.39
    );
}

#[test]
fn whole_route_frontier_retains_a_resource_feasible_device_approach() {
    let mut c = connection("sprint-entry", 19., 30., 1.);
    c["requiredGait"] = json!("sprint");
    let mut world = scene(
        vec![
            json!({"id":"approach","vertices":[[-1.,0.,-1.],[20.,0.,-1.],[20.,0.,1.],[-1.,0.,1.]]}),
            surface("landing", 30.),
        ],
        vec![c],
    );
    world["movement"]["locomotion"] = json!({"speed":2.,"sprintSpeed":5.,"sprintAcceleration":10.,"stamina":{"capacity":4.,"initial":4.,"activationCost":1.,"sprintDrain":1.,"recoveryRate":0.,"recoveryDelay":1.,"reserve":1.}});
    let q = json!({"starts":[start("a",0.,0.,"available")],"goal":[30.,0.,0.]});
    let p = json!({"sampleSpacing":2.,"maxCandidates":24,"maxAttempts":0});
    let result = solve_snapshot(&world, &q, &p).unwrap();
    complete(&result);
    assert!(result["route"]["locomotion"]["minimum"].as_f64().unwrap() >= 1. - 1e-8);
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .any(|s| s["connection"] == "sprint-entry")
    );
    world["movement"]["locomotion"]["stamina"]["initial"] = json!(1.);
    let result = solve_snapshot(&world, &q, &p).unwrap();
    assert_eq!(result["route"]["status"], "no-verified-route");
}
#[test]
fn physical_snapshot_generates_support_from_raw_collision() {
    let input = scene(vec![surface("floor", 0.)], vec![]);
    let snapshot = json!({"kind":"physical","input":{"ground":{"surfaces":[],"options":{"speed":2.,"maxVertical":0.5,"profile":{"radius":0.1,"height":1.8},"walls":[]}},"collision":input["collision"],"movement":input["movement"]}});
    let q = json!({"starts":[start("a",-0.5,0.,"available")],"goal":[0.5,0.,0.]});
    let result = solve_snapshot(&snapshot, &q, &policy()).unwrap();
    complete(&result);
    assert!((result["route"]["cost"].as_f64().unwrap() - 0.5).abs() < 1e-6);
}

#[test]
fn following_support_placement_opens_an_otherwise_unreachable_platform() {
    let floor = json!({"id":"floor","vertices":[[-2.,0.,-2.],[6.,0.,-2.],[6.,0.,2.],[-2.,0.,2.]]});
    let upper =
        json!({"id":"upper","vertices":[[3.5,0.8,-1.],[5.,0.8,-1.],[5.,0.8,1.],[3.5,0.8,1.]]});
    let mut world = scene(vec![floor, upper], vec![]);
    world["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":0.5,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":3.});
    world["movement"]["runAirSpeed"] = json!(3.);
    world["movement"]["stepUp"] = json!(0.1);
    // Supplied placement bodies use the common box corner bit order: X/Y/Z.
    let body = (0..8)
        .map(|bits| {
            [
                if bits & 1 != 0 { 0.5 } else { -0.5 },
                if bits & 2 != 0 { 0.4 } else { 0. },
                if bits & 4 != 0 { 0.5 } else { -0.5 },
            ]
        })
        .collect::<Vec<_>>();
    world["devices"] = json!({"followingSupports":[{"id":"box","spawn":[0.,0.,0.],"bodies":[body],"geometryKind":"box","maxDistance":4.5,"initialState":0.,"assumption":"placement-within-activity-range"}]});
    let q = json!({"starts":[start("a",-1.,0.,"available")],"goal":[4.,0.8,0.]});
    let p =
        json!({"sampleSpacing":0.5,"maxCandidates":4000,"maxLinks":10,"maxShortcutCandidates":16});
    let result = solve_snapshot(&world, &q, &p).unwrap();
    complete(&result);
    assert_eq!(result["route"]["placements"][0]["device"], "box");
}

#[test]
fn authored_connections_require_the_declared_support_faces() {
    let mut action = connection("ab", 0., 10., 1.);
    action["fromSurface"] = json!("a");
    action["toSurface"] = json!("b");
    let mut world = scene(vec![surface("a", 0.), surface("b", 10.)], vec![action]);
    let q = json!({"starts":[start("a",0.,0.,"available")],"goal":[10.,0.,0.]});
    let policy = json!({"maxCandidates":0});
    complete(&solve_snapshot(&world, &q, &policy).unwrap());
    for (key, wrong) in [("fromSurface", "b"), ("toSurface", "a")] {
        let original = world["connections"][0][key].clone();
        world["connections"][0][key] = json!(wrong);
        let result = solve_snapshot(&world, &q, &policy).unwrap();
        assert_eq!(result["route"]["status"], "no-verified-route", "{key}");
        world["connections"][0][key] = original;
    }
    world["connections"][0]["fromSurface"] = json!("missing");
    assert!(solve_snapshot(&world, &q, &policy).is_err());
}
#[test]
fn support_constraint_can_match_a_non_nearest_projection() {
    let mut overlay = surface("overlay", 0.);
    for p in overlay["vertices"].as_array_mut().unwrap() {
        p[1] = json!(0.02);
    }
    let mut action = connection("ab", 0., 10., 1.);
    action["fromSurface"] = json!("overlay");
    action["toSurface"] = json!("b");
    action["endpointTolerance"] = json!(0.05);
    let mut world = scene(vec![surface("a", 0.), surface("b", 10.)], vec![action]);
    world["surfaces"].as_array_mut().unwrap().push(overlay);
    let q = json!({"starts":[start("a",0.,0.,"available")],"goal":[10.,0.,0.]});
    complete(&solve_snapshot(&world, &q, &json!({"maxCandidates":0})).unwrap());
}
#[test]
fn compiled_evaluation_replays_identical_resource_clocks_and_state() {
    let opts = options(
        json!({"dash":{"speed":10.,"duration":0.7,"cooldown":2.,"cost":2.},"sprintThrough":["jump"]}),
    );
    let mut state = locomotion::initial(&opts);
    let mut compiled = state;
    let sequence = [
        walk(0., 3.),
        walk(3., 35.),
        Segment {
            mode: "jump".into(),
            points: vec![[35., 0.01, 0.], [36., 0.01, 0.]],
            times: vec![0., 2.],
            ..Default::default()
        },
        walk(36., 80.),
    ];
    for (i, segment) in sequence.iter().enumerate() {
        let sprint = true;
        let dash = i % 2 == 0;
        let (next, time, output) =
            locomotion::advance(segment, &opts, state, sprint, dash).unwrap();
        let (fast, clock) = locomotion::evaluate(
            &locomotion::compile(segment).unwrap(),
            &opts,
            compiled,
            sprint,
            dash,
        )
        .unwrap();
        assert_eq!(time, clock);
        assert!(locomotion::continuation(next, fast));
        assert_eq!(next.energy, fast.energy);
        assert_eq!(next.delay, fast.delay);
        assert_eq!(next.minimum, fast.minimum);
        assert_eq!(next.dash_count, fast.dash_count);
        assert_eq!(
            time,
            output
                .iter()
                .map(|s| s.times.last().copied().unwrap_or(0.))
                .sum::<f64>()
        );
        state = next;
        compiled = fast;
    }
}
#[test]
fn frontier_keeps_distinct_energy_and_recovery_delay_and_does_not_retain_capped_candidates() {
    let opts = options(json!({}));
    let initial = locomotion::initial(&opts);
    let base = Label {
        node: 0,
        stage: 0,
        cost: 1.,
        arrival: 0.,
        origin: 0,
        state: initial,
        parent: None,
        step: None,
        boost: None,
        remaining: 0.,
        used_boost: None,
        minimum: initial.energy,
        dashes: 0,
        active: true,
    };
    let mut arena = vec![];
    let mut rows = vec![vec![]];
    let mut heap = BinaryHeap::new();
    let mut truncated = false;
    insert(
        base.clone(),
        &mut arena,
        &mut rows,
        &mut heap,
        &[0.],
        4,
        &mut truncated,
    );
    let mut less = base.clone();
    less.state.energy -= 1.;
    insert(
        less,
        &mut arena,
        &mut rows,
        &mut heap,
        &[0.],
        4,
        &mut truncated,
    );
    let mut delayed = base.clone();
    delayed.state.delay = 1.;
    insert(
        delayed,
        &mut arena,
        &mut rows,
        &mut heap,
        &[0.],
        4,
        &mut truncated,
    );
    assert_eq!(rows[0].len(), 3);
    let mut unique = base.clone();
    unique.state.delay = 2.;
    insert(
        unique,
        &mut arena,
        &mut rows,
        &mut heap,
        &[0.],
        4,
        &mut truncated,
    );
    assert_eq!(arena.len(), 4);
    for i in 1..100 {
        let mut worse = base.clone();
        worse.cost += i as f64;
        worse.state.energy = 0.;
        worse.state.delay = i as f64 + 2.;
        insert(
            worse,
            &mut arena,
            &mut rows,
            &mut heap,
            &[0.],
            4,
            &mut truncated,
        );
    }
    assert!(truncated);
    assert_eq!(rows[0].len(), 4);
    assert_eq!(arena.len(), 4);
    assert_eq!(heap.len(), 4);
}

#[test]
fn fixed_ride_does_not_inherit_a_character_boost_that_expires_mid_ride() {
    let floor =
        json!({"id":"floor","vertices":[[-4.,0.,-2.],[10.,0.,-2.],[10.,0.,2.],[-4.,0.,2.]]});
    let action = json!({"id":"ride","mode":"rope","traversal":"moving-support","state":"open","points":[[0.,0.01,0.],[6.,0.01,0.]],"times":[0.,0.3],"endpointTolerance":0.02});
    let mut world = scene(vec![floor], vec![action.clone()]);
    world["movement"]["speed"] = json!(4.);
    world["movement"]["locomotion"] = json!({"speed":4.,"sprintSpeed":4.,"sprintAcceleration":10.});
    world["boosts"] = json!([{"id":"fast","position":[-2.,0.,0.],"interaction":{"radius":0.15},"multiplier":2.,"duration":0.5}]);
    let q = json!({"starts":[start("player",-2.,0.25,"available")],"goal":[8.,0.,0.]});
    let result = solve_snapshot(&world, &q, &json!({"maxCandidates":0})).unwrap();
    complete(&result);
    assert!((result["route"]["cost"].as_f64().unwrap() - 1.3).abs() < 1e-9);
    let segments = array(&result["route"]["segments"]);
    let i = segments
        .iter()
        .position(|s| s["connection"] == "ride")
        .unwrap();
    assert_eq!(segments[i]["points"], action["points"]);
    assert_eq!(segments[i]["times"], action["times"]);
    assert!(segments[i]["boost"].is_null());
    assert!(segments[i - 1]["boost"].is_object());
    assert!(segments[i + 1]["boost"].is_null());
    let scheduled = array(&result["route"]["schedule"])
        .iter()
        .flat_map(|block| array(&block["segments"]))
        .find(|s| s["connection"] == "ride")
        .unwrap();
    assert!(scheduled["boost"].is_null());
    assert_eq!(scheduled["times"], action["times"]);
}

#[test]
fn airborne_waypoint_crossing_uses_the_original_vertical_tolerance() {
    let mut snapshot = scene(vec![surface("a", 0.), surface("b", 4.)], vec![]);
    snapshot["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":5.});
    snapshot["movement"]["runAirSpeed"] = json!(5.);
    let world = crate::world::World::new(json!({"kind":"surfaces","input":snapshot})).unwrap();
    let mut connection = world
        .flight([0., 0.01, 0.], [4., 0.01, 0.], crate::model::Mode::Jump)
        .unwrap()
        .unwrap();
    connection.id = "bridge".into();
    snapshot["connections"] = json!([connection]);
    let query = json!({"starts":[start("a",0.,0.,"available")],"goal":[4.,0.,0.],"waypoints":[[2.,0.7,0.]]});
    let result = solve_snapshot(&snapshot, &query, &json!({"maxCandidates":0})).unwrap();
    complete(&result);
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .any(|s| s["connection"] == "bridge")
    );
}
#[test]
fn waypoint_projection_does_not_change_its_original_height_contract() {
    let snapshot = scene(
        vec![json!({"id":"floor","vertices":[[-1.,0.,-1.],[5.,0.,-1.],[5.,0.,1.],[-1.,0.,1.]]})],
        vec![],
    );
    // Navigation can project this waypoint onto the floor within 0.5 m, but
    // the canonical physical feet at +0.01 lie outside its original height slab.
    let query = json!({"starts":[start("a",0.,0.,"available")],"goal":[4.,0.,0.],"waypoints":[[2.,-0.495,0.]]});
    let result = solve_snapshot(&snapshot, &query, &json!({"maxCandidates":0})).unwrap();
    assert_eq!(result["route"]["status"], "no-verified-route");
}
#[test]
fn waypoint_intervals_keep_order_for_vertical_and_stationary_traces() {
    let trace = [[0., 0., 0.], [0., 2., 0.]];
    // The two slabs overlap: accepting the earliest point in the first slab
    // leaves a valid intersection with the second, although its centre is lower.
    assert_eq!(
        advance_stage(&trace, 0, &[[0., 1., 0.], [0., 0.5, 0.]], 0.5),
        2
    );
    assert_eq!(
        advance_stage(&trace, 0, &[[0., 1.6, 0.], [0., 0.2, 0.]], 0.5),
        1
    );
    assert_eq!(
        advance_stage(&[[0., 0., 0.]], 0, &[[0., 0.4, 0.], [0., 0.2, 0.]], 0.5),
        2
    );
    assert_eq!(
        advance_stage(&[[0., 0., 0.], [2., 0., 0.]], 0, &[[1., 0., 0.000002]], 0.5),
        0
    );
    assert_eq!(advance_stage(&trace, 0, &[[0., 3., 0.]], 0.5), 0);
}

#[test]
fn generated_action_identity_survives_query_local_node_reordering() {
    let mut snapshot = scene(vec![surface("a", 0.), surface("b", 4.)], vec![]);
    snapshot["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":5.});
    snapshot["movement"]["runAirSpeed"] = json!(5.);
    let policy = json!({"maxCandidates":256,"maxLinks":4,"sampleSpacing":100.});
    let forward = json!({"starts":[start("a",0.,0.,"available")],"goal":[4.,0.,0.]});
    let reverse = json!({"starts":[start("b",4.,0.,"available")],"goal":[0.,0.,0.]});
    let a = solve_snapshot(&snapshot, &forward, &policy).unwrap();
    let b = solve_snapshot(&snapshot, &reverse, &policy).unwrap();
    complete(&a);
    complete(&b);
    let directed = |result: &Value, x: f64, end: f64| -> String {
        array(&result["connections"])
            .iter()
            .find(|c| {
                c["points"][0] == json!([x, 0.01, 0.])
                    && c["points"].as_array().unwrap().last() == Some(&json!([end, 0.01, 0.]))
                    && c["mode"] == "jump"
            })
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .into()
    };
    assert_ne!(directed(&a, 0., 4.), directed(&b, 4., 0.));
    assert_eq!(directed(&a, 0., 4.), directed(&b, 0., 4.));
    assert_eq!(directed(&a, 4., 0.), directed(&b, 4., 0.));
    let mut learned = std::collections::BTreeMap::new();
    for result in [&a, &b] {
        let actions = array(&result["connections"]);
        let ids = actions
            .iter()
            .map(|c| c["id"].as_str().unwrap())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(ids.len(), actions.len());
        for c in actions {
            let physical = json!({"mode":c["mode"],"points":c["points"],"times":c["times"],"flight":c["flight"]});
            if let Some(previous) =
                learned.insert(c["id"].as_str().unwrap().to_owned(), physical.clone())
            {
                assert_eq!(
                    previous, physical,
                    "one bank key cannot replace a different physical action"
                );
            }
        }
    }
}

#[test]
fn walking_proposals_bound_samples_without_capping_essential_anchors() {
    let mut graph = Graph {
        points: vec![],
        edges: vec![],
        generated: vec![],
        action_ids: std::collections::HashSet::new(),
        anchors: std::collections::HashSet::new(),
    };
    let source = graph.node([0., 0., 0.]);
    for i in 1..=32 {
        graph.anchor([i as f64 * 100., 0., 0.]);
    }
    for i in 1..=100 {
        graph.node([i as f64 / 10., 0., 1.]);
    }
    // A known-device endpoint may already have entered as an ordinary sample.
    let promoted = graph.anchor([10., 0., 1.]);
    let components = vec![Some(0); graph.points.len()];
    let (targets, omitted) = graph.walking_targets(source, 2, 8, &components);
    assert!(omitted);
    assert!(targets.contains(&promoted));
    assert!(graph.anchors.iter().all(|id| targets.contains(id)));
    assert_eq!(
        targets
            .iter()
            .filter(|id| !graph.anchors.contains(id))
            .count(),
        8
    );
    assert_eq!(targets.len(), graph.anchors.len() + 8);
    for stage in [0, 1] {
        let (all, omitted) = graph.walking_targets(source, stage, 1, &components);
        assert!(!omitted);
        assert_eq!(all.len(), graph.points.len() - 1);
    }
}
#[test]
fn bounded_sample_walking_keeps_proven_obstacle_detours_between_query_anchors() {
    let floor = json!({"id":"floor","vertices":[[-4.,0.,-3.],[4.,0.,-3.],[4.,0.,3.],[-4.,0.,3.]]});
    let mut snapshot = scene(vec![floor], vec![]);
    let positions = snapshot["collision"]["positions"].as_array_mut().unwrap();
    let base = positions.len() / 3;
    positions.extend(
        [0., 0., -1., 0., 4., -1., 0., 4., 1., 0., 0., 1.]
            .into_iter()
            .map(|x| json!(x)),
    );
    snapshot["collision"]["indices"]
        .as_array_mut()
        .unwrap()
        .extend(
            [base, base + 1, base + 2, base, base + 2, base + 3]
                .into_iter()
                .map(|x| json!(x)),
        );
    let query = json!({"starts":[start("a",-2.,0.,"available")],"goal":[2.,0.,0.]});
    for stage in [0, 1, 2] {
        let result = solve_snapshot(
            &snapshot,
            &query,
            // With no optional nodes, stage 2 cannot form a direct chain
            // around the obstacle and must retain ordinary ground detours.
            &json!({"physicalWork":{"step":stage},"maxLinks":1,"maxCandidates":if stage==2 {0}else{64}}),
        )
        .unwrap();
        complete(&result);
        let phases = array(&result["diagnostics"]["walkingPhases"]);
        if stage == 2 {
            assert_eq!(phases.len(), 2);
            assert_eq!(phases[0]["kind"], "direct");
            assert_eq!(phases[0]["complete"], false);
            assert!(phases[0]["unexploredDetours"].as_u64().unwrap() > 0);
            assert_eq!(phases[1]["kind"], "detours");
            assert_eq!(phases[1]["complete"], true);
            assert_eq!(
                phases
                    .iter()
                    .map(|p| p["expanded"].as_u64().unwrap())
                    .sum::<u64>(),
                result["route"]["search"]["expanded"].as_u64().unwrap()
            );
        } else {
            assert_eq!(phases.len(), 1);
            assert_eq!(phases[0]["kind"], "full");
        }
        assert!(result["route"]["length"].as_f64().unwrap() > 4.);
        assert!(
            array(&result["route"]["points"])
                .iter()
                .any(|p| p[2].as_f64().unwrap().abs() > 1.)
        );
    }
    snapshot["movement"]["locomotion"] = json!({"speed":2.,"sprintSpeed":2.,"sprintAcceleration":10.,
        "search":{"maxExpanded":1}});
    let bounded = solve_snapshot(&snapshot, &query, &json!({"maxCandidates":0})).unwrap();
    assert_eq!(bounded["route"]["status"], "no-verified-route");
    assert_eq!(bounded["route"]["search"]["expanded"], 1);
    assert_eq!(bounded["route"]["search"]["truncated"], true);
    assert_eq!(
        array(&bounded["diagnostics"]["walkingPhases"]).len(),
        1,
        "the fallback must not reset an exhausted expansion allowance"
    );
    snapshot["movement"]["locomotion"]["search"]["maxExpanded"] = json!(2);
    let bounded = solve_snapshot(&snapshot, &query, &json!({"maxCandidates":0})).unwrap();
    complete(&bounded);
    assert_eq!(bounded["route"]["search"]["expanded"], 2);
    assert_eq!(array(&bounded["diagnostics"]["walkingPhases"]).len(), 2);
}
#[test]
fn bounded_sample_walking_keeps_all_device_endpoints_for_multiple_hops() {
    let snapshot = scene(
        vec![surface("a", 0.), surface("b", 10.), surface("c", 20.)],
        vec![
            connection("ab", 0.6, 9.4, 2.),
            connection("bc", 10.6, 19.4, 3.),
        ],
    );
    let query = json!({"starts":[start("a",-0.5,0.,"available")],"goal":[20.5,0.,0.]});
    let result =
        solve_snapshot(&snapshot, &query, &json!({"maxLinks":1,"maxCandidates":64})).unwrap();
    complete(&result);
    let ids = array(&result["route"]["segments"])
        .iter()
        .filter_map(|s| s["connection"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, ["ab", "bc"]);
    assert!((result["route"]["cost"].as_f64().unwrap() - 6.7).abs() < 1e-8);
    let phases = array(&result["diagnostics"]["walkingPhases"]);
    assert_eq!(phases.len(), 1);
    assert_eq!(phases[0]["kind"], "direct");
    assert_eq!(phases[0]["complete"], true);
    assert!(phases[0]["unexploredDetours"].as_u64().unwrap() > 0);
    assert_eq!(result["route"]["search"]["truncated"], true);
    for authored in array(&snapshot["connections"]) {
        let segment = array(&result["route"]["segments"])
            .iter()
            .find(|s| s["connection"] == authored["id"])
            .unwrap();
        assert_eq!(segment["points"], authored["points"]);
        assert_eq!(segment["times"], authored["times"]);
    }
}

#[test]
fn generated_flight_support_accepts_navigation_height_offset_with_physical_clearance() {
    let mut snapshot = scene(vec![surface("a", 0.), surface("b", 4.)], vec![]);
    for surface in snapshot["surfaces"].as_array_mut().unwrap() {
        for p in surface["vertices"].as_array_mut().unwrap() {
            p[1] = json!(0.1);
        }
    }
    snapshot["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":5.});
    snapshot["movement"]["runAirSpeed"] = json!(5.);
    let world = crate::world::World::new(json!({"kind":"surfaces","input":snapshot})).unwrap();
    assert!(
        world
            .flight([0., 0.01, 0.], [4., 0.01, 0.], crate::model::Mode::Jump)
            .unwrap()
            .is_some()
    );
    let query = json!({"starts":[start("a",0.,0.,"available")],"goal":[4.,0.,0.]});
    let result = solve_snapshot(
        &snapshot,
        &query,
        &json!({"maxCandidates":256,"maxLinks":4}),
    )
    .unwrap();
    complete(&result);
}

#[test]
fn ranked_discovery_reaches_late_multihop_landings_after_many_essential_distractors() {
    let far =
        json!({"id":"far","vertices":[[-100.,0.,-1.],[-20.,0.,-1.],[-20.,0.,1.],[-100.,0.,1.]]});
    let mut snapshot = scene(
        vec![surface("a", 0.), surface("b", 4.), surface("c", 8.), far],
        vec![],
    );
    snapshot["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":5.});
    snapshot["movement"]["runAirSpeed"] = json!(5.);
    snapshot["boosts"]=Value::Array((0..20).map(|i|json!({"id":format!("distractor/{i}"),"position":[-80.+i as f64*2.,0.,0.],"interaction":{"radius":0.1},"multiplier":2.,"duration":1.})).collect());
    let query = json!({"starts":[start("a",0.,0.,"available")],"goal":[8.,0.,0.]});
    let result = solve_snapshot(
        &snapshot,
        &query,
        &json!({"maxCandidates":2000,"maxLinks":6,"sampleSpacing":100.}),
    )
    .unwrap();
    complete(&result);
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .filter(|s| s["mode"] == "jump")
            .count()
            >= 2
    );
    assert!(result["diagnostics"]["candidateAttempts"].as_u64().unwrap() <= 2000);
}

#[test]
fn descending_targets_keep_early_slots_among_many_same_floor_components() {
    let mut snapshot = scene(vec![surface("base", 0.)], vec![]);
    snapshot["movement"]["model"]["maxHorizontalSpeed"] = json!(8.);
    snapshot["movement"]["model"]["maxJumpHeight"] = json!(1.);
    let world = crate::world::World::new(json!({"kind":"surfaces","input":snapshot})).unwrap();
    let mut graph = Graph {
        points: vec![],
        edges: vec![],
        generated: vec![],
        action_ids: Default::default(),
        anchors: Default::default(),
    };
    graph.node([0., 20., 0.]);
    for i in 0..24 {
        let angle = i as f64 * 0.2;
        graph.node([angle.cos(), 20., angle.sin()]);
    }
    let deep = graph.node([4., 0., 1.]);
    let components = (0..graph.points.len()).map(Some).collect::<Vec<_>>();
    let ranked = rank_action_targets(
        &graph,
        0,
        &world,
        1.,
        &components,
        &vec![true; graph.points.len()],
    )
    .unwrap();
    assert!(ranked.iter().position(|&id| id == deep).unwrap() < 3);
}

#[test]
fn upper_ledge_and_lateral_deep_landing_survive_horizontal_corridor_sampling() {
    let upper =
        json!({"id":"upper","vertices":[[-3.,20.,-3.],[3.,20.,-3.],[3.,20.,12.],[-3.,20.,12.]]});
    let lower = json!({"id":"lower","vertices":[[5.,0.,8.],[9.,0.,8.],[9.,0.,12.],[5.,0.,12.]]});
    let mut snapshot = scene(vec![upper, lower], vec![]);
    snapshot["movement"]["model"]["maxJumpHeight"] = json!(1.);
    snapshot["movement"]["model"]["maxHorizontalSpeed"] = json!(3.);
    snapshot["movement"]["runAirSpeed"] = json!(3.);
    let query = json!({"starts":[{"id":"start","position":[0.,20.,-2.],"state":"available","cost":0.}],"goal":[7.,0.,10.]});
    let result = solve_snapshot(
        &snapshot,
        &query,
        &json!({"maxCandidates":4000,"maxLinks":32,"sampleSpacing":1.}),
    )
    .unwrap();
    complete(&result);
    assert!(array(&result["route"]["segments"]).iter().any(|s| {
        let points = array(&s["points"]);
        (s["mode"] == "jump" || s["mode"] == "drop")
            && points.first().unwrap()[1].as_f64().unwrap()
                - points.last().unwrap()[1].as_f64().unwrap()
                > 19.
    }));
}

#[test]
fn continuous_landing_inside_large_lower_polygon_connects_to_grounded_goal() {
    // Every fixed lower-floor center/radial sample is underneath the upper
    // platform, while its perimeter is outside jump range. A safe landing lies
    // in the lower polygon's interior beyond the platform footprint.
    let upper =
        json!({"id":"upper","vertices":[[-3.,20.,-3.],[3.,20.,-3.],[3.,20.,3.],[-3.,20.,3.]]});
    let lower =
        json!({"id":"lower","vertices":[[-40.,0.,-40.],[40.,0.,-40.],[40.,0.,40.],[-40.,0.,40.]]});
    let mut snapshot = scene(vec![upper, lower], vec![]);
    snapshot["movement"]["model"]["maxJumpHeight"] = json!(1.);
    snapshot["movement"]["model"]["maxHorizontalSpeed"] = json!(4.);
    snapshot["movement"]["runAirSpeed"] = json!(4.);
    let query = json!({"starts":[{"id":"upper","position":[0.,20.,0.],"cost":0.,"state":"available"}],"goal":[30.,0.,30.]});
    let result = solve_snapshot(
        &snapshot,
        &query,
        &json!({"maxCandidates":4000,"maxLinks":16,"sampleSpacing":100.}),
    )
    .unwrap();
    complete(&result);
    let flight = array(&result["route"]["segments"])
        .iter()
        .find(|s| {
            let points = array(&s["points"]);
            s["mode"] == "jump"
                && points.first().unwrap()[1].as_f64().unwrap()
                    - points.last().unwrap()[1].as_f64().unwrap()
                    > 19.
        })
        .unwrap();
    let end = point(array(&flight["points"]).last().unwrap()).unwrap();
    assert!(end[0].abs() < 15. && end[2].abs() < 15. && end[1] < 0.02);
    assert!(end[0].abs() > 3. || end[2].abs() > 3.);
    assert!(flight["flight"].is_object());
    assert!(
        array(&result["route"]["segments"])
            .last()
            .is_some_and(|s| s["mode"] == "walk")
    );
}

fn carried_resource(energy: f64, sprinting: bool) -> Value {
    json!({"energy":energy,"minimum":energy,"dashCount":0,"delay":0.,
        "sprinting":sprinting,"hasActivated":sprinting,"velocity":2.,
        "previousDirection":null,"dashCooldown":0.,"dashRemaining":0.})
}
#[test]
fn arrival_resource_continuations_keep_gait_stamina_and_dash_clocks_separate() {
    let mut action = connection("sprint-rope", 0., 10., 0.25);
    action["requiredGait"] = json!("sprint");
    let mut snapshot = scene(vec![surface("a", 0.), surface("b", 10.)], vec![action]);
    snapshot["movement"]["locomotion"] = json!({"speed":2.,"sprintSpeed":4.,"sprintAcceleration":2.,
        "dash":{"speed":8.,"duration":0.3,"cooldown":2.,"cost":1.},
        "stamina":{"capacity":2.,"initial":2.,"activationCost":1.,"sprintDrain":1.,
            "recoveryRate":1.,"recoveryDelay":0.5,"reserve":0.}});
    let mut tired = start("tired", 0., 0., "available");
    tired["continuation"] = json!({"resource":carried_resource(0.,false)});
    let mut ready = start("ready", 0., 0.5, "available");
    let mut resource = carried_resource(1.5, true);
    resource["minimum"] = json!(0.5);
    resource["delay"] = json!(0.4);
    resource["dashCount"] = json!(3);
    resource["dashCooldown"] = json!(1.5);
    resource["dashRemaining"] = json!(0.2);
    ready["continuation"] = json!({"resource":resource});
    let query = json!({"starts":[tired,ready.clone()],"goal":[10.,0.,0.]});
    let result = solve_snapshot(&snapshot, &query, &json!({"maxCandidates":0})).unwrap();
    complete(&result);
    assert_eq!(result["route"]["start"], "ready");
    assert!((result["route"]["cost"].as_f64().unwrap() - 0.75).abs() < EPS);
    let output = &result["continuation"]["resource"];
    assert_eq!(output["energy"], 1.5);
    assert_eq!(output["minimum"], 0.5);
    assert_eq!(output["dashCount"], 3);
    assert_eq!(output["dashRemaining"], 0.);
    assert_eq!(output["dashCooldown"], 1.25);
    assert_eq!(output["delay"], 0.4);
    let stationary = solve_snapshot(
        &snapshot,
        &json!({"starts":[ready],"goal":[0.,0.,0.]}),
        &json!({"maxCandidates":0}),
    )
    .unwrap();
    complete(&stationary);
    assert_eq!(stationary["route"]["locomotion"]["minimum"], 0.5);
    assert_eq!(stationary["route"]["locomotion"]["dashes"], 3);
}
#[test]
fn carried_boost_enables_flight_without_trigger_in_sparse_world_and_cannot_restart() {
    let mut snapshot = scene(vec![surface("a", 0.), surface("b", 7.)], vec![]);
    snapshot["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,
        "maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":4.});
    snapshot["movement"]["runAirSpeed"] = json!(4.);
    let mut arrival = start("arrival", 0., 0., "available");
    arrival["continuation"] = json!({"resource":carried_resource(0.,false),"usedBoost":"earlier",
        "boost":{"id":"earlier","multiplier":2.,"duration":3.,"remaining":1.,
            "position":[-20.,0.01,0.],"interaction":{"radius":0.2}}});
    let query = json!({"starts":[arrival.clone()],"goal":[7.,0.,0.]});
    let policy = json!({"maxCandidates":1024,"maxLinks":2,"sampleSpacing":100.});
    let result = solve_snapshot(&snapshot, &query, &policy).unwrap();
    complete(&result);
    assert_eq!(result["continuation"]["usedBoost"], "earlier");
    assert!(
        result["continuation"]["boost"]["remaining"]
            .as_f64()
            .unwrap()
            < 1.
    );
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .any(|s| s["mode"] == "jump" && s["boost"]["id"] == "earlier")
    );
    snapshot["boosts"] = json!([{"id":"earlier","multiplier":2.,"duration":3.,
        "position":[0.,0.01,0.],"interaction":{"radius":0.2}}]);
    arrival["continuation"]
        .as_object_mut()
        .unwrap()
        .remove("boost");
    let expired = solve_snapshot(
        &snapshot,
        &json!({"starts":[arrival],"goal":[7.,0.,0.]}),
        &policy,
    )
    .unwrap();
    assert_ne!(
        expired["route"]["status"], "complete",
        "expired used trigger must not restart"
    );
}

#[test]
fn generated_catalog_train_freeze_reuses_flight_and_run_off_above_offset_navigation() {
    for run_off in [false, true] {
        let (surfaces, from, to) = if run_off {
            (
                vec![
                    json!({"id":"upper","vertices":[[-4.,2.,-2.],[0.,2.,-2.],[0.,2.,2.],[-4.,2.,2.]]}),
                    json!({"id":"lower","vertices":[[-4.,0.,-2.],[5.,0.,-2.],[5.,0.,2.],[-4.,0.,2.]]}),
                ],
                [-1., 2.01, 0.],
                [2., 0.01, 0.],
            )
        } else {
            (
                vec![surface("a", 0.), surface("b", 4.)],
                [0., 0.01, 0.],
                [4., 0.01, 0.],
            )
        };
        let mut raw = scene(surfaces, vec![]);
        // Change navigation only: raw collision stays on the physical floors.
        for face in raw["surfaces"].as_array_mut().unwrap() {
            for p in face["vertices"].as_array_mut().unwrap() {
                p[1] = json!(p[1].as_f64().unwrap() + if run_off { 0.08 } else { 0.2 });
            }
        }
        raw["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,
            "maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":5.});
        raw["movement"]["runAirSpeed"] = json!(5.);
        // Ordinary flight previously emitted radius as authored tolerance;
        // a valid radius greater than maxVertical made frozen reuse an error.
        if !run_off {
            raw["movement"]["profile"]["radius"] = json!(0.6);
        }
        let snapshot = json!({"kind":"surfaces","revision":"catalog-offset","coverage":"complete","input":raw});
        let world = crate::world::World::new(snapshot.clone()).unwrap();
        let connection = if run_off {
            world
                .run_off(
                    from,
                    to,
                    &world.movement.model,
                    &crate::world::FlightControl {
                        mode: crate::model::Mode::Drop,
                        ..Default::default()
                    },
                )
                .unwrap()
                .unwrap()
        } else {
            world
                .flight(from, to, crate::model::Mode::Jump)
                .unwrap()
                .unwrap()
        };
        let physical = serde_json::to_value(&connection).unwrap();
        let mut segment: Segment = serde_json::from_value(physical.clone()).unwrap();
        classify_flight(&mut segment, world.movement.run_air_speed);
        let mut graph = Graph {
            points: vec![],
            edges: vec![],
            generated: vec![],
            action_ids: Default::default(),
            anchors: Default::default(),
        };
        let source = graph.node(from);
        let authority = physical_authority(&world).unwrap();
        graph
            .generated(source, segment, false, None, &authority)
            .unwrap();
        let generated = graph.generated[0].clone();
        let query = json!({"starts":[{"id":"start","position":from,"cost":0.,"state":"available"}],"goal":to});
        let policy =
            json!({"maxCandidates":0,"catalogConnections":[generated],"physicalWork":{"step":1}});
        let mut engine = crate::engine::Engine::new(policy.clone(), snapshot.clone()).unwrap();
        engine.catalog("train").unwrap();
        let trained = engine.start(query.clone()).unwrap()["result"].clone();
        assert_eq!(trained["reason"], "catalog-trained");
        assert_ne!(trained["route"]["status"], "complete");
        let stats = engine.catalog("freeze").unwrap();
        assert_eq!(stats["actions"], 1);
        let frozen = engine.start(query.clone()).unwrap()["result"].clone();
        complete(&frozen);
        assert_eq!(engine.catalog("stats").unwrap()["actions"], 1);
        let learned = &trained["connections"][0];
        assert_eq!(learned["points"], physical["points"]);
        assert_eq!(learned["times"], physical["times"]);
        assert_eq!(learned["flight"], physical["flight"]);
        // Explicitly disable discovery while reusing the learned bank contents.
        let mut reuse = policy.clone();
        reuse["catalogConnections"] = trained["connections"].clone();
        let reused = solve(&world, &query, &reuse).unwrap();
        complete(&reused);
        assert_eq!(reused["diagnostics"]["candidateAttempts"], 0);
        assert_eq!(reused["route"]["cost"], frozen["route"]["cost"]);
        // Recomputing the content ID cannot authorize forged physical peak metadata.
        let mut false_peak = learned.clone();
        false_peak["peakHorizontalSpeed"] = json!(0.);
        false_peak["id"] = json!(generated_id(&false_peak, &authority).unwrap());
        false_peak["connection"] = false_peak["id"].clone();
        let false_segment: Segment = serde_json::from_value(false_peak.clone()).unwrap();
        assert!(!admit_generated(&world, &false_peak, &false_segment, &authority, &[]).unwrap());
        // A marker and a recomputed content ID cannot authorize a forged model.
        let mut forged = learned.clone();
        forged["flight"]["model"]["maxJumpHeight"] = json!(100.);
        let forged_id = generated_id(&forged, &authority).unwrap();
        forged["id"] = json!(forged_id);
        forged["connection"] = forged["id"].clone();
        reuse["catalogConnections"] = json!([forged]);
        assert_ne!(
            solve(&world, &query, &reuse).unwrap()["route"]["status"],
            "complete"
        );
        // World-authored actions retain their explicit tolerance even when a
        // caller copies a valid generated marker and physical witness onto them.
        let mut authored = learned.clone();
        authored["endpointTolerance"] = json!(0.02);
        let mut authored_input = snapshot.clone();
        authored_input["input"]["connections"] = json!([authored]);
        let authored_world = crate::world::World::new(authored_input).unwrap();
        assert_ne!(
            solve(&authored_world, &query, &json!({"maxCandidates":0})).unwrap()["route"]["status"],
            "complete"
        );
    }
}

#[test]
fn local_raw_crack_interfaces_enable_jump_inside_a_broad_imported_face() {
    let left =
        json!({"id":"raw-left","vertices":[[-4.,0.,-2.],[1.,0.,-2.],[1.,0.,2.],[-4.,0.,2.]]});
    let right =
        json!({"id":"raw-right","vertices":[[1.4,0.,-2.],[5.,0.,-2.],[5.,0.,2.],[1.4,0.,2.]]});
    let mut snapshot = scene(vec![left, right], vec![]);
    // The imported nav polygon covers the physical crack; its own perimeter,
    // center and radial samples provide no reachable landing across the gap.
    snapshot["surfaces"] =
        json!([{"id":"imported","vertices":[[-4.,0.1,-2.],[5.,0.1,-2.],[5.,0.1,2.],[-4.,0.1,2.]]}]);
    snapshot["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":0.3,
        "maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":2.});
    snapshot["movement"]["runAirSpeed"] = json!(2.);
    let physical = json!({"kind":"physical","input":{
        "ground":{"surfaces":snapshot["surfaces"],"options":snapshot["movement"]},
        "movement":snapshot["movement"],"collision":snapshot["collision"]}});
    let result = solve_snapshot(
        &physical,
        &json!({"starts":[start("start",-2.,0.,"available")],"goal":[3.,0.,0.]}),
        &json!({"maxCandidates":512,"maxLinks":8,"sampleSpacing":100.}),
    )
    .unwrap();
    complete(&result);
    assert!(result["diagnostics"]["repairRegions"].as_u64().unwrap() > 0);
    assert!(result["diagnostics"]["candidateAttempts"].as_u64().unwrap() <= 512);
    assert!(array(&result["route"]["segments"]).iter().any(|s| {
        let points = array(&s["points"]);
        s["mode"] == "jump"
            && points.first().unwrap()[0].as_f64().unwrap() < 1.
            && points.last().unwrap()[0].as_f64().unwrap() > 1.4
            && s["flight"].is_object()
    }));
}

#[test]
fn directed_nav_feedback_finds_raw_crack_when_straight_corridor_has_no_navigation() {
    let rect = |id: &str, x0: f64, x1: f64, z0: f64, z1: f64, y: f64| {
        json!({"id":id,
        "vertices":[[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]]})
    };
    let raw = scene(
        vec![
            rect("raw-left", -4., -0.8, -1., 1., 0.),
            rect("raw-right", -0.4, 0., -1., 1., 0.),
            rect("raw-turn", 0., 2., -1., 1., 0.),
            rect("raw-goal", 0., 2., 1., 6., 0.),
        ],
        vec![],
    );
    let movement = json!({"speed":2.,"maxVertical":0.5,"profile":{"radius":0.1,"height":1.8},
        "walls":[],"runAirSpeed":2.,"maxDrop":100.,"maxHorizontalDistance":100.,
        "model":{"gravity":10.,"fallingGravity":10.,"maxJumpHeight":0.3,
            "maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":2.}});
    // The directed nav route turns through two portals; its first leg crosses
    // a physical gap hidden inside the broad imported starting face.
    let snapshot = json!({"kind":"physical","input":{"ground":{"surfaces":[
        rect("a",-4.,0.,-1.,1.,0.1),rect("b",0.,2.,-1.,1.,0.1),
        rect("c",0.,2.,1.,6.,0.1)],"options":movement},
        "movement":movement,"collision":raw["collision"]}});
    let result = solve_snapshot(
        &snapshot,
        &json!({"starts":[start("start",-3.,0.,"available")],"goal":[1.,0.,5.]}),
        &json!({"maxCandidates":512,"maxLinks":8,"sampleSpacing":100.}),
    )
    .unwrap();
    complete(&result);
    let diagnostics = &result["diagnostics"];
    assert!(diagnostics["groundProbes"].as_u64().unwrap() <= 32);
    assert!(diagnostics["groundRouteExpanded"].as_u64().unwrap() <= 64);
    let feedback = &diagnostics["groundProbeFeedback"][0];
    assert_eq!(feedback["direct"]["kind"], "Navigation");
    assert_eq!(feedback["navigation"]["found"], true);
    assert!(
        array(&feedback["navigation"]["failures"])
            .iter()
            .any(|f| f["kind"] == "PhysicalSupport")
    );
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .any(|s| s["mode"] == "jump" && s["flight"].is_object())
    );
}

fn sparse_optional_fixture() -> Value {
    let raw = scene(vec![surface("inside", 0.)], vec![]);
    json!({"kind":"physical","coverage":{"bounds":{"min":[-3.,-3.],"max":[3.,3.]}},"input":{
        "ground":{"surfaces":[surface("inside",0.),surface("unrelated",5.)],"options":raw["movement"]},
        "movement":raw["movement"],"collision":raw["collision"]}})
}
#[test]
fn optional_uncovered_samples_do_not_abort_a_covered_route() {
    let snapshot = sparse_optional_fixture();
    let query = json!({"starts":[start("start",-0.5,0.,"available")],"goal":[0.5,0.,0.]});
    let plain = solve_snapshot(&snapshot, &query, &json!({"maxCandidates":0})).unwrap();
    let sampled = solve_snapshot(
        &snapshot,
        &query,
        &json!({"maxCandidates":32,"maxLinks":4,"sampleSpacing":100.}),
    )
    .unwrap();
    complete(&plain);
    complete(&sampled);
    assert_eq!(plain["route"]["cost"], sampled["route"]["cost"]);
    assert_eq!(sampled["diagnostics"]["truncated"], true);
    assert!(
        array(&sampled["route"]["points"])
            .iter()
            .all(|p| p[0].as_f64().unwrap().abs() < 1.)
    );
    // Query-anchor admission stays explicit; skipping optional witnesses must
    // not turn an unloaded arrival into a grounded source.
    let uncovered = solve_snapshot(
        &snapshot,
        &json!({"starts":[start("unloaded",5.,0.,"available")],"goal":[0.5,0.,0.]}),
        &json!({"maxCandidates":0}),
    )
    .unwrap();
    assert_eq!(uncovered["route"]["status"], "unmapped");
}
#[test]
fn optional_proofs_skip_coverage_but_propagate_real_control_and_geometry_errors() {
    let snapshot = sparse_optional_fixture();
    let world = crate::world::World::new(snapshot.clone()).unwrap();
    let mut model = world.movement.model.clone();
    model.max_jump_height = 1.;
    model.max_horizontal_speed = 10.;
    let mut truncated = false;
    let flight = world.flight_with_control(
        [-0.5, 0.01, 0.],
        [5., 0.01, 0.],
        &model,
        &crate::world::FlightControl::default(),
    );
    assert!(
        flight
            .as_ref()
            .is_err_and(|e| crate::world::is_coverage_error(e))
    );
    assert!(optional_proof(flight, &mut truncated).unwrap().is_none());
    assert!(truncated);
    truncated = false;
    let invalid = world.flight_with_control(
        [-0.5, 0.01, 0.],
        [0.5, 0.01, 0.],
        &model,
        &crate::world::FlightControl {
            horizontal_split: Some(2.),
            ..Default::default()
        },
    );
    let message = invalid.as_ref().unwrap_err().clone();
    assert_eq!(
        optional_proof(invalid, &mut truncated).unwrap_err(),
        message
    );
    assert!(!truncated);
    let mut malformed = snapshot;
    malformed["input"]["collision"]["indices"] = json!([0, 99, 1]);
    assert!(
        solve_snapshot(
            &malformed,
            &json!({"starts":[start("start",0.,0.,"available")],"goal":[0.5,0.,0.]}),
            &json!({"maxCandidates":32})
        )
        .is_err()
    );
}

#[test]
fn fast_run_off_requires_sprint_before_takeoff_but_slow_drop_does_not() {
    let rectangle = |id: &str, end: f64, y: f64| {
        json!({"id":id,
        "vertices":[[-4.,y,-2.],[end,y,-2.],[end,y,2.],[-4.,y,2.]]})
    };
    let mut raw = scene(
        vec![rectangle("lower", 5., 0.), rectangle("upper", 0., 2.)],
        vec![],
    );
    raw["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,
        "maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":6.,"airAcceleration":30.,"airDeceleration":30.});
    raw["movement"]["runAirSpeed"] = json!(2.);
    let world = crate::world::World::new(json!({"kind":"surfaces","input":raw})).unwrap();
    let opts = options(json!({"sprintThrough":["drop"]}));
    let initial = locomotion::initial(&opts);
    let connection = |x| {
        world
            .run_off(
                [-1., 2.01, 0.],
                [x, 0.01, 0.],
                &world.movement.model,
                &crate::world::FlightControl {
                    mode: crate::model::Mode::Drop,
                    ..Default::default()
                },
            )
            .unwrap()
            .expect("physically proved run-off")
    };
    let fast = connection(2.);
    let original = serde_json::to_value(&fast).unwrap();
    let mut segment: Segment = serde_json::from_value(original.clone()).unwrap();
    classify_flight(&mut segment, 2.);
    assert_eq!(segment.required_gait.as_deref(), Some("sprint"));
    assert!(
        locomotion::advance(&segment, &opts, initial, true, false).is_none(),
        "resource scheduling cannot acquire sprint in unsupported flight"
    );
    let mut approach = walk(-2., -1.);
    for foot in &mut approach.points {
        foot[1] = 2.01;
    }
    let (sprinting, approach_duration, approach_segments) =
        locomotion::advance(&approach, &opts, initial, true, false).unwrap();
    let (_, duration, scheduled) =
        locomotion::advance(&segment, &opts, sprinting, true, false).unwrap();
    assert_eq!(duration, *segment.times.last().unwrap());
    assert_eq!(
        serde_json::to_value(&scheduled[0]).unwrap()["flight"],
        original["flight"]
    );
    assert_eq!(scheduled[0].points, segment.points);
    assert_eq!(scheduled[0].times, segment.times);
    assert!(approach_duration > 0.);
    assert!(
        approach_segments
            .iter()
            .any(|s| s.gait.as_deref() == Some("sprint"))
    );
    // Both ordinary free-fall and controlled cubic run-off use World peaks.
    let controlled = world
        .run_off(
            [-1., 2.01, 0.],
            [2., 0.01, 0.],
            &world.movement.model,
            &crate::world::FlightControl {
                mode: crate::model::Mode::Drop,
                exit: Some([1., 0.]),
                speed_fraction: Some(0.5),
                terminal: Some("average".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
    let ordinary = world
        .flight([0.2, 2.01, 0.], [2., 0.01, 0.], crate::model::Mode::Drop)
        .unwrap()
        .unwrap();
    for physical in [controlled, ordinary] {
        let peak = physical.extra["peakHorizontalSpeed"].as_f64().unwrap();
        assert!(peak > 2. + 1e-6);
        let mut drop: Segment =
            serde_json::from_value(serde_json::to_value(physical).unwrap()).unwrap();
        classify_flight(&mut drop, 2.);
        assert_eq!(drop.required_gait.as_deref(), Some("sprint"));
        assert!(locomotion::advance(&drop, &opts, initial, true, false).is_none());
        drop.required_gait = None;
        classify_flight(&mut drop, peak - 0.5e-6);
        assert_eq!(
            drop.required_gait, None,
            "common replay tolerates 1e-6 speed excess"
        );
        classify_flight(&mut drop, peak - 2e-6);
        assert_eq!(drop.required_gait.as_deref(), Some("sprint"));
    }
    let mut slow: Segment =
        serde_json::from_value(serde_json::to_value(connection(0.4)).unwrap()).unwrap();
    classify_flight(&mut slow, 2.);
    assert_eq!(slow.required_gait, None);
    assert!(locomotion::advance(&slow, &opts, initial, false, false).is_some());
    // Fixed launches retain device authority even when character air speed is lower.
    let mut launch = segment;
    launch.mode = "launch".into();
    launch.required_gait = None;
    classify_flight(&mut launch, 2.);
    assert_eq!(launch.required_gait, None);
}

#[test]
fn feedback_and_flights_share_one_total_physical_attempt_budget() {
    let mut raw = scene(vec![surface("a", 0.), surface("b", 4.)], vec![]);
    raw["movement"]["model"] = json!({"gravity":10.,"fallingGravity":10.,"maxJumpHeight":1.,
        "maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":4.});
    raw["movement"]["runAirSpeed"] = json!(4.);
    let result = solve_snapshot(
        &raw,
        &json!({"starts":[start("a",0.,0.,"available")],"goal":[4.,0.,0.]}),
        &json!({"maxCandidates":16,"maxLinks":8,"sampleSpacing":100.}),
    )
    .unwrap();
    let d = &result["diagnostics"];
    let total = d["candidateAttempts"].as_u64().unwrap();
    let feedback = d["feedbackAttempts"].as_u64().unwrap();
    let flights = d["flightAttempts"].as_u64().unwrap();
    assert_eq!(total, feedback + flights);
    assert_eq!(feedback, d["groundProbes"].as_u64().unwrap());
    assert!(feedback > 0 && feedback <= 2);
    assert!(total <= 16);
    assert!(
        flights > 14,
        "unused feedback reserve returns to flight discovery: {d}"
    );

    let floor = scene(
        vec![json!({"id":"floor","vertices":[[-1.,0.,-2.],[21.,0.,-2.],
        [21.,0.,2.],[-1.,0.,2.]]})],
        vec![],
    );
    let waypoints = (1..=12)
        .map(|x| json!([x as f64, 0.01, 0.]))
        .collect::<Vec<_>>();
    let supported = solve_snapshot(
        &floor,
        &json!({"starts":[start("a",0.,0.,"available")],"goal":[14.,0.,0.],"waypoints":waypoints}),
        &json!({"maxCandidates":128,"maxLinks":8,"sampleSpacing":100.}),
    )
    .unwrap();
    complete(&supported);
    let d = &supported["diagnostics"];
    assert!(
        d["groundProbes"].as_u64().unwrap() > 8,
        "feedback can inspect a longer supported prefix"
    );
    assert!(d["groundProbes"].as_u64().unwrap() <= 16);
    assert!(d["candidateAttempts"].as_u64().unwrap() <= 128);
}

#[test]
fn pending_ground_proofs_finish_local_device_chain_before_far_unavailable_pairs() {
    let floor =
        json!({"id":"approach","vertices":[[-4.,0.,-3.],[4.,0.,-3.],[4.,0.,3.],[-4.,0.,3.]]});
    let mut entry = connection("entry", 0.5, 10., 0.01);
    entry["requiredGait"] = json!("sprint");
    let mut snapshot = scene(
        vec![
            floor,
            surface("middle", 10.),
            surface("goal", 20.),
            surface("dead-end", 50.),
            surface("far", 300.),
            surface("far-end", 400.),
        ],
        vec![
            entry,
            connection("finish", 10., 20., 0.01),
            connection("unreachable", 300., 400., 0.1),
        ],
    );
    let positions = snapshot["collision"]["positions"].as_array_mut().unwrap();
    let base = positions.len() / 3;
    positions.extend(
        [0., 0., -1., 0., 4., -1., 0., 4., 1., 0., 0., 1.]
            .into_iter()
            .map(|x| json!(x)),
    );
    snapshot["collision"]["indices"]
        .as_array_mut()
        .unwrap()
        .extend(
            [base, base + 1, base + 2, base, base + 2, base + 3]
                .into_iter()
                .map(|x| json!(x)),
        );
    snapshot["movement"]["locomotion"] = json!({"speed":2.,"sprintSpeed":5.,"sprintAcceleration":10.,
        "stamina":{"capacity":10.,"initial":10.,"activationCost":1.,"sprintDrain":2.,
            "recoveryRate":1.,"recoveryDelay":1.,"reserve":1.}});
    let mut tired = start("tired", -0.5, 0., "available");
    tired["continuation"] = json!({"resource":carried_resource(1.,false)});
    let mut ready = start("ready", -0.5, 0.1, "available");
    let mut carried = carried_resource(8., true);
    carried["velocity"] = json!(5.);
    ready["continuation"] = json!({"resource":carried});
    let query = json!({"starts":[tired,ready],"goal":[20.,0.,0.]});
    geometry::PATH_PROOFS.with(|proofs| proofs.borrow_mut().clear());
    let result = solve_snapshot(&snapshot, &query, &json!({"maxCandidates":0})).unwrap();
    complete(&result);
    assert_eq!(result["route"]["start"], "ready");
    let phases = array(&result["diagnostics"]["walkingPhases"]);
    assert_eq!(phases.len(), 2);
    assert_eq!(phases[1]["kind"], "detours");
    assert_eq!(phases[1]["groundJobs"]["proved"], 1);
    assert!(phases[1]["groundJobs"]["pending"].as_u64().unwrap() > 0);
    geometry::PATH_PROOFS.with(|proofs| {
        let proofs = proofs.borrow();
        assert_eq!(
            proofs.len(),
            1,
            "local proof must advance the queue before far unavailable targets: {proofs:?}"
        );
        assert!((proofs[0].0[0] + 0.5).abs() < 1e-6 && (proofs[0].1[0] - 0.5).abs() < 1e-6);
    });
    // Replaying the selected whole-route decisions must retain the carried
    // arrival's exact stamina/gait clocks across the deferred geometry edge.
    let opts = options(json!({}));
    let mut state =
        locomotion::read_state(&query["starts"][1]["continuation"]["resource"], &opts).unwrap();
    let mut duration = 0.;
    for block in array(&result["route"]["schedule"]) {
        for raw in array(&block["segments"]) {
            let segment: Segment = serde_json::from_value(raw.clone()).unwrap();
            let (next, time, _) = locomotion::advance(
                &segment,
                &opts,
                state,
                block["allowSprint"].as_bool().unwrap(),
                block["allowDash"].as_bool().unwrap(),
            )
            .unwrap();
            state = next;
            duration += time;
        }
    }
    assert_eq!(
        serde_json::to_value(state).unwrap(),
        result["continuation"]["resource"]
    );
    assert!((duration + 0.1 - result["route"]["cost"].as_f64().unwrap()).abs() < 1e-9);
    for authored in array(&snapshot["connections"]).iter().take(2) {
        let selected = array(&result["route"]["segments"])
            .iter()
            .find(|s| s["connection"] == authored["id"])
            .unwrap();
        assert_eq!(selected["points"], authored["points"]);
        assert_eq!(selected["times"], authored["times"]);
    }
    // A short proof may reveal only a dead end. Keep the farther selected
    // endpoint queued because its device is necessary for goal connectivity.
    let mut farther = snapshot.clone();
    farther["connections"][0]["points"][0][0] = json!(3.);
    farther["connections"]
        .as_array_mut()
        .unwrap()
        .push(connection("near-dead-end", 0.5, 50., 0.01));
    geometry::PATH_PROOFS.with(|proofs| proofs.borrow_mut().clear());
    let result = solve_snapshot(&farther, &query, &json!({"maxCandidates":0})).unwrap();
    complete(&result);
    assert!(
        array(&result["route"]["segments"])
            .iter()
            .any(|s| s["connection"] == "entry" && s["points"][0][0] == 3.)
    );
    geometry::PATH_PROOFS.with(|proofs| {
        let proofs = proofs.borrow();
        assert!(
            (proofs[0].1[0] - 0.5).abs() < 1e-6,
            "near proof is ranked first"
        );
        assert!(
            proofs.iter().any(|(_, to)| (to[0] - 3.).abs() < 1e-6),
            "the farther necessary target must not be pruned"
        );
        assert!(
            proofs
                .iter()
                .all(|(from, to)| from[0] < 300. && to[0] < 300.)
        );
    });
}

#[test]
fn generated_interior_landing_becomes_a_source_for_the_next_flight() {
    let rectangle = |id: &str, x0: f64, x1: f64, y: f64, z: f64| {
        json!({"id":id,
        "vertices":[[x0,y,-z],[x1,y,-z],[x1,y,z],[x0,y,z]]})
    };
    // Fixed center/perimeter proposals on the broad middle polygon are outside
    // reach. Its reachable interior is a landing, then a launch site across its
    // far edge to the separate grounded goal. Walking cannot cross the gap.
    let mut snapshot = scene(
        vec![
            rectangle("upper", -3., 3., 20., 3.),
            rectangle("middle", -40., 12., 8., 40.),
            rectangle("goal", 15., 17., 0., 1.),
        ],
        vec![],
    );
    snapshot["movement"]["model"]["maxJumpHeight"] = json!(1.);
    snapshot["movement"]["model"]["maxHorizontalSpeed"] = json!(5.);
    snapshot["movement"]["runAirSpeed"] = json!(5.);
    let query = json!({"starts":[{"id":"upper","position":[0.,20.,0.],"cost":0.,"state":"available"}],
        "goal":[16.,0.,0.]});
    let result = solve_snapshot(
        &snapshot,
        &query,
        &json!({"maxCandidates":4000,"maxLinks":1,"sampleSpacing":100.}),
    )
    .unwrap();
    complete(&result);
    let flights = array(&result["route"]["segments"])
        .iter()
        .filter(|s| s["mode"] == "jump" || s["mode"] == "drop")
        .collect::<Vec<_>>();
    assert!(flights.len() >= 2);
    let landing = point(array(&flights[0]["points"]).last().unwrap()).unwrap();
    assert!(
        landing[0] > 3.
            && landing[0] < 12.
            && (landing[1] - 8.01).abs() < 1e-5
            && landing[2].abs() < 40.
    );
    assert_eq!(flights[1]["points"][0], json!(landing));
    assert!(flights.iter().all(|s| s["flight"].is_object()));
    assert!(result["diagnostics"]["candidateAttempts"].as_u64().unwrap() <= 4000);
    let work = &result["diagnostics"]["discovery"];
    let original = work["originalSources"].as_u64().unwrap();
    assert!(work["processedSources"].as_u64().unwrap() > original);
    assert!(work["interiorLandings"].as_u64().unwrap() > 0);
    assert!(work["interiorLandings"].as_u64().unwrap() <= original);
    assert!(work["queuedSources"].as_u64().unwrap() <= original * 2);
}
