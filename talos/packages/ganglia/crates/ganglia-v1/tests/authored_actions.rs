use ganglia_v1::{search, world::World};
use serde_json::{Value, json};
fn scene(raw_floor: bool) -> Value {
    let surfaces = json!([
 {"id":"a","vertices":[[-1.,0.,-1.],[1.,0.,-1.],[1.,0.,1.],[-1.,0.,1.]]},
 {"id":"b","vertices":[[9.,0.,-1.],[11.,0.,-1.],[11.,0.,1.],[9.,0.,1.]]}]);
    let mut positions = vec![];
    let mut indices: Vec<usize> = vec![];
    if raw_floor {
        for s in surfaces.as_array().unwrap() {
            let base = positions.len() / 3;
            for p in s["vertices"].as_array().unwrap() {
                positions.extend([p[0].as_f64().unwrap(), -0.005, p[2].as_f64().unwrap()]);
            }
            indices.extend([base, base + 2, base + 1, base, base + 3, base + 2]);
        }
    }
    let options = json!({"speed":2.,"maxVertical":0.5,"profile":{"radius":0.1,"height":1.8},"walls":[],"connections":[{"id":"authored","mode":"rope","state":"open","points":[[0.,0.,0.],[10.,0.,0.]],"times":[0.,3.]}]});
    let movement = json!({"speed":2.,"maxVertical":0.5,"profile":{"radius":0.1,"height":1.8},"maxSlope":45.,"runAirSpeed":0.,"maxDrop":100.,"maxHorizontalDistance":100.,"model":{"gravity":10.,"fallingGravity":10.,"maxJumpHeight":0.,"maxFallingSpeed":20.,"apexTime":0.,"maxHorizontalSpeed":0.}});
    if raw_floor {
        json!({"kind":"physical","input":{"ground":{"surfaces":surfaces,"options":options},"movement":movement,"collision":{"positions":positions,"indices":indices}}})
    } else {
        json!({"kind":"surfaces","input":{"surfaces":surfaces,"movement":movement,"walls":[],"connections":options["connections"],"collision":{"positions":[],"indices":[]}}})
    }
}
fn assert_authored_route(raw_floor: bool) {
    let w = World::new(scene(raw_floor)).unwrap();
    let query = json!({"starts":[{"id":"start","state":"available","position":[-0.5,0.,0.],"cost":0.}],"goal":[10.5,0.,0.]});
    let result = search::solve(&w, &query, &json!({"maxCandidates":0})).unwrap();
    assert_eq!(result["route"]["status"], "complete", "{result}");
    let segments = result["route"]["segments"].as_array().unwrap();
    let action = segments
        .iter()
        .find(|s| s["connection"] == "authored")
        .unwrap();
    assert_eq!(action["points"], json!([[0., 0., 0.], [10., 0., 0.]]));
    assert_eq!(action["times"], json!([0., 3.]));
    assert!(segments.iter().filter(|s| s["mode"] == "walk").count() >= 2);
    assert_eq!(result["route"]["points"][0], json!([-0.5, 0., 0.]));
    assert_eq!(
        result["route"]["points"]
            .as_array()
            .unwrap()
            .last()
            .unwrap(),
        &json!([10.5, 0., 0.])
    );
}
#[test]
fn surface_only_authored_action_joins_without_witness_mutation() {
    assert_authored_route(false)
}
#[test]
fn physical_authored_feet_join_at_valid_five_mm_clearance() {
    assert_authored_route(true)
}
