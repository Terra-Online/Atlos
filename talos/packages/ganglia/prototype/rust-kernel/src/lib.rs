mod candidate_search;
mod collision;
mod goals;
mod ground_trace;
mod locomotion;
mod route_search;

use napi::bindgen_prelude::{Float64Array, Uint32Array};
use napi::{Error, Result};
use napi_derive::napi;
use std::collections::HashMap;

#[derive(Clone)]
struct Vertex {
    ordinal: usize,
    component: u32,
    point: [f64; 3],
    cell: (i64, i64),
    retained: bool,
    repeats: Vec<usize>,
}

#[derive(Default)]
struct Group {
    component: u32,
    sources: Vec<usize>,
    retained: Vec<usize>,
}

struct Proposal {
    later: usize,
    earlier: usize,
    occurrence: usize,
    length: f64,
    rank: [f64; 4],
    first: [f64; 4],
}

type Bucket = (u32, u32, i64, i64, i64);
type PositionKey = (u32, i64, i64, [u64; 3]);

// Match V8's two/three-argument Math.hypot evaluation order. A different
// rounding at an equal-length tie can select a different surface witness.
// https://github.com/v8/v8/blob/main/src/builtins/math.tq
fn hypot2(x: f64, y: f64) -> f64 {
    let m = x.abs().max(y.abs());
    if m == 0.0 {
        return 0.0;
    }
    let a = x / m;
    let b = y / m;
    (a * a + b * b).sqrt() * m
}

fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    let x = (a[0] - b[0]).abs();
    let y = (a[1] - b[1]).abs();
    let z = (a[2] - b[2]).abs();
    let m = x.max(y).max(z);
    if m == 0.0 {
        return 0.0;
    }
    let pa = (x / m) * (x / m);
    let pb = (y / m) * (y / m);
    let compensation = (pa + pb) - pa - pb;
    let pc = (z / m) * (z / m) - compensation;
    (pa + pb + pc).sqrt() * m
}

#[napi]
pub struct TransferIndex {
    vertices: Vec<Vertex>,
    cells: HashMap<(i64, i64), Vec<Group>>,
    components: HashMap<u32, Vec<usize>>,
    radius: f64,
    vertical_range: f64,
}

#[napi]
impl TransferIndex {
    #[napi(constructor)]
    pub fn new(
        points: Float64Array,
        components: Uint32Array,
        radius: f64,
        vertical_range: f64,
    ) -> Result<Self> {
        if points.len() != components.len() * 3
            || !radius.is_finite()
            || radius <= 0.0
            || !vertical_range.is_finite()
            || vertical_range <= 0.0
        {
            return Err(Error::from_reason("Invalid transfer index inputs"));
        }
        let mut index = Self {
            vertices: Vec::new(),
            cells: HashMap::new(),
            components: HashMap::new(),
            radius,
            vertical_range,
        };
        let mut positions: HashMap<PositionKey, usize> = HashMap::new();
        for ordinal in 0..components.len() {
            let point = [
                points[3 * ordinal],
                points[3 * ordinal + 1],
                points[3 * ordinal + 2],
            ];
            // Integer spatial keys must remain exact when reconstructed in JS.
            if point.iter().any(|v| !v.is_finite() || v.abs() > 9e15)
                || (point[0] / radius).abs() > 9e15
                || (point[2] / radius).abs() > 9e15
            {
                return Err(Error::from_reason(
                    "Prototype requires finite, safe spatial keys",
                ));
            }
            let cell = (
                (point[0] / radius).floor() as i64,
                (point[2] / radius).floor() as i64,
            );
            let component = components[ordinal];
            let bits = point.map(|v| if v == 0.0 { 0 } else { v.to_bits() });
            let key = (component, cell.0, cell.1, bits);
            if let Some(&previous) = positions.get(&key) {
                index.vertices[previous].repeats.push(ordinal);
                continue;
            }
            let groups = index.cells.entry(cell).or_default();
            let slot = match groups.iter().position(|g| g.component == component) {
                Some(slot) => slot,
                None => {
                    groups.push(Group {
                        component,
                        ..Group::default()
                    });
                    groups.len() - 1
                }
            };
            let group = &mut groups[slot];
            let retained = !group
                .retained
                .iter()
                .any(|&v| distance(point, index.vertices[v].point) < 0.001);
            let slot = index.vertices.len();
            index.vertices.push(Vertex {
                ordinal,
                component,
                point,
                cell,
                retained,
                repeats: Vec::new(),
            });
            positions.insert(key, slot);
            index.components.entry(component).or_default().push(slot);
            group.sources.push(slot);
            if retained {
                group.retained.push(slot);
            }
        }
        Ok(index)
    }

