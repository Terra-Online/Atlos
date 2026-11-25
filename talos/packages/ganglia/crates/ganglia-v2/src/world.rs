#[path = "contacts.rs"]
mod contacts;
use crate::{devices::RopeDrop, geometry::*, types::*, walls::Walls};
pub(super) use contacts::Contact;
use std::{collections::HashSet, sync::Arc, thread};

const STANDING_OFFSET: f64 = 0.005;
const SUPPORT_SEARCH: f64 = 0.31;
pub(super) const STANDING_HEIGHT_DRIFT: f64 = SUPPORT_SEARCH + crate::circular::CLEARANCE;
const WALK_CLEARANCE: f64 = 0.01;
const WALK_TRACE_TOLERANCE: f64 = 0.025;
const WALK_SAMPLE_MIN: f64 = 0.025;

#[derive(Clone)]
pub struct World {
    pub physical: Arc<Physical>,
    contacts: Arc<contacts::Catalog>,
    rope_drops: Arc<Vec<RopeDrop>>,
    ground: Arc<Vec<[Point; 3]>>,
    ground_index: Arc<Index>,
    collision: Arc<Vec<[Point; 3]>>,
    collision_index: Arc<Index>,
    static_support_index: Arc<Index>,
    static_support_normals: Arc<Vec<Option<Point>>>,
    static_boxes: Arc<Vec<[Point; 8]>>,
    static_box_index: Arc<Index>,
    moving: Arc<Vec<[Point; 3]>>,
    moving_index: Arc<Index>,
    circular: Arc<Vec<[Point; 3]>>,
    circular_index: Arc<Index>,
    coverage: Option<Arc<TileCoverage>>,
    walls: Arc<Walls>,
    boxes: Arc<Vec<[Point; 3]>>,
    box_index: Arc<Index>,
    pub roofs: Arc<Vec<Surface>>,
    box_support: Arc<Vec<[Point; 3]>>,
    box_support_index: Arc<Index>,
    box_bodies: Arc<Vec<[Point; 8]>>,
    box_body_index: Arc<Index>,
}

struct TileCoverage {
    span: f64,
    tiles: HashSet<(i64, i64)>,
}

// Exported primitive boxes include their entire solid volume. A triangle-only
// sweep can otherwise accept a stationary capsule enclosed by their faces.
fn static_boxes(collision: &Collision) -> Vec<[Point; 8]> {
    collision
        .box_starts
        .iter()
        .filter_map(|first| {
            let start = first.checked_mul(3)?;
            let indices = collision.indices.get(start..start.checked_add(36)?)?;
            let mut vertices = indices.to_vec();
            vertices.sort_unstable();
            vertices.dedup();
            if vertices.len() != 8 {
                return None;
            }
            // The collision export lists corners around each Z face. Rearrange
            // them so each bit corresponds to an edge from the first corner.
            let body = [0, 1, 3, 2, 4, 5, 7, 6].map(|i| {
                let at = vertices[i] * 3;
                std::array::from_fn(|j| collision.positions[at + j])
            });
            let axes = [1, 2, 4].map(|i| sub(body[i], body[0]));
            let lengths = axes.map(|a| dot(a, a).sqrt());
            if lengths.into_iter().any(|len| len < 1e-6)
                || [(0, 1), (0, 2), (1, 2)]
                    .into_iter()
                    .any(|(i, j)| dot(axes[i], axes[j]).abs() > 1e-6 * lengths[i] * lengths[j])
            {
                return None;
            }
            for (bits, &p) in body.iter().enumerate() {
                let expected = axes.iter().enumerate().fold(body[0], |old, (i, &axis)| {
                    if bits & (1 << i) == 0 {
                        old
                    } else {
                        add(old, axis)
                    }
                });
                if distance(p, expected) > 1e-5 {
                    return None;
                }
            }
            Some(body)
        })
        .collect()
}

