use ganglia_v2::Engine;
use serde_json::{Value, json};

fn solve(
    nav: [[f64; 3]; 4],
    collision: &[[[f64; 3]; 4]],
    radius: f64,
    start: [f64; 3],
    goal: [f64; 3],
) -> Value {
    let positions: Vec<_> = collision.iter().flatten().flatten().copied().collect();
    let indices: Vec<_> = (0..collision.len())
        .flat_map(|i| [0, 1, 2, 0, 2, 3].map(|corner| 4 * i + corner))
        .collect();
    let input = json!({"physical": {
        "ground": {
            "surfaces": [{"vertices": nav}],
            "options": {"maxVertical": 0.5, "profile": {"radius": radius, "height": 1.8}, "walls": []}
        },
        "collision": {"positions": positions, "indices": indices},
        "movement": {
            "model": {
                "gravity": 10, "fallingGravity": 10, "maxJumpHeight": 0,
                "maxFallingSpeed": 20, "apexTime": 0, "maxHorizontalSpeed": 5,
                "startHorizontalSpeed": 5, "airOverspeedDeceleration": 10,
                "airAcceleration": 10, "airDeceleration": 10
            },
            "maxSlope": 46,
            "runAirSpeed": 5
        },
        "locomotion": {"speed": 5}
    }});
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
fn walks_up_a_slope_at_capsule_supported_feet_height() {
    let floor = [[-2., -2., -2.], [-2., -2., 2.], [2., 2., 2.], [2., 2., -2.]];
    let route = solve(floor, &[floor], 0.2, [0., 0., 0.], [1., 1., 0.]);
    assert_eq!(route["status"], "complete");
    // On y=x the tangent bottom sphere lifts the feet by r*(sqrt(2)-1).
    let offset = 0.2 * (2_f64.sqrt() - 1.) + 0.005;
    for point in route["points"].as_array().unwrap() {
        let x = point[0].as_f64().unwrap();
        let y = point[1].as_f64().unwrap();
        assert!((y - x - offset).abs() < 1e-7, "{point}");
    }
}

#[test]
fn walks_along_the_edge_of_a_finite_ramp() {
    let ramp = [[-1., -1., -2.], [-1., -1., 2.], [0., 0., 2.], [0., 0., -2.]];
    let route = solve(
        ramp,
        &[ramp],
        0.2,
        [-0.01, -0.01, -0.5],
        [-0.01, -0.01, 0.5],
    );
    assert_eq!(route["status"], "complete");
    // At this XZ the bottom sphere rests on the edge x=0.
    let height = (0.2_f64.powi(2) - 0.01_f64.powi(2)).sqrt() - 0.2 + 0.005;
    for point in route["points"].as_array().unwrap() {
        assert!(
            (point[1].as_f64().unwrap() - height).abs() < 1e-7,
            "{point}"
        );
    }
}

#[test]
fn rejects_a_short_walk_across_a_gap_wider_than_the_capsule() {
    let flat = |left, right| {
        [
            [left, 0., -1.],
            [left, 0., 1.],
            [right, 0., 1.],
            [right, 0., -1.],
        ]
    };
    let route = solve(
        flat(-1., 1.),
        &[flat(-1., -0.025), flat(0.025, 1.)],
        0.02,
        [-0.15, 0., 0.],
        [0.15, 0., 0.],
    );
    assert_eq!(route["status"], "no-verified-route");
}
