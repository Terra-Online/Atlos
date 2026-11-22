mod backbone;
mod devices;
mod flight;
mod geometry;
#[cfg(feature = "napi")]
mod native;
mod optimize;
mod search;
mod types;
mod walls;
mod world;

use geometry::*;
use serde_json::{Value, json};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use types::*;
use world::World;

pub struct Engine {
    world: World,
    backbone: backbone::Backbone,
    config: Config,
    stats: Value,
    cancelled: AtomicBool,
}
#[derive(Clone)]
struct Candidate {
    arrival: Arrival,
    segments: Vec<Segment>,
}
impl Candidate {
    fn cost(&self) -> f64 {
        self.arrival.cost + self.segments.iter().map(Segment::cost).sum::<f64>()
    }

    fn finishes_at_first_goal(&self, query: &Query) -> bool {
        let Some(interaction) = query.interaction.as_ref().filter(|goal| goal.airborne) else {
            return true;
        };
        // A valid terminal action is insufficient when its prefix already
        // entered the collection volume. Check the whole candidate before it
        // enters the population, including after a shortcut or splice.
        for (index, segment) in self.segments.iter().enumerate() {
            for (chord, points) in segment.points.windows(2).enumerate() {
                if let Some((fraction, position)) =
                    flight::hit(points[0], points[1], query.goal, interaction)
                {
                    let time = segment.times[chord]
                        + fraction * (segment.times[chord + 1] - segment.times[chord]);
                    return index + 1 == self.segments.len()
                        && segment.mode == "jump"
                        && distance(position, segment.end()) <= 1e-6
                        && (time - segment.cost()).abs() <= 1e-6;
                }
            }
        }
        false
    }
}
impl Engine {
    pub fn new(input: &str) -> Result<Self, String> {
        let started = Instant::now();
        let input: Input = serde_json::from_str(input).map_err(|e| e.to_string())?;
        let config = input.config;
        if config.population_size == 0
            || config.attempts_per_round == 0
            || config.stagnant_rounds == 0
            || !(0. ..1.).contains(&config.improvement_threshold)
        {
            return Err("Invalid optimization policy".into());
        }
        let world = World::new(input.physical)?;
        let anchor_supports: Vec<_> = input
            .anchors
            .iter()
            .map(|&position| {
                let feet = world
                    .standing(position)
                    .filter(|&p| !world.blocked(p, p, 0.));
                json!({"position":position,"feet":feet})
            })
            .collect();
        let backbone = backbone::Backbone::build(&world, input.marks, input.anchors);
        let bounds = (!backbone.nodes.is_empty()).then(|| Bounds::points(&backbone.nodes));
        let stats = json!({"backboneBuildMs":started.elapsed().as_secs_f64()*1000.,"nodeCount":backbone.nodes.len(),"edgeCount":backbone.edges.iter().map(Vec::len).sum::<usize>(),
            "anchorSupports":anchor_supports,
            "nodeBounds":bounds.map(|b|json!({"min":b.min,"max":b.max})),
            "markedTargets":backbone.terminals.iter().map(|(mark,edges)|json!({"position":mark.position,"connections":edges.len()})).collect::<Vec<_>>(),
            "ropeConnections":backbone.edges.iter().flatten().filter_map(|edge|edge.action.connection.as_ref()).collect::<Vec<_>>()});
        Ok(Self {
            world,
            backbone,
            config,
            stats,
            cancelled: AtomicBool::new(false),
        })
    }
    pub fn stats(&self) -> Value {
        self.stats.clone()
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
    pub fn solve(&self, query: &str) -> Result<Value, String> {
        let query: Query = serde_json::from_str(query).map_err(|e| e.to_string())?;
        let started = Instant::now();
        let mut initialization = json!({});
        let mut population = self.initialize(&query, &mut initialization);
        let initialization_ms = started.elapsed().as_secs_f64() * 1000.;
        optimize::select(&mut population, self.config.population_size);
        let initial_cost = population.first().map(Candidate::cost);
        let rounds = self.optimize(&mut population, &query);
        let diagnostics = json!({"truncated":self.cancelled.load(Ordering::Relaxed),"v2":{"backboneBuildMs":self.stats["backboneBuildMs"],"nodeCount":self.backbone.nodes.len(),"edgeCount":self.stats["edgeCount"],"initializationMs":initialization_ms,"initialization":initialization,"initialCost":initial_cost,"rounds":rounds,"seed":self.config.seed}});
        let Some(best) = population.first() else {
            return Ok(
                json!({"route":{"status":"no-verified-route"},"connections":[],"diagnostics":diagnostics,"reason":"No feasible route in the prepared backbone"}),
            );
        };
        let points: Vec<_> = best
            .segments
            .iter()
            .enumerate()
            .flat_map(|(i, s)| s.points.iter().skip(usize::from(i > 0)).copied())
            .collect();
        let length: f64 = points.windows(2).map(|p| distance(p[0], p[1])).sum();
        let last = best.segments.last().unwrap();
        Ok(
            json!({"route":{"status":"complete","start":best.arrival.id,"arrivalCost":best.arrival.cost,"cost":best.cost(),"length":length,"points":points,"segments":best.segments,"schedule":[{"segments":best.segments,"allowSprint":false,"allowDash":false}],"goalHit":{"segment":best.segments.len()-1,"time":last.cost(),"position":last.end()}},"arrival":best.arrival,"connections":[],"diagnostics":diagnostics}),
        )
    }
}
