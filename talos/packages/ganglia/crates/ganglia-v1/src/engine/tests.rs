use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

fn route(a: Point, b: Point) -> Value {
    json!({"status":"complete","start":"a","arrivalCost":0.,"cost":distance(a,b),"length":distance(a,b),"points":[a,b],
    "segments":[{"mode":"walk","points":[a,b],"times":[0.,distance(a,b)]}]})
}
fn input() -> Value {
    json!({"kind":"scene","scene":{"scene":"fixture","walls":[],"navigation":{"surfaces":[
    {"id":"floor","vertices":[[-100.,0.,-10.],[100.,0.,-10.],[100.,0.,10.],[-100.,0.,10.]]}],"options":{"speed":1.,"maxVertical":3.}}},
    "locomotion":{"speed":1.,"sprintSpeed":1.,"sprintAcceleration":1.}})
}
fn query() -> Value {
    json!({"starts":[{"id":"a","position":[0.,0.,0.],"cost":4.,"state":"available"}],"goal":[10.,0.,0.]})
}

fn detoured(world: &World, q: &Value, c: &Value) -> Result<Value, String> {
    let mut result = success(world, q, c)?;
    if q["starts"][0]["position"][0].as_f64() == Some(0.) {
        let a = point(&q["starts"][0]["position"])?;
        let b = point(&q["goal"])?;
        let points = vec![a, [a[0], a[1], 10.], [b[0], b[1], 10.], b];
        let mut times = vec![0.];
        for p in points.windows(2) {
            times.push(times.last().unwrap() + distance(p[0], p[1]));
        }
        result["route"]["points"] = json!(points);
        result["route"]["segments"] = json!([{"mode":"walk","points":points,"times":times}]);
        result["route"]["length"] = json!(times.last().unwrap());
        result["route"]["cost"] =
            json!(times.last().unwrap() + number(&q["starts"][0], "cost", 0.));
    }
    Ok(result)
}

#[test]
fn scene_compares_complete_arrival_costs_after_physical_detours() {
    let mut e = Engine::with_search(json!({}), input(), detoured).unwrap();
    let mut q = query();
    q["starts"] = json!([{"id":"a","position":[0.,0.,0.],"cost":0.,"state":"available"},
        {"id":"b","position":[-10.,0.,0.],"cost":1.,"state":"available"}]);
    let step = e.start(q).unwrap();
    let result = finish(&mut e, step);
    assert_eq!(result["route"]["start"], "b", "{result}");
    assert_eq!(result["route"]["cost"], 21.);
}
fn success(_: &World, q: &Value, _: &Value) -> Result<Value, String> {
    let a = point(&q["starts"][0]["position"])?;
    let b = point(&q["goal"])?;
    let mut r = route(a, b);
    r["start"] = q["starts"][0]["id"].clone();
    r["arrivalCost"] = q["starts"][0]["cost"].clone();
    r["cost"] = json!(distance(a, b) + number(&q["starts"][0], "cost", 0.));
    Ok(json!({"route":r,"connections":[],"diagnostics":{"truncated":false}}))
}
fn snapshot() -> Value {
    json!({"kind":"surfaces","input":{"surfaces":input()["scene"]["navigation"]["surfaces"],
    "walls":[],"collision":{"positions":[],"indices":[]},"movement":{"speed":1.,"maxVertical":3.,"profile":{"radius":0.1,"height":1.},
    "model":{"gravity":9.8,"fallingGravity":9.8,"maxJumpHeight":1.,"maxFallingSpeed":20.,"apexTime":0.5,"maxHorizontalSpeed":3.}}}})
}
fn response(step: &Value, revision: &str, coverage: Value) -> Value {
    json!({"id":step["effect"]["id"],"revision":revision,"coverage":coverage,
    "snapshot":snapshot()})
}
fn finish(e: &mut Engine, mut step: Value) -> Value {
    for _ in 0..200 {
        if step["type"] == "complete" {
            return step["result"].clone();
        }
        step = e
            .resume(response(&step, "r1", json!({"kind":"complete"})))
            .unwrap();
    }
    panic!("Engine did not terminate")
}

#[test]
fn completed_tail_restores_original_arrival_cost_and_queries_are_fresh() {
    let mut e = Engine::with_search(json!({}), input(), success).unwrap();
    let step = e.start(query()).unwrap();
    let first = finish(&mut e, step);
    assert_eq!(first["partial"], false);
    assert_eq!(first["route"]["start"], "a");
    assert_eq!(first["route"]["cost"], 14.);
    let mut next = query();
    next["starts"][0]["cost"] = json!(9.);
    let step = e.start(next).unwrap();
    let second = finish(&mut e, step);
    assert_eq!(second["route"]["cost"], 19.);
    assert_eq!(e.cache.len(), 1);
}

#[test]
fn stale_response_does_not_consume_pending_query() {
    let mut e = Engine::with_search(json!({}), input(), success).unwrap();
    let step = e.start(query()).unwrap();
    let mut stale = response(&step, "r", json!({"kind":"complete"}));
    stale["id"] = json!(999);
    assert!(e.resume(stale).unwrap_err().contains("Stale"));
    assert_eq!(finish(&mut e, step)["route"]["status"], "complete");
}

#[test]
fn revision_and_sparse_coverage_both_invalidate_preparation() {
    let mut e = Engine::with_search(json!({}), input(), success).unwrap();
    let snapshot = snapshot();
    let one = json!({"kind":"sparse","bounds":{"min":[-100,-100],"max":[100,100]},"tileSpan":32,"tiles":[{"x":0,"z":0}]});
    let mut two = one.clone();
    two["tiles"] = json!([{"x":1,"z":0}]);
    let a = e.world(&snapshot, &json!("r1"), &one).unwrap();
    let b = e.world(&snapshot, &json!("r1"), &one).unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    let c = e.world(&snapshot, &json!("r1"), &two).unwrap();
    assert!(!Arc::ptr_eq(&a, &c));
    let d = e.world(&snapshot, &json!("r2"), &two).unwrap();
    assert!(!Arc::ptr_eq(&c, &d));
}

fn fail_walking(world: &World, q: &Value, c: &Value) -> Result<Value, String> {
    if c["physicalWork"]["step"] == 0 {
        return Ok(
            json!({"route":{"status":"no-verified-route"},"reason":"walking-blocked","diagnostics":{"truncated":true}}),
        );
    }
    success(world, q, c)
}
#[test]
fn staged_retries_preserve_truncation_after_success() {
    let mut e = Engine::with_search(json!({}), input(), fail_walking).unwrap();
    let step = e.start(query()).unwrap();
    let result = finish(&mut e, step);
    assert_eq!(result["route"]["status"], "complete");
    assert_eq!(result["diagnostics"]["truncated"], true);
}

