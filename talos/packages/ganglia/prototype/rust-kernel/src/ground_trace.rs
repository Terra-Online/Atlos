use napi::bindgen_prelude::{Float64Array, Uint8Array, Uint32Array};
use napi::{Error, Result};
use napi_derive::napi;

type Point = [f64; 3];
const TOLERANCE: f64 = 1e-7;

#[napi(object)]
pub struct GroundTraceSnapshot {
    pub triangles: Float64Array,
    pub neighbor_offsets: Uint32Array,
    pub neighbor_targets: Uint32Array,
    pub neighbor_opposites: Uint32Array,
    pub portal_endpoints: Float64Array,
    pub has_portal: Uint8Array,
}

struct Triangle {
    vertices: [Point; 3],
    determinant: f64,
}

struct Neighbor {
    target: usize,
    opposite: usize,
    portal: Option<(Point, Point)>,
}

#[derive(Clone, Copy)]
struct Clip {
    near: f64,
    far: f64,
    first: Point,
    last: Point,
}

#[derive(Clone, Copy)]
struct Entry {
    triangle: usize,
    fraction: f64,
    previous: Option<usize>,
}

#[napi]
pub struct GroundTraceIndex {
    triangles: Vec<Triangle>,
    offsets: Vec<usize>,
    neighbors: Vec<Neighbor>,
    generation: u64,
    clip_generation: Vec<u64>,
    clips: Vec<Option<Clip>>,
    reached_generation: Vec<u64>,
    reached: Vec<usize>,
    queue: Vec<Entry>,
}

fn invalid() -> Error {
    Error::from_reason("Invalid native ground trace snapshot")
}

fn point(values: &[f64]) -> Result<Point> {
    if values.len() != 3 || values.iter().any(|v| !v.is_finite()) {
        return Err(Error::from_reason("Invalid ground visibility endpoints"));
    }
    Ok([values[0], values[1], values[2]])
}

// Math.min/max propagate NaN and choose a specific sign at zero. Fractions can
// reach signed zero on portal boundaries, so retain both behaviors explicitly.
fn minimum<const N: usize>(values: [f64; N]) -> f64 {
    values.into_iter().fold(f64::INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else if a == 0.0 && b == 0.0 {
            if a.is_sign_negative() || b.is_sign_negative() {
                -0.0
            } else {
                0.0
            }
        } else {
            a.min(b)
        }
    })
}

fn maximum<const N: usize>(values: [f64; N]) -> f64 {
    values.into_iter().fold(f64::NEG_INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else if a == 0.0 && b == 0.0 {
            if a.is_sign_positive() || b.is_sign_positive() {
                0.0
            } else {
                -0.0
            }
        } else {
            a.max(b)
        }
    })
}

fn hypot2(x: f64, y: f64) -> f64 {
    if x.is_infinite() || y.is_infinite() {
        f64::INFINITY
    } else {
        super::hypot2(x, y)
    }
}

fn weights_at(triangle: &Triangle, point: Point) -> Point {
    let [a, b, c] = triangle.vertices;
    let x = point[0] - a[0];
    let z = point[2] - a[2];
    let u = (x * (c[2] - a[2]) - z * (c[0] - a[0])) / triangle.determinant;
    let v = ((b[0] - a[0]) * z - (b[2] - a[2]) * x) / triangle.determinant;
    [1.0 - u - v, u, v]
}

fn height_at(triangle: &Triangle, point: Point) -> f64 {
    weights_at(triangle, point)
        .into_iter()
        .enumerate()
        .fold(0.0, |height, (index, weight)| {
            height + weight * triangle.vertices[index][1]
        })
}

fn clip_triangle(triangle: &Triangle, start: Point, end: Point) -> Option<Clip> {
    let first = weights_at(triangle, start);
    let last = weights_at(triangle, end);
    let mut near = 0.0;
    let mut far = 1.0;
    for index in 0..3 {
        let delta = last[index] - first[index];
        if delta.abs() < 1e-14 {
            if first[index] < -TOLERANCE {
                return None;
            }
            continue;
        }
        let crossing = -first[index] / delta;
        if delta > 0.0 {
            near = maximum([near, crossing]);
        } else {
            far = minimum([far, crossing]);
        }
    }
    if near > far + TOLERANCE || far < 0.0 || near > 1.0 {
        return None;
    }
    Some(Clip {
        near: maximum([0.0, near]),
        far: minimum([1.0, far]),
        first,
        last,
    })
}

