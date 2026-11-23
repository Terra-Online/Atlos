use ganglia_v2::Engine;
use serde_json::{Value, json};

fn scene() -> Value {
    json!({"physical": {
        "ground": {"surfaces":[{"id":"floor","vertices":[[0,0,0],[10,0,0],[10,0,10],[0,0,10]]}],
            "options":{"speed":5,"maxVertical":0.5,"profile":{"radius":0.3,"height":1.8},"walls":[]}},
        "collision":{"positions":[],"indices":[]},
        "movement":{"model":{"gravity":10,"fallingGravity":10,"maxJumpHeight":2,"maxFallingSpeed":20,"apexTime":0,"maxHorizontalSpeed":5,"startHorizontalSpeed":5,"airOverspeedDeceleration":10,"airAcceleration":10,"airDeceleration":10},"maxSlope":45,"runAirSpeed":5,"stepUp":0.4,"stepDown":0.4},
        "locomotion":{"speed":5,"sprintSpeed":7,"sprintAcceleration":60}
    },"marks":[],"config":{"seed":7}})
}
fn query(goal: [f64; 3]) -> String {
    json!({"starts":[{"id":"player","position":[1,0,1],"cost":2,"state":"available"}],"goal":goal})
        .to_string()
}

#[test]
fn walking_preserves_backbone_and_reports_convergence_rounds() {
    let engine = Engine::new(&scene().to_string()).unwrap();
    let before = engine.stats();
    let result = engine.solve(&query([9., 0., 1.])).unwrap();
    assert_eq!(result["route"]["status"], "complete");
    // This fixture has no stamina limit: accelerate from 5 to 7 m/s at
    // 60 m/s², then cover the remainder of the 8 m approach at sprint speed.
    let acceleration_time = (7. - 5.) / 60.;
    let acceleration_distance = (5. + 7.) * acceleration_time / 2.;
    let expected = 2. + acceleration_time + (8. - acceleration_distance) / 7.;
    assert!((result["route"]["cost"].as_f64().unwrap() - expected).abs() < 1e-8);
    assert_eq!(engine.stats(), before);
    let rounds = result["diagnostics"]["v2"]["rounds"].as_array().unwrap();
    assert!(rounds.len() >= 3);
    assert!(
        rounds
            .iter()
            .all(|r| r["attempts"] == 100 && r["elapsedMs"].as_f64().unwrap() >= 0.)
    );
}

#[test]
fn crosses_a_static_gap_using_a_prepared_jump() {
    let mut input = scene();
    input["physical"]["ground"]["surfaces"] = json!([
        {"id":"left","vertices":[[0,0,0],[3,0,0],[3,0,3],[0,0,3]]},
        {"id":"right","vertices":[[5,0,0],[8,0,0],[8,0,3],[5,0,3]]}
    ]);
    input["physical"]["collision"] = json!({"positions":[0,0,0,3,0,3,3,0,0,0,0,0,0,0,3,3,0,3,5,0,0,8,0,3,8,0,0,5,0,0,5,0,3,8,0,3],"indices":[0,1,2,3,4,5,6,7,8,9,10,11]});
    let engine = Engine::new(&input.to_string()).unwrap();
    let result = engine.solve(&query([7., 0., 1.])).unwrap();
    assert_eq!(result["route"]["status"], "complete");
    assert!(
        result["route"]["segments"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["mode"] == "jump")
    );
}

#[test]
fn airborne_goal_requires_a_prepared_mark_and_ends_in_flight() {
    let mut input = scene();
    let query=json!({"starts":[{"id":"player","position":[1,0,1],"cost":0,"state":"available"}],"goal":[5,1.5,5],"interaction":{"radius":0.3,"airborne":true}}).to_string();
    assert_eq!(
        Engine::new(&input.to_string())
            .unwrap()
            .solve(&query)
            .unwrap()["route"]["status"],
        "no-verified-route"
    );
    input["marks"] = json!([{"position":[5,1.5,5],"interaction":{"radius":0.3,"airborne":true}}]);
    let result = Engine::new(&input.to_string())
        .unwrap()
        .solve(&query)
        .unwrap();
    assert_eq!(result["route"]["status"], "complete");
    assert_eq!(
        result["route"]["segments"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["mode"],
        "jump"
    );
    assert!(result["route"]["goalHit"]["position"][1].as_f64().unwrap() > 1.);
}

#[test]
fn full_height_collision_wall_cannot_be_crossed_by_search_or_optimization() {
    let mut input = scene();
    input["physical"]["collision"] = json!({
        "positions":[0,0,0,10,0,10,10,0,0,0,0,0,0,0,10,10,0,10,5,0,0,5,10,0,5,10,10,5,0,0,5,10,10,5,0,10],
        "indices":[0,1,2,3,4,5,6,7,8,9,10,11]
    });
    let engine = Engine::new(&input.to_string()).unwrap();
    let result = engine.solve(&query([9., 0., 1.])).unwrap();
    assert_eq!(result["route"]["status"], "no-verified-route");
    assert_eq!(result["diagnostics"]["truncated"], false);
}

#[test]
fn cancellation_is_observed_before_initial_route_search() {
    let engine = Engine::new(&scene().to_string()).unwrap();
    engine.cancel();
    let result = engine.solve(&query([9., 0., 1.])).unwrap();
    assert_eq!(result["diagnostics"]["truncated"], true);
    assert_eq!(result["route"]["status"], "no-verified-route");
}