fn fail_all(_: &World, _: &Value, _: &Value) -> Result<Value, String> {
    Ok(
        json!({"route":{"status":"no-verified-route"},"reason":"blocked","diagnostics":{"truncated":false}}),
    )
}
static PHYSICAL_FAILURE_CALLS: AtomicUsize = AtomicUsize::new(0);
fn counted_failure(world: &World, query: &Value, config: &Value) -> Result<Value, String> {
    PHYSICAL_FAILURE_CALLS.fetch_add(1, Ordering::SeqCst);
    fail_all(world, query, config)
}
#[test]
fn expanded_requests_do_not_repeat_identical_bounded_physical_searches() {
    PHYSICAL_FAILURE_CALLS.store(0, Ordering::SeqCst);
    let mut engine =
        Engine::with_search(json!({"maxAttempts":1}), input(), counted_failure).unwrap();
    let step = engine.start(query()).unwrap();
    assert_eq!(
        finish(&mut engine, step)["route"]["status"],
        "no-verified-route"
    );
    // Tail and forward have different arrivals. Each needs walking and full
    // discovery once; expanded IO returning the same facts adds no new search.
    assert_eq!(PHYSICAL_FAILURE_CALLS.load(Ordering::SeqCst), 4);
    let step = engine.start(query()).unwrap();
    finish(&mut engine, step);
    assert_eq!(PHYSICAL_FAILURE_CALLS.load(Ordering::SeqCst), 8);

    PHYSICAL_FAILURE_CALLS.store(0, Ordering::SeqCst);
    let mut step = engine.start(query()).unwrap();
    for revision in 0..20 {
        if step["type"] == "complete" {
            break;
        }
        step = engine
            .resume(response(
                &step,
                &format!("revision-{revision}"),
                json!({"kind":"complete"}),
            ))
            .unwrap();
    }
    assert_eq!(step["type"], "complete");
    assert_eq!(
        PHYSICAL_FAILURE_CALLS.load(Ordering::SeqCst),
        8,
        "changed physical facts must repeat the full bounded attempts"
    );
}
#[test]
fn terminal_partial_survives_failed_prefix_and_cancellation_invalidates_effect() {
    let mut e = Engine::with_search(json!({}), input(), fail_all).unwrap();
    let mut q = query();
    q["interaction"] = json!({"airborne":true,"radius":1.});
    let step = e.start(q).unwrap();
    assert_eq!(step["effect"]["kind"], "terminals");
    let terminal = route([9., 0., 0.], [10., 0., 0.]);
    let step = e
        .resume(json!({"id":step["effect"]["id"],"terminals":[{"id":"asset","route":terminal}]}))
        .unwrap();
    assert_eq!(step["effect"]["partial"]["partial"], true);
    let result = e.cancel().unwrap();
    assert_eq!(result["result"]["partial"], true);
    assert_eq!(result["result"]["reason"], "aborted");
    assert!(
        e.resume(response(&step, "r", json!({"kind":"complete"})))
            .is_err()
    );
}

#[test]
fn composition_cannot_reset_sprint_activation_at_window_boundary() {
    let a = route([0., 0., 0.], [1., 0., 0.]);
    let mut b = route([1., 0., 0.], [2., 0., 0.]);
    b["segments"][0]["mode"] = json!("jump");
    b["segments"][0]["requiredGait"] = json!("sprint");
    b["segments"][0]["flight"] = json!({"kind":"flight","control":{"mode":"jump"}});
    let policy = json!({"speed":1.,"sprintSpeed":2.,"sprintAcceleration":100.,"stamina":{"capacity":1.,"initial":1.,"activationCost":1.,"recoveryRate":0.,"recoveryDelay":0.,"reserve":0.}});
    let joined = schedule::compose(&[a, b], &policy).unwrap().unwrap();
    assert_eq!(joined["schedule"].as_array().unwrap().len(), 2);
    assert_eq!(
        joined["segments"].as_array().unwrap().last().unwrap()["flight"]["kind"],
        "flight"
    );
    assert_eq!(joined["locomotion"]["final"], 0.);
    let mut exhausted = policy.clone();
    exhausted["stamina"]["initial"] = json!(0.);
    let a = route([0., 0., 0.], [1., 0., 0.]);
    let mut b = route([1., 0., 0.], [2., 0., 0.]);
    b["segments"][0]["mode"] = json!("jump");
    b["segments"][0]["requiredGait"] = json!("sprint");
    assert!(schedule::compose(&[a, b], &exhausted).unwrap().is_none());
}

#[test]
fn composition_rejects_discontinuity_and_expires_walk_boost() {
    let a = route([0., 0., 0.], [1., 0., 0.]);
    let b = route([2., 0., 0.], [3., 0., 0.]);
    assert!(
        schedule::compose(&[a.clone(), b], &input()["locomotion"])
            .unwrap()
            .is_none()
    );
    let mut a = a;
    let mut b = route([1., 0., 0.], [2., 0., 0.]);
    let boost = json!({"id":"boost","duration":1.5,"multiplier":1.});
    a["segments"][0]["boost"] = boost.clone();
    b["segments"][0]["boost"] = boost;
    b["segments"][0]["boost"]["duration"] = json!(0.5);
    let fact = json!({"id":"boost","duration":1.5,"multiplier":1.,"position":[0.,0.,0.],"interaction":{"radius":0.}});
    let joined = schedule::compose_with_boosts(&[a, b], &input()["locomotion"], &[fact])
        .unwrap()
        .unwrap();
    assert!(joined["segments"].as_array().unwrap().last().unwrap()["boost"].is_null());
    assert!((number(&joined, "cost", 0.) - 2.).abs() < 1e-9);
}

static CALLS: AtomicUsize = AtomicUsize::new(0);
fn trained(w: &World, q: &Value, c: &Value) -> Result<Value, String> {
    CALLS.fetch_add(1, Ordering::SeqCst);
    let mut r = success(w, q, c)?;
    r["connections"] = json!([{"id":"action","state":"open","mode":"jump","points":[[0,0,0],[1,0,0]],"times":[0,1]}]);
    Ok(r)
}
#[test]
fn catalog_freeze_stops_training_without_caching_queries() {
    let mut e = Engine::with_search(json!({}), input(), trained).unwrap();
    e.catalog("train").unwrap();
    let step = e.start(query()).unwrap();
    finish(&mut e, step);
    let stats = e.catalog("freeze").unwrap();
    assert_eq!(stats["actions"], 1);
    let before = CALLS.load(Ordering::SeqCst);
    let step = e.start(query()).unwrap();
    finish(&mut e, step);
    assert!(CALLS.load(Ordering::SeqCst) > before);
    assert_eq!(e.catalog("stats").unwrap()["actions"], 1);
    assert!(e.catalog("train").is_err());
    e.close();
    e.close();
    assert!(e.start(query()).is_err());
}

