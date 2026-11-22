use crate::{Candidate, Engine, types::*};
use serde_json::{Value, json};
use std::{sync::atomic::Ordering, time::Instant};

struct Random(u64);
impl Random {
    fn index(&mut self, length: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 as usize) % length
    }
    fn offset(&mut self) -> f64 {
        self.index(10001) as f64 / 10000. - 0.5
    }
}
impl Engine {
    pub(super) fn optimize(&self, population: &mut Vec<Candidate>, query: &Query) -> Vec<Value> {
        let mut rounds = Vec::new();
        let mut stagnant = 0;
        let mut rng = Random(self.config.seed.max(1));
        while !population.is_empty()
            && stagnant < self.config.stagnant_rounds
            && !self.cancelled.load(Ordering::Relaxed)
        {
            let started = Instant::now();
            let before = population[0].cost();
            let mut accepted = 0;
            let mut attempts = 0;
            for _ in 0..self.config.attempts_per_round {
                if self.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                attempts += 1;
                let base = &population[rng.index(population.len())];
                let proposal = match rng.index(3) {
                    0 => self.shortcut(base, query, &mut rng),
                    1 => self.move_join(base, query, &mut rng),
                    _ => self.splice(
                        base,
                        &population[rng.index(population.len())],
                        query,
                        &mut rng,
                    ),
                };
                if let Some(candidate) = proposal {
                    // A changed prefix changes resources at every later action.
                    // Proposals are fully rescheduled before they enter the population.
                    if candidate.cost() + 1e-9 < base.cost()
                        && candidate.finishes_at_first_goal(query)
                    {
                        population.push(candidate);
                        select(population, self.config.population_size);
                        accepted += 1;
                    }
                }
            }
            let best = population[0].cost();
            let improvement = if before > 0. {
                (before - best) / before
            } else {
                0.
            };
            stagnant = if improvement <= self.config.improvement_threshold {
                stagnant + 1
            } else {
                0
            };
            rounds.push(json!({"elapsedMs":started.elapsed().as_secs_f64()*1000.,"attempts":attempts,"accepted":accepted,"bestCost":best,"relativeImprovement":improvement}));
        }
        rounds
    }
    fn reconnect(
        &self,
        start: Point,
        end: Point,
        terminal: bool,
        query: &Query,
    ) -> Option<Segment> {
        if let Some(interaction) = query
            .interaction
            .as_ref()
            .filter(|i| terminal && i.airborne)
        {
            self.world.collect(start, query.goal, interaction)
        } else {
            self.world.action(start, end)
        }
    }
    fn shortcut(&self, base: &Candidate, query: &Query, rng: &mut Random) -> Option<Candidate> {
        let len = base.segments.len();
        if len < 2 {
            return None;
        }
        let left = rng.index(len - 1);
        let right = left + 2 + rng.index(len - left - 1);
        let action = self.reconnect(
            base.segments[left].start(),
            base.segments[right - 1].end(),
            right == len,
            query,
        )?;
        let mut segments = base.segments.clone();
        segments.splice(left..right, [action]);
        self.candidate(base.arrival.clone(), segments)
    }
    fn move_join(&self, base: &Candidate, query: &Query, rng: &mut Random) -> Option<Candidate> {
        let len = base.segments.len();
        if len < 2 {
            return None;
        }
        let index = rng.index(len - 1);
        let mut point = base.segments[index].end();
        point[0] += rng.offset();
        point[2] += rng.offset();
        let point = self.world.project(point, 0.5)?;
        let first = self.world.action(base.segments[index].start(), point)?;
        let second = self.reconnect(
            point,
            base.segments[index + 1].end(),
            index + 2 == len,
            query,
        )?;
        let mut segments = base.segments.clone();
        segments.splice(index..index + 2, [first, second]);
        self.candidate(base.arrival.clone(), segments)
    }
    fn splice(
        &self,
        base: &Candidate,
        donor: &Candidate,
        query: &Query,
        rng: &mut Random,
    ) -> Option<Candidate> {
        let left = rng.index(base.segments.len());
        let right = rng.index(donor.segments.len());
        let bridge = self.reconnect(
            base.segments[left].start(),
            donor.segments[right].end(),
            right + 1 == donor.segments.len(),
            query,
        )?;
        let mut segments = base.segments[..left].to_vec();
        segments.push(bridge);
        segments.extend_from_slice(&donor.segments[right + 1..]);
        self.candidate(base.arrival.clone(), segments)
    }
}
// This local policy is replaceable independently of route generation. Keep the
// incumbent and lowest costs first; affinity experiments belong here later.
pub(super) fn select(population: &mut Vec<Candidate>, capacity: usize) {
    population.sort_by(|a, b| a.cost().total_cmp(&b.cost()));
    population.truncate(capacity);
}