fn interpolate(start: Point, end: Point, fraction: f64) -> Point {
    [
        start[0] + fraction * (end[0] - start[0]),
        start[1] + fraction * (end[1] - start[1]),
        start[2] + fraction * (end[2] - start[2]),
    ]
}

#[napi]
impl GroundTraceIndex {
    #[napi(constructor)]
    pub fn new(snapshot: GroundTraceSnapshot) -> Result<Self> {
        let count = snapshot.triangles.len() / 9;
        let edges = snapshot.neighbor_targets.len();
        if !snapshot.triangles.len().is_multiple_of(9)
            || snapshot.triangles.iter().any(|v| !v.is_finite())
            || snapshot.neighbor_offsets.len() != count + 1
            || snapshot.neighbor_offsets[0] != 0
            || snapshot.neighbor_offsets[count] as usize != edges
            || snapshot
                .neighbor_offsets
                .windows(2)
                .any(|pair| pair[0] > pair[1])
            || snapshot.neighbor_opposites.len() != edges
            || snapshot.has_portal.len() != edges
            || snapshot.portal_endpoints.len() != edges * 6
            || snapshot.portal_endpoints.iter().any(|v| !v.is_finite())
            || snapshot
                .neighbor_targets
                .iter()
                .any(|&target| target as usize >= count)
            || snapshot
                .neighbor_opposites
                .iter()
                .any(|&opposite| opposite >= 3)
        {
            return Err(invalid());
        }
        let triangles = snapshot
            .triangles
            .as_chunks::<9>()
            .0
            .iter()
            .map(|values| {
                let a = [values[0], values[1], values[2]];
                let b = [values[3], values[4], values[5]];
                let c = [values[6], values[7], values[8]];
                let determinant = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
                Triangle {
                    vertices: [a, b, c],
                    determinant,
                }
            })
            .collect();
        let neighbors = (0..edges)
            .map(|edge| {
                let offset = edge * 6;
                Neighbor {
                    target: snapshot.neighbor_targets[edge] as usize,
                    opposite: snapshot.neighbor_opposites[edge] as usize,
                    portal: if snapshot.has_portal[edge] != 0 {
                        let values = &snapshot.portal_endpoints[offset..offset + 6];
                        Some((
                            [values[0], values[1], values[2]],
                            [values[3], values[4], values[5]],
                        ))
                    } else {
                        None
                    },
                }
            })
            .collect();
        Ok(Self {
            triangles,
            offsets: snapshot
                .neighbor_offsets
                .iter()
                .map(|&offset| offset as usize)
                .collect(),
            neighbors,
            generation: 0,
            clip_generation: vec![0; count],
            clips: vec![None; count],
            reached_generation: vec![0; count],
            reached: vec![0; count],
            queue: Vec::new(),
        })
    }