#[test]
fn invalid_budgets_are_rejected_before_any_query() {
    for (key, value) in [
        ("maxCandidates", json!(-1)),
        ("maxShortcutCandidates", json!(0.5)),
        ("maxLinks", json!(0)),
        ("batchConcurrency", json!(0)),
        ("maxAttempts", json!(9_007_199_254_740_992_u64)),
        ("maxTiles", json!(513)),
        ("sampleSpacing", json!(0)),
        ("margin", Value::Null),
        ("maxTargetError", json!(-0.1)),
    ] {
        let mut config = json!({});
        config[key] = value;
        assert!(
            Engine::with_search(config, input(), success).is_err(),
            "accepted invalid {key}"
        );
    }
    assert!(
        Engine::with_search(
            json!({"maxTargetError":0,"maxCandidates":0,"maxShortcutCandidates":0}),
            input(),
            success
        )
        .is_ok()
    );
}

#[test]
fn cached_snapshot_miss_allows_full_resend_of_same_effect() {
    let mut e = Engine::with_search(json!({}), input(), success).unwrap();
    let step = e.start(query()).unwrap();
    let mut cached = response(&step, "new-revision", json!({"kind":"complete"}));
    cached["snapshot"] = json!({"cached":true});
    assert_eq!(e.resume(cached).unwrap_err(), "Native snapshot cache miss");
    assert_eq!(finish(&mut e, step)["route"]["status"], "complete");
}

fn short_windows(w: &World, q: &Value, c: &Value) -> Result<Value, String> {
    // A 100 m guide is densified at 16 2/3 m intervals under the default
    // 38.4 m tile width. The fixture accepts one interval, rejects longer work.
    if distance(point(&q["starts"][0]["position"])?, point(&q["goal"])?) > 18. {
        return fail_all(w, q, c);
    }
    success(w, q, c)
}
#[test]
fn failed_long_window_expands_then_subdivides_without_rejecting_arrival() {
    let mut e = Engine::with_search(json!({"maxTiles":512}), input(), short_windows).unwrap();
    let mut q = query();
    q["goal"] = json!([100., 0., 0.]);
    let mut step = e.start(q).unwrap();
    let mut expanded = false;
    let mut nearer = false;
    for _ in 0..500 {
        if step["type"] == "complete" {
            break;
        }
        expanded |= number(&step["effect"], "margin", 0.) == 16.;
        if let Ok(target) = point(&step["effect"]["target"]) {
            nearer |= target[0] > 0. && target[0] < 20.;
        }
        step = e
            .resume(response(&step, "same-world", json!({"kind":"complete"})))
            .unwrap();
    }
    assert!(expanded && nearer);
    assert_eq!(step["result"]["route"]["status"], "complete");
    assert_eq!(step["result"]["diagnostics"]["candidateAttempts"], 1);
    assert_eq!(step["result"]["partial"], false);
    assert!((number(&step["result"]["route"], "cost", 0.) - 104.).abs() < 1e-6);
}

#[test]
fn waypoint_consumption_observes_trace_order_and_vertical_intervals() {
    let waypoints = vec![json!([8., 0., 0.]), json!([2., 0., 0.])];
    assert_eq!(
        consume_waypoints(&[[0., 0., 0.], [10., 0., 0.]], &waypoints, 0, 0.1, 0.1).unwrap(),
        1
    );
    assert_eq!(
        consume_waypoints(
            &[[0., 0., 0.], [10., 0., 0.], [0., 0., 0.]],
            &waypoints,
            0,
            0.1,
            0.1
        )
        .unwrap(),
        2
    );
    let vertical = vec![json!([0., 8., 0.]), json!([0., 2., 0.])];
    assert_eq!(
        consume_waypoints(&[[0., 0., 0.], [0., 10., 0.]], &vertical, 0, 0.1, 0.1).unwrap(),
        1
    );
}

#[test]
fn native_scene_walk_emits_replayable_schedule_and_pays_arrival_once() {
    let mut snapshot = snapshot();
    let vertices = snapshot["input"]["surfaces"][0]["vertices"]
        .as_array()
        .unwrap()
        .clone();
    snapshot["input"]["collision"] = json!({"positions":vertices.iter().flat_map(|p|point(p).unwrap()).collect::<Vec<_>>(),"indices":[0,2,1,0,3,2]});
    snapshot["input"]["movement"]["locomotion"] = input()["locomotion"].clone();
    let mut e = Engine::new(
        json!({"maxCandidates":0,"maxShortcutCandidates":0}),
        input(),
    )
    .unwrap();
    let mut step = e.start(query()).unwrap();
    let mut loads = 0;
    for _ in 0..30 {
        if step["type"] == "complete" {
            break;
        }
        loads += 1;
        step=e.resume(json!({"id":step["effect"]["id"],"snapshot":snapshot,"revision":"floor-v1","coverage":{"kind":"complete"}})).unwrap();
    }
    assert_eq!(step["type"], "complete");
    assert_eq!(
        loads, 1,
        "a canonical feet offset must not cause a repeated full-query physical load"
    );
    let result = &step["result"];
    assert_eq!(result["route"]["status"], "complete");
    assert_eq!(result["partial"], false);
    assert_eq!(result["route"]["arrivalCost"], 4.);
    assert!(
        result["route"]["schedule"]
            .as_array()
            .is_some_and(|s| !s.is_empty())
    );
    let route = &result["route"];
    let seconds = route["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            s["times"]
                .as_array()
                .unwrap()
                .last()
                .unwrap()
                .as_f64()
                .unwrap()
        })
        .sum::<f64>();
    assert!((number(route, "cost", 0.) - seconds - 4.).abs() < 1e-9);
    assert_eq!(
        e.cache.front().unwrap().world.snapshot()["coverage"],
        "complete"
    );
}

