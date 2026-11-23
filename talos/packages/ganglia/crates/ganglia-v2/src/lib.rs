mod backbone;
mod circular;
mod conditional;
mod contact_search;
mod devices;
mod flight;
mod geometry;
mod locomotion;
#[cfg(feature = "napi")]
mod native;
mod optimize;
mod placement;
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
    layouts: Vec<PreparedLayout>,
    config: Config,
    stats: Value,
    cancelled: AtomicBool,
}
struct PreparedLayout {
    world: World,
    backbone: backbone::Backbone,
    placements: Vec<Placement>,
}
#[derive(Clone)]
struct Candidate {
    layout: usize,
    arrival: Arrival,
    segments: Vec<Segment>,
    scheduled: locomotion::Scheduled,
}
impl Candidate {
    fn cost(&self) -> f64 {
        self.arrival.cost + self.scheduled.duration
    }

    fn finishes_at_first_goal(&self, query: &Query) -> bool {
        let Some(interaction) = query.interaction.as_ref().filter(|goal| goal.airborne) else {
            return true;
        };
        // A valid terminal action is insufficient when its prefix already
        // entered the collection volume. Check the whole candidate before it
        // enters the population, including after a shortcut or splice.
        for (index, segment) in self.scheduled.segments.iter().enumerate() {
            for (chord, points) in segment.points.windows(2).enumerate() {
                if let Some((fraction, position)) =
                    flight::hit(points[0], points[1], query.goal, interaction)
                {
                    let time = segment.times[chord]
                        + fraction * (segment.times[chord + 1] - segment.times[chord]);
                    return index + 1 == self.scheduled.segments.len()
                        && matches!(segment.mode, "jump" | "drop" | "launch")
                        && distance(position, segment.end()) <= 1e-6
                        && (time - segment.cost()).abs() <= 1e-6;
                }
            }
        }
        false
    }
}
impl Engine {
    fn world_for(&self, layout: usize) -> &World {
        &self.layouts[layout].world
    }
    fn backbone_for(&self, layout: usize) -> &backbone::Backbone {
        &self.layouts[layout].backbone
    }
    fn candidate(
        &self,
        layout: usize,
        arrival: Arrival,
        segments: Vec<Segment>,
    ) -> Option<Candidate> {
        self.world_for(layout).contact_receipts(&segments)?;
        let scheduled = locomotion::best(&segments, &self.world_for(layout).physical)?;
        self.world_for(layout)
            .contact_receipts(&scheduled.segments)?;
        Some(Candidate {
            layout,
            arrival,
            segments,
            scheduled,
        })
    }
    pub fn new(input: &str) -> Result<Self, String> {
        let started = Instant::now();
        let input: Input = serde_json::from_str(input).map_err(|e| e.to_string())?;
        Self::from_input(input, started)
    }
    fn from_input(input: Input, started: Instant) -> Result<Self, String> {
        let config = input.config;
        if config.population_size == 0
            || config.attempts_per_round == 0
            || config.stagnant_rounds == 0
            || !(0. ..1.).contains(&config.improvement_threshold)
        {
            return Err("Invalid optimization policy".into());
        }
        locomotion::validate(&input.physical.locomotion)?;
        let base = World::new(input.physical)?;
        let placements = placement::prepare(&base, input.layouts)?;
        let worlds: Vec<_> = placements
            .into_iter()
            .map(|picks| (base.layout(&picks), picks))
            .collect();
        let proofs = backbone::Proofs::new(
            worlds
                .iter()
                .flat_map(|(world, _)| world.box_bounds())
                .collect(),
            &base.physical.ground.options.profile,
            worlds.len() > 1 && base.has_static_collision(),
        );
        let anchor_supports: Vec<_> = input
            .anchors
            .iter()
            .map(|&position| {
                let world = &worlds[0].0;
                let feet = world
                    .standing(position)
                    .filter(|&p| !world.blocked(p, p, 0.));
                json!({"position":position,"feet":feet})
            })
            .collect();
        let mut layout_stats = Vec::new();
        let mut layouts = Vec::new();
        for (world, picks) in worlds {
            let layout_started = Instant::now();
            let before = proofs.stats();
            let backbone = backbone::Backbone::build(
                &world,
                input.marks.clone(),
                input.anchors.clone(),
                &proofs,
            );
            let after = proofs.stats();
            layout_stats.push(json!({"layout":layouts.len(),"placements":picks,"nodeCount":backbone.nodes.len(),"edgeCount":backbone.edges.iter().map(Vec::len).sum::<usize>(),"conditionalEdgeCount":backbone.conditional.iter().map(Vec::len).sum::<usize>(),"buildMs":layout_started.elapsed().as_secs_f64()*1000.,"phasesMs":{"samples":backbone.preparation_ms[0],"portsAndIndex":backbone.preparation_ms[1],"edges":backbone.preparation_ms[2],"terminals":backbone.preparation_ms[3]},"pairProofsStored":after.0-before.0,"pairProofHits":after.1-before.1}));
            layouts.push(PreparedLayout {
                world,
                backbone,
                placements: picks,
            });
        }
        let (pair_proofs, pair_hits) = proofs.stats();
        // The key table is construction-only; shared segment proofs remain in edges.
        drop(proofs);
        let backbone = &layouts[0].backbone;
        let bounds = (!backbone.nodes.is_empty()).then(|| Bounds::points(&backbone.nodes));
        let stats = json!({"pairProofCount":pair_proofs,"pairProofHits":pair_hits,"layouts":layout_stats,"totalNodeCount":layouts.iter().map(|l|l.backbone.nodes.len()).sum::<usize>(),"totalEdgeCount":layouts.iter().flat_map(|l|&l.backbone.edges).map(Vec::len).sum::<usize>(),"backboneBuildMs":started.elapsed().as_secs_f64()*1000.,"nodeCount":backbone.nodes.len(),"edgeCount":backbone.edges.iter().map(Vec::len).sum::<usize>(),
            "conditionalEdgeCount":layouts.iter().flat_map(|layout| &layout.backbone.conditional).map(Vec::len).sum::<usize>(),
            "anchorSupports":anchor_supports,
            "nodeBounds":bounds.map(|b|json!({"min":b.min,"max":b.max})),
            "markedTargets":backbone.terminals.iter().map(|(mark,edges)|json!({"position":mark.position,"connections":edges.len()})).collect::<Vec<_>>(),
            "ropeConnections":backbone.edges.iter().flatten().filter(|edge|edge.action.mode=="rope" && edge.action.traversal.is_none()).filter_map(|edge|edge.action.connection.as_ref()).collect::<Vec<_>>(),
            "movingConnections":backbone.edges.iter().flatten().filter(|edge|edge.action.traversal.is_some()).filter_map(|edge|edge.action.connection.as_ref()).collect::<Vec<_>>(),
            "launchConnections":backbone.edges.iter().flatten().filter(|edge|edge.action.mode=="launch").filter_map(|edge|edge.action.connection.as_ref()).collect::<Vec<_>>()});
        Ok(Self {
            layouts,
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
        let diagnostics = json!({"truncated":self.cancelled.load(Ordering::Relaxed),"v2":{"backboneBuildMs":self.stats["backboneBuildMs"],"nodeCount":self.stats["totalNodeCount"],"edgeCount":self.stats["totalEdgeCount"],"initializationMs":initialization_ms,"initialization":initialization,"initialCost":initial_cost,"rounds":rounds,"seed":self.config.seed}});
        let Some(best) = population.first() else {
            return Ok(
                json!({"route":{"status":"no-verified-route"},"connections":[],"diagnostics":diagnostics,"reason":"No feasible route in the prepared backbone"}),
            );
        };
        let segments = &best.scheduled.segments;
        let points: Vec<_> = segments
            .iter()
            .enumerate()
            .flat_map(|(i, s)| s.points.iter().skip(usize::from(i > 0)).copied())
            .collect();
        let length: f64 = points.windows(2).map(|p| distance(p[0], p[1])).sum();
        let last = segments.last().unwrap();
        let policy = &self.world_for(best.layout).physical.locomotion;
        let placements = &self.layouts[best.layout].placements;
        let state = &best.scheduled.state;
        let schedule = if best.scheduled.boosts.is_empty() {
            &best.segments
        } else {
            segments
        };
        Ok(
            json!({"route":{"status":"complete","placements":placements,"start":best.arrival.id,"arrivalCost":best.arrival.cost,"cost":best.cost(),"length":length,"points":points,"segments":segments,"schedule":[{"segments":schedule,"allowSprint":best.scheduled.controls.allow_sprint,"allowDash":best.scheduled.controls.allow_dash}],"boosts":best.scheduled.boosts,"locomotion":{"initial":policy.stamina.as_ref().map_or(0.,|s|s.initial),"final":state.energy,"minimum":state.minimum,"dashes":state.dashes,"dash":policy.dash},"goalHit":{"segment":segments.len()-1,"time":last.cost(),"position":last.end()}},"arrival":best.arrival,"supportBoxes":devices::used_supports(self.world_for(best.layout),segments),"connections":[],"diagnostics":diagnostics}),
        )
    }
}