impl World {
    pub fn new(mut physical: Physical) -> Result<Self, String> {
        if physical.locomotion.speed <= 0.
            || physical.ground.options.profile.radius < 0.
            || physical.ground.options.profile.height < 2. * physical.ground.options.profile.radius
        {
            return Err("Invalid movement profile".into());
        }
        let model = &physical.movement.model;
        if model.gravity <= 0.
            || model.falling_gravity <= 0.
            || model.max_falling_speed <= 0.
            || model.max_jump_height < 0.
            || model.apex_time < 0.
            || physical.movement.run_air_speed < 0.
            || model.max_horizontal_speed < 0.
        {
            return Err("Invalid jump model".into());
        }
        let coverage = physical
            .ground
            .tiles
            .as_ref()
            .or_else(|| {
                physical
                    .ground
                    .build
                    .as_ref()
                    .and_then(|build| build.tiles.as_ref())
            })
            .map(|tiles| {
                let span = physical.ground.build.as_ref().map_or(0., |build| {
                    build.cell_size.unwrap_or(0.) * build.tile_cells.unwrap_or(0) as f64
                });
                if !span.is_finite() || span <= 0. {
                    return Err(
                        "Sparse coverage requires positive cellSize and tileCells".to_string()
                    );
                }
                Ok(TileCoverage {
                    span,
                    tiles: tiles.iter().map(|t| (t.x, t.z)).collect(),
                })
            })
            .transpose()?;
        let walls = Walls::new(
            physical
                .rounded_walls
                .take()
                .unwrap_or_else(|| std::mem::take(&mut physical.ground.options.walls)),
        )?;
        let mut circular_surfaces = Vec::new();
        for support in physical
            .devices
            .iter()
            .flat_map(|facts| &facts.moving_supports)
        {
            if support.assumption != "phase-free-swept-support" {
                continue;
            }
            if let Some(shape) = &support.circular {
                crate::circular::validate(shape)?;
                if support.family != "waterwheel" {
                    return Err("Invalid circular support family".into());
                }
                circular_surfaces.extend(support.surfaces.iter().cloned());
            }
        }
        let circular: Vec<_> = circular_surfaces
            .iter()
            .flat_map(|s| {
                (1..s.vertices.len().saturating_sub(1))
                    .map(|i| [s.vertices[0], s.vertices[i], s.vertices[i + 1]])
            })
            .collect();
        let circular_index = Index::new(
            &circular
                .iter()
                .map(|t| Bounds::points(t))
                .collect::<Vec<_>>(),
        );
        physical.ground.surfaces.extend(circular_surfaces);
        let moving_surfaces: Vec<_> = physical
            .devices
            .iter()
            .flat_map(|facts| &facts.moving_supports)
            .filter(|support| {
                support.assumption == "phase-free-swept-support" && support.circular.is_none()
            })
            .flat_map(|support| support.surfaces.iter().cloned())
            .collect();
        // These are alternative support contacts, not solids occupying every
        // pose at once. Keep them out of the collision sweep index.
        let moving: Vec<_> = moving_surfaces
            .iter()
            .flat_map(|s| {
                (1..s.vertices.len().saturating_sub(1))
                    .map(|i| [s.vertices[0], s.vertices[i], s.vertices[i + 1]])
            })
            .collect();
        let moving_index =
            Index::new(&moving.iter().map(|t| Bounds::points(t)).collect::<Vec<_>>());
        physical.ground.surfaces.extend(moving_surfaces);
        let ground: Vec<_> = physical
            .ground
            .surfaces
            .iter()
            .flat_map(|s| {
                (1..s.vertices.len().saturating_sub(1))
                    .map(|i| [s.vertices[0], s.vertices[i], s.vertices[i + 1]])
            })
            .collect();
        let positions = &physical.collision.positions;
        if positions.len() % 3 != 0
            || physical.collision.indices.len() % 3 != 0
            || physical
                .collision
                .indices
                .iter()
                .any(|i| *i >= positions.len() / 3)
        {
            return Err("Invalid collision indices".into());
        }
        let collision: Vec<_> = physical
            .collision
            .indices
            .chunks_exact(3)
            .map(|ids| {
                std::array::from_fn(|i| {
                    [
                        positions[ids[i] * 3],
                        positions[ids[i] * 3 + 1],
                        positions[ids[i] * 3 + 2],
                    ]
                })
            })
            .collect();
        let static_boxes = static_boxes(&physical.collision);
        let static_box_index = Index::new(
            &static_boxes
                .iter()
                .map(|body| Bounds::points(body))
                .collect::<Vec<_>>(),
        );
        physical.collision.box_starts = Vec::new();
        // The spatial index owns decoded triangles; retaining the serialized
        // buffers here would keep a second full collision mesh alive.
        physical.collision.positions = Vec::new();
        physical.collision.indices = Vec::new();
        let collision_bounds: Arc<[Bounds]> = collision.iter().map(|t| Bounds::points(t)).collect();
        let build_ground =
            || Index::new(&ground.iter().map(|t| Bounds::points(t)).collect::<Vec<_>>());
        let build_collision = || Index::all(collision_bounds.clone());
        let build_support = || {
            let minimum_up = physical.movement.max_slope.to_radians().cos();
            let normals: Vec<_> = collision
                .iter()
                .map(|&triangle| support_normal(triangle, minimum_up, true))
                .collect();
            let items = normals
                .iter()
                .enumerate()
                .filter_map(|(i, normal)| normal.is_some().then_some(i))
                .collect();
            let index = Index::with_items(collision_bounds.clone(), items);
            (index, normals)
        };
        let (ground_index, collision_index, (static_support_index, static_support_normals)) =
            if ground.len() + collision.len() >= 20_000 {
                thread::scope(|scope| {
                    let ground = scope.spawn(build_ground);
                    let collision = scope.spawn(build_collision);
                    let support = build_support();
                    (ground.join().unwrap(), collision.join().unwrap(), support)
                })
            } else {
                (build_ground(), build_collision(), build_support())
            };
        let contacts = Arc::new(contacts::Catalog::new(&physical));
        Ok(Self {
            contacts,
            rope_drops: Arc::new(RopeDrop::catalog(&physical)),
            physical: Arc::new(physical),
            ground: Arc::new(ground),
            ground_index: Arc::new(ground_index),
            collision: Arc::new(collision),
            collision_index: Arc::new(collision_index),
            static_support_index: Arc::new(static_support_index),
            static_support_normals: Arc::new(static_support_normals),
            static_boxes: Arc::new(static_boxes),
            static_box_index: Arc::new(static_box_index),
            moving: Arc::new(moving),
            moving_index: Arc::new(moving_index),
            circular: Arc::new(circular),
            circular_index: Arc::new(circular_index),
            coverage: coverage.map(Arc::new),
            boxes: Arc::new(Vec::new()),
            box_index: Arc::new(Index::new(&[])),
            roofs: Arc::new(Vec::new()),
            box_support: Arc::new(Vec::new()),
            box_support_index: Arc::new(Index::new(&[])),
            box_bodies: Arc::new(Vec::new()),
            box_body_index: Arc::new(Index::new(&[])),
            walls: Arc::new(walls),
        })
    }
    pub fn layout(&self, placements: &[Placement]) -> Self {
        let (boxes, roofs, bodies) = crate::placement::geometry(&self.physical, placements);
        let mut result = self.clone();
        result.box_index = Arc::new(Index::new(
            &boxes.iter().map(|t| Bounds::points(t)).collect::<Vec<_>>(),
        ));
        result.boxes = Arc::new(boxes);
        let support: Vec<_> = roofs
            .iter()
            .flat_map(|s| {
                (1..s.vertices.len() - 1).map(|i| [s.vertices[0], s.vertices[i], s.vertices[i + 1]])
            })
            .collect();
        result.box_support_index = Arc::new(Index::new(
            &support
                .iter()
                .map(|t| Bounds::points(t))
                .collect::<Vec<_>>(),
        ));
        result.box_support = Arc::new(support);
        result.box_body_index = Arc::new(Index::new(
            &bodies.iter().map(|b| Bounds::points(b)).collect::<Vec<_>>(),
        ));
        result.box_bodies = Arc::new(bodies);
        result.roofs = Arc::new(roofs);
        result
    }
    pub(super) fn has_static_collision(&self) -> bool {
        !self.collision.is_empty()
    }
    pub(super) fn drop_source(&self, start: Point, end: Point) -> Option<String> {
        self.rope_drops
            .iter()
            .find_map(|rope| rope.source(start, end))
            .map(str::to_owned)
    }
    pub(super) fn box_bounds(&self) -> Vec<Bounds> {
        self.box_bodies
            .iter()
            .map(|body| Bounds::points(body))
            .collect()
    }
    pub(super) fn box_contacts(&self) -> Vec<Point> {
        let margin = self.physical.ground.options.profile.radius + 0.5;
        self.box_bodies
            .iter()
            .flat_map(|body| {
                let b = Bounds::points(body);
                let x = (b.min[0] + b.max[0]) / 2.;
                let z = (b.min[2] + b.max[2]) / 2.;
                [
                    [b.min[0] - margin, b.min[1], z],
                    [b.max[0] + margin, b.min[1], z],
                    [x, b.min[1], b.min[2] - margin],
                    [x, b.min[1], b.max[2] + margin],
                ]
            })
            .collect()
    }
    pub(super) fn excluded(&self, bounds: Bounds) -> bool {
        self.walls.overlaps(bounds)
    }
    pub(super) fn static_triangles(&self, bounds: Bounds) -> Vec<[Point; 3]> {
        let mut result = Vec::new();
        self.collision_index.query(bounds, |i| {
            result.push(self.collision[i]);
            false
        });
        result
    }
    pub(super) fn coverage_contains(&self, bounds: Bounds) -> bool {
        if let Some(window) = self
            .physical
            .ground
            .build
            .as_ref()
            .and_then(|b| b.bounds.as_ref())
            && (bounds.min[0] < window.min[0]
                || bounds.max[0] > window.max[0]
                || bounds.min[2] < window.min[1]
                || bounds.max[2] > window.max[1])
        {
            return false;
        }
        if let Some(coverage) = &self.coverage {
            for x in (bounds.min[0] / coverage.span).floor() as i64
                ..=(bounds.max[0] / coverage.span).floor() as i64
            {
                for z in (bounds.min[2] / coverage.span).floor() as i64
                    ..=(bounds.max[2] / coverage.span).floor() as i64
                {
                    if !coverage.tiles.contains(&(x, z)) {
                        return false;
                    }
                }
            }
        }
        true
    }
    pub fn project(&self, p: Point, tolerance: f64) -> Option<Point> {
        // Available arrivals and authored device ports can rest on collision
        // faces omitted by the navigation mesh. Prove that contact directly.
        if let Some(feet) = self.standing(p)
            && (feet[1] - p[1]).abs() <= tolerance + 1e-6
            && !self.blocked(feet, feet, 0.)
        {
            return Some(feet);
        }
        // Arrival projection uses its public tolerance, independently of the
        // tighter support envelope used by continuous walking. Navigation can
        // be lower than the physical capsule contact at the same XZ position.
        if let Some(height) = self.support_height_range(
            p,
            p[1] - tolerance - STANDING_OFFSET - 1e-9,
            p[1] + tolerance - STANDING_OFFSET + 1e-9,
        ) {
            let feet = [p[0], height + STANDING_OFFSET, p[2]];
            if (feet[1] - p[1]).abs() <= tolerance + 1e-6 && !self.blocked(feet, feet, 0.) {
                return Some(feet);
            }
        }
        let mut best = None;
        let mut delta = tolerance + 1e-9;
        self.ground_index.query(
            Bounds {
                min: [p[0] - 1e-8, p[1] - tolerance, p[2] - 1e-8],
                max: [p[0] + 1e-8, p[1] + tolerance, p[2] + 1e-8],
            },
            |i| {
                if let Some(y) = triangle_height(p, self.ground[i]) {
                    let d = (y - p[1]).abs();
                    if d < delta {
                        delta = d;
                        best = Some([p[0], y, p[2]]);
                    }
                }
                false
            },
        );
        // Navigation and collision heights can differ. The complete projection,
        // including standing clearance, must respect the caller's tolerance.
        best.and_then(|point| self.standing(point))
            .filter(|point| (point[1] - p[1]).abs() <= tolerance + 1e-6)
    }
    pub fn standing(&self, p: Point) -> Option<Point> {
        if let Some(height) = self.circular_height(p) {
            return Some(if p[1] - height >= STANDING_OFFSET - 1e-6 {
                p
            } else {
                [p[0], height + crate::circular::CLEARANCE, p[2]]
            });
        }
        if self.collision.is_empty()
            && self.moving.is_empty()
            && self.circular.is_empty()
            && self.boxes.is_empty()
        {
            // A navigation-only hint still needs support; it cannot create a
            // floating launch platform when collision geometry is absent.
            let mut feet = None;
            self.ground_index
                .query(Bounds::points(&[p]).expand(0.01), |i| {
                    if let Some(y) = triangle_height(p, self.ground[i])
                        && (y - p[1]).abs() <= 0.01
                    {
                        feet = Some([p[0], y, p[2]]);
                    }
                    false
                });
            return feet;
        }
        self.support_height(p).map(|height| {
            if (!self.moving.is_empty() || !self.circular.is_empty())
                && (-1e-6..=WALK_CLEARANCE + 1e-6).contains(&(p[1] - height))
            {
                p
            } else {
                [p[0], height + STANDING_OFFSET, p[2]]
            }
        })
    }
    pub fn moving_standing(&self, support: &MovingSupport, p: Point) -> Option<Point> {
        let radius = self.physical.ground.options.profile.radius;
        let up = self.physical.movement.max_slope.to_radians().cos();
        let height = support
            .surfaces
            .iter()
            .flat_map(|s| {
                (1..s.vertices.len().saturating_sub(1))
                    .map(|i| [s.vertices[0], s.vertices[i], s.vertices[i + 1]])
            })
            .filter_map(|triangle| {
                let normal = support_normal(triangle, up, true)?;
                sphere_support(p, triangle, normal, radius)
            })
            .filter(|height| (height - p[1]).abs() <= 0.31)
            .min_by(|a, b| (a - p[1]).abs().total_cmp(&(b - p[1]).abs()))?;
        let feet = if (-1e-6..=WALK_CLEARANCE + 1e-6).contains(&(p[1] - height)) {
            p
        } else {
            [p[0], height + STANDING_OFFSET, p[2]]
        };
        (!self.blocked(feet, feet, 0.)).then_some(feet)
    }
    fn circular_height(&self, p: Point) -> Option<f64> {
        // A neighbouring higher rim patch must not lift this contact. Circular
        // contacts use their explicit horizontal footprint and authored height.
        let mut circular = None;
        self.circular_index
            .query(Bounds::points(&[p]).expand(0.02), |i| {
                if let Some(y) = triangle_height(p, self.circular[i])
                    && (-1e-6..=0.02).contains(&(p[1] - y))
                    && circular.is_none_or(|old: f64| (p[1] - y).abs() < (p[1] - old).abs())
                {
                    circular = Some(y);
                }
                false
            });
        circular
    }
    fn support_height(&self, p: Point) -> Option<f64> {
        self.support_height_range(p, p[1] - SUPPORT_SEARCH, p[1] + SUPPORT_SEARCH)
    }
    fn support_height_range(&self, p: Point, minimum: f64, maximum: f64) -> Option<f64> {
        if let Some(height) = self.circular_height(p) {
            return Some(height);
        }
        let radius = self.physical.ground.options.profile.radius;
        let minimum_up = self.physical.movement.max_slope.to_radians().cos();
        let mut best = None;
        let mut moving_contact: Option<f64> = None;
        let bounds = Bounds {
            min: [p[0] - radius - 1e-8, minimum - radius, p[2] - radius - 1e-8],
            max: [p[0] + radius + 1e-8, maximum + radius, p[2] + radius + 1e-8],
        };
        // A point body chooses nearest height. Preserve the original index's
        // tie order for that degenerate profile; a capsule picks highest.
        let static_index = if radius == 0. {
            &self.collision_index
        } else {
            &self.static_support_index
        };
        for (index, triangles, moving, normals) in [
            (
                static_index,
                &self.collision,
                false,
                Some(&self.static_support_normals),
            ),
            (&self.moving_index, &self.moving, true, None),
            (&self.box_support_index, &self.box_support, false, None),
        ] {
            index.query(bounds, |i| {
                let triangle = triangles[i];
                let normal = normals.map_or_else(
                    || support_normal(triangle, minimum_up, true),
                    |normals| normals[i],
                );
                if let Some(normal) = normal
                    && let Some(height) = sphere_support(p, triangle, normal, radius)
                    && (minimum..=maximum).contains(&height)
                {
                    // Only an existing moving contact selects an alternative
                    // pose. Static feet still use the highest nearby support.
                    if moving
                        && (-1e-6..=WALK_CLEARANCE + 1e-6).contains(&(p[1] - height))
                        && moving_contact.is_none_or(|old| height > old)
                    {
                        moving_contact = Some(height);
                    }
                    if best.is_none_or(|old: f64| {
                        if radius > 0. {
                            height > old
                        } else {
                            (height - p[1]).abs() < (old - p[1]).abs()
                        }
                    }) {
                        best = Some(height);
                    }
                }
                false
            });
        }
        moving_contact.or(best)
    }
    pub fn blocked(&self, a: Point, b: Point, inflation: f64) -> bool {
        let profile = &self.physical.ground.options.profile;
        let radius = profile.radius + inflation;
        let axis = [
            add(a, [0., profile.radius, 0.]),
            add(a, [0., profile.height - profile.radius, 0.]),
            add(b, [0., profile.height - profile.radius, 0.]),
            add(b, [0., profile.radius, 0.]),
        ];
        let axis_bounds = Bounds::points(&axis);
        let bounds = axis_bounds.expand(radius);
        if let Some(coverage) = self
            .physical
            .ground
            .build
            .as_ref()
            .and_then(|b| b.bounds.as_ref())
            && (bounds.min[0] < coverage.min[0]
                || bounds.max[0] > coverage.max[0]
                || bounds.min[2] < coverage.min[1]
                || bounds.max[2] > coverage.max[1])
        {
            return true;
        }
        if let Some(coverage) = &self.coverage {
            // Loaded empty tiles are usable flight space; omitted tiles make
            // no collision claim. Include the entire swept body's footprint,
            // using the same conservative rectangle as snapshot coverage.
            for x in (bounds.min[0] / coverage.span).floor() as i64
                ..=(bounds.max[0] / coverage.span).floor() as i64
            {
                for z in (bounds.min[2] / coverage.span).floor() as i64
                    ..=(bounds.max[2] / coverage.span).floor() as i64
                {
                    if !coverage.tiles.contains(&(x, z)) {
                        return true;
                    }
                }
            }
        }
        if self.static_box_index.query(axis_bounds, |i| {
            axis.iter()
                .any(|p| crate::placement::contains(self.static_boxes[i], *p))
        }) {
            return true;
        }
        if self.box_body_index.query(bounds, |i| {
            axis.iter()
                .any(|p| crate::placement::contains(self.box_bodies[i], *p))
        }) {
            return true;
        }
        if self.walls.blocked(axis, bounds, radius) {
            return true;
        }
        let intersects = swept_band([a, b], bounds, radius);
        [
            (&self.collision_index, &self.collision),
            (&self.box_index, &self.boxes),
        ]
        .into_iter()
        .any(|(index, triangles)| {
            index.query_where(intersects, |i| {
                let t = triangles[i];
                let limit = radius - 1e-6;
                let normal = cross(sub(t[1], t[0]), sub(t[2], t[0]));
                let normal_squared = dot(normal, normal);
                if normal_squared > 1e-20 {
                    // A triangle lies within its plane. If the entire capsule
                    // axis sweep is farther from that plane than the radius,
                    // the exact triangle distance cannot obstruct the motion.
                    let span = axis.map(|p| dot(sub(p, t[0]), normal));
                    let limit = (limit + 1e-8) * normal_squared.sqrt();
                    if span.iter().all(|&d| d > limit) || span.iter().all(|&d| d < -limit) {
                        return false;
                    }
                }
                triangles_within([axis[0], axis[1], axis[2]], t, limit)
                    || triangles_within([axis[0], axis[2], axis[3]], t, limit)
            })
        })
    }
    fn support_span(&self, path: [Point; 2], faces_only: bool) -> bool {
        self.support_span_with(path, faces_only, &self.moving_index, &self.moving)
    }
    fn support_span_with(
        &self,
        path: [Point; 2],
        faces_only: bool,
        moving_index: &Index,
        moving: &[[Point; 3]],
    ) -> bool {
        const CONTACT_ENVELOPE: f64 = 0.02;
        let physical = !self.collision.is_empty()
            || !self.moving.is_empty()
            || !self.circular.is_empty()
            || !self.boxes.is_empty();
        let mut intervals = Vec::new();
        let radius = if physical {
            self.physical.ground.options.profile.radius
        } else {
            0.
        };
        let static_source = if physical {
            (
                self.static_support_index.as_ref(),
                self.collision.as_slice(),
                true,
                Some(self.static_support_normals.as_slice()),
            )
        } else {
            (
                self.ground_index.as_ref(),
                self.ground.as_slice(),
                false,
                None,
            )
        };
        let minimum_up = self.physical.movement.max_slope.to_radians().cos();
        let mut bounds = Bounds::points(&path).expand(radius + CONTACT_ENVELOPE);
        bounds.min[1] += radius;
        bounds.max[1] += radius;
        let intersects = swept_band(path, bounds, radius + CONTACT_ENVELOPE);
        for (index, triangles, physical, normals) in [
            static_source,
            (moving_index, moving, true, None),
            (
                self.circular_index.as_ref(),
                self.circular.as_slice(),
                true,
                None,
            ),
            (
                self.box_support_index.as_ref(),
                self.box_support.as_slice(),
                true,
                None,
            ),
        ] {
            if index.query_where(intersects, |i| {
                let triangle = triangles[i];
                let normal = normals.map_or_else(
                    || support_normal(triangle, minimum_up, physical),
                    |normals| normals[i],
                );
                let Some(normal) = normal else {
                    return false;
                };
                if faces_only {
                    let span =
                        face_support_interval(path, triangle, normal, radius, WALK_CLEARANCE);
                    if span == [0., 1.] {
                        return true;
                    }
                    if span[0] <= span[1] {
                        intervals.push(span);
                    }
                    false
                } else {
                    let first = intervals.len();
                    support_intervals(
                        path,
                        triangle,
                        normal,
                        radius,
                        CONTACT_ENVELOPE,
                        &mut intervals,
                    );
                    intervals[first..].contains(&[0., 1.])
                }
            }) {
                return true;
            }
        }
        intervals.sort_unstable_by(|a, b| a[0].total_cmp(&b[0]));
        let mut end: f64 = 0.;
        for [lo, hi] in intervals {
            if lo > end + 1e-8 {
                return false;
            }
            end = end.max(hi);
            if end >= 1. - 1e-8 {
                return true;
            }
        }
        false
    }
    fn walk_chord(&self, a: Point, b: Point) -> bool {
        let faces = self.support_span([a, b], true);
        if (!faces && !self.support_span([a, b], false)) || self.blocked(a, b, 0.) {
            return false;
        }
        if faces
            || (self.collision.is_empty()
                && self.moving.is_empty()
                && self.circular.is_empty()
                && self.boxes.is_empty())
        {
            return true;
        }
        // The edge envelope only proves proximity. Follow the standing-height
        // check used by the physical model and verify the projected body clears.
        let radius = self.physical.ground.options.profile.radius;
        let spacing = (radius / 8.).max(WALK_SAMPLE_MIN);
        let count = (distance(a, b) / spacing).ceil().max(2.) as usize;
        (1..count).all(|i| {
            let point = lerp(a, b, i as f64 / count as f64);
            let Some(height) = self.support_height(point) else {
                return false;
            };
            let gap = point[1] - height;
            if (-1e-6..=WALK_CLEARANCE + 1e-6).contains(&gap) {
                return true;
            }
            let feet = [point[0], height + STANDING_OFFSET, point[2]];
            (feet[1] - point[1]).abs() <= WALK_TRACE_TOLERANCE && !self.blocked(feet, feet, 0.)
        })
    }
    fn walk_projection(&self, point: Point) -> Option<Point> {
        if self.collision.is_empty()
            && self.moving.is_empty()
            && self.circular.is_empty()
            && self.boxes.is_empty()
        {
            self.project(point, 0.5)
        } else {
            self.standing(point).or_else(|| self.project(point, 0.5))
        }
    }
    fn append_walk_span(&self, a: Point, b: Point, points: &mut Vec<Point>) -> Option<()> {
        if self.walk_chord(a, b) {
            points.push(b);
        } else {
            if horizontal(a, b) <= WALK_SAMPLE_MIN {
                return None;
            }
            let middle = self.walk_projection(lerp(a, b, 0.5))?;
            self.append_walk_span(a, middle, points)?;
            self.append_walk_span(middle, b, points)?;
        }
        Some(())
    }
    pub fn walk(&self, a: Point, b: Point) -> Option<Segment> {
        let distance_xz = horizontal(a, b);
        if distance_xz < 1e-9 && (a[1] - b[1]).abs() > 1e-7 {
            return None;
        }
        let mut points = vec![a];
        if self.walk_chord(a, b) {
            points.push(b);
        } else {
            // Start with coarse projections and subdivide where a straight
            // span cannot follow the standing height around a slope or edge.
            let count = (distance_xz / 0.4).ceil().max(1.) as usize;
            // A longer chord over a gap can spend many support and collision
            // checks reaching the first hole. Probe one of the same mandatory
            // samples out of order, then reuse it during the trace build.
            let middle = count / 2;
            let midpoint = if count >= 8 {
                Some(self.walk_projection(lerp(a, b, middle as f64 / count as f64))?)
            } else {
                None
            };
            for i in 1..=count {
                let point = if i == count {
                    b
                } else if i == middle
                    && let Some(midpoint) = midpoint
                {
                    midpoint
                } else {
                    self.walk_projection(lerp(a, b, i as f64 / count as f64))?
                };
                self.append_walk_span(*points.last().unwrap(), point, &mut points)?;
            }
        }
        Some(self.walk_segment(points))
    }
    pub(super) fn walk_segment(&self, points: Vec<Point>) -> Segment {
        let mut times = vec![0.];
        for pair in points.windows(2) {
            let length = distance(pair[0], pair[1]);
            // Resource scheduling drops sub-nanometre walk spans. Preserve the
            // same zero-duration representation after support projection rounds.
            let duration = if length <= 1e-9 {
                0.
            } else {
                length / self.physical.locomotion.speed
            };
            times.push(times.last().unwrap() + duration);
        }
        Segment {
            required_gait: None,
            boost: None,
            mode: "walk",
            points,
            times,
            connection: None,
            flight: None,
            gait: Some("run"),
            traversal: None,
        }
    }
    pub fn action(&self, a: Point, b: Point) -> Option<Segment> {
        self.walk(a, b)
            .or_else(|| self.drop(a, b))
            .or_else(|| self.jump(a, b, None))
    }
    pub fn goals(&self, query: &Query) -> Vec<Point> {
        let Some(interaction) = &query.interaction else {
            return self
                .project(query.goal, self.physical.ground.options.max_vertical)
                .into_iter()
                .collect();
        };
        if interaction.airborne {
            return Vec::new();
        }
        let mut result = Vec::new();
        // Authored static supports can be absent from navigation. Query their
        // local collision faces as terminal contacts without adding query nodes
        // to the prepared backbone. Standing and obstruction proofs still apply.
        for (index, triangles, physical) in [
            (&self.ground_index, &self.ground, false),
            (&self.box_support_index, &self.box_support, false),
            (&self.collision_index, &self.collision, true),
        ] {
            index.query(
                Bounds::points(&[query.goal]).expand(interaction.radius),
                |i| {
                    let triangle = triangles[i];
                    if physical
                        && support_normal(
                            triangle,
                            self.physical.movement.max_slope.to_radians().cos(),
                            true,
                        )
                        .is_none()
                    {
                        return false;
                    }
                    let mut candidates = triangle.to_vec();
                    if let Some(y) = triangle_height(query.goal, triangle) {
                        candidates.push([query.goal[0], y, query.goal[2]]);
                    }
                    for j in 0..3 {
                        let a = triangle[j];
                        let b = triangle[(j + 1) % 3];
                        let d = sub(b, a);
                        let denominator = dot(d, d);
                        if denominator > 0. {
                            candidates.push(lerp(
                                a,
                                b,
                                (dot(sub(query.goal, a), d) / denominator).clamp(0., 1.),
                            ));
                        }
                    }
                    if let Some(point) = candidates
                        .into_iter()
                        .filter(|p| crate::flight::hit(*p, *p, query.goal, interaction).is_some())
                        .min_by(|a, b| {
                            distance(*a, query.goal).total_cmp(&distance(*b, query.goal))
                        })
                    {
                        if let Some(point) = self.standing(point) {
                            if crate::flight::hit(point, point, query.goal, interaction).is_some()
                                && !self.blocked(point, point, 0.)
                            {
                                result.push(point);
                            }
                        }
                    }
                    false
                },
            );
        }
        result.sort_by(|a, b| distance(*a, query.goal).total_cmp(&distance(*b, query.goal)));
        result.dedup_by(|a, b| distance(*a, *b) < 1e-6);
        result
    }
}