#[test]
fn composition_preserves_late_sprint_controls_across_piece_boundaries() {
    let mut a = route([0., 0., 0.], [10., 0., 0.]);
    a["segments"][0]["gait"] = json!("run");
    a["schedule"] = json!([{"segments":a["segments"],"allowSprint":false,"allowDash":false}]);
    let mut b = route([10., 0., 0.], [12., 0., 0.]);
    b["points"] = json!([
        [10., 0., 0.],
        [10.015, 0., 0.],
        [11., 0., 0.],
        [12., 0., 0.]
    ]);
    let sprint = json!({"mode":"walk","points":[[10.,0.,0.],[10.015,0.,0.],[11.,0.,0.]],"times":[0.,0.01,0.5025],"gait":"sprint"});
    let jump = json!({"mode":"jump","requiredGait":"sprint","points":[[11.,0.,0.],[12.,0.,0.]],"times":[0.,1.]});
    b["segments"] = json!([sprint, jump]);
    b["schedule"] = json!([
        {"segments":[{"mode":"walk","points":[[10.,0.,0.],[11.,0.,0.]],"times":[0.,1.]}],"allowSprint":true,"allowDash":false},
        {"segments":[jump],"allowSprint":true,"allowDash":false}]);
    let policy = json!({"speed":1.,"sprintSpeed":2.,"sprintAcceleration":100.,"stamina":{"capacity":1.,"initial":1.,"activationCost":0.,"sprintDrain":1.,"recoveryRate":0.,"recoveryDelay":0.,"reserve":0.}});
    let joined = schedule::compose(&[a, b], &policy)
        .unwrap()
        .expect("run 10m, then sprint 1m before takeoff is feasible");
    assert!((number(&joined, "cost", 0.) - 11.5025).abs() < 1e-9);
    assert!((number(&joined["locomotion"], "final", 0.) - 0.4975).abs() < 1e-9);
    assert_eq!(joined["schedule"][0]["allowSprint"], false);
    assert_eq!(
        joined["segments"].as_array().unwrap().last().unwrap()["requiredGait"],
        "sprint"
    );
}

#[test]
fn supplied_schedules_cannot_reset_stamina_between_pieces() {
    let mut pieces = vec![];
    for offset in [0., 2.] {
        let mut piece = route([offset, 0., 0.], [offset + 2., 0., 0.]);
        let walk = json!({"mode":"walk","points":[[offset,0.,0.],[offset+1.,0.,0.]],"times":[0.,0.5025],"gait":"sprint"});
        let jump = json!({"mode":"jump","requiredGait":"sprint","points":[[offset+1.,0.,0.],[offset+2.,0.,0.]],"times":[0.,1.]});
        piece["points"] = json!([
            [offset, 0., 0.],
            [offset + 1., 0., 0.],
            [offset + 2., 0., 0.]
        ]);
        piece["segments"] = json!([walk, jump]);
        piece["schedule"] = json!([
            {"segments":[{"mode":"walk","points":[[offset,0.,0.],[offset+1.,0.,0.]],"times":[0.,1.]}],"allowSprint":true,"allowDash":false},
            {"segments":[jump],"allowSprint":true,"allowDash":false}]);
        pieces.push(piece);
    }
    let policy = json!({"speed":1.,"sprintSpeed":2.,"sprintAcceleration":100.,"stamina":{"capacity":1.,"initial":1.,"activationCost":1.,"recoveryRate":0.,"recoveryDelay":0.,"reserve":0.}});
    assert!(schedule::compose(&pieces[..1], &policy).unwrap().is_some());
    assert!(schedule::compose(&pieces[1..], &policy).unwrap().is_some());
    assert!(
        schedule::compose(&pieces, &policy).unwrap().is_none(),
        "two required activations cannot share one unit of nonrecovering stamina"
    );
}

#[test]
fn boost_expiry_keeps_a_slower_feasible_schedule() {
    let boost = json!({"id":"boost","duration":5.,"multiplier":1.});
    let mut a = route([0., 0., 0.], [4., 0., 0.]);
    a["segments"][0]["boost"] = boost.clone();
    let mut b = route([4., 0., 0.], [5., 0., 0.]);
    b["segments"][0]["mode"] = json!("jump");
    b["segments"][0]["times"] = json!([0., 3.]);
    b["segments"][0]["boost"] = boost;
    b["segments"][0]["boost"]["duration"] = json!(1.);
    b["segments"][0]["boostExpiry"] = json!(1.);
    let policy = json!({"speed":1.,"sprintSpeed":2.,"sprintAcceleration":100.});
    let fact = json!({"id":"boost","duration":5.,"multiplier":1.,"position":[0.,0.,0.],"interaction":{"radius":0.}});
    let joined = schedule::compose_with_boosts(&[a, b], &policy, &[fact])
        .unwrap()
        .expect("running for 4s preserves the in-flight expiry at 5s");
    assert!((number(&joined, "cost", 0.) - 7.).abs() < 1e-9);
    assert_eq!(joined["schedule"][0]["allowSprint"], false);
}

#[test]
fn remaining_boost_metadata_is_not_double_charged_and_rides_advance_time() {
    let boost = json!({"id":"boost","duration":3.,"multiplier":2.});
    let mut first = route([0., 0., 0.], [2., 0., 0.]);
    first["segments"][0]["boost"] = boost.clone();
    let mut ride = route([2., 0., 0.], [4., 0., 0.]);
    ride["segments"][0]["mode"] = json!("rope");
    ride["segments"][0]["times"] = json!([0., 0.5]);
    let mut last = route([4., 0., 0.], [6., 0., 0.]);
    last["segments"][0]["boost"] = boost;
    last["segments"][0]["boost"]["duration"] = json!(1.5);
    let mut fact = json!({"id":"boost","duration":3.,"multiplier":2.,"position":[0.,0.,0.],"interaction":{"radius":0.}});
    let pieces = vec![first, ride, last];
    let joined = schedule::compose_with_boosts(&pieces, &input()["locomotion"], &[fact.clone()])
        .unwrap()
        .unwrap();
    assert!((number(&joined, "cost", 0.) - 2.5).abs() < 1e-9);
    assert!(joined["segments"][1]["boost"].is_null());
    assert!((number(&joined["segments"][2]["boost"], "duration", 0.) - 1.5).abs() < 1e-9);
    // The same authored ride consumes the final quarter second of a shorter
    // buff. The following walk remains feasible at ordinary speed.
    fact["duration"] = json!(1.25);
    let expired = schedule::compose_with_boosts(&pieces, &input()["locomotion"], &[fact])
        .unwrap()
        .unwrap();
    assert!((number(&expired, "cost", 0.) - 3.5).abs() < 1e-9);
    assert!(expired["segments"].as_array().unwrap().last().unwrap()["boost"].is_null());
}

