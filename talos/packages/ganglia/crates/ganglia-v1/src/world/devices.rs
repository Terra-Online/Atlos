use super::*;
impl World {
    fn device_feet(&self, d: &Device) -> Result<Vec<Vec3>, String> {
        let Some(g) = &d.goal else { return Ok(vec![]) };
        let mut seeds = d.seeds.clone();
        seeds.extend(
            self.project_with_tolerance(g.position, 0.5, Some(&g.interaction))?
                .into_iter()
                .take(32)
                .map(|p| p.position),
        );
        let mut out = vec![];
        for seed in seeds {
            if !self.in_coverage(seed, self.movement.profile.radius + 0.02) {
                continue;
            }
            if let Some(p) = self.standing_foot(seed)? {
                let dx = p[0] - g.position[0];
                let dz = p[2] - g.position[2];
                let i = &g.interaction;
                if distance(p, g.position) > i.radius + 1e-9
                    || i.max_vertical
                        .is_some_and(|v| (p[1] - g.position[1]).abs() > v)
                {
                    continue;
                }
                if let (Some(f), Some(a)) = (i.facing, i.half_angle)
                    && dx * f[0] + dz * f[2]
                        < dx.hypot(dz) * f[0].hypot(f[2]) * a.to_radians().cos() - 1e-9
                {
                    continue;
                }
                if !out.contains(&p) {
                    out.push(p)
                }
            }
        }
        Ok(out)
    }
    fn add_pair(&mut self, mut c: Connection) {
        let duration = c.duration();
        let mut reverse = c.clone();
        reverse.id += "/reverse";
        reverse.points.reverse();
        reverse.times = c.times.iter().rev().map(|t| duration - t).collect();
        std::mem::swap(&mut reverse.from_surface, &mut reverse.to_surface);
        c.traversal = Some("moving-support".into());
        reverse.traversal = c.traversal.clone();
        self.connections.extend([c, reverse]);
    }
    pub(super) fn prepare_devices(&mut self) -> Result<(), String> {
        let devices = self.devices.clone();
        for d in &devices.devices {
            if d.kind == "accelerate"
                && self.in_coverage(d.position, self.movement.profile.radius + 0.02)
            {
                let duration = d.duration.as_f64();
                if let (Some(duration), Some(goal)) = (duration, &d.goal)
                    && duration > 0.
                    && d.boost_multiplier > 1.
                    && duration.is_finite()
                    && d.boost_multiplier.is_finite()
                {
                    self.boosts.push(Boost {
                        effect: BoostUse {
                            id: d.id.clone(),
                            multiplier: d.boost_multiplier,
                            duration,
                        },
                        position: goal.position,
                        interaction: goal.interaction.clone(),
                    });
                    self.outcomes.push(Outcome {
                        id: d.id.clone(),
                        reason: "trigger-retained".into(),
                    });
                    continue;
                }
                self.outcomes.push(Outcome {
                    id: d.id.clone(),
                    reason: "device-model-unresolved".into(),
                });
            }
        }
        for pair in &devices.ropes {
            let a = devices.devices.iter().find(|d| d.id == pair.bottom);
            let b = devices.devices.iter().find(|d| d.id == pair.top);
            let (Some(a), Some(b)) = (a, b) else {
                return Err("Rope references missing device".into());
            };
            let mut accepted = false;
            if !self.in_coverage(a.position, self.movement.profile.radius + 0.02)
                || !self.in_coverage(b.position, self.movement.profile.radius + 0.02)
            {
                continue;
            }
            if a.resolved
                && b.resolved
                && a.unit_scale
                && b.unit_scale
                && a.speed > 0.
                && a.speed.is_finite()
                && a.overhead >= 0.
                && a.overhead.is_finite()
            {
                let from = self.device_feet(a)?;
                let to = self.device_feet(b)?;
                'pairs: for &p in &from {
                    for &q in &to {
                        let points =
                            vec![p, p, [p[0], q[1] + 0.1, p[2]], [q[0], q[1] + 0.1, q[2]], q];
                        let mut clear = true;
                        for s in points.windows(2) {
                            if !self.clear(s[0], s[1], 0.)? {
                                clear = false;
                                break;
                            }
                        }
                        if !clear {
                            continue;
                        }
                        let mut times = vec![0., a.overhead];
                        for s in points[1..].windows(2) {
                            times.push(times.last().unwrap() + distance(s[0], s[1]) / a.speed)
                        }
                        let mut c = Connection::new(
                            format!("rope/{}/{}", a.id, b.id),
                            Mode::Rope,
                            points,
                            times,
                        );
                        c.endpoint_tolerance = Some(self.movement.profile.radius);
                        c.extra.insert(
                            "device".into(),
                            serde_json::json!({"kind":"rope","bottom":a.id,"top":b.id}),
                        );
                        self.connections.push(c);
                        accepted = true;
                        break 'pairs;
                    }
                }
            }
            self.outcomes.push(Outcome {
                id: a.id.clone(),
                reason: if accepted {
                    "accepted"
                } else {
                    "support-or-model-unresolved"
                }
                .into(),
            });
        }
        for d in &devices.devices {
            if d.kind != "launch"
                || !self.in_coverage(d.position, self.movement.profile.radius + 0.02)
            {
                continue;
            }
            let mut accepted = false;
            if d.fixed_launch
                && d.unit_scale
                && d.height > 0.
                && d.height.is_finite()
                && let Ok(aim) = serde_json::from_value::<Vec3>(d.aim.clone())
            {
                for start in self.device_feet(d)? {
                    let mut m = self.movement.model.clone();
                    m.max_jump_height = d.height.max(aim[1] + d.aim_clearance - start[1]);
                    let end = if self.in_coverage(aim, self.movement.profile.radius + 0.02) {
                        self.standing_foot(aim)?
                    } else {
                        None
                    };
                    let mut candidates = vec![];
                    if let Some(end) = end {
                        candidates.push(end)
                    }
                    // The aim may be airborne. Solve the descending ray/support intercept
                    // jointly rather than treating the aim as a fictitious landing platform.
                    if let Some(aim_time) =
                        super::flight::duration(start[1], aim[1], &m, Mode::Jump)?
                    {
                        let vx = (aim[0] - start[0]) / aim_time;
                        let vz = (aim[2] - start[2]) / aim_time;
                        let min = self
                            .surfaces
                            .iter()
                            .flat_map(|s| s.vertices.iter().map(|p| p[1]))
                            .fold(start[1], f64::min);
                        if let Some(end_time) =
                            super::flight::duration(start[1], min, &m, Mode::Jump)?
                        {
                            let ascent = (2. * m.gravity * m.max_jump_height).sqrt() / m.gravity
                                + m.apex_time;
                            let mut t = ascent;
                            while t <= end_time + 0.025 {
                                let seed = [start[0] + vx * t, aim[1], start[2] + vz * t];
                                if !self.in_coverage(seed, self.movement.profile.radius + 0.02) {
                                    break;
                                }
                                if let Some(h) = self.ground_at(
                                    seed,
                                    (start[1] + m.max_jump_height - seed[1]).max(0.),
                                    (seed[1] - min).max(0.),
                                    self.movement.profile.radius,
                                )? {
                                    let mut foot = h.position;
                                    for _ in 0..16 {
                                        let Some(time) = super::flight::duration(
                                            start[1],
                                            foot[1] + 0.01,
                                            &m,
                                            Mode::Jump,
                                        )?
                                        else {
                                            break;
                                        };
                                        let p =
                                            [start[0] + vx * time, foot[1], start[2] + vz * time];
                                        let Some(next) = self.ground_at(
                                            p,
                                            0.5,
                                            0.5,
                                            self.movement.profile.radius,
                                        )?
                                        else {
                                            break;
                                        };
                                        if distance(next.position, foot) < 1e-5 {
                                            if let Some(f) = self.standing_foot(next.position)? {
                                                candidates.push(f)
                                            }
                                            break;
                                        }
                                        foot = next.position;
                                    }
                                }
                                t += 0.025;
                            }
                        }
                    }
                    for end in candidates {
                        let Some(time) = super::flight::duration(start[1], end[1], &m, Mode::Jump)?
                        else {
                            continue;
                        };
                        m.max_horizontal_speed =
                            (end[0] - start[0]).hypot(end[2] - start[2]) / time + 1e-7;
                        m.start_horizontal_speed = None;
                        m.air_overspeed_deceleration = None;
                        if let Some(mut c) =
                            self.flight_with_control(start, end, &m, &FlightControl::default())?
                        {
                            c.id = format!("launch/{}", d.id);
                            c.mode = Mode::Launch;
                            c.extra.insert(
                                "device".into(),
                                serde_json::json!({"kind":"launch","id":d.id}),
                            );
                            self.connections.push(c);
                            accepted = true;
                            break;
                        }
                    }
                    if accepted {
                        break;
                    }
                }
            }
            self.outcomes.push(Outcome {
                id: d.id.clone(),
                reason: if accepted {
                    "accepted"
                } else {
                    "launch-support-model-or-clearance-unresolved"
                }
                .into(),
            });
        }
        for d in &devices.moving_supports {
            for (i, t) in d.transfers.iter().enumerate() {
                if !self.in_coverage(t.from, self.movement.profile.radius + 0.02)
                    || !self.in_coverage(t.to, self.movement.profile.radius + 0.02)
                {
                    continue;
                }
                let mut reason = "ride-speed-unresolved";
                if let Some(speed) = t.speed.filter(|s| s.is_finite() && *s > 0.) {
                    let a = self.standing_foot(t.from)?;
                    let b = self.standing_foot(t.to)?;
                    if let (Some(a), Some(b)) = (a, b) {
                        reason = "ride-clearance-blocked";
                        if self.clear(a, b, 0.)? {
                            let duration = distance(a, b) / speed;
                            if duration > 0. {
                                let mut c = Connection::new(
                                    format!("moving-ride/{}/{i}", d.id),
                                    Mode::Rope,
                                    vec![a, b],
                                    vec![0., duration],
                                );
                                c.from_surface =
                                    self.project(a, None)?.first().map(|p| p.surface.clone());
                                c.to_surface =
                                    self.project(b, None)?.first().map(|p| p.surface.clone());
                                c.endpoint_tolerance = Some(self.movement.profile.radius);
                                c.extra.insert("support".into(),serde_json::json!({"device":d.id,"family":d.family,"assumption":d.assumption,"fromPose":t.from_pose,"toPose":t.to_pose,"body":t.body}));
                                self.add_pair(c);
                                reason = "accepted";
                            }
                        }
                    }
                    self.outcomes.push(Outcome {
                        id: format!("{}/{i}", d.id),
                        reason: reason.into(),
                    });
                }
            }
        }
        // Join coincident static and swept support footprints through verified
        // short transfers. Other poses remain support alternatives, not solids.
        let moving: Vec<Surface> = self
            .surfaces
            .iter()
            .filter(|s| s.extra.contains_key("supportDevice"))
            .cloned()
            .collect();
        for s in moving {
            let center: Vec3 = std::array::from_fn(|a| {
                s.vertices.iter().map(|p| p[a]).sum::<f64>() / s.vertices.len() as f64
            });
            let mut seeds = vec![center];
            seeds.extend(s.vertices.iter().copied());
            for (i, seed) in seeds.into_iter().enumerate() {
                for hit in self.project_with_tolerance(seed, self.movement.max_vertical, None)? {
                    if self
                        .surface(&hit.surface)
                        .is_some_and(|s| s.extra.contains_key("supportDevice"))
                    {
                        continue;
                    }
                    if !self.in_coverage(seed, self.movement.profile.radius + 0.02) {
                        continue;
                    }
                    let a = [seed[0], seed[1] + 0.01, seed[2]];
                    let b = [hit.position[0], hit.position[1] + 0.01, hit.position[2]];
                    if !self.clear(a, b, 0.)? {
                        continue;
                    }
                    let mut c = Connection::new(
                        format!("moving-join/{}/{i}/{}", s.id, hit.surface),
                        Mode::Rope,
                        vec![a, b],
                        vec![0., (distance(a, b) / self.movement.speed).max(f64::EPSILON)],
                    );
                    c.from_surface = Some(s.id.clone());
                    c.to_surface = Some(hit.surface);
                    c.endpoint_tolerance = Some(self.movement.profile.radius);
                    self.add_pair(c);
                }
            }
        }
        Ok(())
    }
    /// A following support is an alternative placement, never an always-solid
    /// obstacle across its activity range. The returned World owns that one pose.
    pub fn place_following(&self, id: &str, position: Vec3) -> Result<Option<World>, String> {
        let Some(d) = self.devices.following_supports.iter().find(|d| d.id == id) else {
            return Err("Unknown following support".into());
        };
        if !finite(position) || !d.max_distance.is_finite() || d.max_distance < 0. {
            return Err("Invalid following placement".into());
        }
        if distance(position, d.spawn) > d.max_distance + 1e-9 {
            return Ok(None);
        }
        let delta = sub(position, d.spawn);
        let mut roofs = vec![];
        let mut body_faces = vec![];
        for (i, body) in d.bodies.iter().enumerate() {
            if body.len() < 4 || body.iter().any(|&p| !finite(p)) {
                return Err("Invalid following body".into());
            }
            let shifted: Vec<Vec3> = body
                .iter()
                .map(|p| std::array::from_fn(|a| p[a] + delta[a]))
                .collect();
            let low = shifted.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
            let high = shifted
                .iter()
                .map(|p| p[1])
                .fold(f64::NEG_INFINITY, f64::max);
            let bottom = hull(
                shifted
                    .iter()
                    .filter(|p| (p[1] - low).abs() < 1e-5)
                    .copied()
                    .collect(),
            );
            let top = hull(
                shifted
                    .iter()
                    .filter(|p| (p[1] - high).abs() < 1e-5)
                    .copied()
                    .collect(),
            );
            if top.len() < 3 || bottom.len() < 3 {
                return Ok(None);
            }
            // Subtract coplanar static triangles from the complete footprint. Checking
            // corners alone would allow a movable body to bridge unsupported holes.
            if !footprint_supported(&bottom, low, &self.collision.faces) {
                return Ok(None);
            }
            let min: Vec3 =
                std::array::from_fn(|a| shifted.iter().map(|p| p[a]).fold(f64::INFINITY, f64::min));
            let max: Vec3 = std::array::from_fn(|a| {
                shifted
                    .iter()
                    .map(|p| p[a])
                    .fold(f64::NEG_INFINITY, f64::max)
            });
            for face in &self.collision.faces {
                let fmin: Vec3 = std::array::from_fn(|a| {
                    face.iter().map(|p| p[a]).fold(f64::INFINITY, f64::min)
                });
                let fmax: Vec3 = std::array::from_fn(|a| {
                    face.iter().map(|p| p[a]).fold(f64::NEG_INFINITY, f64::max)
                });
                if fmax[1] > low + 1e-5
                    && (0..3).all(|a| fmin[a] < max[a] - 1e-6 && fmax[a] > min[a] + 1e-6)
                {
                    return Ok(None);
                }
            }
            body_faces.extend(convex_faces(&shifted));
            let mut extra = Extra::new();
            extra.insert(
                "placement".into(),
                serde_json::json!({"device":id,"position":position}),
            );
            roofs.push(Surface {
                id: format!("following/{id}/{i}"),
                vertices: top,
                portals: vec![],
                extra,
            });
        }
        let mut snapshot = self.snapshot.clone();
        let arr = snapshot["input"]["devices"]["movingSupports"].as_array_mut();
        let support = serde_json::json!({"id":format!("following/{id}"),"family":"following","surfaces":roofs,"transfers":[],"assumption":"placement-within-activity-range"});
        if let Some(arr) = arr {
            arr.push(support)
        } else {
            snapshot["input"]["devices"]["movingSupports"] = serde_json::json!([support]);
        }
        let mut geometry: CollisionGeometry = decode(&snapshot["input"]["collision"], "collision")?;
        for face in body_faces {
            let base = geometry.positions.len() / 3;
            geometry.positions.extend(face.into_iter().flatten());
            geometry.indices.extend([base, base + 1, base + 2]);
        }
        snapshot["input"]["collision"] =
            serde_json::to_value(geometry).map_err(|e| e.to_string())?;
        World::new(snapshot).map(Some)
    }
}
fn side(a: Vec3, b: Vec3, p: Vec3) -> f64 {
    (b[0] - a[0]) * (p[2] - a[2]) - (b[2] - a[2]) * (p[0] - a[0])
}
fn hull(mut points: Vec<Vec3>) -> Vec<Vec3> {
    points.sort_by(|a, b| a[0].total_cmp(&b[0]).then_with(|| a[2].total_cmp(&b[2])));
    points.dedup();
    if points.len() < 3 {
        return points;
    }
    let half = |list: Vec<Vec3>| {
        let mut out: Vec<Vec3> = vec![];
        for p in list {
            while out.len() > 1 && side(out[out.len() - 2], out[out.len() - 1], p) <= 0. {
                out.pop();
            }
            out.push(p);
        }
        out.pop();
        out
    };
    let mut out = half(points.clone());
    points.reverse();
    out.extend(half(points));
    out.reverse();
    out
}
fn area(poly: &[Vec3]) -> f64 {
    if poly.len() < 3 {
        return 0.;
    }
    poly.iter()
        .enumerate()
        .map(|(i, p)| p[0] * poly[(i + 1) % poly.len()][2] - p[2] * poly[(i + 1) % poly.len()][0])
        .sum::<f64>()
        .abs()
        / 2.
}
fn half_clip(poly: &[Vec3], a: Vec3, b: Vec3, keep_inside: bool) -> Vec<Vec3> {
    let mut out = vec![];
    for i in 0..poly.len() {
        let p = poly[i];
        let q = poly[(i + 1) % poly.len()];
        let x = side(a, b, p);
        let y = side(a, b, q);
        let yes = if keep_inside { x >= 0. } else { x <= 0. };
        let next = if keep_inside { y >= 0. } else { y <= 0. };
        if yes {
            out.push(p)
        }
        if yes != next {
            out.push(super::collision::mix(p, q, x / (x - y)))
        }
    }
    out
}
fn footprint_supported(poly: &[Vec3], height: f64, faces: &[[Vec3; 3]]) -> bool {
    let mut uncovered = vec![poly.to_vec()];
    for t in faces {
        if t.iter().any(|p| (p[1] - height).abs() > 1e-5) || side(t[0], t[1], t[2]) >= -1e-9 {
            continue;
        }
        let ring = [t[2], t[1], t[0]];
        let mut next = vec![];
        for mut remainder in uncovered {
            for i in 0..3 {
                if remainder.is_empty() {
                    break;
                }
                let outside = half_clip(&remainder, ring[i], ring[(i + 1) % 3], false);
                if area(&outside) > 1e-9 {
                    next.push(outside)
                }
                remainder = half_clip(&remainder, ring[i], ring[(i + 1) % 3], true);
            }
        }
        uncovered = next;
        if uncovered.is_empty() {
            return true;
        }
        if uncovered.len() > 256 {
            return false;
        }
    }
    false
}

