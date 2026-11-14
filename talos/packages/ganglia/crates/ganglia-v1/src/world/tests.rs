use super::*;
use serde_json::json;
fn floor(x0: f64, x1: f64, z0: f64, z1: f64, y: f64) -> CollisionGeometry {
    CollisionGeometry {
        positions: vec![x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0],
        indices: vec![0, 1, 2, 0, 2, 3],
    }
}
fn merge(a: &mut CollisionGeometry, b: CollisionGeometry) {
    let base = a.positions.len() / 3;
    a.positions.extend(b.positions);
    a.indices.extend(b.indices.into_iter().map(|i| i + base));
}
fn snapshot(c: CollisionGeometry) -> Value {
    json!({"kind":"physical","sourceRevision":"test-facts-1","input":{"ground":{"surfaces":[],"options":{"speed":4.,"maxVertical":0.5,"profile":{"radius":0.2,"height":1.8},"walls":[]}},"collision":c,"movement":{"model":{"gravity":10.,"fallingGravity":20.,"maxJumpHeight":2.,"maxFallingSpeed":12.,"apexTime":0.1,"maxHorizontalSpeed":6.,"airAcceleration":30.,"airDeceleration":30.},"maxSlope":45.,"runAirSpeed":6.,"stepUp":0.3,"stepDown":0.3},"locomotion":{"speed":4.,"sprintSpeed":6.,"sprintAcceleration":10.},"devices":null}})
}
#[test]
fn raw_ground_projection_and_cross_triangle_walk() {
    let value = snapshot(floor(-10., 10., -10., 10., 0.));
    let w = World::new(value.clone()).unwrap();
    assert_eq!(w.snapshot(), &value);
    assert_eq!(w.surfaces.len(), 2);
    assert!(!w.portals.is_empty());
    let p = w.project([0., 0.1, 0.], None).unwrap();
    assert_eq!(p[0].position, [0., 0., 0.]);
    let path = w.ground_path([-4., 0., 0.], [4., 0., 0.]).unwrap().unwrap();
    assert!((path.length - 8.).abs() < 1e-8);
    assert!(path.points.iter().all(|p| (p[1] - 0.01).abs() < 1e-9));
    assert!((path.cost - 2.).abs() < 1e-8);
    let refined = w
        .refine(Bounds {
            min: [-2., -2.],
            max: [2., 2.],
        })
        .unwrap();
    assert_ne!(refined.revision, w.revision);
    assert!(refined.project([3., 0., 0.], None).unwrap().is_empty());
}
#[test]
fn sweep_hits_thin_wall_between_clear_endpoints() {
    let mut c = floor(-10., 10., -10., 10., 0.);
    merge(
        &mut c,
        CollisionGeometry {
            positions: vec![0., 0., -1., 0., 4., -1., 0., 4., 1., 0., 0., 1.],
            indices: vec![0, 1, 2, 0, 2, 3],
        },
    );
    let w = World::new(snapshot(c)).unwrap();
    assert!(w.clear([-2., 0.01, 0.], [-2., 0.01, 0.], 0.).unwrap());
    assert!(w.clear([2., 0.01, 0.], [2., 0.01, 0.], 0.).unwrap());
    assert!(!w.clear([-2., 0.01, 0.], [2., 0.01, 0.], 0.).unwrap());
    let detour = w.ground_path([-2., 0., 0.], [2., 0., 0.]).unwrap().unwrap();
    assert!(detour.length > 4.);
    assert!(
        detour
            .points
            .windows(2)
            .all(|p| w.clear(p[0], p[1], 0.).unwrap())
    );
}

#[test]
fn masked_and_directed_portals_constrain_ground_traces() {
    let mut value = snapshot(floor(-3., 3., -2., 2., 0.));
    value["input"]["ground"]["surfaces"] = json!([
        {"id":"left","vertices":[[-3.,0.,-2.],[0.,0.,-2.],[0.,0.,2.],[-3.,0.,2.]],"portals":[]},
        {"id":"right","vertices":[[0.,0.,-2.],[3.,0.,-2.],[3.,0.,2.],[0.,0.,2.]],"portals":[]}
    ]);
    let blocked = World::new(value.clone()).unwrap();
    assert!(
        blocked
            .ground_path([-1., 0., 0.], [1., 0., 0.])
            .unwrap()
            .is_none()
    );
    value["input"]["ground"]["options"]["portals"] = json!([{
        "from":"left","to":"right","points":[[0.,0.,0.],[0.,0.,0.]],
        "entry":[[0.,0.,-1.],[0.,0.,1.]],"exit":[[0.,0.,-1.],[0.,0.,1.]]
    }]);
    let directed = World::new(value).unwrap();
    assert!(
        directed
            .ground_path([-1., 0., 0.], [1., 0., 0.])
            .unwrap()
            .is_some()
    );
    assert!(
        directed
            .ground_path([1., 0., 0.], [-1., 0., 0.])
            .unwrap()
            .is_none()
    );
}

#[test]
fn split_portals_join_over_the_shared_interval() {
    let mut value = snapshot(floor(-3., 3., -2., 2., 0.));
    value["input"]["ground"]["surfaces"] = json!([
        {"id":"left","vertices":[[-3.,0.,-2.],[0.,0.,-2.],[0.,0.,2.],[-3.,0.,2.]]},
        {"id":"right-low","vertices":[[0.,0.,-2.],[3.,0.,-2.],[3.,0.,0.],[0.,0.,0.]]},
        {"id":"right-high","vertices":[[0.,0.,0.],[3.,0.,0.],[3.,0.,2.],[0.,0.,2.]]}
    ]);
    let world = World::new(value).unwrap();
    assert!(
        world
            .ground_path([-1., 0., -1.], [1., 0., -1.])
            .unwrap()
            .is_some()
    );
    assert!(
        world
            .ground_path([-1., 0., 1.], [1., 0., 1.])
            .unwrap()
            .is_some()
    );
}