#[test]
fn pickup_time_follows_the_selected_retimed_trace() {
    let mut before = route([0., 0., 0.], [2., 0., 0.]);
    before["segments"][0]["gait"] = json!("run");
    before["schedule"] =
        json!([{"segments":before["segments"],"allowSprint":false,"allowDash":false}]);
    let mut boosted = route([2., 0., 0.], [4., 0., 0.]);
    boosted["segments"][0]["boost"] = json!({"id":"boost","multiplier":2.,"duration":1.});
    boosted["segments"][0]["gait"] = json!("run");
    boosted["segments"][0]["times"] = json!([0., 1.]);
    boosted["schedule"] =
        json!([{"segments":boosted["segments"],"allowSprint":false,"allowDash":false}]);
    let fact = json!({"id":"boost","multiplier":2.,"duration":1.,"position":[2.,0.,0.],"interaction":{"radius":0.5}});
    let policy = json!({"speed":1.,"sprintSpeed":2.,"sprintAcceleration":100.});
    let joined = schedule::compose_with_boosts(&[before, boosted], &policy, &[fact])
        .unwrap()
        .unwrap();
    // The chosen sprint reaches x=1.5 at 0.7525s and the centre at 1.0025s.
    // Its remaining boost at the second segment is therefore 0.75s, independent
    // of the slower supplied prefix's 1.5s first-hit time.
    assert!((number(&joined, "cost", 0.) - 1.5075).abs() < 1e-9);
    assert!(
        (number(
            &joined["schedule"][1]["segments"][0]["boost"],
            "duration",
            0.
        ) - 0.75)
            .abs()
            < 1e-9
    );
    assert!((number(&joined["boosts"][0], "elapsed", 0.) - 0.755).abs() < 1e-9);
}

fn fresh_sprint_each_window(w: &World, q: &Value, c: &Value) -> Result<Value, String> {
    let mut result = success(w, q, c)?;
    let a = point(&q["starts"][0]["position"])?;
    let b = point(&q["goal"])?;
    let middle = lerp(a, b, 0.5);
    result["route"]["points"] = json!([a, middle, b]);
    result["route"]["segments"] = json!([
        {"mode":"walk","points":[a,middle],"times":[0.,distance(a,middle)]},
        {"mode":"jump","requiredGait":"sprint","points":[middle,b],"times":[0.,1.]}
    ]);
    Ok(result)
}
#[test]
fn whole_route_resource_failure_rejects_arrival_without_a_spatial_window() {
    let mut source = input();
    source["locomotion"] = json!({"speed":1.,"sprintSpeed":2.,"sprintAcceleration":100.,"stamina":{
        "capacity":1.,"initial":1.,"activationCost":1.,"recoveryRate":0.,"recoveryDelay":0.,"reserve":0.}});
    let mut engine = Engine::with_search(
        json!({"maxAttempts":1,"tileSpan":16,"gridSpan":8,"maxTiles":4,"margin":1}),
        source,
        fresh_sprint_each_window,
    )
    .unwrap();
    let mut request = query();
    request["goal"] = json!([60., 0., 0.]);
    let step = engine.start(request).unwrap();
    let result = finish(&mut engine, step);
    assert_eq!(
        result["partial"], true,
        "the feasible tail survives failure of the whole resource schedule"
    );
    assert_eq!(result["diagnostics"]["truncated"], true);
}

#[test]
fn provided_controls_preserve_trace_and_allow_improvement() {
    let mut piece = route([0., 0., 0.], [2., 0., 0.]);
    piece["points"] = json!([[0., 0., 0.], [1., 0., 1.], [2., 0., 0.]]);
    piece["segments"][0]["points"] = piece["points"].clone();
    piece["segments"][0]["times"] = json!([0., 2_f64.sqrt(), 2. * 2_f64.sqrt()]);
    piece["schedule"] = json!([{"segments":[{"mode":"walk","points":[[0.,0.,0.],[2.,0.,0.]],"times":[0.,2.]}],"allowSprint":false,"allowDash":false}]);
    assert_eq!(
        schedule::compose(&[piece], &input()["locomotion"]).unwrap_err(),
        "Route schedule changes the physical trace"
    );
    let mut valid = route([0., 0., 0.], [2., 0., 0.]);
    valid["schedule"] =
        json!([{"segments":valid["segments"],"allowSprint":false,"allowDash":false}]);
    let policy = json!({"speed":1.,"sprintSpeed":2.,"sprintAcceleration":100.});
    let improved = schedule::compose(&[valid], &policy).unwrap().unwrap();
    assert!(number(&improved, "cost", 2.) < 2.);
    assert_eq!(improved["schedule"][0]["allowSprint"], true);
}

fn error_on_later_arrival(w: &World, q: &Value, c: &Value) -> Result<Value, String> {
    if point(&q["starts"][0]["position"])?[0] > 20. {
        Err("later alternative failed".into())
    } else {
        success(w, q, c)
    }
}
#[test]
fn completed_incumbent_survives_an_error_in_an_alternative_arrival() {
    let mut e =
        Engine::with_search(json!({"maxAttempts":2}), input(), error_on_later_arrival).unwrap();
    let mut q = query();
    q["starts"][0]["cost"] = json!(0.);
    q["starts"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"b","position":[30.,0.,0.],"cost":1.,"state":"available"}));
    let step = e.start(q).unwrap();
    let result = finish(&mut e, step);
    assert_eq!(result["route"]["status"], "complete");
    assert_eq!(result["route"]["start"], "a");
    assert_eq!(result["route"]["cost"], 10.);
    assert_eq!(result["diagnostics"]["truncated"], true);
    assert_eq!(result["diagnostics"]["candidateAttempts"], 2);
}

#[test]
fn explicit_ground_range_keeps_its_own_forward_projection_pass() {
    let mut e = Engine::with_search(json!({}), input(), success).unwrap();
    let mut q = query();
    q["starts"][0]["groundRange"] = json!([2, 4]);
    let tail = e.start(q).unwrap();
    assert_eq!(tail["effect"]["arrival"]["id"], "target-approach");
    let forward = e
        .resume(response(&tail, "r1", json!({"kind":"complete"})))
        .unwrap();
    assert_eq!(forward["type"], "load");
    assert_eq!(forward["effect"]["arrival"]["id"], "a");
    assert_eq!(forward["effect"]["arrival"]["groundRange"], json!([2, 4]));
    assert_eq!(finish(&mut e, forward)["partial"], false);
}

