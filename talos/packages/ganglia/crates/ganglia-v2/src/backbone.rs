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
    pub fn build(world: &World, marks: Vec<Mark>, anchors: Vec<Point>) -> Self {
        let profile = std::env::var_os("GANGLIA_PROFILE").is_some();
        let started = std::time::Instant::now();
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
        let mut nodes: Vec<_> = interior
            .into_values()
            .chain(ledges.into_values())
            .chain(anchors)
            .filter_map(|p| world.standing(p))
            .filter(|p| !world.blocked(*p, *p, 0.))
            .collect();
        // Authored traversal ports are critical nodes even when lattice
        // representatives omit their small interaction volumes.
        let launches = crate::devices::launches(world, &nodes, &marks);
        let devices: Vec<_> = crate::devices::ropes(world)
            .into_iter()
            .chain(launches.edges)
            .chain(crate::devices::rides(world))
            .collect();
        // A free pad can have many outgoing flights from the same launch point.
        // Share that port so duplicate coordinates cannot consume its neighbours.
        let mut ports: BTreeMap<_, _> = nodes
            .iter()
            .enumerate()
            .map(|(index, point)| (point.map(f64::to_bits), index))
            .collect();
        let mut port = |point: Point| {
            *ports.entry(point.map(f64::to_bits)).or_insert_with(|| {
                let index = nodes.len();
                nodes.push(point);
                index
            })
        };
        let devices: Vec<_> = devices
            .into_iter()
            .map(|action| (port(action.start()), port(action.end()), action))
            .collect();
        let launch_terminals: Vec<_> = launches
            .terminals
            .into_iter()
            .map(|(mark, action)| (mark, port(action.start()), action))
            .collect();
        let index = Index::new(
            &nodes
                .iter()
                .map(|p| Bounds::points(&[*p]))
                .collect::<Vec<_>>(),
        );
        let mut edges: Vec<Vec<Edge>> = (0..nodes.len()).map(|_| Vec::new()).collect();
        if profile {
            eprintln!(
                "ganglia-v2 backbone: {} nodes, {} device actions",
                nodes.len(),
                devices.len()
            );
        }
        for (i, &a) in nodes.iter().enumerate() {
            if profile && i % 1024 == 0 {
                eprintln!(
                    "ganglia-v2 backbone: {i}/{} nodes, {:.3}s",
                    nodes.len(),
                    started.elapsed().as_secs_f64()
                );
            }
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
        for (from, to, action) in devices {
            edges[from].push(Edge { to, action });
        }
        let terminals = marks
            .into_iter()
            .enumerate()
            .map(|(mark_index, mark)| {
                let mut connections = Vec::new();
                for (index, node, action) in &launch_terminals {
                    if *index == mark_index {
                        connections.push((*node, action.clone()));
                    }
                }
                index.query(Bounds::points(&[mark.position]).expand(12.), |i| {
                    if let Some(action) = world.collect(nodes[i], mark.position, &mark.interaction)
                    {
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