// Triangulate each supporting plane once. Coplanar vertices form one polygon,
// avoiding overlapping triangle fans on a box face or a convex collider face.
fn convex_faces(points: &[Vec3]) -> Vec<[Vec3; 3]> {
    let mut planes: Vec<(Vec3, f64)> = vec![];
    let mut out = vec![];
    for i in 0..points.len() {
        for j in i + 1..points.len() {
            for k in j + 1..points.len() {
                let n = cross(sub(points[j], points[i]), sub(points[k], points[i]));
                let len = hypot(n);
                if len < 1e-10 {
                    continue;
                }
                let mut n = n.map(|v| v / len);
                let mut d = super::collision::dot(n, points[i]);
                let sides: Vec<f64> = points
                    .iter()
                    .map(|&p| super::collision::dot(n, p) - d)
                    .collect();
                if sides.iter().any(|&v| v > 1e-7) && sides.iter().any(|&v| v < -1e-7) {
                    continue;
                }
                if sides.iter().any(|&v| v > 1e-7) {
                    n = n.map(|v| -v);
                    d = -d;
                }
                if planes.iter().any(|(normal, offset)| {
                    distance(*normal, n) < 1e-7 && (*offset - d).abs() < 1e-7
                }) {
                    continue;
                }
                planes.push((n, d));
                let mut face: Vec<Vec3> = points
                    .iter()
                    .copied()
                    .filter(|&p| (super::collision::dot(n, p) - d).abs() < 1e-7)
                    .collect();
                let center: Vec3 = std::array::from_fn(|a| {
                    face.iter().map(|p| p[a]).sum::<f64>() / face.len() as f64
                });
                let u = sub(face[0], center);
                let v = cross(n, u);
                face.sort_by(|&a, &b| {
                    let a = sub(a, center);
                    let b = sub(b, center);
                    super::collision::dot(a, v)
                        .atan2(super::collision::dot(a, u))
                        .total_cmp(&super::collision::dot(b, v).atan2(super::collision::dot(b, u)))
                });
                for t in 1..face.len() - 1 {
                    out.push([face[0], face[t], face[t + 1]])
                }
            }
        }
    }
    out
}