#[test]
fn terminal_selection_composes_prefix_with_goal_event_and_witness() {
    let mut e = Engine::with_search(json!({}), input(), success).unwrap();
    let mut q = query();
    q["interaction"] = json!({"airborne":true,"radius":0.5});
    let step = e.start(q).unwrap();
    let mut expensive = route([8., 0., 0.], [10., 0., 0.]);
    expensive["cost"] = json!(100.);
    let mut terminal = route([9., 0., 0.], [10., 0., 0.]);
    terminal["segments"][0]["mode"] = json!("jump");
    terminal["segments"][0]["flight"] = json!({"kind":"flight","start":[9,0,0],"end":[10,0,0]});
    terminal["goalHit"] = json!({"segment":0,"time":1.,"position":[10.,0.,0.]});
    let step=e.resume(json!({"id":step["effect"]["id"],"terminals":[{"id":"expensive","route":expensive},{"id":"selected","route":terminal}]})).unwrap();
    assert_eq!(step["effect"]["target"], json!([9., 0., 0.]));
    let result = finish(&mut e, step);
    assert_eq!(result["partial"], false);
    assert_eq!(result["route"]["cost"], 14.);
    assert_eq!(result["route"]["goalHit"]["segment"], 1);
    assert_eq!(result["route"]["segments"][1]["flight"]["kind"], "flight");
}

fn second_arrival(w: &World, q: &Value, c: &Value) -> Result<Value, String> {
    if q["starts"][0]["id"] != "b" {
        fail_all(w, q, c)
    } else {
        success(w, q, c)
    }
}
#[test]
fn failed_arrival_is_query_local_and_alternative_gets_a_fresh_attempt() {
    let mut e = Engine::with_search(json!({"maxAttempts":2}), input(), second_arrival).unwrap();
    let mut q = query();
    q["starts"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"b","position":[1.,0.,0.],"cost":20.,"state":"available"}));
    let step = e.start(q).unwrap();
    let result = finish(&mut e, step);
    assert_eq!(result["route"]["status"], "complete");
    assert_eq!(result["route"]["start"], "b");
    assert_eq!(result["diagnostics"]["candidateAttempts"], 2);
    // A new query must try a again; a previous bounded failure is no global
    // reachability certificate and may never populate the prepared cache.
    let step = e.start(query()).unwrap();
    assert_eq!(step["effect"]["kind"], "window");
}

#[test]
fn terminal_partial_is_retained_without_any_coarse_prefix() {
    let mut scene = input();
    scene["scene"]["navigation"]["surfaces"] = json!([]);
    let mut e = Engine::with_search(json!({}), scene, fail_all).unwrap();
    let mut q = query();
    q["interaction"] = json!({"airborne":true,"radius":0.5});
    let step = e.start(q).unwrap();
    let terminal = route([9., 0., 0.], [10., 0., 0.]);
    let result = e
        .resume(json!({"id":step["effect"]["id"],"terminals":[{"id":"target","route":terminal}]}))
        .unwrap();
    assert_eq!(result["type"], "complete");
    assert_eq!(result["result"]["partial"], true);
    assert_eq!(result["result"]["route"], terminal);
    assert_eq!(result["result"]["reason"], "no-global-candidate");
}

fn blocked_first_terminal(w: &World, q: &Value, c: &Value) -> Result<Value, String> {
    if q["goal"][0].as_f64() == Some(9.) {
        fail_all(w, q, c)
    } else {
        success(w, q, c)
    }
}
#[test]
fn failed_cheapest_terminal_reveals_an_alternative_within_shared_budget() {
    let mut e =
        Engine::with_search(json!({"maxAttempts":2}), input(), blocked_first_terminal).unwrap();
    let mut q = query();
    q["starts"][0]["cost"] = json!(0.);
    q["interaction"] = json!({"airborne":true,"radius":0.5});
    let step = e.start(q).unwrap();
    let step = e
        .resume(json!({"id":step["effect"]["id"],"terminals":[
        {"id":"blocked","route":route([9.,0.,0.],[10.,0.,0.])},
        {"id":"reachable","route":route([8.,0.,0.],[10.,0.,0.])}]}))
        .unwrap();
    let result = finish(&mut e, step);
    assert_eq!(result["partial"], false, "{result}");
    assert!(
        route_points(&result["route"])
            .unwrap()
            .contains(&[8., 0., 0.])
    );
    assert_eq!(result["diagnostics"]["candidateAttempts"], 2);
}

#[test]
fn composition_deduplicates_identical_placements_and_rejects_conflicting_poses() {
    let mut a = route([0., 0., 0.], [1., 0., 0.]);
    let mut b = route([1., 0., 0.], [2., 0., 0.]);
    a["placements"] = json!([{"device":"box","position":[1.,0.,0.]}]);
    b["placements"] = a["placements"].clone();
    let policy = json!({"speed":1.,"sprintSpeed":1.,"sprintAcceleration":1.});
    let joined = schedule::compose(&[a.clone(), b.clone()], &policy)
        .unwrap()
        .unwrap();
    assert_eq!(joined["placements"].as_array().unwrap().len(), 1);
    b["placements"][0]["position"] = json!([2., 0., 0.]);
    assert!(schedule::compose(&[a, b], &policy).unwrap().is_none());
}

#[test]
fn continuation_comes_from_selected_retimed_prefix_and_keeps_expired_pickup_used() {
    let policy = json!({"speed":1.,"sprintSpeed":2.,"sprintAcceleration":10.,"stamina":{
        "capacity":4.,"initial":4.,"activationCost":0.,"sprintDrain":1.,"recoveryRate":0.,"recoveryDelay":0.,"reserve":0.}});
    let fact = json!({"id":"boost","duration":0.1,"multiplier":2.,"position":[0.,0.,0.],"interaction":{"radius":0.}});
    let mut piece = route([0., 0., 0.], [2., 0., 0.]);
    piece["segments"][0]["boost"] = json!({"id":"boost","duration":0.1,"multiplier":2.});
    let facts = [fact];
    let result = schedule::compose_state(&[piece], &policy, &facts, &Value::Null)
        .unwrap()
        .unwrap();
    assert_eq!(
        result.continuation["resource"]["energy"],
        result.route["locomotion"]["final"]
    );
    assert!(number(&result.continuation["resource"], "energy", 4.) < 4.);
    assert_eq!(result.continuation["usedBoost"], "boost");
    assert!(result.continuation["boost"].is_null());
    // Materialized expiry seams permit additional controls on a later pass.
    // The supplied feasible schedule must remain an incumbent while per-entry
    // remaining metadata is rebound to the selected clocks.
    let repeated = schedule::compose_state(
        std::slice::from_ref(&result.route),
        &policy,
        &facts,
        &Value::Null,
    )
    .unwrap()
    .unwrap();
    assert!(number(&repeated.route, "cost", 0.) <= number(&result.route, "cost", 0.) + 1e-6);
}

