use ganglia_v2::Engine;
use serde_json::{Value, json};

fn route(wall: Value, ground: [[f64; 3]; 4], start: [f64; 3], goal: [f64; 3]) -> Value {
    let input = json!({
        "physical": {
            "ground": {
                "surfaces": [{"vertices": ground}],
                "options": {
                    "maxVertical": 0.5,
                    "profile": {"radius": 0.02, "height": 1.8},
                    "walls": [wall]
                }
            },
            "collision": {"positions": [], "indices": []},
            "movement": {
                "model": {
                    "gravity": 10, "fallingGravity": 10, "maxJumpHeight": 0,
                    "maxFallingSpeed": 20, "apexTime": 0, "maxHorizontalSpeed": 5,
                    "startHorizontalSpeed": 5, "airOverspeedDeceleration": 10,
                    "airAcceleration": 10, "airDeceleration": 10
                },
                "maxSlope": 45,
                "runAirSpeed": 5
            },
            "locomotion": {"speed": 5}
        }
    });
    let query = json!({
        "starts": [{"id": "player", "position": start, "cost": 0, "state": "available"}],
        "goal": goal
    });
    let result = Engine::new(&input.to_string())
        .unwrap()
        .solve(&query.to_string())
        .unwrap();
    result["route"].clone()
}

#[test]
fn walks_inside_the_bounds_of_a_diagonal_wall_with_clearance() {
    let wall = json!({
        "min": [-2, -1, -2], "max": [2, 3, 2], "state": "active",
        "points": [[-2, -2], [2, 2]]
    });
    let ground = [
        [-1.5, 0., 0.5],
        [-0.5, 0., 0.5],
        [-0.5, 0., 1.5],
        [-1.5, 0., 1.5],
    ];
    let route = route(wall, ground, [-1.3, 0., 1.], [-0.7, 0., 1.]);
    assert_eq!(route["status"], "complete");
}

#[test]
fn rejects_a_step_across_a_thin_wall_between_clear_endpoints() {
    let wall = json!({
        "min": [0.035, -1, -0.05], "max": [0.035, 3, 0.05], "state": "unknown",
        "points": [[0.035, -1], [0.035, 1]]
    });
    let ground = [
        [-0.2, 0., 0.4],
        [0.2, 0., 0.4],
        [0.2, 0., 0.6],
        [-0.2, 0., 0.6],
    ];
    let route = route(wall, ground, [-0.15, 0., 0.5], [0.15, 0., 0.5]);
    assert_eq!(route["status"], "no-verified-route");
}
