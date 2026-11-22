use crate::{geometry::*, types::*, world::World};
use std::collections::BTreeMap;

pub(super) struct Edge {
    pub to: usize,
    pub action: Segment,
}
pub(super) struct Backbone {
    pub nodes: Vec<Point>,
    pub edges: Vec<Vec<Edge>>,
    pub terminals: Vec<(Mark, Vec<(usize, Segment)>)>,
}
impl Backbone {
    pub fn build(world: &World, marks: Vec<Mark>) -> Self {
        // Sparse interior representatives plus ledge samples. The lattice is a
        // discovery heuristic, not a completeness claim: missed connectivity is
        // deliberately left unavailable until the next construction strategy.
        let key = |p: Point, size: f64| {
            [
                (p[0] / size).floor() as i64,
                p[1].floor() as i64,
                (p[2] / size).floor() as i64,
            ]
        };
        let vertex_key = |p: Point| p.map(|v| (v * 10000.).round() as i64);
        let mut interior = BTreeMap::new();
        let mut boundaries: BTreeMap<([i64; 3], [i64; 3]), (usize, Point, Point, Point)> =
            BTreeMap::new();
        for surface in &world.physical.ground.surfaces {
            if surface.vertices.len() < 3 {
                continue;
            }
            let center = scale(
                surface.vertices.iter().copied().fold([0.; 3], add),
                1. / surface.vertices.len() as f64,
            );
            interior.entry(key(center, 4.)).or_insert(center);
            for (i, &a) in surface.vertices.iter().enumerate() {
                let b = surface.vertices[(i + 1) % surface.vertices.len()];
                let ka = vertex_key(a);
                let kb = vertex_key(b);
                let edge = if ka < kb { (ka, kb) } else { (kb, ka) };
                boundaries
                    .entry(edge)
                    .and_modify(|entry| entry.0 += 1)
                    .or_insert((1, a, b, center));
            }
        }
        let mut ledges = BTreeMap::new();
        for (_, (count, a, b, center)) in boundaries {
            if count != 1 {
                continue;
            }
            let steps = (horizontal(a, b) / 3.).ceil().max(1.) as usize;
            for i in 0..steps {
                let edge = lerp(a, b, (i as f64 + 0.5) / steps as f64);
                let point = lerp(edge, center, 0.05);
                ledges.entry(key(point, 2.)).or_insert(point);
            }
        }
        let nodes: Vec<_> = interior
            .into_values()
            .chain(ledges.into_values())
            .filter_map(|p| world.standing(p))
            .filter(|p| !world.blocked(*p, *p, 0.))
            .collect();
        let index = Index::new(
            &nodes
                .iter()
                .map(|p| Bounds::points(&[*p]))
                .collect::<Vec<_>>(),
        );
        let mut edges: Vec<Vec<Edge>> = (0..nodes.len()).map(|_| Vec::new()).collect();
        for (i, &a) in nodes.iter().enumerate() {
            let mut nearby = Vec::new();
            index.query(Bounds::points(&[a]).expand(12.), |j| {
                if i != j {
                    nearby.push(j);
                }
                false
            });
            nearby
                .sort_unstable_by(|&j, &k| distance(a, nodes[j]).total_cmp(&distance(a, nodes[k])));
            for j in nearby.into_iter().take(24) {
                if let Some(action) = world.action(a, nodes[j]) {
                    edges[i].push(Edge { to: j, action });
                }
            }
        }
        let terminals = marks
            .into_iter()
            .map(|mark| {
                let mut connections = Vec::new();
                index.query(Bounds::points(&[mark.position]).expand(12.), |i| {
                    if let Some(action) = world.jump(
                        nodes[i],
                        mark.position,
                        Some((&mark.position, &mark.interaction)),
                    ) {
                        connections.push((i, action));
                    }
                    false
                });
                (mark, connections)
            })
            .collect();
        Self {
            nodes,
            edges,
            terminals,
        }
    }
}
