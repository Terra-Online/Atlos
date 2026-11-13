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
    json!({"sampleSpacing":100.,"maxCandidates":64,"maxAttempts":2000})
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
    let p = json!({"sampleSpacing":0.5,"maxCandidates":20,"maxAttempts":4000,"maxShortcutCandidates":16});
    let result = solve_snapshot(&world, &q, &p).unwrap();
    complete(&result);
    assert_eq!(result["route"]["placements"][0]["device"], "box");
}
