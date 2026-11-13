use napi::bindgen_prelude::{Float64Array, Uint32Array};
use napi::{Error, Result};
use napi_derive::napi;

type Point = [f64; 3];

#[napi(object)]
pub struct GoalFacing {
    pub forward_x: f64,
    pub forward_z: f64,
    pub sine: f64,
    pub cosine: f64,
}

#[napi(object)]
pub struct GoalClipParameters {
    pub max_vertical: Option<f64>,
    pub facing: Option<GoalFacing>,
}

#[derive(Clone, Copy)]
enum Plane {
    Lower,
    Upper,
    Left,
    Right,
}

#[napi]
pub struct GoalProjectionIndex {
    vertices: Vec<Point>,
    offsets: Vec<usize>,
}

fn invalid() -> Error {
    Error::from_reason("Invalid native goal geometry")
}

fn point(values: &[f64]) -> Result<Point> {
    if values.len() != 3 || values.iter().any(|v| !v.is_finite()) {
        return Err(invalid());
    }
    Ok([values[0], values[1], values[2]])
}

fn minimum(a: f64, b: f64) -> f64 {
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
}

fn maximum(a: f64, b: f64) -> f64 {
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
}

// Include the initial zero addition, as in the JS dot3/distance reductions.
// Reassociation can select a different witness at a triangle or surface tie.
fn dot(a: Point, b: Point) -> f64 {
    let mut sum = 0.0;
    sum += a[0] * b[0];
    sum += a[1] * b[1];
    sum += a[2] * b[2];
    sum
}

fn squared(a: Point, b: Point) -> f64 {
    let mut sum = 0.0;
    for axis in 0..3 {
        let difference = a[axis] - b[axis];
        sum += difference * difference;
    }
    sum
}

fn closest_on_edge(target: Point, a: Point, b: Point) -> Point {
    let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let length_squared = dot(d, d);
    let fraction = if length_squared == 0.0 {
        0.0
    } else {
        maximum(
            0.0,
            minimum(
                1.0,
                dot([target[0] - a[0], target[1] - a[1], target[2] - a[2]], d) / length_squared,
            ),
        )
    };
    [
        a[0] + fraction * d[0],
        a[1] + fraction * d[1],
        a[2] + fraction * d[2],
    ]
}

fn closest_on_triangle(target: Point, a: Point, b: Point, c: Point) -> Point {
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let at = [target[0] - a[0], target[1] - a[1], target[2] - a[2]];
    let aa = dot(ab, ab);
    let bb = dot(ac, ac);
    let cross = dot(ab, ac);
    let determinant = aa * bb - cross * cross;
    if determinant > 1e-20 {
        let atab = dot(at, ab);
        let atac = dot(at, ac);
        let u = (bb * atab - cross * atac) / determinant;
        let v = (aa * atac - cross * atab) / determinant;
        if u >= 0.0 && v >= 0.0 && u + v <= 1.0 {
            return [
                a[0] + u * ab[0] + v * ac[0],
                a[1] + u * ab[1] + v * ac[1],
                a[2] + u * ab[2] + v * ac[2],
            ];
        }
    }
    let mut best = closest_on_edge(target, a, b);
    let mut shortest = squared(target, best);
    let second = closest_on_edge(target, b, c);
    let second_squared = squared(target, second);
    if second_squared < shortest {
        best = second;
        shortest = second_squared;
    }
    let third = closest_on_edge(target, c, a);
    if squared(target, third) < shortest {
        best = third;
    }
    best
}

