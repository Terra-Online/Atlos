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
    let body = vec![
        [-0.5, 0., -0.5],
        [0.5, 0., -0.5],
        [0.5, 0., 0.5],
        [-0.5, 0., 0.5],
        [-0.5, 0.4, -0.5],
        [0.5, 0.4, -0.5],
        [0.5, 0.4, 0.5],
        [-0.5, 0.4, 0.5],
    ];
    world["devices"] = json!({"followingSupports":[{"id":"box","spawn":[0.,0.,0.],"bodies":[body],"geometryKind":"convex","maxDistance":4.5,"initialState":0.,"assumption":"movable"}]});
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
        4,
        &mut truncated,
    );
    let mut less = base.clone();
    less.state.energy -= 1.;
    insert(less, &mut arena, &mut rows, &mut heap, 4, &mut truncated);
    let mut delayed = base.clone();
    delayed.state.delay = 1.;
    insert(delayed, &mut arena, &mut rows, &mut heap, 4, &mut truncated);
    assert_eq!(rows[0].len(), 3);
    let mut unique = base.clone();
    unique.state.delay = 2.;
    insert(unique, &mut arena, &mut rows, &mut heap, 4, &mut truncated);
    assert_eq!(arena.len(), 4);
    for i in 1..100 {
        let mut worse = base.clone();
        worse.cost += i as f64;
        worse.state.energy = 0.;
        worse.state.delay = i as f64 + 2.;
        insert(worse, &mut arena, &mut rows, &mut heap, 4, &mut truncated);
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
            &json!({"physicalWork":{"step":stage},"maxLinks":1,"maxCandidates":64}),
        )
        .unwrap();
        complete(&result);
        assert!(result["route"]["length"].as_f64().unwrap() > 4.);
        assert!(
            array(&result["route"]["points"])
                .iter()
                .any(|p| p[2].as_f64().unwrap().abs() > 1.)
        );
    }
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