fn swept_band([a, b]: [Point; 2], bounds: Bounds, radius: f64) -> impl Fn(Bounds) -> bool + Copy {
    let [dx, _, dz] = sub(b, a);
    let span = (dx * dx + dz * dz).sqrt();
    // A chord's AABB can include large pockets outside its capsule or
    // support footprint. Reject them before visiting individual triangles.
    let nx = dz;
    let nz = -dx;
    let limit = (radius + 1e-8) * span;
    move |candidate: Bounds| {
        if !candidate.overlaps(bounds) {
            return false;
        }
        let (x0, x1) = if nx >= 0. {
            (candidate.min[0], candidate.max[0])
        } else {
            (candidate.max[0], candidate.min[0])
        };
        let (z0, z1) = if nz >= 0. {
            (candidate.min[2], candidate.max[2])
        } else {
            (candidate.max[2], candidate.min[2])
        };
        (x0 - a[0]) * nx + (z0 - a[2]) * nz <= limit
            && (x1 - a[0]) * nx + (z1 - a[2]) * nz >= -limit
    }
}

fn support_normal(triangle: [Point; 3], minimum_up: f64, physical: bool) -> Option<Point> {
    let normal = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]));
    if normal[1] == 0. || (physical && normal[1] < 0.) {
        return None;
    }
    // Navigation polygons can be wound either way. Collision triangles must
    // face upward so the underside of a platform cannot be used as floor.
    let unit = scale(normal, normal[1].signum() / dot(normal, normal).sqrt());
    (unit[1] >= minimum_up - 1e-12).then_some(unit)
}