    #[napi]
    pub fn query(&self, component: u32) -> Float64Array {
        let mut proposals: HashMap<Bucket, Proposal> = HashMap::new();
        for &slot in self.components.get(&component).into_iter().flatten() {
            let vertex = &self.vertices[slot];
            for dx in -1..=1 {
                for dz in -1..=1 {
                    if let Some(groups) = self.cells.get(&(vertex.cell.0 + dx, vertex.cell.1 + dz))
                    {
                        for group in groups {
                            if group.component == component {
                                continue;
                            }
                            for &other in &group.retained {
                                self.consider(slot, other, &mut proposals);
                            }
                            if vertex.retained {
                                for &other in &group.sources {
                                    self.consider(other, slot, &mut proposals);
                                }
                            }
                        }
                    }
                }
            }
        }
        let mut proposals: Vec<_> = proposals.into_values().collect();
        proposals.sort_by(|a, b| compare(&a.first, &b.first));
        let mut packed = Vec::with_capacity(proposals.len() * 12);
        for p in proposals {
            packed.extend([
                self.vertices[p.later].ordinal as f64,
                self.vertices[p.earlier].ordinal as f64,
                p.occurrence as f64,
                p.length,
            ]);
            packed.extend(p.rank);
            packed.extend(p.first);
        }
        packed.into()
    }
}

impl TransferIndex {
    fn consider(&self, later: usize, earlier: usize, proposals: &mut HashMap<Bucket, Proposal>) {
        let a = &self.vertices[later];
        let b = &self.vertices[earlier];
        if a.component == b.component
            || (a.point[1] - b.point[1]).abs() > self.vertical_range
            || hypot2(a.point[0] - b.point[0], a.point[2] - b.point[2]) > self.radius
        {
            return;
        }
        let occurrence = if a.ordinal > b.ordinal {
            a.ordinal
        } else {
            let slot = a.repeats.partition_point(|&ordinal| ordinal <= b.ordinal);
            match a.repeats.get(slot) {
                Some(&ordinal) => ordinal,
                None => return,
            }
        };
        let key = (
            a.component.min(b.component),
            a.component.max(b.component),
            a.point[0].floor() as i64,
            a.point[1].floor() as i64,
            a.point[2].floor() as i64,
        );
        let rank = [
            occurrence as f64,
            (b.point[0] / self.radius).floor() - (a.point[0] / self.radius).floor(),
            (b.point[2] / self.radius).floor() - (a.point[2] / self.radius).floor(),
            b.ordinal as f64,
        ];
        let length = distance(a.point, b.point);
        let first = match proposals.get_mut(&key) {
            Some(previous) => {
                let first = if compare(&previous.first, &rank).is_lt() {
                    previous.first
                } else {
                    rank
                };
                if previous.length < length
                    || (previous.length == length && !compare(&previous.rank, &rank).is_gt())
                {
                    previous.first = first;
                    return;
                }
                first
            }
            None => rank,
        };
        proposals.insert(
            key,
            Proposal {
                later,
                earlier,
                occurrence,
                length,
                rank,
                first,
            },
        );
    }
}

fn compare(a: &[f64; 4], b: &[f64; 4]) -> std::cmp::Ordering {
    for (a, b) in a.iter().zip(b) {
        let order = a.partial_cmp(b).expect("finite rank");
        if !order.is_eq() {
            return order;
        }
    }
    std::cmp::Ordering::Equal
}