fn signed_distance(plane: Plane, point: Point, target: Point, clip: &GoalClipParameters) -> f64 {
    match plane {
        Plane::Lower => point[1] - target[1] + clip.max_vertical.expect("height plane"),
        Plane::Upper => target[1] + clip.max_vertical.expect("height plane") - point[1],
        Plane::Left | Plane::Right => {
            let facing = clip.facing.as_ref().expect("facing plane");
            let forward = (point[0] - target[0]) * facing.forward_x
                + (point[2] - target[2]) * facing.forward_z;
            let side = (point[0] - target[0]) * facing.forward_z
                - (point[2] - target[2]) * facing.forward_x;
            match plane {
                Plane::Left => forward * facing.sine + side * facing.cosine,
                _ => forward * facing.sine - side * facing.cosine,
            }
        }
    }
}

fn clip_polygon(
    input: &[Point],
    output: &mut Vec<Point>,
    plane: Plane,
    target: Point,
    clip: &GoalClipParameters,
) {
    output.clear();
    for index in 0..input.len() {
        let a = input[index];
        let b = input[(index + 1) % input.len()];
        let a_distance = signed_distance(plane, a, target, clip);
        let b_distance = signed_distance(plane, b, target, clip);
        let a_inside = a_distance >= 0.0;
        let b_inside = b_distance >= 0.0;
        if a_inside {
            output.push(a);
        }
        if a_inside != b_inside {
            let fraction = a_distance / (a_distance - b_distance);
            output.push([
                a[0] + fraction * (b[0] - a[0]),
                a[1] + fraction * (b[1] - a[1]),
                a[2] + fraction * (b[2] - a[2]),
            ]);
        }
    }
}

fn closest_on_surface(
    vertices: &[Point],
    target: Point,
    clip: &GoalClipParameters,
    polygon: &mut Vec<Point>,
    scratch: &mut Vec<Point>,
) -> Option<(Point, f64)> {
    let mut best = None;
    let mut shortest = f64::INFINITY;
    let a = vertices[0];
    let clipped = clip.max_vertical.is_some() || clip.facing.is_some();
    for fan in 1..vertices.len() - 1 {
        let b = vertices[fan];
        let c = vertices[fan + 1];
        let area_xz = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
        if area_xz.abs() < 1e-10 {
            continue;
        }
        if !clipped {
            let candidate = closest_on_triangle(target, a, b, c);
            let candidate_squared = squared(target, candidate);
            if candidate_squared < shortest {
                best = Some(candidate);
                shortest = candidate_squared;
            }
            continue;
        }
        polygon.clear();
        polygon.extend([a, b, c]);
        for plane in [Plane::Lower, Plane::Upper, Plane::Left, Plane::Right] {
            let enabled = match plane {
                Plane::Lower | Plane::Upper => clip.max_vertical.is_some(),
                Plane::Left | Plane::Right => clip.facing.is_some(),
            };
            if enabled {
                clip_polygon(polygon, scratch, plane, target, clip);
                std::mem::swap(polygon, scratch);
            }
        }
        if polygon.is_empty() {
            continue;
        }
        if polygon.len() < 3 {
            let candidate = closest_on_edge(
                target,
                polygon[0],
                *polygon.last().expect("nonempty polygon"),
            );
            let candidate_squared = squared(target, candidate);
            if candidate_squared < shortest {
                best = Some(candidate);
                shortest = candidate_squared;
            }
        } else {
            for index in 1..polygon.len() - 1 {
                let candidate =
                    closest_on_triangle(target, polygon[0], polygon[index], polygon[index + 1]);
                let candidate_squared = squared(target, candidate);
                if candidate_squared < shortest {
                    best = Some(candidate);
                    shortest = candidate_squared;
                }
            }
        }
    }
    best.map(|point| (point, shortest.sqrt()))
}

