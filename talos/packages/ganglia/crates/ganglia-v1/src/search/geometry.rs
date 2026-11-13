//! Search geometry adapter. World owns every physical proof and canonical path.
use super::Point;

pub(super) const EPS: f64 = 1e-8;
pub(super) fn add(a: Point, b: Point) -> Point {
    std::array::from_fn(|i| a[i] + b[i])
}
pub(super) fn sub(a: Point, b: Point) -> Point {
    std::array::from_fn(|i| a[i] - b[i])
}
pub(super) fn scale(a: Point, n: f64) -> Point {
    a.map(|x| x * n)
}
pub(super) fn dot(a: Point, b: Point) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}
pub(super) fn distance(a: Point, b: Point) -> f64 {
    dot(sub(a, b), sub(a, b)).sqrt()
}
pub(super) fn lerp(a: Point, b: Point, t: f64) -> Point {
    add(a, scale(sub(b, a), t))
}
pub(super) struct Geometry<'a> {
    pub world: &'a crate::world::World,
    pub radius: f64,
}
impl<'a> Geometry<'a> {
    pub fn new(world: &'a crate::world::World) -> Result<Self, String> {
        Ok(Self {
            world,
            radius: world.movement.profile.radius,
        })
    }
    pub fn interaction(&self, p: Point, v: &serde_json::Value) -> Result<Vec<Point>, String> {
        let interaction: crate::model::Interaction =
            serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
        let mut points = Vec::new();
        for p in self.world.project(p, Some(&interaction))? {
            if let Some(p) = self.world.standing_foot(p.position)? {
                points.push(p);
            }
        }
        Ok(points)
    }
    pub fn project(&self, p: Point, tolerance: f64) -> Option<Point> {
        self.world
            .project_with_tolerance(p, tolerance, None)
            .ok()?
            .first()
            .and_then(|p| self.world.standing_foot(p.position).ok().flatten())
    }
    pub fn path(&self, a: Point, b: Point) -> Option<Vec<Point>> {
        self.world
            .ground_path(a, b)
            .ok()
            .flatten()
            .map(|p| p.points)
    }
    pub fn clear(&self, a: Point, b: Point, inflation: f64) -> bool {
        self.world.clear(a, b, inflation).unwrap_or(false)
    }
}
