use super::collision::{cross, point_triangle, segment_segment, sub};
use crate::model::*;
pub(super) fn validate(walls: &[Wall]) -> Result<(), String> {
    for w in walls {
        if w.min.iter().chain(w.max.iter()).any(|v| !v.is_finite())
            || (0..3).any(|i| w.min[i] > w.max[i])
            || !matches!(w.state.as_str(), "active" | "inactive" | "unknown")
            || !w.padding.is_finite()
            || w.padding < 0.
        {
            return Err("Invalid wall".into());
        }
        if w.points.is_some() && w.polygon.is_some()
            || w.sphere.is_some() && (w.points.is_some() || w.polygon.is_some())
        {
            return Err("Conflicting wall shapes".into());
        }
        for (ring, n) in [(&w.points, 2), (&w.polygon, 3)] {
            if let Some(r) = ring
                && (r.len() < n || r.iter().flatten().any(|v| !v.is_finite()))
            {
                return Err("Invalid wall ring".into());
            }
        }
        if let Some(s) = &w.sphere
            && (s.center.iter().any(|v| !v.is_finite()) || !s.radius.is_finite() || s.radius <= 0.)
        {
            return Err("Invalid wall sphere".into());
        }
    }
    Ok(())
}
fn inside(p: Vec3, r: &[[f64; 2]]) -> bool {
    let mut yes = false;
    for i in 0..r.len() {
        let a = r[i];
        let b = r[(i + 1) % r.len()];
        if (a[1] > p[2]) != (b[1] > p[2])
            && p[0] < (b[0] - a[0]) * (p[2] - a[1]) / (b[1] - a[1]) + a[0]
        {
            yes = !yes
        }
    }
    yes
}
fn interval(a: f64, b: f64, min: f64, max: f64, lo: &mut f64, hi: &mut f64) -> bool {
    let d = b - a;
    if d == 0. {
        return a >= min && a <= max;
    }
    let x = (min - a) / d;
    let y = (max - a) / d;
    *lo = lo.max(x.min(y));
    *hi = hi.min(x.max(y));
    *lo <= *hi
}
pub(super) fn blocked(walls: &[Wall], a: Vec3, b: Vec3, p: Profile, inflation: f64) -> bool {
    for w in walls {
        if w.state == "inactive" {
            continue;
        }
        let r = p.radius + w.padding + inflation;
        if let Some(s) = &w.sphere {
            let c = [a[0], a[1] + p.radius, a[2]];
            let d = [a[0], a[1] + p.height - p.radius, a[2]];
            let e = [b[0], b[1] + p.radius, b[2]];
            let f = [b[0], b[1] + p.height - p.radius, b[2]];
            let t1 = [c, d, f];
            let t2 = [c, f, e];
            let n1 = cross(sub(d, c), sub(f, c));
            let n2 = cross(sub(f, c), sub(e, c));
            if point_triangle(s.center, t1, n1).min(point_triangle(s.center, t2, n2))
                <= (s.radius + r).powi(2)
            {
                return true;
            }
            continue;
        }
        let mut lo = 0.;
        let mut hi = 1.;
        if !interval(
            a[1],
            b[1],
            w.min[1] - p.height - inflation,
            w.max[1] + inflation,
            &mut lo,
            &mut hi,
        ) {
            continue;
        }
        if let Some(ring) = w.polygon.as_ref().or(w.points.as_ref()) {
            let x = super::collision::mix(a, b, lo);
            let y = super::collision::mix(a, b, hi);
            if w.polygon.is_some() && (inside(x, ring) || inside(y, ring)) {
                return true;
            }
            let n = if w.polygon.is_some() {
                ring.len()
            } else {
                ring.len() - 1
            };
            for i in 0..n {
                let c = ring[i];
                let d = ring[(i + 1) % ring.len()];
                if segment_segment(
                    [x[0], 0., x[2]],
                    [y[0], 0., y[2]],
                    [c[0], 0., c[1]],
                    [d[0], 0., d[1]],
                ) <= r * r
                {
                    return true;
                }
            }
        } else if interval(a[0], b[0], w.min[0] - r, w.max[0] + r, &mut lo, &mut hi)
            && interval(a[2], b[2], w.min[2] - r, w.max[2] + r, &mut lo, &mut hi)
        {
            return true;
        }
    }
    false
}