#[napi]
impl GoalProjectionIndex {
    #[napi(constructor)]
    pub fn new(positions: Float64Array, surface_offsets: Uint32Array) -> Result<Self> {
        if !positions.len().is_multiple_of(3)
            || positions.iter().any(|v| !v.is_finite())
            || surface_offsets.is_empty()
            || surface_offsets[0] != 0
            || *surface_offsets.last().expect("nonempty offsets") as usize != positions.len() / 3
            || surface_offsets
                .windows(2)
                .any(|pair| pair[1] < pair[0] || pair[1] - pair[0] < 3)
        {
            return Err(invalid());
        }
        Ok(Self {
            vertices: positions
                .as_chunks::<3>()
                .0
                .iter()
                .map(|p| [p[0], p[1], p[2]])
                .collect(),
            offsets: surface_offsets
                .iter()
                .map(|&offset| offset as usize)
                .collect(),
        })
    }

    #[napi]
    pub fn project_point(
        &self,
        target: Float64Array,
        candidates: Uint32Array,
        max_vertical: f64,
    ) -> Result<Float64Array> {
        let target = point(&target)?;
        self.check_candidates(&candidates)?;
        if !max_vertical.is_finite() || max_vertical < 0.0 {
            return Err(invalid());
        }
        let mut best = None;
        let mut error = f64::INFINITY;
        // Candidate order is supplied by the JS broad phase and remains unchanged.
        // Strict updates retain the first triangle and surface at an equal height.
        for &candidate in candidates.iter() {
            let id = candidate as usize;
            let vertices = &self.vertices[self.offsets[id]..self.offsets[id + 1]];
            let a = vertices[0];
            for fan in 1..vertices.len() - 1 {
                let b = vertices[fan];
                let c = vertices[fan + 1];
                let det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
                if det.abs() < 1e-10 {
                    continue;
                }
                let u =
                    ((b[2] - c[2]) * (target[0] - c[0]) + (c[0] - b[0]) * (target[2] - c[2])) / det;
                let v =
                    ((c[2] - a[2]) * (target[0] - c[0]) + (a[0] - c[0]) * (target[2] - c[2])) / det;
                if u < -1e-8 || v < -1e-8 || u + v > 1.0 + 1e-8 {
                    continue;
                }
                let y = u * a[1] + v * b[1] + (1.0 - u - v) * c[1];
                let delta = (y - target[1]).abs();
                if delta <= max_vertical && delta < error {
                    best = Some((candidate, y));
                    error = delta;
                }
            }
        }
        Ok(match best {
            Some((id, height)) => vec![id as f64, target[0], height, target[2], error],
            None => Vec::new(),
        }
        .into())
    }

    #[napi]
    pub fn closest_surfaces(
        &self,
        target: Float64Array,
        candidates: Uint32Array,
        clip: GoalClipParameters,
    ) -> Result<Float64Array> {
        let target = point(&target)?;
        self.check_candidates(&candidates)?;
        if clip.max_vertical.is_some_and(|v| !v.is_finite() || v < 0.0)
            || clip.facing.as_ref().is_some_and(|facing| {
                [
                    facing.forward_x,
                    facing.forward_z,
                    facing.sine,
                    facing.cosine,
                ]
                .iter()
                .any(|v| !v.is_finite())
            })
        {
            return Err(invalid());
        }
        let mut result = Vec::new();
        // Two buffers serve every clipped fan triangle in this query. The JS
        // implementation's plane and vertex ordering is preserved while avoiding
        // a fresh polygon allocation for each clipping plane.
        let mut polygon = Vec::new();
        let mut scratch = Vec::new();
        for &candidate in candidates.iter() {
            let id = candidate as usize;
            if let Some((position, distance)) = closest_on_surface(
                &self.vertices[self.offsets[id]..self.offsets[id + 1]],
                target,
                &clip,
                &mut polygon,
                &mut scratch,
            ) {
                result.extend([id as f64, position[0], position[1], position[2], distance]);
            }
        }
        Ok(result.into())
    }
}

impl GoalProjectionIndex {
    fn check_candidates(&self, candidates: &[u32]) -> Result<()> {
        if candidates
            .iter()
            .any(|&id| id as usize + 1 >= self.offsets.len())
        {
            Err(invalid())
        } else {
            Ok(())
        }
    }
}
