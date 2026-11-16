//! Goal-side discovery fills missing catalog approaches before query serving.
//! Region connectivity ranks proposals; every retained edge is a World flight proof.
use super::{Point, geometry, optional_proof};
use crate::{
    model::{Bounds, Connection, Mode},
    world::World,
};
use std::collections::{BTreeMap, HashSet};

pub(super) fn incoming(
    world: &World,
    goals: &[Point],
    roots: &[Point],
    spacing: f64,
    limit: usize,
    truncated: &mut bool,
) -> Result<(Vec<Connection>, usize), String> {
    if goals.is_empty() || limit == 0 {
        return Ok((vec![], 0));
    }
    let anchors = goals.iter().chain(roots).copied().collect::<Vec<_>>();
    let margin = world.movement.model.max_horizontal_speed * 4.;
    let bounds = Bounds {
        min: [0, 2].map(|i| anchors.iter().map(|p| p[i]).fold(f64::INFINITY, f64::min) - margin),
        max: [0, 2].map(|i| {
            anchors
                .iter()
                .map(|p| p[i])
                .fold(f64::NEG_INFINITY, f64::max)
                + margin
        }),
    };
    let component = |p| -> Result<Option<usize>, String> {
        Ok(world
            .project(p, None)?
            .first()
            .and_then(|h| world.support_component(&h.surface)))
    };
    let spacing = spacing.clamp(0.5, 2.);
    let mut cells = BTreeMap::new();
    for boundary in world.support_boundaries(bounds)? {
        crate::cancel::check()?;
        let Some(owner) = world.support_component(&boundary.surface) else {
            continue;
        };
        let [a, b] = boundary.points;
        let dx = b[0] - a[0];
        let dz = b[2] - a[2];
        let length = dx.hypot(dz);
        if length < 1e-8 {
            continue;
        }
        let count = (length / spacing.max(0.5)).ceil().max(1.) as usize;
        for k in 0..=count {
            for inset in [-2., -1., 1., 2.] {
                let mut p = geometry::lerp(a, b, k as f64 / count as f64);
                p[0] -= dz / length * world.movement.profile.radius * inset;
                p[2] += dx / length * world.movement.profile.radius * inset;
                let cell = p.map(|v| (v / spacing.max(0.5)).floor() as i64);
                cells.entry((owner, cell)).or_insert(p);
            }
        }
    }
    let mut regions = BTreeMap::<usize, Vec<Point>>::new();
    for ((owner, _), p) in cells {
        crate::cancel::check()?;
        if let Some(p) = optional_proof(world.standing_foot(p), truncated)?
            && component(p)? == Some(owner)
            && optional_proof(world.clear(p, p, 0.).map(Some), truncated)?.unwrap_or(false)
        {
            regions.entry(owner).or_default().push(p);
        }
    }
    let mut queue = Vec::new();
    let mut queued = HashSet::new();
    let mut root_regions = HashSet::new();
    for &p in roots {
        if let Some(owner) = component(p)? {
            root_regions.insert(owner);
        }
    }
    for &p in goals {
        if let Some(owner) = component(p)? {
            regions.entry(owner).or_default().push(p);
            if queued.insert(owner) {
                queue.push((owner, 0.));
            }
        }
    }
    let mut connections = Vec::new();
    let mut attempts = 0;
    let mut expanded = 0;
    while let Some((target_region, _)) = queue.pop() {
        crate::cancel::check()?;
        if expanded == 8 || attempts >= limit {
            *truncated = true;
            break;
        }
        expanded += 1;
        let exact = goals
            .iter()
            .copied()
            .filter(|&p| component(p).ok().flatten() == Some(target_region))
            .collect::<Vec<_>>();
        let targets = if exact.is_empty() {
            &regions[&target_region]
        } else {
            &exact
        };
        let mut groups = Vec::new();
        for (&source_region, sources) in &regions {
            crate::cancel::check()?;
            if source_region == target_region {
                continue;
            }
            let mut pairs = Vec::new();
            for (index, &source) in sources.iter().enumerate() {
                if index % 64 == 0 {
                    crate::cancel::check()?;
                }
                let target = targets
                    .iter()
                    .filter(|p| p[1] - source[1] <= world.movement.model.max_jump_height)
                    .min_by(|a, b| {
                        geometry::distance(source, **a).total_cmp(&geometry::distance(source, **b))
                    });
                let Some(&target) = target else { continue };
                if !super::free_flight_reaches(world, source, target, Mode::Jump, 1.)? {
                    continue;
                }
                pairs.push((geometry::distance(source, target), source, target));
            }
            pairs.sort_by(|a, b| a.0.total_cmp(&b.0));
            pairs.truncate(64);
            if !pairs.is_empty() {
                groups.push((source_region, pairs));
            }
        }
        groups.sort_by(|a, b| a.1[0].0.total_cmp(&b.1[0].0).then(a.0.cmp(&b.0)));
        let mut accepted = HashSet::new();
        'pairs: for rank in 0..64 {
            for (source_region, pairs) in &groups {
                if accepted.contains(source_region) {
                    continue;
                }
                let Some(&(_, source, target)) = pairs.get(rank) else {
                    continue;
                };
                if attempts >= limit {
                    *truncated = true;
                    break 'pairs;
                }
                let Some(source) = optional_proof(world.standing_foot(source), truncated)? else {
                    continue;
                };
                let Some(target) = optional_proof(world.standing_foot(target), truncated)? else {
                    continue;
                };
                if component(source)? != Some(*source_region)
                    || component(target)? != Some(target_region)
                {
                    continue;
                }
                attempts += 1;
                if let Some(connection) =
                    optional_proof(world.flight(source, target, Mode::Jump), truncated)?
                {
                    connections.push(connection);
                    accepted.insert(*source_region);
                    if !root_regions.contains(source_region) && queued.insert(*source_region) {
                        let remaining = regions[source_region]
                            .iter()
                            .flat_map(|&p| roots.iter().map(move |&r| geometry::distance(p, r)))
                            .fold(f64::INFINITY, f64::min);
                        queue.push((*source_region, remaining));
                        queue.sort_by(|a, b| b.1.total_cmp(&a.1).then(b.0.cmp(&a.0)));
                    }
                }
            }
        }
    }
    if std::env::var_os("GANGLIA_PROFILE").is_some() {
        eprintln!(
            "{}",
            serde_json::json!({"native":"training", "regions":regions.len(), "expanded":expanded,"attempts":attempts,"connections":connections.len()})
        );
    }
    Ok((connections, attempts))
}