fn placement_replay_snapshot() -> Value {
    let vertices = vec![
        [-20., 0., -2.],
        [20., 0., -2.],
        [20., 0., 2.],
        [-20., 0., 2.],
    ];
    let body = (0..8)
        .map(|bits| {
            [
                if bits & 1 != 0 { 0.5 } else { -0.5 },
                if bits & 2 != 0 { 0.4 } else { 0. },
                if bits & 4 != 0 { 0.5 } else { -0.5 },
            ]
        })
        .collect::<Vec<_>>();
    json!({"kind":"physical","input":{
        "ground":{"surfaces":[{"id":"floor","vertices":vertices}],"options":{"speed":8.,"maxVertical":0.5,"walls":[],"profile":{"radius":0.1,"height":1.}}},
        "collision":{"positions":vertices.into_iter().flatten().collect::<Vec<_>>(),"indices":[0,2,1,0,3,2]},
        "movement":{"model":{"gravity":10.,"fallingGravity":20.,"maxJumpHeight":0.5,"maxFallingSpeed":20.,"apexTime":0.1,"maxHorizontalSpeed":8.,"startHorizontalSpeed":8.,"airAcceleration":30.,"airDeceleration":30.,"airOverspeedDeceleration":5.},"maxSlope":45.,"runAirSpeed":8.,"stepUp":0.3,"stepDown":0.3},
        "locomotion":{"speed":8.,"sprintSpeed":8.,"sprintAcceleration":10.},
        "devices":{"devices":[],"ropes":[],"followingSupports":[{"id":"box","spawn":[0.,0.,0.],"bodies":[body],"geometryKind":"box","maxDistance":10.,"initialState":0.,"assumption":"placement-within-activity-range"}]}
    }})
}
fn flight_fragment(connection: crate::model::Connection, arrival: &Value) -> Value {
    let seconds = connection.duration();
    let points = connection.points.clone();
    json!({"status":"complete","start":arrival["id"],"arrivalCost":arrival["cost"],
        "cost":seconds+number(arrival,"cost",0.),"length":crate::world::path_length(&points),
        "points":points,"segments":[serde_json::to_value(connection).unwrap()]})
}
fn move_box_after_takeoff(w: &World, q: &Value, _: &Value) -> Result<Value, String> {
    let arrival = &q["starts"][0];
    let start = point(&arrival["position"])?;
    let end = point(&q["goal"])?;
    let mut route = if start[1] > 0.3 {
        let landing = w.standing_foot(end)?.ok_or("Missing native landing")?;
        flight_fragment(
            w.flight(start, landing, crate::model::Mode::Jump)?
                .ok_or("Missing native flight")?,
            arrival,
        )
    } else {
        let path = w
            .ground_path(start, end)?
            .ok_or("Missing native ground path")?;
        let mut times = vec![0.];
        for pair in path.points.windows(2) {
            times.push(times.last().unwrap() + distance(pair[0], pair[1]) / 8.);
        }
        json!({"status":"complete","start":arrival["id"],"arrivalCost":arrival["cost"],"cost":number(arrival,"cost",0.)+times.last().unwrap(),"length":path.length,
            "points":path.points,"segments":[{"mode":"walk","points":path.points,"times":times}]})
    };
    if start[0] > 0.5 && start[0] < 10. {
        route["placements"] = json!([{"device":"box","position":[-4.,0.,0.]}]);
    }
    Ok(json!({"route":route,"connections":[],"diagnostics":{"truncated":false}}))
}

#[test]
fn later_placement_rejects_an_earlier_first_segment_jump_from_the_default_roof() {
    let snapshot = placement_replay_snapshot();
    let world = World::new(snapshot.clone()).unwrap();
    let flight = world
        .flight([0., 0.41, 0.], [4., 0.01, 0.], crate::model::Mode::Jump)
        .unwrap()
        .unwrap();
    let moved = world
        .with_placements(&[json!({"device":"box","position":[-4.,0.,0.]})])
        .unwrap()
        .unwrap();
    assert!(
        flight
            .points
            .windows(2)
            .all(|p| moved.clear(p[0], p[1], 0.).unwrap()),
        "collision-only chord replay misses the lost takeoff support"
    );
    let mut scene = input();
    scene["scene"]["navigation"]["surfaces"] = snapshot["input"]["ground"]["surfaces"].clone();
    scene["locomotion"] = snapshot["input"]["locomotion"].clone();
    let mut engine = Engine::with_search(
        json!({"tileSpan":8.,"gridSpan":4.,"maxTiles":4,"margin":0.5,"maxAttempts":2}),
        scene,
        move_box_after_takeoff,
    )
    .unwrap();
    let mut q = query();
    q["starts"][0]["position"] = json!([0., 0.41, 0.]);
    q["goal"] = json!([16., 0., 0.]);
    let mut step = engine.start(q).unwrap();
    for _ in 0..50 {
        if step["type"] == "complete" {
            break;
        }
        step=engine.resume(json!({"id":step["effect"]["id"],"snapshot":snapshot,"revision":"placement-support","coverage":{"kind":"complete"}})).unwrap();
    }
    assert_eq!(step["type"], "complete");
    assert_eq!(step["result"]["partial"], true, "{step}");
    assert_eq!(step["result"]["reason"], "placement-invalidates-prefix");
}

#[test]
fn earlier_piece_replay_forwards_collection_geometry_and_ignores_the_unused_future() {
    let snapshot = placement_replay_snapshot();
    let world = World::new(snapshot.clone()).unwrap();
    let start = [-8., 0.01, 0.];
    let end = [-3., 0.01, 0.];
    let full = world
        .flight(start, end, crate::model::Mode::Jump)
        .unwrap()
        .unwrap();
    let goal = full.points[full.points.len() / 3];
    let interaction = crate::model::Interaction {
        radius: 0.1,
        airborne: true,
        ..Default::default()
    };
    let flight = world
        .flight_to_goal(
            start,
            end,
            &world.movement.model,
            &crate::world::FlightControl::default(),
            goal,
            &interaction,
        )
        .unwrap()
        .unwrap();
    let time = flight.duration();
    let position = *flight.points.last().unwrap();
    let mut route = flight_fragment(flight, &json!({"id":"approach","cost":0.}));
    route["goalHit"] = json!({"segment":0,"time":time,"position":position});
    let mut changed = snapshot;
    changed["input"]["ground"]["options"]["walls"] =
        json!([{"min":[-4.,0.,-1.],"max":[-3.9,4.,1.],"state":"active"}]);
    let changed = World::new(changed).unwrap();
    assert!(
        trace_clear(
            &changed,
            &route,
            &json!({"goal":goal,"interaction":interaction})
        )
        .unwrap()
    );
    assert!(
        !trace_clear(&changed, &route, &json!({"goal":goal})).unwrap(),
        "without collection authority the unsafe future must be rejected"
    );
}

