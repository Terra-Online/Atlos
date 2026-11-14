//! Frozen navigation index for proposing connected action chains. Navigation is
//! optimistic: Search still proves every walk, action and resource transition.
use super::{Point, horizontal, point};
use crate::{model::Interaction, world::World};
use serde_json::Value;
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};

struct Entry {
    id: String,
    from: usize,
    to: usize,
    start: Point,
    end: Point,
    duration: f64,
}
pub(super) struct Selection {
    pub actions: Vec<String>,
    pub connects_goal: bool,
}
pub(super) struct Index {
    components: HashMap<String, usize>,
    forward: Vec<Vec<usize>>,
    entries: Vec<Entry>,
    actions: Vec<Vec<usize>>,
    local: Vec<Vec<usize>>,
    reachable: RefCell<HashMap<usize, Vec<usize>>>,
}
#[derive(Clone)]
struct State {
    edge: usize,
    elapsed: f64,
    score: f64,
    chain: Vec<usize>,
}
impl PartialEq for State {
    fn eq(&self, b: &Self) -> bool {
        self.score == b.score && self.edge == b.edge
    }
}
impl Eq for State {}
impl PartialOrd for State {
    fn partial_cmp(&self, b: &Self) -> Option<Ordering> {
        Some(self.cmp(b))
    }
}
impl Ord for State {
    fn cmp(&self, b: &Self) -> Ordering {
        b.score
            .total_cmp(&self.score)
            .then_with(|| b.edge.cmp(&self.edge))
    }
}

