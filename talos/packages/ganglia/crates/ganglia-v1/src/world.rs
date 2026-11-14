//! Immutable physical snapshot and geometry proofs used by route search.
//! Generated support is a triangle mesh, independent of a TypeScript/Recast build.
//! A projection is only a support proposal: walking and flight methods additionally
//! validate the full swept body against collision, walls and declared coverage.
mod boundaries;
mod collision;
mod devices;
mod flight;
mod ground;
#[cfg(test)]
mod tests;
mod walls;
use crate::model::*;
pub use collision::{GroundHit, Hit};
use collision::{Index, cross, hypot, sub};
pub use flight::FlightControl;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    hash::{Hash, Hasher},
};
#[derive(Clone, Debug)]
pub struct Coverage {
    pub collision_bounds: Option<Bounds>,
    pub support_bounds: Option<Bounds>,
    pub declared: Value,
    bounds: Option<Bounds>,
    tiles: Option<HashSet<(i64, i64)>>,
    tile_span: f64,
}
#[derive(Clone, Debug)]
pub struct Projection {
    pub surface: String,
    pub position: Vec3,
    pub distance: f64,
}
/// An uncovered source edge interval, clipped to an XZ query rectangle.
/// Search chooses insets and validates physical support and motion separately.
#[derive(Clone, Debug)]
pub struct Boundary {
    pub surface: String,
    pub points: [Vec3; 2],
    /// Unit horizontal normal pointing into the source polygon.
    pub inward: Vec3,
}
#[derive(Clone, Debug)]
pub struct GroundPath {
    pub points: Vec<Vec3>,
    pub length: f64,
    pub cost: f64,
}
#[derive(Clone, Debug)]
pub struct Discovery {
    pub connections: Vec<Connection>,
    pub attempts: usize,
    pub truncated: bool,
}
#[derive(Clone, Debug)]
pub struct Outcome {
    pub id: String,
    pub reason: String,
}
#[derive(Clone, Debug)]
pub struct World {
    pub surfaces: Vec<Surface>,
    pub portals: Vec<Portal>,
    pub connections: Vec<Connection>,
    pub boosts: Vec<Boost>,
    pub movement: Movement,
    pub locomotion: Option<Locomotion>,
    pub devices: Devices,
    pub revision: String,
    pub coverage: Coverage,
    pub outcomes: Vec<Outcome>,
    /// Original normalized host envelope, including source revision and witness metadata.
    pub snapshot: Value,
    walls: Vec<Wall>,
    collision: Index,
    support: Index,
    owners: Vec<usize>,
    surface_ids: BTreeMap<String, usize>,
    portal_owners: Vec<Vec<usize>>,
    components: Vec<usize>,
    ground_graph: std::sync::OnceLock<ground::Graph>,
}
pub fn distance(a: Vec3, b: Vec3) -> f64 {
    hypot(sub(a, b))
}
pub fn path_length(points: &[Vec3]) -> f64 {
    points.windows(2).map(|p| distance(p[0], p[1])).sum()
}
fn decode<T: DeserializeOwned>(v: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(v.clone()).map_err(|e| format!("Invalid {name}: {e}"))
}
fn optional<T: DeserializeOwned>(v: &Value, name: &str) -> Result<Option<T>, String> {
    if v.is_null() {
        Ok(None)
    } else {
        decode(v, name).map(Some)
    }
}
fn number(v: &Value, key: &str, fallback: f64) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(fallback)
}
fn finite(p: Vec3) -> bool {
    p.iter().all(|v| v.is_finite())
}
// Keep already supported feet exact: authored actions and walking successors
// must meet without changing their execution witnesses. The shared physical
// verifier accepts clearances between 5 and 10 mm, including numerical tolerance.
// A surface input also authorizes exact navigation feet when raw collision has
// no supporting face; the mesh is its supplied support contract.
fn standing_height(height: f64, support: f64, mesh_support: bool) -> f64 {
    if (mesh_support && (height - support).abs() <= 1e-6)
        || (0.005 - 1e-6..=0.01 + 1e-6).contains(&(height - support))
    {
        height
    } else {
        support + 0.01
    }
}
impl World {
    pub fn new(snapshot: Value) -> Result<Self, String> {
        let kind = snapshot
            .get("kind")
            .and_then(Value::as_str)
            .ok_or("Missing snapshot kind")?;
        if !matches!(kind, "physical" | "surfaces") {
            return Err("World requires normalized physical or surfaces facts".into());
        }
        let input = snapshot.get("input").ok_or("Missing snapshot input")?;
        let physical = kind == "physical";
        let ground = if physical { &input["ground"] } else { input };
        let options = if physical {
            &ground["options"]
        } else {
            &input["movement"]
        };
        let locomotion: Option<Locomotion> = optional(
            if physical {
                &input["locomotion"]
            } else {
                &options["locomotion"]
            },
            "locomotion",
        )?;
        let raw_movement = &input["movement"];
        let profile: Profile = decode(&options["profile"], "profile")?;
        let model: JumpModel = decode(&raw_movement["model"], "jump model")?;
        let speed = number(
            options,
            "speed",
            locomotion.as_ref().map_or(f64::NAN, |l| l.speed),
        );
        let movement = Movement {
            speed,
            max_vertical: number(options, "maxVertical", 0.5),
            profile,
            model,
            run_air_speed: number(raw_movement, "runAirSpeed", 0.),
            max_slope: number(raw_movement, "maxSlope", 45.),
            max_drop: number(raw_movement, "maxDrop", 100.),
            max_horizontal_distance: number(raw_movement, "maxHorizontalDistance", 100.),
            step_up: number(raw_movement, "stepUp", 0.3),
            step_down: number(raw_movement, "stepDown", 0.3),
            active_boost: options["activeBoost"].as_str().map(str::to_owned),
        };
        validate_movement(&movement)?;
        let mut surfaces: Vec<Surface> = decode(&ground["surfaces"], "surfaces")?;
        let generated = physical && surfaces.is_empty();
        let walls: Vec<Wall> = if physical {
            optional::<Vec<Wall>>(&input["roundedWalls"], "walls")?
                .or(optional::<Vec<Wall>>(&options["walls"], "walls")?)
                .unwrap_or_default()
        } else {
            decode(&input["walls"], "walls")?
        };
        walls::validate(&walls)?;
        let geometry: CollisionGeometry = decode(&input["collision"], "collision")?;
        let collision_bounds: Option<Bounds> =
            optional(&input["collisionOptions"]["bounds"], "collision bounds")?;
        let support_bounds: Option<Bounds> = optional(&ground["build"]["bounds"], "build bounds")?;
        let collision = Index::new(&geometry, collision_bounds.clone())?;
        // Empty raw ground is intentional for host snapshots: generate all upward,
        // slope-admissible collision faces. Exact clearance is checked on each path.
        if physical && surfaces.is_empty() {
            for (id, t) in collision.faces.iter().enumerate() {
                let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
                let len = hypot(n);
                if len == 0. || n[1] / len < movement.max_slope.to_radians().cos() {
                    continue;
                }
                let vertices = ground::clip_to_bounds(t.to_vec(), support_bounds.as_ref());
                if vertices.len() >= 3 {
                    surfaces.push(Surface {
                        id: format!("ground/{id}"),
                        vertices,
                        portals: None,
                        extra: Extra::new(),
                    });
                }
            }
        }
        let devices: Devices = optional(&input["devices"], "devices")?.unwrap_or_default();
        for d in &devices.moving_supports {
            for s in &d.surfaces {
                let mut s = s.clone();
                s.id = format!("moving/{}/{}", d.id, s.id);
                s.extra
                    .insert("supportDevice".into(), Value::String(d.id.clone()));
                s.extra.insert(
                    "supportAssumption".into(),
                    Value::String(d.assumption.clone()),
                );
                surfaces.push(s);
            }
        }
        let mut surface_ids = BTreeMap::new();
        let mut faces = vec![];
        let mut owners = vec![];
        for (id, s) in surfaces.iter().enumerate() {
            if s.id.is_empty()
                || s.vertices.len() < 3
                || s.vertices.iter().any(|&p| !finite(p))
                || s.portals
                    .as_ref()
                    .is_some_and(|edges| edges.iter().any(|&i| i >= s.vertices.len()))
                || surface_ids.insert(s.id.clone(), id).is_some()
            {
                return Err("Invalid or duplicate surface".into());
            }
            for i in 1..s.vertices.len() - 1 {
                let t = [s.vertices[0], s.vertices[i], s.vertices[i + 1]];
                if cross(sub(t[1], t[0]), sub(t[2], t[0]))[1].abs() > 1e-12 {
                    faces.push(if cross(sub(t[1], t[0]), sub(t[2], t[0]))[1] < 0. {
                        [t[0], t[2], t[1]]
                    } else {
                        t
                    });
                    owners.push(id);
                }
            }
        }
        let support = Index::from_faces(faces, None)?;
        let mut portals: Vec<Portal> =
            optional(&options["portals"], "portals")?.unwrap_or_default();
        if !physical {
            portals
                .extend(optional::<Vec<Portal>>(&input["portals"], "portals")?.unwrap_or_default());
        }
        let mut stitching = movement.clone();
        if !generated {
            // Supplied meshes authorize height-changing seams explicitly.
            // Geometric stitching must not invent their reverse direction.
            stitching.step_up = 0.;
            stitching.step_down = 0.;
        }
        portals.extend(ground::portals(&surfaces, &stitching));
        let mut seen = HashSet::new();
        portals.retain(|p| seen.insert(serde_json::to_string(p).unwrap_or_default()));
        for p in &portals {
            if !surface_ids.contains_key(&p.from)
                || !surface_ids.contains_key(&p.to)
                || p.points.iter().any(|&p| !finite(p))
            {
                return Err("Invalid portal".into());
            }
        }
        let mut portal_owners = vec![vec![]; surfaces.len()];
        for (i, portal) in portals.iter().enumerate() {
            portal_owners[surface_ids[&portal.from]].push(i);
        }
        let mut components: Vec<usize> = (0..surfaces.len()).collect();
        fn root(parents: &mut [usize], mut i: usize) -> usize {
            while parents[i] != i {
                parents[i] = parents[parents[i]];
                i = parents[i];
            }
            i
        }
        for portal in &portals {
            let from = root(&mut components, surface_ids[&portal.from]);
            let to = root(&mut components, surface_ids[&portal.to]);
            components[from] = to;
        }
        for i in 0..components.len() {
            components[i] = root(&mut components, i);
        }
        let connections: Vec<Connection> = optional(&input["connections"], "connections")?
            .or(optional(&options["connections"], "connections")?)
            .unwrap_or_default();
        for c in &connections {
            validate_connection(c)?;
        }
        let boosts: Vec<Boost> = optional(&input["boosts"], "boosts")?.unwrap_or_default();
        let mut h = std::collections::hash_map::DefaultHasher::new();
        serde_json::to_string(&snapshot)
            .map_err(|e| e.to_string())?
            .hash(&mut h);
        let declared = if snapshot.get("coverage").is_some() {
            snapshot["coverage"].clone()
        } else {
            input["coverage"].clone()
        };
        let mut coverage = Coverage {
            collision_bounds,
            support_bounds,
            declared,
            bounds: None,
            tiles: None,
            tile_span: 0.,
        };
        if !coverage.declared.is_null() && coverage.declared.as_str() != Some("complete") {
            let bounds: Bounds = decode(&coverage.declared["bounds"], "coverage bounds")?;
            if (0..2).any(|i| {
                !bounds.min[i].is_finite()
                    || !bounds.max[i].is_finite()
                    || bounds.min[i] > bounds.max[i]
            }) {
                return Err("Invalid coverage bounds".into());
            }
            coverage.bounds = Some(bounds);
            if let Some(tiles) = coverage.declared["tiles"].as_array() {
                let span = coverage.declared["tileSpan"]
                    .as_f64()
                    .ok_or("Missing coverage tile span")?;
                if !span.is_finite() || span <= 0. {
                    return Err("Invalid coverage tile span".into());
                }
                let mut keys = HashSet::new();
                for v in tiles {
                    keys.insert((
                        v["x"].as_i64().ok_or("Invalid coverage tile x")?,
                        v["z"].as_i64().ok_or("Invalid coverage tile z")?,
                    ));
                }
                coverage.tiles = Some(keys);
                coverage.tile_span = span;
            }
        }
        let mut world = Self {
            surfaces,
            portals,
            connections,
            boosts,
            movement,
            locomotion,
            devices,
            revision: format!("rust-world-1/{:016x}", h.finish()),
            coverage,
            outcomes: vec![],
            snapshot,
            walls,
            collision,
            support,
            owners,
            surface_ids,
            portal_owners,
            components,
            ground_graph: std::sync::OnceLock::new(),
        };
        world.prepare_devices()?;
        Ok(world)
    }
    pub fn snapshot(&self) -> &Value {
        &self.snapshot
    }
    pub fn walls(&self) -> &[Wall] {
        &self.walls
    }
    fn require_coverage(&self, a: Vec3, b: Vec3, r: f64) -> Result<(), String> {
        let c = &self.coverage.declared;
        if c.is_null() || c.as_str() == Some("complete") {
            return Ok(());
        }
        let Some(bounds) = &self.coverage.bounds else {
            return Ok(());
        };
        if (0..2).any(|i| {
            let axis = i * 2;
            a[axis].min(b[axis]) - r < bounds.min[i] || a[axis].max(b[axis]) + r > bounds.max[i]
        }) {
            return Err("Motion exceeds declared physical coverage".into());
        }
        if let Some(keys) = &self.coverage.tiles {
            let span = self.coverage.tile_span;
            let minx = ((a[0].min(b[0]) - r) / span).floor() as i64;
            let maxx = ((a[0].max(b[0]) + r - 1e-10) / span).floor() as i64;
            let minz = ((a[2].min(b[2]) - r) / span).floor() as i64;
            let maxz = ((a[2].max(b[2]) + r - 1e-10) / span).floor() as i64;
            if (maxx - minx + 1) as i128 * (maxz - minz + 1) as i128 > 1_000_000 {
                return Err("Coverage query exceeds tile budget".into());
            }
            for x in minx..=maxx {
                for z in minz..=maxz {
                    if keys.contains(&(x, z)) {
                        continue;
                    }
                    let mut low: f64 = 0.;
                    let mut high: f64 = 1.;
                    let mut touches = true;
                    for (axis, index) in [(0, x), (2, z)] {
                        let d = b[axis] - a[axis];
                        let min = index as f64 * span - r;
                        let max = (index + 1) as f64 * span + r;
                        if d == 0. {
                            if a[axis] < min || a[axis] > max {
                                touches = false;
                                break;
                            }
                        } else {
                            let p = (min - a[axis]) / d;
                            let q = (max - a[axis]) / d;
                            low = low.max(p.min(q));
                            high = high.min(p.max(q));
                            if low > high {
                                touches = false;
                                break;
                            }
                        }
                    }
                    if touches {
                        return Err("Motion crosses an unloaded physical tile".into());
                    }
                }
            }
        }
        Ok(())
    }
    fn in_coverage(&self, p: Vec3, r: f64) -> bool {
        self.require_coverage(p, p, r).is_ok()
            && self
                .collision
                .require_scope([p[0] - r, p[1], p[2] - r, p[0] + r, p[1], p[2] + r])
                .is_ok()
    }
    pub fn known_actions(&self) -> &[Connection] {
        &self.connections
    }
    /// Return positive-length polygon edge portions without outgoing passage.
    /// Entry apertures are subtracted as a union; incoming and point portals
    /// remove no edge length. Points retain edge order and interpolated height.
    pub fn support_boundaries(&self, bounds: Bounds) -> Result<Vec<Boundary>, String> {
        boundaries::query(self, bounds)
    }
    /// Closest geometric point on one supplied support polygon's triangle fan.
    /// Unknown IDs and non-finite points are errors; a polygon without usable
    /// support triangles returns None. Search owns range and physical checks.
    pub fn project_to_surface(&self, surface_id: &str, p: Vec3) -> Result<Option<Vec3>, String> {
        if !finite(p) {
            return Err("Invalid surface projection point".into());
        }
        let surface = self.surface(surface_id).ok_or("Unknown support surface")?;
        Ok(ground::closest_on_surface(surface, p))
    }
    pub fn surface(&self, id: &str) -> Option<&Surface> {
        self.surface_ids.get(id).map(|&i| &self.surfaces[i])
    }
    pub fn support_component(&self, id: &str) -> Option<usize> {
        self.surface_ids.get(id).map(|&i| self.components[i])
    }
    pub fn sweep_capsule(
        &self,
        a: Vec3,
        b: Vec3,
        p: Profile,
        inflation: f64,
    ) -> Result<Option<Hit>, String> {
        self.require_coverage(a, b, p.radius + inflation)?;
        self.collision.sweep(a, b, p, inflation)
    }
    pub fn wall_blocked(&self, a: Vec3, b: Vec3, inflation: f64) -> bool {
        walls::blocked(self.walls(), a, b, self.movement.profile, inflation)
    }
    pub fn clear(&self, a: Vec3, b: Vec3, inflation: f64) -> Result<bool, String> {
        Ok(!self.wall_blocked(a, b, inflation)
            && self
                .sweep_capsule(a, b, self.movement.profile, inflation)?
                .is_none())
    }
    pub fn ground_at(
        &self,
        p: Vec3,
        up: f64,
        down: f64,
        radius: f64,
    ) -> Result<Option<GroundHit>, String> {
        Ok(self
            .ground_support(p, up, down, radius)?
            .map(|(hit, _)| hit))
    }
    // Keep support provenance local. Supplied navigation can authorize mesh
    // feet in surface inputs; physical snapshots still need raw static support.
    fn ground_support(
        &self,
        p: Vec3,
        up: f64,
        down: f64,
        radius: f64,
    ) -> Result<Option<(GroundHit, bool)>, String> {
        self.require_coverage(p, p, radius)?;
        let base = self
            .collision
            .ground(p, up, down, self.movement.max_slope, radius)?;
        let overlay = self
            .support
            .ground(p, up, down, self.movement.max_slope, radius)?;
        let overlay = overlay.and_then(|hit| {
            let moving = self.surfaces[self.owners[hit.triangle]]
                .extra
                .contains_key("supportDevice");
            let mesh_support = !moving && self.snapshot["kind"] == "surfaces" && base.is_none();
            (moving || mesh_support).then_some((hit, mesh_support))
        });
        Ok(match (base, overlay) {
            (None, hit) => hit,
            (Some(hit), None) => Some((hit, false)),
            (Some(a), Some((b, mesh))) => Some(if radius > 0. {
                if a.position[1] >= b.position[1] {
                    (a, false)
                } else {
                    (b, mesh)
                }
            } else if (a.position[1] - p[1]).abs() <= (b.position[1] - p[1]).abs() {
                (a, false)
            } else {
                (b, mesh)
            }),
        })
    }
    pub fn project(
        &self,
        p: Vec3,
        interaction: Option<&Interaction>,
    ) -> Result<Vec<Projection>, String> {
        self.project_with_tolerance(p, self.movement.max_vertical, interaction)
    }
    pub fn project_with_tolerance(
        &self,
        p: Vec3,
        tolerance: f64,
        interaction: Option<&Interaction>,
    ) -> Result<Vec<Projection>, String> {
        ground::project(self, p, tolerance, interaction)
    }
    /// Preserve feet already 5–10 mm above physical support, or on an authorized
    /// surface mesh with no raw support. Other seeds receive 1 cm clearance.
    /// Every accepted position still needs full-body clearance.
    pub fn standing_foot(&self, p: Vec3) -> Result<Option<Vec3>, String> {
        let Some((h, mesh_support)) = self.ground_support(
            p,
            self.movement.max_vertical,
            self.movement.max_vertical,
            self.movement.profile.radius,
        )?
        else {
            return Ok(None);
        };
        let mut foot = h.position;
        foot[1] = standing_height(p[1], foot[1], mesh_support);
        if self
            .project_with_tolerance(foot, self.movement.profile.radius.max(0.02), None)?
            .is_empty()
            || !self.clear(foot, foot, 0.)?
        {
            return Ok(None);
        }
        Ok(Some(foot))
    }
    pub fn ground_path(&self, a: Vec3, b: Vec3) -> Result<Option<GroundPath>, String> {
        ground::path(self, a, b)
    }
    /// Rebuild an immutable finer support mesh from the same bound raw triangles.
    /// No world or caller-owned query state is mutated.
    pub fn refine(&self, bounds: Bounds) -> Result<Self, String> {
        if self
            .surfaces
            .iter()
            .any(|surface| surface.portals.is_some())
            || self.snapshot["input"]["ground"]["options"]["portals"]
                .as_array()
                .is_some_and(|portals| !portals.is_empty())
        {
            // A raw rebuild cannot recover authored edge masks or directed
            // portals. Retain their mesh ownership instead of authorizing new
            // passages or discarding an explicitly supplied transfer.
            return Self::new(self.snapshot.clone());
        }
        let mut v = self.snapshot.clone();
        v["input"]["ground"]["surfaces"] = serde_json::json!([]);
        // Regenerated faces have new ownership. Imported seam references belong
        // to the replaced mesh; rebuild their directed geometry from raw facts.
        v["input"]["ground"]["options"]["portals"] = serde_json::json!([]);
        v["input"]["ground"]["build"]["bounds"] =
            serde_json::to_value(bounds).map_err(|e| e.to_string())?;
        Self::new(v)
    }
    pub fn discover_actions(
        &self,
        from: Vec3,
        targets: &[Vec3],
        limit: usize,
    ) -> Result<Discovery, String> {
        let mut out = Discovery {
            connections: vec![],
            attempts: 0,
            truncated: false,
        };
        for (i, &target) in targets.iter().enumerate() {
            for mode in [Mode::Jump, Mode::Drop] {
                if out.attempts >= limit {
                    out.truncated = true;
                    return Ok(out);
                }
                out.attempts += 1;
                if let Some(c) = self.flight(from, target, mode)? {
                    let mut c = c;
                    c.id = format!("motion/{}/{i}/{mode:?}", self.revision);
                    out.connections.push(c);
                }
            }
        }
        Ok(out)
    }
}
fn validate_movement(m: &Movement) -> Result<(), String> {
    let j = &m.model;
    if [
        m.speed,
        m.max_vertical,
        m.profile.radius,
        m.profile.height,
        m.max_slope,
        m.step_up,
        m.step_down,
        j.gravity,
        j.falling_gravity,
        j.max_jump_height,
        j.max_falling_speed,
        j.apex_time,
        j.max_horizontal_speed,
    ]
    .iter()
    .any(|v| !v.is_finite())
        || m.speed <= 0.
        || m.max_vertical < 0.
        || m.profile.radius < 0.
        || m.profile.height <= 0.
        || m.profile.height < 2. * m.profile.radius
        || m.max_slope <= 0.
        || m.max_slope >= 90.
        || m.step_up < 0.
        || m.step_down < 0.
        || j.gravity <= 0.
        || j.falling_gravity <= 0.
        || j.max_jump_height < 0.
        || j.max_falling_speed <= 0.
        || j.apex_time < 0.
        || j.max_horizontal_speed < 0.
    {
        return Err("Invalid movement model".into());
    }
    Ok(())
}
pub fn validate_connection(c: &Connection) -> Result<(), String> {
    if c.id.is_empty()
        || c.mode == Mode::Walk
        || !matches!(c.state.as_str(), "open" | "closed" | "unknown")
        || c.points.len() < 2
        || c.points.len() != c.times.len()
        || c.points.iter().any(|&p| !finite(p))
        || c.times.first() != Some(&0.)
        || c.duration() <= 0.
        || c.times.iter().any(|v| !v.is_finite() || *v < 0.)
        || c.times.windows(2).any(|t| t[1] < t[0])
        || c.points
            .windows(2)
            .zip(c.times.windows(2))
            .any(|(p, t)| t[0] == t[1] && distance(p[0], p[1]) > 1e-9)
    {
        return Err("Invalid connection motion or timing".into());
    }
    Ok(())
}
