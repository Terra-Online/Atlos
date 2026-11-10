struct Settings {
    viewport: vec4f,
    depthOffset: vec4f,
    color: vec4f,
    animation: vec4f, // x: viewer time; y: material repeat in CSS pixels
    light: vec4f, // camera-space sun direction, screen Y down
}
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var sceneDepth: texture_depth_2d;

struct Vertex {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) @interpolate(flat) length: f32,
    @location(2) @interpolate(flat) phase: f32,
    @location(3) @interpolate(flat) color: vec3f,
    @location(4) @interpolate(flat) wirePhase: f32,
    @location(5) @interpolate(flat) normal: vec2f,
}

@vertex fn vs(@builtin(vertex_index) index: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) color: vec4f) -> Vertex {
    let corners = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
    let corner = corners[index];
    let t = (corner.x + 1) * 0.5;
    let delta = (b.xy - a.xy) * settings.viewport.xy * vec2f(0.5, -0.5) / settings.viewport.z;
    let segmentLength = length(delta);
    let direction = delta / max(segmentLength, 0.000001);
    let normal = vec2f(-direction.y, direction.x);
    let halfWidth = settings.color.w + 2.5;
    let offset = (direction * corner.x + normal * corner.y) * halfWidth;
    let xy = mix(a.xy, b.xy, t) + offset * vec2f(2,-2) * settings.viewport.z / settings.viewport.xy;
    var out: Vertex;
    out.position = vec4f(xy, mix(a.z, b.z, t), 1);
    out.local = vec2f(t * segmentLength + corner.x * halfWidth, corner.y * halfWidth);
    out.length = segmentLength;
    out.phase = a.w;
    out.color = color.rgb;
    out.wirePhase = color.a;
    out.normal = normal;
    return out;
}

// Mirrored diagonal bands make a diamond mesh. Filter their edges before discard.
fn thread(phase: f32) -> f32 {
    let distance = abs(fract(phase) - 0.5);
    let aa = min(fwidth(phase), 0.2);
    return 1 - smoothstep(0.13 - aa, 0.23 + aa, distance);
}
@fragment fn fs(input: Vertex) -> @location(0) vec4f {
    let along = input.wirePhase + input.local.x;
    let across = input.local.y / settings.color.w;
    let phase = along / settings.animation.y;
    let strands = vec2f(phase * 8 + across, phase * 8 - across);
    let detail = 1 - smoothstep(0.4, 0.9, max(fwidth(strands.x), fwidth(strands.y)));
    let mesh = mix(0.65, max(thread(strands.x), thread(strands.y)), detail);
    // Shallow bevel on a flat band, lit by the scene sun rather than a fixed crown.
    let bevel = smoothstep(0.5, 1.0, abs(across)) * sign(across) * 0.35;
    let surfaceNormal = normalize(vec3f(input.normal * bevel, 1.0));
    let diffuse = max(dot(surfaceNormal, settings.light.xyz), 0.0);
    // Broad light sweeps and offset narrow streaks travel over a stationary base.
    // Whitening the highlight keeps motion legible even on saturated yellow.
    let travel = phase - settings.animation.x * 0.45;
    let sweepDistance = abs(fract(travel + across * 0.08) - 0.5);
    let sweep = 1 - smoothstep(0.04, 0.26, sweepDistance);
    let streakDistance = abs(fract(travel * 2 - across * 0.2) - 0.5);
    let streak = (1 - smoothstep(0.015, 0.10, streakDistance))
        * (1 - smoothstep(0.45, 0.95, abs(across + 0.2)));
    let radius = length(vec2f(max(max(-input.local.x, input.local.x - input.length), 0), input.local.y));
    let edge = 1 - smoothstep(settings.color.w - 0.75, settings.color.w, radius);
    // Shade only the sides. A radial rim would outline every segment's cap and
    // create visible collars along an otherwise continuous polyline.
    let selvedge = smoothstep(0.78, 1.0, abs(across));

    let size = vec2i(textureDimensions(sceneDepth));
    let uv = input.position.xy / settings.viewport.xy + settings.depthOffset.xy;
    let pixel = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - 1);
    let depth = textureLoad(sceneDepth, pixel, 0);
    let near = settings.viewport.w;
    // Compare in metres so ground-contact tolerance stays stable at any distance.
    let hidden = depth > 0 && near / max(input.position.z, 0.000000001) > near / max(depth, 0.000000001) + settings.depthOffset.z;
    if hidden && fract((input.phase + input.local.x) / settings.depthOffset.w) > 0.625 { discard; }
    let body = input.color * (0.46 + diffuse * 0.32 + mesh * 0.20 - selvedge * 0.05);
    let emission = sweep * 0.32 + streak * 0.26;
    let color = mix(body, vec3f(1.0), emission) + input.color * sweep * 0.08;
    let bodyAlpha = (0.78 + mesh * 0.20) * edge;
    // A small depth-gated contact shadow anchors nearby surface runs. This is a
    // screen-space approximation, not a shadow-map caster for airborne routes.
    let sunAcross = dot(settings.light.xy, input.normal);
    let shadowOffset = -sunAcross * 1.5;
    let shadowRadius = length(vec2f(max(max(-input.local.x, input.local.x - input.length), 0), input.local.y - shadowOffset));
    let separation = near / max(depth, 0.000000001) - near / max(input.position.z, 0.000000001);
    let contact = select(0.0, 1 - smoothstep(0.1, 0.45, abs(separation)), depth > 0 && !hidden);
    let shadowAlpha = (1 - smoothstep(settings.color.w - 0.5, settings.color.w + 2.0, shadowRadius)) * contact * 0.24;
    let alpha = bodyAlpha + shadowAlpha * (1 - bodyAlpha);
    if alpha < 0.001 { discard; }
    return vec4f((color * bodyAlpha + vec3f(0.025) * shadowAlpha * (1 - bodyAlpha)) / alpha, alpha);
}