impl Index {
    pub(super) fn prepare(world: &World, bank: &BTreeMap<String, Value>) -> Result<Self, String> {
        let ids: HashMap<_, _> = world
            .surfaces
            .iter()
            .enumerate()
            .map(|(i, s)| (s.id.as_str(), i))
            .collect();
        let mut forward = vec![Vec::new(); ids.len()];
        let mut reverse = forward.clone();
        for p in &world.portals {
            let a = ids[p.from.as_str()];
            let b = ids[p.to.as_str()];
            forward[a].push(b);
            reverse[b].push(a);
        }
        // Iterative Kosaraju avoids a call stack proportional to mesh size.
        let mut seen = vec![false; ids.len()];
        let mut order = Vec::new();
        for root in 0..ids.len() {
            if seen[root] {
                continue;
            }
            seen[root] = true;
            let mut stack = vec![(root, 0)];
            while let Some((node, next)) = stack.last_mut() {
                if *next < forward[*node].len() {
                    let child = forward[*node][*next];
                    *next += 1;
                    if !seen[child] {
                        seen[child] = true;
                        stack.push((child, 0));
                    }
                } else {
                    order.push(*node);
                    stack.pop();
                }
            }
        }
        let mut groups = vec![usize::MAX; ids.len()];
        let mut count = 0;
        for &root in order.iter().rev() {
            if groups[root] != usize::MAX {
                continue;
            }
            groups[root] = count;
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                for &child in &reverse[node] {
                    if groups[child] == usize::MAX {
                        groups[child] = count;
                        stack.push(child);
                    }
                }
            }
            count += 1;
        }
        let mut dag = vec![Vec::new(); count];
        for (a, edges) in forward.iter().enumerate() {
            for &b in edges {
                if groups[a] != groups[b] {
                    dag[groups[a]].push(groups[b]);
                }
            }
        }
        for edges in &mut dag {
            edges.sort_unstable();
            edges.dedup();
        }
        let components: HashMap<_, _> = ids
            .into_iter()
            .map(|(id, i)| (id.to_owned(), groups[i]))
            .collect();
        let mut entries = Vec::new();
        let mut actions = vec![Vec::new(); count];
        let mut local = vec![Vec::new(); count];
        for (id, value) in bank {
            crate::cancel::check()?;
            let points = value["points"].as_array().ok_or("Catalog points missing")?;
            let start = point(points.first().ok_or("Catalog points empty")?)?;
            let end = point(points.last().ok_or("Catalog points empty")?)?;
            let from = world
                .project(start, None)?
                .first()
                .and_then(|p| components.get(&p.surface))
                .copied();
            let to = world
                .project(end, None)?
                .first()
                .and_then(|p| components.get(&p.surface))
                .copied();
            let (Some(from), Some(to)) = (from, to) else {
                continue;
            };
            let times = value["times"].as_array().ok_or("Catalog times missing")?;
            let duration = times.last().and_then(Value::as_f64).unwrap_or(0.)
                - times.first().and_then(Value::as_f64).unwrap_or(0.);
            if from == to {
                local[from].push(entries.len());
            } else {
                actions[from].push(entries.len());
            }
            entries.push(Entry {
                id: id.clone(),
                from,
                to,
                start,
                end,
                duration,
            });
        }
        if std::env::var_os("GANGLIA_PROFILE").is_some() {
            eprintln!(
                "{}",
                serde_json::json!({"native":"catalog","phase":"index","components":count,"entries":entries.len(),"bank":bank.len()})
            );
        }
        Ok(Self {
            components,
            forward: dag,
            entries,
            actions,
            local,
            reachable: RefCell::new(HashMap::new()),
        })
    }
    fn reachable(&self, root: usize) -> Vec<usize> {
        if let Some(found) = self.reachable.borrow().get(&root) {
            return found.clone();
        }
        let mut seen = vec![false; self.forward.len()];
        seen[root] = true;
        let mut nodes = vec![root];
        let mut cursor = 0;
        while cursor < nodes.len() {
            let node = nodes[cursor];
            cursor += 1;
            for &next in &self.forward[node] {
                if !seen[next] {
                    seen[next] = true;
                    nodes.push(next);
                }
            }
        }
        self.reachable.borrow_mut().insert(root, nodes.clone());
        nodes
    }
    pub(super) fn select(
        &self,
        world: &World,
        query: &Value,
        limit: usize,
    ) -> Result<Selection, String> {
        let goal = point(&query["goal"])?;
        let interaction: Option<Interaction> = if query["interaction"].is_null() {
            None
        } else {
            Some(serde_json::from_value(query["interaction"].clone()).map_err(|e| e.to_string())?)
        };
        let goals: HashSet<_> = world
            .project(goal, interaction.as_ref())?
            .iter()
            .filter_map(|p| self.components.get(&p.surface).copied())
            .collect();
        let speed = world
            .locomotion
            .as_ref()
            .map_or(world.movement.speed, |m| m.sprint_speed)
            .max(1e-6);
        let limit = limit.min(16);
        let mut heap = BinaryHeap::new();
        let mut best = vec![f64::INFINITY; self.entries.len()];
        let extend = |component,
                      position,
                      elapsed,
                      chain: &[usize],
                      heap: &mut BinaryHeap<State>,
                      best: &mut [f64]| {
            if chain.len() >= limit {
                return;
            }
            for region in self.reachable(component) {
                for &edge in &self.actions[region] {
                    let action = &self.entries[edge];
                    debug_assert_eq!(action.from, region);
                    let next =
                        elapsed + horizontal(position, action.start) / speed + action.duration;
                    if next >= best[edge] || chain.contains(&edge) {
                        continue;
                    }
                    best[edge] = next;
                    let mut chain = chain.to_vec();
                    chain.push(edge);
                    heap.push(State {
                        edge,
                        elapsed: next,
                        score: next + horizontal(action.end, goal) / speed,
                        chain,
                    });
                }
            }
        };
        let mut root_gap = f64::INFINITY;
        let mut origins = Vec::new();
        for start in query["starts"].as_array().ok_or("Missing starts")? {
            if start["state"] != "available" {
                continue;
            }
            let position = point(&start["position"])?;
            root_gap = root_gap.min(crate::world::distance(position, goal));
            if let Some(component) = world
                .project(position, None)?
                .first()
                .and_then(|p| self.components.get(&p.surface))
            {
                origins.push((*component, position));
                extend(
                    *component,
                    position,
                    start["cost"].as_f64().unwrap_or(0.),
                    &[],
                    &mut heap,
                    &mut best,
                );
            }
        }
        let mut selected = Vec::new();
        let mut used = HashSet::new();
        let mut alternatives = 0;
        // Nearby launch/landing witnesses compete for one proposal slot. Keep
        // their exact controls, but spend the bounded query graph on distinct
        // transfers rather than many samples of the same trajectory.
        let signature = |edge: usize| {
            let e = &self.entries[edge];
            let cell = |p: Point| p.map(|x| (x / 2.).floor() as i64);
            (e.from, e.to, cell(e.start), cell(e.end))
        };
        let mut transfers = HashSet::new();
        let mut prefixes = HashMap::<usize, (f64, State)>::new();
        while let Some(state) = heap.pop() {
            crate::cancel::check()?;
            if state.elapsed != best[state.edge] {
                continue;
            }
            let action = &self.entries[state.edge];
            let gap = crate::world::distance(action.end, goal);
            if gap < root_gap
                && state.chain.len() <= limit.min(8)
                && prefixes.get(&action.to).is_none_or(|(old, _)| gap < *old)
            {
                prefixes.insert(action.to, (gap, state.clone()));
            }
            if self.reachable(action.to).iter().any(|c| goals.contains(c)) {
                let additions: Vec<_> = state
                    .chain
                    .iter()
                    .copied()
                    .filter(|i| !used.contains(i))
                    .collect();
                if additions
                    .iter()
                    .any(|i| !transfers.contains(&signature(*i)))
                    && selected.len() + additions.len() <= limit
                {
                    for i in additions {
                        used.insert(i);
                        transfers.insert(signature(i));
                        selected.push(self.entries[i].id.clone());
                    }
                    alternatives += 1;
                }
                if selected.len() == limit || alternatives == 8 {
                    break;
                }
            }
            extend(
                action.to,
                action.end,
                state.elapsed,
                &state.chain,
                &mut heap,
                &mut best,
            );
        }
        let connects_goal = !selected.is_empty();
        if !connects_goal {
            let mut prefixes = prefixes.into_values().collect::<Vec<_>>();
            prefixes.sort_by(|a, b| {
                a.0.total_cmp(&b.0)
                    .then_with(|| a.1.elapsed.total_cmp(&b.1.elapsed))
            });
            for (_, state) in prefixes.into_iter().take(2) {
                for edge in state.chain {
                    if selected.len() < limit.min(8) && used.insert(edge) {
                        selected.push(self.entries[edge].id.clone());
                    }
                }
            }
        }
        // A navigation SCC can still contain physical cracks. Keep nearby
        // learned crossings available alongside inter-region chains.
        for &edge in &used {
            origins.push((self.entries[edge].to, self.entries[edge].end));
        }
        let mut local = HashMap::<usize, f64>::new();
        for (component, origin) in origins {
            for region in self.reachable(component) {
                for &edge in &self.local[region] {
                    let a = &self.entries[edge];
                    let score = horizontal(origin, a.start) / speed
                        + a.duration
                        + horizontal(a.end, goal) / speed;
                    local
                        .entry(edge)
                        .and_modify(|old| *old = old.min(score))
                        .or_insert(score);
                }
            }
        }
        let mut local = local.into_iter().collect::<Vec<_>>();
        local.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        for (edge, _) in local {
            if selected.len() == limit {
                break;
            }
            if transfers.insert(signature(edge)) {
                selected.push(self.entries[edge].id.clone());
            }
        }
        if std::env::var_os("GANGLIA_PROFILE").is_some() {
            eprintln!(
                "{}",
                serde_json::json!({"native":"catalog","phase":"select","goals":goals,"entries":self.entries.len(),"visited":best.iter().filter(|v|v.is_finite()).count(),"selected":selected.len()})
            );
        }
        Ok(Selection {
            actions: selected,
            connects_goal,
        })
    }
}