    #[napi]
    pub fn trace(
        &mut self,
        start: Float64Array,
        end: Float64Array,
        support_ids: Uint32Array,
    ) -> Result<Float64Array> {
        let start = point(&start)?;
        let end = point(&end)?;
        if support_ids
            .iter()
            .any(|&id| id as usize >= self.triangles.len())
        {
            return Err(invalid());
        }
        if hypot2(end[0] - start[0], end[2] - start[2]) < 1e-10 {
            return Ok(if super::distance(start, end) < TOLERANCE {
                [start, end].into_iter().flatten().collect::<Vec<_>>()
            } else {
                Vec::new()
            }
            .into());
        }
        self.begin();
        for &id in support_ids.iter() {
            let id = id as usize;
            if let Some(interval) = self.clipped(id, start, end)
                && interval.near <= TOLERANCE
            {
                self.reached_generation[id] = self.generation;
                self.reached[id] = self.queue.len();
                self.queue.push(Entry {
                    triangle: id,
                    fraction: 0.0,
                    previous: None,
                });
            }
        }
        let mut head = 0;
        while head < self.queue.len() {
            let entry = self.queue[head];
            let triangle = entry.triangle;
            let interval = self
                .clipped(triangle, start, end)
                .expect("queued clipped triangle");
            if self.reached[triangle] != head {
                head += 1;
                continue;
            }
            if interval.far >= 1.0 - TOLERANCE
                && (height_at(&self.triangles[triangle], end) - end[1]).abs() <= TOLERANCE
            {
                return Ok(self.reconstruct(head, start, end).into());
            }
            for edge in self.offsets[triangle]..self.offsets[triangle + 1] {
                let target = self.neighbors[edge].target;
                let opposite = self.neighbors[edge].opposite;
                let Some(next) = self.clipped(target, start, end) else {
                    continue;
                };
                let first = interval.first[opposite];
                let delta = interval.last[opposite] - first;
                let mut fraction = if delta.abs() < 1e-14 {
                    if first.abs() > TOLERANCE {
                        continue;
                    }
                    maximum([entry.fraction, interval.near, next.near])
                } else {
                    -first / delta
                };
                if fraction < entry.fraction - TOLERANCE
                    || fraction < next.near - TOLERANCE
                    || fraction > minimum([interval.far, next.far]) + TOLERANCE
                    || fraction > 1.0
                {
                    continue;
                }
                fraction = maximum([0.0, fraction]);
                if let Some((portal_start, portal_end)) = self.neighbors[edge].portal {
                    let point = interpolate(start, end, fraction);
                    let dx = portal_end[0] - portal_start[0];
                    let dz = portal_end[2] - portal_start[2];
                    let length_squared = dx * dx + dz * dz;
                    let t = if length_squared < 1e-16 {
                        0.0
                    } else {
                        ((point[0] - portal_start[0]) * dx + (point[2] - portal_start[2]) * dz)
                            / length_squared
                    };
                    if t < -TOLERANCE
                        || t > 1.0 + TOLERANCE
                        || hypot2(
                            point[0] - portal_start[0] - t * dx,
                            point[2] - portal_start[2] - t * dz,
                        ) > 1e-4
                    {
                        continue;
                    }
                }
                if self.reached_generation[target] == self.generation
                    && self.queue[self.reached[target]].fraction <= fraction + TOLERANCE
                {
                    continue;
                }
                self.reached_generation[target] = self.generation;
                self.reached[target] = self.queue.len();
                self.queue.push(Entry {
                    triangle: target,
                    fraction,
                    previous: Some(head),
                });
            }
            head += 1;
        }
        Ok(Vec::new().into())
    }
}

impl GroundTraceIndex {
    fn begin(&mut self) {
        if self.generation == u64::MAX {
            self.clip_generation.fill(0);
            self.reached_generation.fill(0);
            self.generation = 1;
        } else {
            self.generation += 1;
        }
        self.queue.clear();
    }

    fn clipped(&mut self, triangle: usize, start: Point, end: Point) -> Option<Clip> {
        if self.clip_generation[triangle] != self.generation {
            self.clips[triangle] = clip_triangle(&self.triangles[triangle], start, end);
            self.clip_generation[triangle] = self.generation;
        }
        self.clips[triangle]
    }

    fn reconstruct(&self, mut entry: usize, start: Point, end: Point) -> Vec<f64> {
        let mut crossings = Vec::new();
        while let Some(previous) = self.queue[entry].previous {
            let current = self.queue[entry];
            let point = interpolate(start, end, current.fraction);
            crossings.push([
                point[0],
                height_at(&self.triangles[current.triangle], point),
                point[2],
            ]);
            crossings.push([
                point[0],
                height_at(&self.triangles[self.queue[previous].triangle], point),
                point[2],
            ]);
            entry = previous;
        }
        // The TS reverse applies to the entire crossings array, including each
        // height pair. Parent entries remain in the queue even after replacement.
        let mut result = Vec::with_capacity((crossings.len() + 2) * 3);
        result.extend(start);
        for crossing in crossings.into_iter().rev() {
            result.extend(crossing);
        }
        result.extend(end);
        result
    }
}