static TERMINAL_PREFIX_SOLVES: AtomicUsize = AtomicUsize::new(0);
fn prefix_selects_distant_box(w: &World, q: &Value, c: &Value) -> Result<Value, String> {
    if q["interaction"]["airborne"] == true {
        return fail_all(w, q, c);
    }
    TERMINAL_PREFIX_SOLVES.fetch_add(1, Ordering::Relaxed);
    let placement = json!({"device":"box","position":[-12.,0.,0.]});
    let placed = w
        .with_placements(std::slice::from_ref(&placement))?
        .ok_or("Missing prefix placement")?;
    let arrival = &q["starts"][0];
    let start = point(&arrival["position"])?;
    let end = placed
        .standing_foot(point(&q["goal"])?)?
        .ok_or("Missing terminal entry")?;
    let landing = [-10., 0.01, end[2]];
    let flight = placed
        .flight(start, landing, crate::model::Mode::Jump)?
        .ok_or("Missing prefix descent")?;
    let first = flight_fragment(flight, arrival);
    let path = placed
        .ground_path(landing, end)?
        .ok_or("Missing prefix walk")?;
    let mut times = vec![0.];
    for pair in path.points.windows(2) {
        times.push(times.last().unwrap() + distance(pair[0], pair[1]) / 8.);
    }
    let second = json!({"status":"complete","start":arrival["id"],"arrivalCost":0.,"cost":times.last().unwrap(),"length":path.length,
        "points":path.points,"segments":[{"mode":"walk","points":path.points,"times":times}]});
    let mut route = schedule::compose(&[first, second], &w.snapshot()["input"]["locomotion"])?
        .ok_or("Missing prefix schedule")?;
    route["placements"] = json!([placement]);
    Ok(json!({"route":route,"connections":[],"diagnostics":{"truncated":false}}))
}

#[test]
fn future_terminal_is_replayed_after_prefix_poses_change_its_original_scene() {
    for (lost_roof, sparse_prefix) in [(true, false), (false, false), (false, true)] {
        let mut snapshot = placement_replay_snapshot();
        snapshot["input"]["devices"]["followingSupports"][0]["maxDistance"] = json!(20.);
        let original = World::new(snapshot.clone()).unwrap();
        let z = if lost_roof { 0. } else { 1.5 };
        let goal = [4., 0.01, z];
        let interaction = crate::model::Interaction {
            radius: 0.05,
            airborne: true,
            ..Default::default()
        };
        let entry = [-1., 0.01, z];
        let mut pieces = vec![];
        let takeoff = if lost_roof {
            let roof = [0., 0.41, 0.];
            pieces.push(flight_fragment(
                original
                    .flight(entry, roof, crate::model::Mode::Jump)
                    .unwrap()
                    .unwrap(),
                &json!({"id":"approach","cost":0.}),
            ));
            roof
        } else {
            entry
        };
        let flight = original
            .flight_to_goal(
                takeoff,
                goal,
                &original.movement.model,
                &crate::world::FlightControl::default(),
                goal,
                &interaction,
            )
            .unwrap()
            .unwrap();
        let duration = flight.duration();
        let position = *flight.points.last().unwrap();
        let mut last = flight_fragment(flight, &json!({"id":"approach","cost":0.}));
        last["goalHit"] = json!({"segment":0,"time":duration,"position":position});
        pieces.push(last);
        let terminal = schedule::compose(&pieces, &snapshot["input"]["locomotion"])
            .unwrap()
            .unwrap();
        let mut q = query();
        q["starts"][0]["position"] = json!([-12., 0.41, 0.]);
        q["goal"] = json!(goal);
        q["interaction"] = json!(interaction);
        assert!(
            trace_clear(&original, &terminal, &q).unwrap(),
            "asset must be prevalidated in its original default poses"
        );
        let mut scene = input();
        scene["scene"]["navigation"]["surfaces"] = snapshot["input"]["ground"]["surfaces"].clone();
        scene["locomotion"] = snapshot["input"]["locomotion"].clone();
        let mut engine =
            Engine::with_search(json!({"maxAttempts":1}), scene, prefix_selects_distant_box)
                .unwrap();
        TERMINAL_PREFIX_SOLVES.store(0, Ordering::Relaxed);
        let step = engine.start(q.clone()).unwrap();
        let mut step=engine.resume(json!({"id":step["effect"]["id"],"terminals":[{"id":"original-approach","route":terminal}]})).unwrap();
        let mut loads = 0;
        for _ in 0..20 {
            if step["type"] == "complete" {
                break;
            }
            let validation = step["effect"]["purpose"] == "terminal-validation";
            let before = TERMINAL_PREFIX_SOLVES.load(Ordering::Relaxed);
            if validation {
                loads += 1;
                assert_eq!(step["effect"]["start"], json!(entry));
                assert_eq!(step["effect"]["target"], json!(goal));
                assert_eq!(step["effect"]["interaction"], json!(interaction));
            }
            let mut loaded = snapshot.clone();
            let coverage = if sparse_prefix && !validation {
                loaded["input"]["collisionOptions"]["bounds"] =
                    json!({"min":[-20.,-2.],"max":[-0.6,2.]});
                let tiles = (-5..0)
                    .flat_map(|x| (-1..=0).map(move |z| json!({"x":x,"z":z})))
                    .collect::<Vec<_>>();
                json!({"kind":"sparse","bounds":{"min":[-20.,-2.],"max":[-0.6,2.]},"tiles":tiles,"tileSpan":4.})
            } else {
                json!({"kind":"complete"})
            };
            step=engine.resume(json!({"id":step["effect"]["id"],"snapshot":loaded,"revision":if validation {"terminal-proof"} else {"prefix-proof"},"coverage":coverage})).unwrap();
            if validation {
                assert_eq!(
                    TERMINAL_PREFIX_SOLVES.load(Ordering::Relaxed),
                    before,
                    "verification-only IO must never invoke route search"
                );
            }
        }
        assert_eq!(step["type"], "complete");
        assert_eq!(
            loads,
            usize::from(lost_roof || sparse_prefix),
            "lost_roof={lost_roof} sparse={sparse_prefix} reason={} status={} partial={} solves={}",
            step["result"]["reason"],
            step["result"]["route"]["status"],
            step["result"]["partial"],
            TERMINAL_PREFIX_SOLVES.load(Ordering::Relaxed)
        );
        assert_eq!(step["result"]["partial"], lost_roof, "{step}");
        if lost_roof {
            assert_eq!(
                step["result"]["route"], terminal,
                "retain the unchanged original-scene partial instead of certifying the incompatible composition"
            );
        } else {
            let configured = original
                .with_placements(&[json!({"device":"box","position":[-12.,0.,0.]})])
                .unwrap()
                .unwrap();
            assert!(trace_clear(&configured, &step["result"]["route"], &q).unwrap());
        }
    }
}
