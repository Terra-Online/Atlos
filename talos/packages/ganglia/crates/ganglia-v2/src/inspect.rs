use crate::{backbone::Backbone, geometry::Bounds, graph, types::Point, world::World};
use serde::Serialize;
use std::collections::BTreeMap;

pub(super) fn windows() -> Result<Vec<Bounds>, String> {
    let raw = match std::env::var("GANGLIA_V2_INSPECT_BOUNDS") {
        Ok(raw) => raw,
        Err(std::env::VarError::NotPresent) => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let windows: Vec<Bounds> = serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid GANGLIA_V2_INSPECT_BOUNDS: {error}"))?;
    if windows
        .iter()
        .any(|bounds| (0..3).any(|axis| bounds.min[axis] >= bounds.max[axis]))
    {
        return Err("Inspection windows need increasing XYZ bounds".into());
    }
    Ok(windows)
}

#[derive(Serialize)]
pub(super) struct View {
    min: Point,
    max: Point,
    triangles: Vec<[Point; 3]>,
    nodes: Vec<(Point, bool, bool, usize)>,
    edges: Vec<(usize, usize, &'static str, bool)>,
}

#[derive(Serialize)]
pub(super) struct Coverage {
    span: f64,
    tiles: Vec<(i64, i64, usize, usize, usize)>,
}

pub(super) fn coverage(
    world: &World,
    backbone: &Backbone,
    reached: &[bool],
    to_goal: &[bool],
) -> Option<Coverage> {
    let ground = &world.physical.ground;
    let build = ground.build.as_ref()?;
    let span = build.cell_size? * build.tile_cells? as f64;
    let mut counts: BTreeMap<_, _> = ground
        .tiles
        .as_ref()
        .or(build.tiles.as_ref())?
        .iter()
        .map(|tile| ((tile.x, tile.z), [0; 3]))
        .collect();
    for (index, point) in backbone.nodes.iter().enumerate() {
        let x = (point[0] / span).floor() as i64;
        let z = (point[2] / span).floor() as i64;
        if let Some(count) = counts.get_mut(&(x, z)) {
            count[0] += 1;
            count[1] += usize::from(reached[index]);
            count[2] += usize::from(to_goal[index]);
        }
    }
    Some(Coverage {
        span,
        tiles: counts
            .into_iter()
            .map(|((x, z), [total, start, goal])| (x, z, total, start, goal))
            .collect(),
    })
}

pub(super) fn views(
    windows: &[Bounds],
    world: &World,
    backbone: &Backbone,
    reached: &[bool],
    to_goal: &[bool],
) -> Vec<View> {
    // Decompose the entire directed backbone before cropping inspection windows.
    let (components, _) = graph::components(backbone.nodes.len(), |from| {
        backbone.edges[from]
            .iter()
            .map(|edge| edge.to)
            .chain(backbone.conditional[from].iter().map(|edge| edge.to))
    });
    windows
        .iter()
        .map(|&bounds| capture(bounds, world, backbone, reached, to_goal, &components))
        .collect()
}

fn capture(
    bounds: Bounds,
    world: &World,
    backbone: &Backbone,
    reached: &[bool],
    to_goal: &[bool],
    components: &[usize],
) -> View {
    let mut ids = vec![None; backbone.nodes.len()];
    let mut nodes = Vec::new();
    for (index, &point) in backbone.nodes.iter().enumerate() {
        if (0..3).all(|axis| (bounds.min[axis]..=bounds.max[axis]).contains(&point[axis])) {
            ids[index] = Some(nodes.len());
            nodes.push((point, reached[index], to_goal[index], components[index]));
        }
    }
    let mut edges = Vec::new();
    for (index, from) in ids.iter().enumerate() {
        let Some(from) = *from else { continue };
        edges.extend(
            backbone.edges[index]
                .iter()
                .filter_map(|edge| Some((from, ids[edge.to]?, edge.action.mode, false))),
        );
        edges.extend(
            backbone.conditional[index]
                .iter()
                .filter_map(|edge| Some((from, ids[edge.to]?, edge.flight.action.mode, true))),
        );
    }
    View {
        min: bounds.min,
        max: bounds.max,
        triangles: world.static_triangles(bounds),
        nodes,
        edges,
    }
}