#[test]
fn interaction_sphere_only_clips_height_when_requested() {
    let world = World::new(snapshot(floor(-3., 3., -3., 3., 0.))).unwrap();
    let mut interaction = Interaction {
        radius: 3.,
        ..Interaction::default()
    };
    assert!(
        !world
            .project([0., 2., 0.], Some(&interaction))
            .unwrap()
            .is_empty()
    );
    interaction.max_vertical = Some(0.5);
    assert!(
        world
            .project([0., 2., 0.], Some(&interaction))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn airborne_collection_stops_before_later_collision() {
    let mut geometry = floor(-4., 4., -3., 3., 0.);
    merge(
        &mut geometry,
        CollisionGeometry {
            positions: vec![0., 0., -3., 0., 4., -3., 0., 4., 3., 0., 0., 3.],
            indices: vec![0, 1, 2, 0, 2, 3],
        },
    );
    let world = World::new(snapshot(geometry)).unwrap();
    let start = [-2., 0.01, 0.];
    let target = [0., 1.9, 0.];
    let control = FlightControl::default();
    assert!(
        world
            .flight_with_control(start, target, &world.movement.model, &control)
            .unwrap()
            .is_none()
    );
    let goal = Interaction {
        airborne: true,
        radius: 0.5,
        ..Default::default()
    };
    let prefix = world
        .flight_to_goal(
            start,
            target,
            &world.movement.model,
            &control,
            target,
            &goal,
        )
        .unwrap()
        .unwrap();
    assert_eq!(prefix.terminal, Some(true));
    assert!(prefix.points.last().unwrap()[0] < -world.movement.profile.radius);
    assert!(
        prefix
            .points
            .windows(2)
            .all(|p| world.clear(p[0], p[1], 0.).unwrap())
    );
    assert_eq!(prefix.extra["flight"]["end"], json!(target));
}
#[test]
fn tiny_support_crack_is_not_walkable() {
    let mut c = floor(-3., 0., -2., 2., 0.);
    merge(&mut c, floor(0.001, 3., -2., 2., 0.));
    let w = World::new(snapshot(c)).unwrap();
    assert!(
        w.ground_path([-2., 0., 0.], [2., 0., 0.])
            .unwrap()
            .is_none()
    );
}
#[test]
fn flight_vertical_phases_witness_and_ceiling() {
    let w = World::new(snapshot(floor(-10., 10., -10., 10., 0.))).unwrap();
    let a = [-2., 0.01, 0.];
    let b = [2., 0.01, 0.];
    let c = w.flight(a, b, Mode::Jump).unwrap().unwrap();
    let expected = (40_f64).sqrt() / 10. + 0.1 + (4_f64 / 20.).sqrt();
    assert!((c.duration() - expected).abs() < 1e-10);
    assert_eq!(c.points.first(), Some(&a));
    assert_eq!(c.points.last(), Some(&b));
    assert_eq!(c.extra["flight"]["kind"], "flight");
    assert_eq!(c.extra["flight"]["start"], json!(a));
    assert!(
        !c.extra["flight"]["model"]
            .as_object()
            .unwrap()
            .contains_key("startHorizontalSpeed")
    );
    assert!(w.flight(a, [2., 3., 0.], Mode::Jump).unwrap().is_none());
    let mut geometry = floor(-10., 10., -10., 10., 0.);
    merge(&mut geometry, floor(-10., 10., -10., 10., 3.));
    let ceiling = World::new(snapshot(geometry)).unwrap();
    assert!(ceiling.flight(a, b, Mode::Jump).unwrap().is_none());
}
#[test]
fn air_waypoint_and_terminal_fall() {
    let w = World::new(snapshot(floor(-20., 20., -20., 20., -10.))).unwrap();
    let control = FlightControl {
        horizontal_waypoint: Some([0., 1.]),
        ..Default::default()
    };
    let arc = w
        .flight_with_control([-1., 0.01, 0.], [1., 0.01, 0.], &w.movement.model, &control)
        .unwrap()
        .unwrap();
    assert!(arc.points.iter().any(|p| p[2] > 0.99));
    let expected = 12. / 20. + (10. - 144. / 40.) / 12.;
    assert!((w.flight_duration(0., -10., Mode::Drop).unwrap().unwrap() - expected).abs() < 1e-10);
}
#[test]
fn coverage_guard_and_wall_shapes() {
    let mut v = snapshot(floor(-10., 10., -10., 10., 0.));
    v["input"]["collisionOptions"] = json!({"bounds":{"min":[-3.,-3.],"max":[3.,3.]}});
    v["input"]["roundedWalls"] = json!([{"min":[-1.,0.,-1.],"max":[1.,2.,1.],"state":"active","sphere":{"center":[0.,1.,0.],"radius":0.4}}]);
    let w = World::new(v).unwrap();
    assert!(w.clear([2.9, 0.01, 0.], [2.9, 0.01, 0.], 0.).is_err());
    assert!(w.wall_blocked([-2., 0., 0.], [2., 0., 0.], 0.));
    assert!(!w.wall_blocked([-2., 5., 0.], [2., 5., 0.], 0.));
}
#[test]
fn boost_and_fixed_launch_actions_preserve_models() {
    let mut v = snapshot(floor(-10., 10., -10., 10., 0.));
    v["input"]["devices"] = json!({"devices":[{"id":"boost","kind":"accelerate","position":[0.,0.,0.],"goal":{"position":[0.,0.,0.],"interaction":{"radius":1.}},"duration":3.,"boostMultiplier":2.},{"id":"pad","kind":"launch","position":[-2.,0.,0.],"goal":{"position":[-2.,0.,0.],"interaction":{"radius":1.}},"seeds":[[-2.,0.,0.]],"fixedLaunch":true,"unitScale":true,"aim":[3.,0.,0.],"height":2.,"aimClearance":0.1}],"ropes":[]});
    let w = World::new(v).unwrap();
    assert_eq!(w.boosts.len(), 1);
    assert_eq!(w.boosts[0].effect.duration, 3.);
    let pad = w
        .known_actions()
        .iter()
        .find(|c| c.id == "launch/pad")
        .unwrap();
    assert_eq!(pad.mode, Mode::Launch);
    assert_eq!(pad.extra["flight"]["control"]["mode"], "jump");
    let model = pad.extra["flight"]["model"].as_object().unwrap();
    assert!(!model.contains_key("airAcceleration"));
    assert!(!model.contains_key("airDeceleration"));
    assert!(!model.contains_key("startHorizontalSpeed"));
    validate_connection(pad).unwrap();
}
#[test]
fn moving_support_is_overlay_and_has_timed_rides() {
    let mut v = snapshot(floor(-10., 10., -10., 10., 0.));
    v["input"]["devices"] = json!({"devices":[],"ropes":[],"movingSupports":[{"id":"lift","family":"platform","assumption":"phase-free-swept-support","surfaces":[{"id":"roof","vertices":[[-1.,2.,-1.],[-1.,2.,1.],[4.,2.,1.],[4.,2.,-1.]]}],"surfacePoses":[[{"fromPose":0,"toPose":1,"body":0}]],"transfers":[{"from":[0.,2.,0.],"to":[3.,2.,0.],"speed":1.5,"fromPose":0,"toPose":1,"body":0}]}]});
    let w = World::new(v).unwrap();
    assert!(
        (w.ground_at([1., 2.1, 0.], 0.5, 0.5, 0.2)
            .unwrap()
            .unwrap()
            .position[1]
            - 2.)
            .abs()
            < 1e-8
    );
    let c = w
        .connections
        .iter()
        .find(|c| c.id == "moving-ride/lift/0")
        .unwrap();
    assert_eq!(c.traversal.as_deref(), Some("moving-support"));
    assert!((c.duration() - 2.).abs() < 1e-8);
    assert_eq!(
        w.devices.moving_supports[0].extra["surfacePoses"][0][0]["toPose"],
        1
    );
}
#[test]
fn wire_result_retains_schedule_and_flight_metadata() {
    let value = json!({"route":{"status":"complete","start":"s","cost":1.,"arrivalCost":0.,"length":1.,"points":[[0.,0.,0.],[1.,0.,0.]],"segments":[{"mode":"jump","points":[[0.,0.,0.],[1.,0.,0.]],"times":[0.,1.],"flight":{"kind":"flight","custom":"kept"}}],"schedule":[{"segments":[0],"allowSprint":true,"allowDash":false}]},"connections":[],"diagnostics":{"truncated":false},"placements":[{"device":"box","position":[0.,0.,0.]}]});
    let result: RouteResult = serde_json::from_value(value.clone()).unwrap();
    let round = serde_json::to_value(result).unwrap();
    assert_eq!(round["route"]["schedule"], value["route"]["schedule"]);
    assert_eq!(
        round["route"]["segments"][0]["flight"],
        value["route"]["segments"][0]["flight"]
    );
    assert_eq!(round["placements"], value["placements"]);
}

#[test]
fn rope_action_has_authored_overhead_and_clear_exit() {
    let mut geometry = floor(-6., 6., -3., 3., 0.);
    merge(&mut geometry, floor(1., 5., -2., 2., 3.));
    let mut v = snapshot(geometry);
    let device = |id: &str, position: Vec3| json!({"id":id,"kind":"rope","position":position,"goal":{"position":position,"interaction":{"radius":0.5}},"seeds":[position],"unitScale":true,"resolved":true,"speed":2.,"overhead":0.5});
    v["input"]["devices"] = json!({"devices":[device("bottom",[-2.,0.,0.]),device("top",[2.,3.,0.])],"ropes":[{"bottom":"bottom","top":"top"}]});
    let w = World::new(v).unwrap();
    let c = w
        .known_actions()
        .iter()
        .find(|c| c.id == "rope/bottom/top")
        .unwrap();
    assert_eq!(c.times[1], 0.5);
    assert_eq!(c.points.len(), 5);
    validate_connection(c).unwrap();
    assert!(
        c.points
            .windows(2)
            .all(|p| w.clear(p[0], p[1], 0.).unwrap())
    );
}
#[test]
fn following_placement_checks_full_footprint_range_and_body_collision() {
    let mut v = snapshot(floor(-6., 6., -6., 6., 0.));
    let body: Vec<Vec3> = (0..8)
        .map(|bits| {
            [
                if bits & 1 == 0 { -0.5 } else { 0.5 },
                if bits & 2 == 0 { 0. } else { 1. },
                if bits & 4 == 0 { -0.5 } else { 0.5 },
            ]
        })
        .collect();
    v["input"]["devices"] = json!({"devices":[],"ropes":[],"followingSupports":[{"id":"box","spawn":[0.,0.,0.],"bodies":[body],"geometryKind":"box","maxDistance":2.,"initialState":0,"assumption":"placement-within-activity-range"}]});
    let w = World::new(v).unwrap();
    assert!(w.place_following("box", [0., 3., 0.]).unwrap().is_none());
    let placed = w.place_following("box", [1., 0., 0.]).unwrap().unwrap();
    assert!(!placed.clear([-1., 0.01, 0.], [3., 0.01, 0.], 0.).unwrap());
    let h = placed
        .ground_at([1., 1.1, 0.], 0.5, 0.5, 0.2)
        .unwrap()
        .unwrap();
    assert!((h.position[1] - 1.).abs() < 1e-8);
    assert!(!w.clear([-1., 0.01, 0.], [3., 0.01, 0.], 0.).unwrap());
    assert!(!w.clear([0., 0.01, 0.], [0., 0.01, 0.], 0.).unwrap());
    assert!(placed.clear([0., 0.01, 0.], [0., 0.01, 0.], 0.).unwrap());
    let mut cracked = snapshot({
        let mut c = floor(-6., 0.99, -6., 6., 0.);
        merge(&mut c, floor(1.01, 6., -6., 6., 0.));
        c
    });
    cracked["input"]["devices"] = w.snapshot()["input"]["devices"].clone();
    assert!(
        World::new(cracked)
            .unwrap()
            .place_following("box", [1., 0., 0.])
            .unwrap()
            .is_none()
    );
}
#[test]
fn unloaded_tile_is_not_empty_space() {
    let mut v = snapshot(floor(-4., 4., -4., 4., 0.));
    v["coverage"] = json!({"bounds":{"min":[-4.,-4.],"max":[4.,4.]},"tileSpan":1.,"tiles":[{"x":-2,"z":0},{"x":-1,"z":0},{"x":1,"z":0},{"x":2,"z":0}]});
    let w = World::new(v).unwrap();
    assert!(w.clear([-1.5, 0.01, 0.5], [-1.5, 0.01, 0.5], 0.).unwrap());
    assert!(w.clear([-1.5, 0.01, 0.5], [1.5, 0.01, 0.5], 0.).is_err());
}
#[test]
fn supported_run_off_has_prefix_and_replay_witness() {
    let mut c = floor(-4., 5., -2., 2., 0.);
    merge(&mut c, floor(-4., 0., -2., 2., 2.));
    let w = World::new(snapshot(c)).unwrap();
    let control = FlightControl {
        mode: Mode::Drop,
        ..Default::default()
    };
    let c = w
        .run_off([-1., 2.01, 0.], [2., 0.01, 0.], &w.movement.model, &control)
        .unwrap()
        .unwrap();
    assert_eq!(c.extra["flight"]["kind"], "run-off");
    assert!(c.points.iter().any(|p| p[0] > -0.1 && p[1] > 1.9));
    assert_eq!(c.points.last(), Some(&[2., 0.01, 0.]));
    validate_connection(&c).unwrap();
}

#[test]
fn refine_preserves_unmasked_authored_directed_portals() {
    let mut collision = floor(-3., 0., -2., 2., 0.);
    merge(&mut collision, floor(0., 3., -2., 2., 0.005));
    let mut v = snapshot(collision);
    v["input"]["ground"]["surfaces"] = json!([
 {"id":"left","vertices":[[-3.,0.,-2.],[0.,0.,-2.],[0.,0.,2.],[-3.,0.,2.]]},
 {"id":"right","vertices":[[0.,0.005,-2.],[3.,0.005,-2.],[3.,0.005,2.],[0.,0.005,2.]]}]);
    v["input"]["ground"]["options"]["portals"] = json!([{"from":"left","to":"right","points":[[0.,0.,0.],[0.,0.005,0.]],"entry":[[0.,0.,-1.],[0.,0.,1.]],"exit":[[0.,0.005,-1.],[0.,0.005,1.]]}]);
    let w = World::new(v).unwrap();
    let forward = w.ground_path([-1., 0., 0.], [1., 0.005, 0.]).unwrap();
    assert!(forward.is_some(), "authored forward passage must be usable");
    assert!(
        w.ground_path([1., 0.005, 0.], [-1., 0., 0.])
            .unwrap()
            .is_none()
    );
    let refined = w
        .refine(Bounds {
            min: [-2., -1.5],
            max: [2., 1.5],
        })
        .unwrap();
    assert!(
        refined
            .ground_path([-1., 0., 0.], [1., 0.005, 0.])
            .unwrap()
            .is_some()
    );
    assert!(
        refined
            .ground_path([1., 0.005, 0.], [-1., 0., 0.])
            .unwrap()
            .is_none(),
        "refinement must not authorize a reverse seam"
    );
}

#[test]
fn ground_paths_preserve_valid_authored_feet() {
    let mut value = snapshot(floor(-3., 3., -2., 2., -0.005));
    value["input"]["ground"]["surfaces"] = json!([
        {"id":"navigation","vertices":[[-3.,0.,-2.],[-3.,0.,2.],[3.,0.,2.],[3.,0.,-2.]]}
    ]);
    let world = World::new(value).unwrap();
    let from = [-1., 0., 0.];
    let to = [1., 0.005, 0.];
    assert_eq!(world.standing_foot(from).unwrap(), Some(from));
    assert_eq!(world.standing_foot(to).unwrap(), Some(to));
    let path = world.ground_path(from, to).unwrap().unwrap();
    assert_eq!(path.points.first(), Some(&from));
    assert_eq!(path.points.last(), Some(&to));
    assert!(
        path.points
            .windows(2)
            .all(|p| world.clear(p[0], p[1], 0.).unwrap())
    );
    let blocked = World::new(snapshot(floor(-3., 3., -2., 2., 0.))).unwrap();
    assert_ne!(blocked.standing_foot(from).unwrap(), Some(from));
}

#[test]
fn surface_input_support_does_not_require_collision_triangles() {
    let surface =
        json!({"id":"navigation","vertices":[[-3.,0.,-2.],[-3.,0.,2.],[3.,0.,2.],[3.,0.,-2.]]});
    let physical = snapshot(CollisionGeometry::default());
    let mut input = physical["input"]["ground"]["options"].clone();
    input["surfaces"] = json!([surface.clone()]);
    input["collision"] = json!({"positions":[],"indices":[]});
    input["walls"] = json!([]);
    input["movement"] = physical["input"]["movement"].clone();
    input["movement"]["speed"] = json!(4.);
    input["movement"]["maxVertical"] = json!(0.5);
    input["movement"]["profile"] = json!({"radius":0.2,"height":1.8});
    let world = World::new(json!({"kind":"surfaces","input":input})).unwrap();
    let start = world.standing_foot([-1., 0., 0.]).unwrap().unwrap();
    assert_eq!(start, [-1., 0., 0.]);
    let end = world.standing_foot([1., 0., 0.]).unwrap().unwrap();
    let path = world.ground_path(start, end).unwrap().unwrap();
    assert_eq!(path.points.first(), Some(&start));
    assert_eq!(path.points.last(), Some(&end));
    let mut physical = physical;
    physical["input"]["ground"]["surfaces"] = json!([surface]);
    let raw = World::new(physical).unwrap();
    assert!(raw.standing_foot([-1., 0., 0.]).unwrap().is_none());
    assert!(
        raw.ground_path([-1., 0., 0.], [1., 0., 0.])
            .unwrap()
            .is_none()
    );
}

#[test]
fn ground_repair_finds_supported_detour_past_multiple_blocked_chords() {
    let columns = 24;
    let mut value = snapshot(floor(0., columns as f64, 0., 2., 0.));
    value["input"]["ground"]["options"]["profile"] = json!({"radius":0.1,"height":1.7});
    value["input"]["ground"]["surfaces"] = serde_json::Value::Array(
        (0..columns)
            .flat_map(|x| {
                (0..2).map(move |z| {
                    json!({
                        "id":format!("{x}/{z}"),
                        "vertices":[[x,0,z],[x+1,0,z],[x+1,0,z+1],[x,0,z+1]]
                    })
                })
            })
            .collect(),
    );
    value["input"]["ground"]["options"]["walls"] = serde_json::Value::Array(
        (1..columns)
            .map(|x| {
                json!({
                    "min":[x as f64-0.02,0.,0.25],
                    "max":[x as f64+0.02,3.,0.75],"state":"active"
                })
            })
            .collect(),
    );
    let world = World::new(value).unwrap();
    let start = [0.2, 0.01, 0.5];
    let goal = [columns as f64 - 0.2, 0.01, 0.5];
    assert!(!world.clear(start, goal, 0.).unwrap());
    for (a, b) in [(start, goal), (goal, start)] {
        let path = world.ground_path(a, b).unwrap().unwrap();
        assert!(distance(*path.points.first().unwrap(), a) < 1e-9);
        assert!(distance(*path.points.last().unwrap(), b) < 1e-9);
        assert!(path.length > distance(a, b));
        assert!(path.points.iter().all(|p| (p[1] - 0.01).abs() < 1e-9));
        assert!(
            path.points
                .windows(2)
                .all(|p| world.clear(p[0], p[1], 0.).unwrap())
        );
        let repeated = world.ground_path(a, b).unwrap().unwrap();
        assert!((path.length - repeated.length).abs() < 1e-8);
    }
}

#[test]
fn ground_detours_ignore_unloaded_proposals_without_granting_access() {
    let mut value = snapshot(floor(-3., 3., -2., 2., 0.));
    value["coverage"] = json!({
        "bounds":{"min":[-3.,-2.],"max":[3.,2.]},"tileSpan":10.,
        "tiles":[{"x":-1,"z":-1},{"x":-1,"z":0},{"x":0,"z":-1},{"x":0,"z":0}]
    });
    value["input"]["ground"]["options"]["walls"] = json!([
        {"min":[-0.05,0.,-0.3],"max":[0.05,3.,0.3],"state":"active"},
        {"min":[2.8,0.,1.8],"max":[3.2,3.,2.2],"state":"active"}
    ]);
    let world = World::new(value).unwrap();
    let path = world
        .ground_path([-1., 0.01, 0.], [1., 0.01, 0.])
        .unwrap()
        .unwrap();
    assert!(path.length > 2.);
    assert!(
        path.points
            .iter()
            .all(|&p| world.in_coverage(p, world.movement.profile.radius))
    );
    assert!(
        path.points
            .windows(2)
            .all(|p| world.clear(p[0], p[1], 0.).unwrap())
    );
    assert!(world.standing_foot([3.1, 0., 2.1]).is_err());
}

#[test]
fn surface_landing_projection_selects_interior_edges_and_requested_layer() {
    let mut value = snapshot(CollisionGeometry::default());
    value["input"]["ground"]["surfaces"] = json!([
        {"id":"lower","vertices":[[1.,0.,-2.],[5.,0.,-2.],[5.,0.,2.],[1.,0.,2.]]},
        {"id":"upper","vertices":[[1.,10.,-2.],[5.,10.,-2.],[5.,10.,2.],[1.,10.,2.]]}
    ]);
    let world = World::new(value).unwrap();
    assert_eq!(
        world.project_to_surface("lower", [2., 8., 0.]).unwrap(),
        Some([2., 0., 0.])
    );
    assert_eq!(
        world.project_to_surface("upper", [2., 8., 0.]).unwrap(),
        Some([2., 10., 0.])
    );
    assert_eq!(
        world.project_to_surface("lower", [-1., 0., 1.]).unwrap(),
        Some([1., 0., 1.])
    );
    assert_eq!(
        world.project_to_surface("lower", [8., 3., 4.]).unwrap(),
        Some([5., 0., 2.])
    );
}

#[test]
fn surface_landing_projection_uses_three_dimensional_slope_distance() {
    let mut value = snapshot(CollisionGeometry::default());
    value["input"]["ground"]["surfaces"] = json!([
        {"id":"slope","vertices":[[0.,0.,0.],[2.,2.,0.],[2.,2.,2.],[0.,0.,2.]]}
    ]);
    let world = World::new(value).unwrap();
    let projected = world
        .project_to_surface("slope", [1., 0., 1.])
        .unwrap()
        .unwrap();
    assert!(distance(projected, [0.5, 0.5, 1.]) < 1e-10);
    assert_eq!(
        world.project_to_surface("slope", [3., 3., 1.]).unwrap(),
        Some([2., 2., 1.])
    );
}

#[test]
fn surface_landing_projection_rejects_bad_bindings_and_has_no_vertical_support() {
    let mut value = snapshot(CollisionGeometry::default());
    value["input"]["ground"]["surfaces"] = json!([
        {"id":"vertical","vertices":[[0.,0.,0.],[0.,1.,0.],[0.,1.,1.]]}
    ]);
    let world = World::new(value).unwrap();
    assert!(world.project_to_surface("missing", [0., 0., 0.]).is_err());
    assert!(
        world
            .project_to_surface("vertical", [f64::NAN, 0., 0.])
            .is_err()
    );
    assert_eq!(
        world.project_to_surface("vertical", [1., 0., 0.]).unwrap(),
        None
    );
}

#[test]
fn nonlinear_raw_support_retains_real_walk_bends_before_costing() {
    // Local raw triangles around a captured failing chord. Both supplied feet
    // are valid, but the common physical trace bends down between them.
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/nonlinear-walk.json")).unwrap();
    let w = World::new(fixture["snapshot"].clone()).unwrap();
    let a: Vec3 = serde_json::from_value(fixture["a"].clone()).unwrap();
    let b: Vec3 = serde_json::from_value(fixture["b"].clone()).unwrap();
    let path = w.ground_path(a, b).unwrap().unwrap();
    assert_eq!(path.points[0], a);
    assert_eq!(*path.points.last().unwrap(), b);
    assert!(path.length > distance(a, b) + 0.0003);
    assert!((path.cost - path.length / w.movement.speed).abs() < 1e-12);
    for pair in path.points.windows(2) {
        let count = (distance(pair[0], pair[1]) / (w.movement.profile.radius / 4.).max(0.025))
            .ceil()
            .max(1.) as usize;
        let replay: Vec<_> = (0..=count)
            .map(|i| {
                let seed = collision::mix(pair[0], pair[1], i as f64 / count as f64);
                let support = w
                    .ground_at(
                        seed,
                        w.movement.max_vertical,
                        w.movement.max_vertical,
                        w.movement.profile.radius,
                    )
                    .unwrap()
                    .unwrap();
                let clearance = seed[1] - support.position[1];
                let mut feet = seed;
                if !(0.005 - 1e-6..=0.01 + 1e-6).contains(&clearance) {
                    feet[1] = support.position[1] + 0.005;
                }
                feet
            })
            .collect();
        assert!(distance(replay[0], pair[0]) < 1e-5);
        assert!(distance(*replay.last().unwrap(), pair[1]) < 1e-5);
        assert!((path_length(&replay) - distance(pair[0], pair[1])).abs() < 1e-5);
        assert!(replay.windows(2).all(|p| w.clear(p[0], p[1], 0.).unwrap()));
    }
}

#[test]
fn capsule_support_bend_is_not_replaced_by_endpoint_interpolation() {
    let mut collision = floor(-2., 2., -2., 2., 0.);
    merge(
        &mut collision,
        CollisionGeometry {
            positions: vec![-1., 0.2, -1., -1., 0.2, 1., 0., 0., 1., 0., 0., -1.],
            indices: vec![0, 1, 2, 0, 2, 3],
        },
    );
    let mut input = snapshot(collision);
    input["input"]["ground"]["surfaces"] = json!([
        {"id":"navigation","vertices":[[-2.,0.,-2.],[4.,0.,-2.],[-2.,0.,4.]]}
    ]);
    let w = World::new(input).unwrap();
    let a = w.standing_foot([-0.06, 0., 0.]).unwrap().unwrap();
    let b = w.standing_foot([0.06, 0., 0.]).unwrap().unwrap();
    let path = w.ground_path(a, b).unwrap().unwrap();
    assert_eq!(path.points.first(), Some(&a));
    assert_eq!(path.points.last(), Some(&b));
    assert!(path.length > distance(a, b) + 1e-5);
    assert!(
        path.points
            .windows(2)
            .all(|p| distance(p[0], p[1]) <= 0.045 + 1e-10 && w.clear(p[0], p[1], 0.).unwrap())
    );
}

#[test]
fn physical_walk_needs_raw_centerline_support_even_when_capsule_bridges_gap() {
    let mut collision = floor(-2., -0.05, -1., 1., 0.);
    merge(&mut collision, floor(0.05, 2., -1., 1., 0.));
    let mut input = snapshot(collision);
    input["input"]["ground"]["options"]["profile"]["radius"] = json!(0.3);
    input["input"]["ground"]["surfaces"] = json!([
        {"id":"navigation","vertices":[[-2.,0.,-1.],[2.,0.,-1.],[2.,0.,1.],[-2.,0.,1.]]}
    ]);
    let w = World::new(input).unwrap();
    assert!(w.standing_foot([0., 0.01, 0.]).unwrap().is_some());
    assert!(
        w.ground_path([-1., 0.01, 0.], [1., 0.01, 0.])
            .unwrap()
            .is_none()
    );
}

fn following_box(id: &str, x: f64) -> Value {
    let body: Vec<Vec3> = (0..8)
        .map(|bits| {
            [
                x + if bits & 1 == 0 { -0.5 } else { 0.5 },
                if bits & 2 == 0 { 0. } else { 1. },
                if bits & 4 == 0 { -0.5 } else { 0.5 },
            ]
        })
        .collect();
    json!({"id":id,"spawn":[x,0.,0.],"bodies":[body],"geometryKind":"box","maxDistance":8.,
        "initialState":0.,"assumption":"placement-within-activity-range"})
}
#[test]
fn following_batch_replaces_defaults_jointly_and_retains_fixed_bindings() {
    let mut input = snapshot(floor(-10., 10., -3., 3., 0.));
    input["input"]["devices"] =
        json!({"followingSupports":[following_box("a",0.),following_box("b",2.)]});
    let w = World::new(input.clone()).unwrap();
    assert!(w.place_following("a", [2., 0., 0.]).unwrap().is_none());
    let poses = vec![
        json!({"device":"a","position":[2.,0.,0.]}),
        json!({"device":"b","position":[4.,0.,0.]}),
    ];
    let moved = w.with_placements(&poses).unwrap().unwrap();
    assert!(moved.clear([0., 0.01, 0.], [0., 0.01, 0.], 0.).unwrap());
    assert!(!moved.clear([2., 0.01, 0.], [2., 0.01, 0.], 0.).unwrap());
    assert!(
        (moved
            .ground_at([2., 1.1, 0.], 0.2, 0.2, 0.2)
            .unwrap()
            .unwrap()
            .position[1]
            - 1.)
            .abs()
            < 1e-9
    );
    assert_eq!(
        moved.snapshot()["input"]["collision"],
        input["input"]["collision"]
    );
    let repeated = moved.with_placements(&poses).unwrap().unwrap();
    assert_eq!(
        repeated.snapshot()["placements"].as_array().unwrap().len(),
        2
    );
    assert!(moved.place_following("a", [3., 0., 0.]).is_err());
}
#[test]
fn following_placement_rejects_unsupported_models_exclusions_and_other_defaults() {
    let mut input = snapshot(floor(-10., 10., -3., 3., 0.));
    input["input"]["devices"] = json!({"followingSupports":[following_box("a",0.)]});
    input["input"]["ground"]["options"]["walls"] = json!([
        {"min":[1.5,0.,-0.5],"max":[2.5,1.,0.5],"state":"active"}
    ]);
    let w = World::new(input.clone()).unwrap();
    assert!(w.place_following("a", [2., 0., 0.]).unwrap().is_none());
    input["input"]["ground"]["options"]["walls"] = json!([]);
    input["input"]["devices"]["followingSupports"][0]["geometryKind"] = json!("convex");
    let w = World::new(input).unwrap();
    assert!(!w.clear([0., 0.01, 0.], [0., 0.01, 0.], 0.).unwrap());
    assert!(w.place_following("a", [2., 0., 0.]).unwrap().is_none());
}
#[test]
fn following_outside_loaded_window_keeps_pose_binding_without_geometry() {
    let mut input = snapshot(floor(-10., 10., -3., 3., 0.));
    input["coverage"] = json!({"bounds":{"min":[-10.,-3.],"max":[10.,3.]}});
    input["input"]["devices"] = json!({"followingSupports":[following_box("far",100.)]});
    let w = World::new(input).unwrap();
    let moved = w.place_following("far", [101., 0., 0.]).unwrap().unwrap();
    assert_eq!(
        moved.snapshot()["placements"][0]["position"],
        json!([101., 0., 0.])
    );
    assert!(
        !moved
            .surfaces
            .iter()
            .any(|s| s.id.starts_with("following/"))
    );
}
#[test]
fn moving_support_is_not_hidden_by_higher_imported_navigation() {
    let mut input = snapshot(floor(-3., 3., -3., 3., 0.));
    input["input"]["ground"]["surfaces"] = json!([
        {"id":"navigation","vertices":[[-3.,0.08,-3.],[3.,0.08,-3.],[3.,0.08,3.],[-3.,0.08,3.]]}
    ]);
    input["input"]["devices"] = json!({"movingSupports":[{"id":"platform","family":"platform",
        "assumption":"phase-free-swept-support","surfaces":[{"id":"roof","vertices":[[-2.,0.05,-2.],[2.,0.05,-2.],[2.,0.05,2.],[-2.,0.05,2.]]}]}]});
    input["input"]["devices"]["movingSupports"][0]["surfaces"][0]["vertices"]
        .as_array_mut()
        .unwrap()
        .reverse();
    let w = World::new(input).unwrap();
    let hit = w.ground_at([0., 0.1, 0.], 0.5, 0.5, 0.2).unwrap().unwrap();
    assert!((hit.position[1] - 0.05).abs() < 1e-9);
}
#[test]
fn fixed_launch_direct_height_uses_canonical_landing_feet() {
    let mut collision = floor(-2., 2., -2., 2., 0.);
    merge(&mut collision, floor(4., 6., -2., 2., 2.));
    let mut input = snapshot(collision);
    input["input"]["devices"] = json!({"devices":[{"id":"pad","kind":"launch","position":[0.,0.,0.],
        "goal":{"position":[0.,0.,0.],"interaction":{"radius":0.5}},"seeds":[[0.,0.,0.]],
        "unitScale":true,"fixedLaunch":true,"height":0.1,"aim":[5.,2.,0.],"aimClearance":0.5}]});
    let w = World::new(input).unwrap();
    let launch = w
        .known_actions()
        .iter()
        .find(|c| c.id == "launch/pad")
        .unwrap();
    let start = launch.points[0];
    let end = *launch.points.last().unwrap();
    assert!(
        (launch.extra["flight"]["model"]["maxJumpHeight"]
            .as_f64()
            .unwrap()
            - (end[1] + 0.5 - start[1]))
            .abs()
            < 1e-10
    );
}

#[test]
fn rounded_support_chords_preserve_standing_at_arbitrary_scheduler_cuts() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/scheduler-cut.json")).unwrap();
    let w = World::new(fixture["snapshot"].clone()).unwrap();
    let a: Vec3 = serde_json::from_value(fixture["a"].clone()).unwrap();
    let b: Vec3 = serde_json::from_value(fixture["b"].clone()).unwrap();
    let path = w.ground_path(a, b).unwrap().unwrap();
    for pair in path.points.windows(2) {
        for i in 0..=257 {
            let foot = collision::mix(pair[0], pair[1], i as f64 / 257.);
            let hit = w
                .ground_at(foot, 0.31, 0.31, w.movement.profile.radius)
                .unwrap()
                .unwrap();
            let clearance = foot[1] - hit.position[1];
            assert!(
                (0.005 - 1e-6..=0.01 + 1e-6).contains(&clearance),
                "unsupported scheduler cut {foot:?}: {clearance}"
            );
        }
    }
}

#[test]
fn physical_standing_is_independent_of_navigation_projection_radius() {
    let mut input = snapshot(floor(-3., 3., -3., 3., 0.));
    input["input"]["ground"]["options"]["profile"]["radius"] = json!(0.1);
    input["input"]["ground"]["surfaces"] = json!([
        {"id":"offset","vertices":[[-3.,0.4,-3.],[3.,0.4,-3.],[3.,0.4,3.],[-3.,0.4,3.]]}
    ]);
    let w = World::new(input).unwrap();
    let foot = w.standing_foot([0., 0.005, 0.]).unwrap().unwrap();
    assert_eq!(foot, [0., 0.005, 0.]);
    assert!(
        w.project_with_tolerance(foot, 0.1, None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        w.project_with_tolerance(foot, 0.5, None).unwrap()[0].surface,
        "offset"
    );
    let walk = w
        .ground_path([-1., 0.005, 0.], [1., 0.005, 0.])
        .unwrap()
        .unwrap();
    assert_eq!(walk.points[0], [-1., 0.005, 0.]);
    assert_eq!(*walk.points.last().unwrap(), [1., 0.005, 0.]);
}

#[test]
fn direct_probe_distinguishes_physical_gap_navigation_and_clearance() {
    let mut collision = floor(-2., -0.05, -1., 1., 0.);
    merge(&mut collision, floor(0.05, 2., -1., 1., 0.));
    let mut input = snapshot(collision);
    input["input"]["ground"]["surfaces"] = json!([
        {"id":"navigation","vertices":[[-2.,0.,-1.],[2.,0.,-1.],[2.,0.,1.],[-2.,0.,1.]]}
    ]);
    let w = World::new(input).unwrap();
    let GroundProbe::Rejected(GroundFailure::PhysicalSupport { span }) =
        w.probe_ground([-1., 0.01, 0.], [1., 0.01, 0.]).unwrap()
    else {
        panic!("raw crack needs a physical witness")
    };
    assert!(span[0][0].min(span[1][0]) < 0.05 && span[0][0].max(span[1][0]) > -0.05);
    let boundaries = w
        .raw_support_boundaries(Bounds {
            min: [-0.1, -0.8],
            max: [0.1, 0.8],
        })
        .unwrap();
    assert!(
        boundaries
            .iter()
            .any(|b| (b.points[0][0] + 0.05).abs() < 1e-8 && b.inward[0] < -0.99)
    );
    assert!(
        boundaries
            .iter()
            .any(|b| (b.points[0][0] - 0.05).abs() < 1e-8 && b.inward[0] > 0.99)
    );
    let mut masked = snapshot(floor(-2., 2., -1., 1., 0.));
    masked["input"]["ground"]["surfaces"] = json!([
        {"id":"left","vertices":[[-2.,0.,-1.],[0.,0.,-1.],[0.,0.,1.],[-2.,0.,1.]],"portals":[]},
        {"id":"right","vertices":[[0.,0.,-1.],[2.,0.,-1.],[2.,0.,1.],[0.,0.,1.]],"portals":[]}
    ]);
    let w = World::new(masked).unwrap();
    assert!(matches!(
        w.probe_ground([-1., 0.01, 0.], [1., 0.01, 0.]).unwrap(),
        GroundProbe::Rejected(GroundFailure::Navigation)
    ));
    assert!(
        w.raw_support_boundaries(Bounds {
            min: [-0.1, -0.8],
            max: [0.1, 0.8]
        })
        .unwrap()
        .is_empty()
    );
    let mut blocked = snapshot(floor(-2., 2., -2., 2., 0.));
    blocked["input"]["ground"]["options"]["walls"] =
        json!([{ "min":[-0.1,0.,-0.5],"max":[0.1,2.,0.5],"state":"active"}]);
    let w = World::new(blocked).unwrap();
    assert!(matches!(
        w.probe_ground([-1., 0.01, 0.], [1., 0.01, 0.]).unwrap(),
        GroundProbe::Rejected(GroundFailure::Clearance { .. })
    ));
    // A failed direct chord is not a failed ground route: the detour remains.
    assert!(
        w.ground_path([-1., 0.01, 0.], [1., 0.01, 0.])
            .unwrap()
            .is_some()
    );
}
#[test]
fn raw_boundaries_subtract_partial_shared_edges_without_mesh_diagonals() {
    let mut collision = floor(-2., 0., -1., 1., 0.);
    merge(&mut collision, floor(0., 2., -1., 0., 0.));
    let w = World::new(snapshot(collision)).unwrap();
    let boundaries = w
        .raw_support_boundaries(Bounds {
            min: [-0.01, -0.9],
            max: [0.01, 0.9],
        })
        .unwrap();
    let seam: Vec<_> = boundaries
        .iter()
        .filter(|b| b.points.iter().all(|p| p[0].abs() < 1e-8))
        .collect();
    assert_eq!(seam.len(), 1);
    assert!(seam[0].points.iter().any(|p| p[2].abs() < 1e-7));
    assert!(seam[0].points.iter().any(|p| (p[2] - 0.9).abs() < 1e-7));
    assert!(seam[0].inward[0] < -0.99);
}
#[test]
fn direct_probe_reports_finite_proof_budget_without_running_ground_search() {
    let w = World::new(snapshot(floor(-20_000., 20_000., -2., 2., 0.))).unwrap();
    assert!(matches!(
        w.probe_ground([-19_000., 0.01, 0.], [19_000., 0.01, 0.])
            .unwrap(),
        GroundProbe::Rejected(GroundFailure::ProofBudget { .. })
    ));
    let local = World::new(snapshot(floor(-2., 2., -2., 2., 0.))).unwrap();
    let GroundProbe::Supported(path) = local.probe_ground([-1., 0.01, 0.], [1., 0.01, 0.]).unwrap()
    else {
        panic!("flat chord")
    };
    assert!((path.length - 2.).abs() < 1e-9);
    assert!((path.cost - path.length / w.movement.speed).abs() < 1e-12);
}

#[test]
fn flight_replay_rejects_support_lost_when_default_box_is_moved() {
    let mut input = snapshot(floor(-6., 6., -3., 3., 0.));
    input["input"]["devices"] = json!({"followingSupports":[following_box("box",0.)]});
    let w = World::new(input).unwrap();
    let flight = w
        .flight([0., 1.01, 0.], [2., 0.01, 0.], Mode::Jump)
        .unwrap()
        .unwrap();
    let segment = serde_json::to_value(&flight).unwrap();
    assert!(w.replay_flight(&segment, None).unwrap());
    let moved = w.place_following("box", [4., 0., 0.]).unwrap().unwrap();
    assert!(
        flight
            .points
            .windows(2)
            .all(|p| moved.clear(p[0], p[1], 0.).unwrap())
    );
    assert!(!moved.replay_flight(&segment, None).unwrap());
}
#[test]
fn flight_replay_collection_proves_prefix_without_future_landing_or_obstacle_checks() {
    let w = World::new(snapshot(floor(-8., 8., -3., 3., 0.))).unwrap();
    let start = [-3., 0.01, 0.];
    let end = [3., 0.01, 0.];
    let full = w.flight(start, end, Mode::Jump).unwrap().unwrap();
    let target = full.points[full.points.len() / 3];
    let interaction = Interaction {
        radius: 0.1,
        airborne: true,
        ..Default::default()
    };
    let flight = w
        .flight_to_goal(
            start,
            end,
            &w.movement.model,
            &FlightControl::default(),
            target,
            &interaction,
        )
        .unwrap()
        .unwrap();
    let segment = serde_json::to_value(&flight).unwrap();
    let mut input = snapshot(floor(-8., -2., -3., 3., 0.));
    input["input"]["ground"]["options"]["walls"] = json!([
        {"min":[2.,0.,-1.],"max":[2.1,4.,1.],"state":"active"}
    ]);
    let changed = World::new(input).unwrap();
    assert!(
        changed
            .replay_flight(&segment, Some((target, &interaction)))
            .unwrap()
    );
    assert!(!changed.replay_flight(&segment, None).unwrap());
    let mut mistimed = segment.clone();
    let times = mistimed["times"].as_array_mut().unwrap();
    let last = times.last_mut().unwrap();
    *last = json!(last.as_f64().unwrap() + 0.01);
    assert!(
        !changed
            .replay_flight(&mistimed, Some((target, &interaction)))
            .unwrap()
    );
}
#[test]
fn flight_replay_accepts_run_off_and_supplied_fixed_launch_model_authority() {
    let mut collision = floor(-4., 5., -2., 2., 0.);
    merge(&mut collision, floor(-4., 0., -2., 2., 2.));
    let w = World::new(snapshot(collision)).unwrap();
    let control = FlightControl {
        mode: Mode::Drop,
        ..Default::default()
    };
    let run_off = w
        .run_off(
            [-1., 2.005, 0.],
            [2., 0.005, 0.],
            &w.movement.model,
            &control,
        )
        .unwrap()
        .unwrap();
    assert!(
        w.replay_flight(&serde_json::to_value(run_off).unwrap(), None)
            .unwrap()
    );
    let mut model = w.movement.model.clone();
    model.max_jump_height = 4.;
    model.max_horizontal_speed = 3.;
    model.start_horizontal_speed = None;
    model.air_acceleration = None;
    model.air_deceleration = None;
    let mut launch = w
        .flight_with_control(
            [-2., 2.01, 0.],
            [2., 0.01, 0.],
            &model,
            &FlightControl::default(),
        )
        .unwrap()
        .unwrap();
    launch.mode = Mode::Launch;
    assert!(
        w.replay_flight(&serde_json::to_value(launch).unwrap(), None)
            .unwrap()
    );
}

#[test]
fn physical_stair_walk_is_supported_before_scheduling() {
    let mut collision = floor(-2., 0., -2., 2., 0.);
    merge(&mut collision, floor(0., 2., -2., 2., 0.2));
    merge(
        &mut collision,
        CollisionGeometry {
            positions: vec![0., 0., -2., 0., 0.2, -2., 0., 0.2, 2., 0., 0., 2.],
            indices: vec![0, 1, 2, 0, 2, 3],
        },
    );
    let mut input = snapshot(collision);
    input["input"]["movement"]["stepUp"] = json!(0.5);
    input["input"]["movement"]["stepDown"] = json!(0.5);
    let w = World::new(input).unwrap();
    let path = w
        .ground_path([-1., 0.01, 0.], [1., 0.21, 0.])
        .unwrap()
        .expect("legitimate supported 20cm stair");
    assert_eq!(path.points[0], [-1., 0.01, 0.]);
    assert!(distance(*path.points.last().unwrap(), [1., 0.21, 0.]) < 1e-9);
    assert!(path.length > distance(path.points[0], *path.points.last().unwrap()) + 0.01);
    assert!(
        path.points
            .windows(2)
            .all(|p| w.clear(p[0], p[1], 0.).unwrap())
    );
    for pair in path.points.windows(2) {
        for i in 0..=17 {
            let p = collision::mix(pair[0], pair[1], i as f64 / 17.);
            let h = w
                .ground_at(p, 0.31, 0.31, w.movement.profile.radius)
                .unwrap()
                .unwrap();
            assert!((0.005 - 1e-6..=0.01 + 1e-6).contains(&(p[1] - h.position[1])));
        }
    }
}

fn bent_navigation(gap: bool) -> World {
    let mut collision = floor(-3., -1., -2., 0., 0.);
    if gap {
        merge(&mut collision, floor(-1., 1., -2., -1.05, 0.));
        merge(&mut collision, floor(-1., 1., -0.95, 0., 0.));
    } else {
        merge(&mut collision, floor(-1., 1., -2., 0., 0.));
    }
    merge(&mut collision, floor(-1., 1., 0., 3., 0.));
    let mut input = snapshot(collision);
    input["input"]["ground"]["surfaces"] = json!([
        {"id":"left","vertices":[[-3.,0.,-2.],[-1.,0.,-2.],[-1.,0.,0.],[-3.,0.,0.]],"portals":[]},
        {"id":"corner","vertices":[[-1.,0.,-2.],[1.,0.,-2.],[1.,0.,0.],[-1.,0.,0.]],"portals":[]},
        {"id":"upper","vertices":[[-1.,0.,0.],[1.,0.,0.],[1.,0.,3.],[-1.,0.,3.]],"portals":[]}
    ]);
    input["input"]["ground"]["options"]["portals"] = json!([
        {"from":"left","to":"corner","points":[[-1.,0.,-1.],[-1.,0.,-1.]],
            "entry":[[-1.,0.,-2.],[-1.,0.,0.]],"exit":[[-1.,0.,-2.],[-1.,0.,0.]]},
        {"from":"corner","to":"upper","points":[[0.,0.,0.],[0.,0.,0.]],
            "entry":[[-1.,0.,0.],[1.,0.,0.]],"exit":[[-1.,0.,0.],[1.,0.,0.]]}
    ]);
    World::new(input).unwrap()
}
#[test]
fn navigation_route_probe_reveals_physical_gap_hidden_from_straight_probe() {
    let w = bent_navigation(true);
    let a = [-2., 0.01, -1.];
    let b = [0., 0.01, 2.];
    assert!(matches!(
        w.probe_ground(a, b).unwrap(),
        GroundProbe::Rejected(GroundFailure::Navigation)
    ));
    let result = w
        .probe_ground_route(
            a,
            b,
            GroundRouteLimits {
                max_expansions: 64,
                max_legs: 7,
            },
        )
        .unwrap();
    assert!(result.navigation.is_some());
    assert!(result.supported.is_none());
    assert!(result.expanded <= 64 && result.probed <= 7);
    assert!(!result.truncated);
    assert!(
        result
            .failures
            .iter()
            .any(|f| matches!(f, GroundFailure::PhysicalSupport { .. }))
    );
}
#[test]
fn navigation_route_probe_returns_only_fully_proved_directed_canonical_joins() {
    let w = bent_navigation(false);
    let a = [-2., 0.01, -1.];
    let b = [0., 0.01, 2.];
    let result = w
        .probe_ground_route(
            a,
            b,
            GroundRouteLimits {
                max_expansions: 64,
                max_legs: 7,
            },
        )
        .unwrap();
    let path = result
        .supported
        .clone()
        .unwrap_or_else(|| panic!("{result:?}"));
    assert!(result.failures.is_empty() && !result.truncated);
    assert_eq!(path.points[0], a);
    assert_eq!(*path.points.last().unwrap(), b);
    assert!(
        path.points
            .windows(2)
            .all(|p| w.clear(p[0], p[1], 0.).unwrap())
    );
    assert!((path.length - path_length(&path.points)).abs() < 1e-10);
    assert_eq!(result.probed, result.navigation.unwrap().len() - 1);
    let reverse = w
        .probe_ground_route(
            b,
            a,
            GroundRouteLimits {
                max_expansions: 64,
                max_legs: 7,
            },
        )
        .unwrap();
    assert!(reverse.navigation.is_none() && reverse.supported.is_none());
    assert!(!reverse.truncated && reverse.probed == 0);
    assert!(matches!(
        reverse.failures.as_slice(),
        [GroundFailure::Navigation]
    ));
}
#[test]
fn navigation_route_probe_honors_prefix_and_expansion_limits_without_route_claims() {
    let w = bent_navigation(false);
    let a = [-2., 0.01, -1.];
    let b = [0., 0.01, 2.];
    let prefix = w
        .probe_ground_route(
            a,
            b,
            GroundRouteLimits {
                max_expansions: 64,
                max_legs: 1,
            },
        )
        .unwrap();
    assert!(prefix.navigation.is_some() && prefix.supported.is_none() && prefix.truncated);
    assert_eq!(prefix.probed, 1);
    let stopped = w
        .probe_ground_route(
            a,
            b,
            GroundRouteLimits {
                max_expansions: 1,
                max_legs: 7,
            },
        )
        .unwrap();
    assert!(stopped.navigation.is_none() && stopped.supported.is_none() && stopped.truncated);
    assert_eq!(stopped.expanded, 1);
    assert_eq!(stopped.probed, 0);
    let no_proofs = w
        .probe_ground_route(
            a,
            b,
            GroundRouteLimits {
                max_expansions: 64,
                max_legs: 0,
            },
        )
        .unwrap();
    assert!(no_proofs.navigation.is_some() && no_proofs.supported.is_none() && no_proofs.truncated);
    assert_eq!(no_proofs.probed, 0);
}

#[test]
fn navigation_proposal_ranking_charges_vertical_floor_excursions() {
    let mut input = snapshot(floor(-2., 12., -4., 4., 0.));
    input["input"]["ground"]["surfaces"] = json!([
        {"id":"start","vertices":[[-1.,0.,-1.],[1.,0.,-1.],[1.,0.,1.],[-1.,0.,1.]],"portals":[]},
        {"id":"high","vertices":[[-1.,20.,-1.],[11.,20.,-1.],[11.,20.,1.],[-1.,20.,1.]],"portals":[]},
        {"id":"level","vertices":[[-1.,0.,1.],[11.,0.,1.],[11.,0.,3.],[-1.,0.,3.]],"portals":[]},
        {"id":"goal","vertices":[[9.,0.,-1.],[11.,0.,-1.],[11.,0.,1.],[9.,0.,1.]],"portals":[]}
    ]);
    input["input"]["ground"]["options"]["portals"] = json!([
        {"from":"start","to":"high","points":[[0.,0.,0.],[0.,20.,0.]]},
        {"from":"high","to":"goal","points":[[10.,20.,0.],[10.,0.,0.]]},
        {"from":"start","to":"level","points":[[0.,0.,0.],[0.,0.,2.]]},
        {"from":"level","to":"goal","points":[[10.,0.,2.],[10.,0.,0.]]}
    ]);
    let w = World::new(input).unwrap();
    let result = w
        .probe_ground_route(
            [0., 0.01, 0.],
            [10., 0.01, 0.],
            GroundRouteLimits {
                max_expansions: 64,
                max_legs: 0,
            },
        )
        .unwrap();
    let navigation = result.navigation.unwrap();
    // Only proposal ranking is exercised: neither alternative is physically
    // certified when no direct proof units are supplied.
    assert!(navigation.iter().all(|p| p[1].abs() < 0.02));
    assert!(navigation.iter().any(|p| (p[2] - 2.).abs() < 1e-9));
    assert!(result.supported.is_none() && result.probed == 0 && result.truncated);
}

#[test]
fn coverage_category_tracks_unavailable_emitters_without_hiding_malformed_facts() {
    let mut input = snapshot(floor(-3., 3., -3., 3., 0.));
    input["coverage"] = json!({"bounds":{"min":[-1.,-1.],"max":[1.,1.]}});
    let w = World::new(input.clone()).unwrap();
    assert!(is_coverage_error(
        &w.clear([0., 0.01, 0.], [2., 0.01, 0.], 0.).unwrap_err()
    ));
    input["coverage"] = json!({"bounds":{"min":[-1.,-1.],"max":[1.,1.]},"tiles":[],"tileSpan":1.});
    let w = World::new(input.clone()).unwrap();
    assert!(is_coverage_error(
        &w.clear([0., 0.01, 0.], [0., 0.01, 0.], 0.).unwrap_err()
    ));
    input["coverage"] = json!("complete");
    input["input"]["collisionOptions"] = json!({"bounds":{"min":[-1.,-1.],"max":[1.,1.]}});
    let w = World::new(input.clone()).unwrap();
    assert!(is_coverage_error(
        &w.clear([0., 0.01, 0.], [2., 0.01, 0.], 0.).unwrap_err()
    ));
    assert!(!is_coverage_error(
        &w.clear([f64::NAN, 0., 0.], [0., 0., 0.], 0.).unwrap_err()
    ));
    input["coverage"] = json!({"bounds":{"min":[1.,-1.],"max":[-1.,1.]}});
    assert!(!is_coverage_error(&World::new(input).unwrap_err()));
    assert!(!is_coverage_error("Coverage query exceeds tile budget"));
    assert!(!is_coverage_error("Flight exceeds sweep budget"));
    assert!(!is_coverage_error("Invalid flight speed control"));
}

fn nav_rectangle(id: &str, x0: f64, x1: f64, z0: f64, z1: f64, y: f64) -> Value {
    json!({"id":id,"vertices":[[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]],"portals":[]})
}
fn proposal_world(surfaces: Value, portals: Value) -> World {
    let mut input = snapshot(floor(-2., 12., -2., 6., 0.));
    input["input"]["ground"]["surfaces"] = surfaces;
    input["input"]["ground"]["options"]["portals"] = portals;
    World::new(input).unwrap()
}
#[test]
fn weighted_navigation_proposal_has_no_shortest_path_guarantee() {
    let w = proposal_world(
        json!([
            nav_rectangle("00-start", -0.1, 0.1, -0.1, 3.1, 0.),
            nav_rectangle("a", -0.1, 8.1, -0.1, 0.1, 0.),
            nav_rectangle("b", 7.9, 8.1, -0.1, 4.1, 0.),
            nav_rectangle("c", 7.9, 10.1, 3.9, 4.1, 0.),
            nav_rectangle("level", -0.1, 10.1, 2.9, 3.1, 0.),
            nav_rectangle("goal", 9.9, 10.1, -0.1, 4.1, 0.)
        ]),
        json!([
            {"from":"00-start","to":"a","points":[[0.,0.,0.],[0.,0.,0.]]},
            {"from":"a","to":"b","points":[[8.,0.,0.],[8.,0.,0.]]},
            {"from":"b","to":"c","points":[[8.,0.,4.],[8.,0.,4.]]},
            {"from":"c","to":"goal","points":[[10.,0.,4.],[10.,0.,4.]]},
            {"from":"00-start","to":"level","points":[[0.,0.,3.],[0.,0.,3.]]},
            {"from":"level","to":"goal","points":[[10.,0.,3.],[10.,0.,3.]]}
        ]),
    );
    let result = w
        .probe_ground_route(
            [0., 0.01, 0.],
            [10., 0.01, 0.],
            GroundRouteLimits {
                max_expansions: 4096,
                max_legs: 0,
            },
        )
        .unwrap();
    let navigation = result.navigation.unwrap();
    // Weighted priority chooses the goal-facing 18m branch even though the
    // alternate authorized path via (0,3),(10,3) is about16m. It is a proposal.
    assert!(path_length(&navigation) > 17.);
    assert!(result.supported.is_none() && result.probed == 0);
}
fn dense_navigation(count: usize) -> World {
    let surfaces: Vec<_> = (0..count)
        .map(|i| {
            nav_rectangle(
                &format!("face/{i:02}"),
                i as f64,
                (i + 1) as f64,
                -1.,
                1.,
                0.,
            )
        })
        .collect();
    let portals: Vec<_> = (0..count - 1)
        .map(|i| {
            json!({"from":format!("face/{i:02}"),"to":format!("face/{:02}",i+1),
        "points":[[(i+1) as f64,0.,0.],[(i+1) as f64,0.,0.]]})
        })
        .collect();
    let mut input = snapshot(floor(0., count as f64, -1., 1., 0.));
    input["input"]["ground"]["surfaces"] = json!(surfaces);
    input["input"]["ground"]["options"]["portals"] = json!(portals);
    World::new(input).unwrap()
}
#[test]
fn navigation_visibility_coalesces_dense_authorized_chords_within_shared_work() {
    let w = dense_navigation(40);
    let result = w
        .probe_ground_route(
            [0.1, 0.01, 0.],
            [39.9, 0.01, 0.],
            GroundRouteLimits {
                max_expansions: 4096,
                max_legs: 1,
            },
        )
        .unwrap();
    assert_eq!(result.navigation.as_ref().unwrap().len(), 2);
    assert_eq!(result.probed, 1);
    assert!(result.supported.is_some() && !result.truncated && result.expanded <= 4096);
    let limited = dense_navigation(8)
        .probe_ground_route(
            [0.1, 0.01, 0.],
            [7.9, 0.01, 0.],
            GroundRouteLimits {
                max_expansions: 16,
                max_legs: 1,
            },
        )
        .unwrap();
    assert!(limited.navigation.as_ref().unwrap().len() > 2);
    assert!(limited.truncated && limited.supported.is_none() && limited.expanded <= 16);
}
#[test]
fn navigation_visibility_retains_masked_detour_and_height_changing_turns() {
    let w = proposal_world(
        json!([
            nav_rectangle("left", 0., 1., -1., 1., 0.),
            nav_rectangle("right", 1., 2., -1., 1., 0.),
            nav_rectangle("upper", 0., 2., 1., 2., 0.)
        ]),
        json!([
            {"from":"left","to":"upper","points":[[0.5,0.,1.],[0.5,0.,1.]]},
            {"from":"upper","to":"right","points":[[1.5,0.,1.],[1.5,0.,1.]]}
        ]),
    );
    let a = [0.5, 0.01, 0.];
    let b = [1.5, 0.01, 0.];
    let result = w
        .probe_ground_route(
            a,
            b,
            GroundRouteLimits {
                max_expansions: 4096,
                max_legs: 3,
            },
        )
        .unwrap();
    assert!(result.navigation.as_ref().unwrap().len() > 2);
    assert!(result.supported.as_ref().unwrap().length > 2.5);
    assert!(matches!(
        w.probe_ground(a, b).unwrap(),
        GroundProbe::Rejected(GroundFailure::Navigation)
    ));
    let height = proposal_world(
        json!([
            nav_rectangle("low", -1., 1., -1., 1., 0.),
            nav_rectangle("high", -1., 3., -1., 1., 2.)
        ]),
        json!([{"from":"low","to":"high","points":[[0.,0.,0.],[0.,2.,0.]]}]),
    );
    let result = height
        .probe_ground_route(
            [0., 0.01, 0.],
            [2., 2.01, 0.],
            GroundRouteLimits {
                max_expansions: 4096,
                max_legs: 0,
            },
        )
        .unwrap();
    let navigation = result.navigation.unwrap();
    assert!(navigation.contains(&[0., 0., 0.]) && navigation.contains(&[0., 2., 0.]));
    assert!(navigation.len() >= 4 && result.supported.is_none());
}

#[test]
fn authoritative_flight_peaks_cover_constant_split_overspeed_and_runoff() {
    let w = World::new(snapshot(floor(-20., 20., -20., 20., 0.))).unwrap();
    let a = [-2., 0.01, 0.];
    let b = [2., 0.01, 0.];
    let constant = w.flight(a, b, Mode::Jump).unwrap().unwrap();
    assert!(
        (constant.extra["peakHorizontalSpeed"].as_f64().unwrap() - 4. / constant.duration()).abs()
            < 1e-12
    );
    let split = w
        .flight_with_control(
            a,
            b,
            &w.movement.model,
            &FlightControl {
                horizontal_waypoint: Some([0., 0.2]),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
    assert_eq!(split.extra["peakHorizontalSpeed"], json!(6.));
    assert!(split.extra["peakHorizontalSpeed"].as_f64().unwrap() > 4. / split.duration());
    let mut model = w.movement.model.clone();
    model.start_horizontal_speed = Some(12.);
    model.air_overspeed_deceleration = Some(5.);
    let fast = w
        .flight_with_control(a, [7., 0.01, 0.], &model, &FlightControl::default())
        .unwrap()
        .unwrap();
    assert!(fast.extra["peakHorizontalSpeed"].as_f64().unwrap() > 6.);
    let mut geometry = floor(-4., 5., -2., 2., 0.);
    merge(&mut geometry, floor(-4., 0., -2., 2., 2.));
    let w = World::new(snapshot(geometry)).unwrap();
    for exit in [None, Some([1., 0.])] {
        let c = w
            .run_off(
                [-1., 2.01, 0.],
                [2., 0.01, 0.],
                &w.movement.model,
                &FlightControl {
                    mode: Mode::Drop,
                    exit,
                    speed_fraction: exit.map(|_| 0.5),
                    terminal: exit.map(|_| "average".into()),
                    ..Default::default()
                },
            )
            .unwrap()
            .unwrap();
        let peak = c.extra["peakHorizontalSpeed"].as_f64().unwrap();
        assert!(peak > 0. && peak <= 6.);
        let mut segment = serde_json::to_value(&c).unwrap();
        assert!(w.replay_flight(&segment, None).unwrap());
        segment["peakHorizontalSpeed"] = json!(peak - 0.01);
        assert!(!w.replay_flight(&segment, None).unwrap());
        segment["peakHorizontalSpeed"] = json!("forged");
        assert!(!w.replay_flight(&segment, None).unwrap());
        segment
            .as_object_mut()
            .unwrap()
            .remove("peakHorizontalSpeed");
        assert!(w.replay_flight(&segment, None).unwrap());
    }
}

#[test]
fn coalescing_exhaustion_retains_a_fully_proved_canonical_route() {
    let w = dense_navigation(8);
    let a = [0.1, 0.01, 0.];
    let b = [7.9, 0.01, 0.];
    let result = w
        .probe_ground_route(
            a,
            b,
            GroundRouteLimits {
                max_expansions: 16,
                max_legs: 255,
            },
        )
        .unwrap();
    let navigation = result.navigation.as_ref().unwrap();
    assert!(result.truncated && result.expanded == 16 && navigation.len() > 2);
    assert_eq!(result.probed, navigation.len() - 1);
    assert!(result.failures.is_empty());
    let path = result.supported.unwrap();
    assert_eq!(path.points.first(), Some(&a));
    assert_eq!(path.points.last(), Some(&b));
    assert!((path.length - 7.8).abs() < 1e-10);
    // Every retained canonical portal foot occurs exactly in the joined path.
    for &point in navigation {
        let canonical = w.standing_foot(point).unwrap().unwrap();
        assert!(path.points.contains(&canonical));
    }
}
