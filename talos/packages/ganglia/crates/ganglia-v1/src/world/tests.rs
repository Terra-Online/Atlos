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
    assert!(w.clear([-1., 0.01, 0.], [3., 0.01, 0.], 0.).unwrap());
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
