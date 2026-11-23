use ganglia_v2::Engine;
use serde_json::json;

#[test]
fn climbs_an_authored_rope_between_supported_floors() {
    let mut input = json!({"physical":{
        "ground":{
            "surfaces":[
                {"vertices":[[0,0,0],[2,0,0],[2,0,2],[0,0,2]]},
                {"vertices":[[2,6,0],[5,6,0],[5,6,2],[2,6,2]]}
            ],
            "options":{"maxVertical":0.5,"profile":{"radius":0.3,"height":1.8},"walls":[]}
        },
        "collision":{
            "positions":[0,0,0,2,0,0,2,0,2,0,0,2,2,6,0,5,6,0,5,6,2,2,6,2],
            "indices":[0,2,1,0,3,2,4,6,5,4,7,6]
        },
        "movement":{
            "model":{"gravity":10,"fallingGravity":10,"maxJumpHeight":2,"maxFallingSpeed":20,"apexTime":0,"maxHorizontalSpeed":5,"startHorizontalSpeed":5,"airOverspeedDeceleration":10,"airAcceleration":10,"airDeceleration":10},
            "maxSlope":45,"runAirSpeed":5
        },
        "locomotion":{"speed":5},
        "devices":{
            "devices":[
                {"id":"bottom","resolved":true,"unitScale":true,"speed":2,"overhead":0.4,
                  "goal":{"position":[1,0,1],"interaction":{"radius":0.25}},"seeds":[[1,0,1]]},
                {"id":"top","resolved":true,"unitScale":true,"speed":2,"overhead":0.4,
                  "goal":{"position":[3,6,1],"interaction":{"radius":0.25}},"seeds":[[3,6,1]]}
            ],
            "ropes":[{"bottom":"bottom","top":"top"}]
        }
    }});
    let query = json!({
        "starts":[{"id":"player","position":[0.5,0,1],"cost":0,"state":"available"}],
        "goal":[4,6,1]
    })
    .to_string();
    let engine = Engine::new(&input.to_string()).unwrap();
    let route = &engine.solve(&query).unwrap()["route"];
    assert_eq!(route["status"], "complete");
    let rope = route["segments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|segment| segment["mode"] == "rope")
        .unwrap();
    assert_eq!(rope["connection"], "rope/bottom/top");
    assert_eq!(rope["points"][0], rope["points"][1]);
    assert_eq!(rope["times"][1], 0.4);
    assert!((rope["times"][4].as_f64().unwrap() - 4.5).abs() < 1e-8);

    input["physical"]["ground"]["options"]["walls"] = json!([
        {"min":[-1,3,-1],"max":[6,4,3],"state":"active"}
    ]);
    let engine = Engine::new(&input.to_string()).unwrap();
    assert_eq!(
        engine.solve(&query).unwrap()["route"]["status"],
        "no-verified-route"
    );
}
