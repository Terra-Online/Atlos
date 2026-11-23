use ganglia_v2::Engine;
use serde_json::json;

#[test]
fn collects_below_a_goal_center_higher_than_the_jump_apex() {
    let goal = [0.6, 2.2, 0.5];
    let interaction = json!({"radius":0.3,"airborne":true});
    let input = json!({
        "physical":{
            "ground":{
                "surfaces":[{"vertices":[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]}],
                "options":{"maxVertical":0.5,"profile":{"radius":0.3,"height":1.8},"walls":[]}
            },
            "collision":{"positions":[],"indices":[]},
            "movement":{
                "model":{"gravity":10,"fallingGravity":10,"maxJumpHeight":2,"maxFallingSpeed":20,"apexTime":0,"maxHorizontalSpeed":5,"startHorizontalSpeed":5,"airOverspeedDeceleration":10,"airAcceleration":10,"airDeceleration":10},
                "maxSlope":45,"runAirSpeed":5
            },
            "locomotion":{"speed":5}
        },
        "marks":[{"position":goal,"interaction":interaction}]
    });
    let query = json!({
        "starts":[{"id":"player","position":[0.5,0,0.5],"cost":0,"state":"available"}],
        "goal":goal,"interaction":interaction
    });
    let result = Engine::new(&input.to_string())
        .unwrap()
        .solve(&query.to_string())
        .unwrap();
    let route = &result["route"];
    assert_eq!(route["status"], "complete");
    let terminal = route["segments"].as_array().unwrap().last().unwrap();
    assert_eq!(terminal["mode"], "jump");
    let hit = &route["goalHit"]["position"];
    assert_eq!(terminal["points"].as_array().unwrap().last().unwrap(), hit);
    assert!(hit[1].as_f64().unwrap() <= 2.);
    let distance_squared: f64 = (0..3)
        .map(|axis| (hit[axis].as_f64().unwrap() - goal[axis]).powi(2))
        .sum();
    assert!(distance_squared <= 0.3_f64.powi(2));
}
