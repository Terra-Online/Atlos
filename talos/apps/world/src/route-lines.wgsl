struct Settings {
    viewport: vec4f,
    depthOffset: vec4f,
    color: vec4f,
    animation: vec4f, // x: viewer time; y: material repeat in CSS pixels
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
}

@vertex fn vs(@builtin(vertex_index) index: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) color: vec4f) -> Vertex {
    let corners = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
    let corner = corners[index];
    let t = (corner.x + 1) * 0.5;
    let delta = (b.xy - a.xy) * settings.viewport.xy * vec2f(0.5, -0.5) / settings.viewport.z;
    let segmentLength = length(delta);
    let direction = delta / max(segmentLength, 0.000001);
    let normal = vec2f(-direction.y, direction.x);
    let halfWidth = settings.color.w;
    let offset = (direction * corner.x + normal * corner.y) * halfWidth;
    let xy = mix(a.xy, b.xy, t) + offset * vec2f(2,-2) * settings.viewport.z / settings.viewport.xy;
    var out: Vertex;
    out.position = vec4f(xy, mix(a.z, b.z, t), 1);
    out.local = vec2f(t * segmentLength + corner.x * halfWidth, corner.y * halfWidth);
    out.length = segmentLength;
    out.phase = a.w;
    out.color = color.rgb;
    out.wirePhase = color.a;
    return out;
}

// Low-contrast fibres suggest a woven surface without carving the band into yarns.
// Keep every longitudinal frequency periodic at WIRE_PERIOD, including at joins.
@fragment fn fs(input: Vertex) -> @location(0) vec4f {
    let along = input.wirePhase + input.local.x;
    let across = input.local.y / settings.color.w;
    let phase = along / settings.animation.y;
    let strands = vec2f(phase * 8 + across, phase * 8 - across);
    let detail = 1 - smoothstep(0.4, 0.9, max(fwidth(strands.x), fwidth(strands.y)));
    let weave = (cos(strands.x * 6.2831853) + cos(strands.y * 6.2831853)) * 0.025 * detail;
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
    if radius > settings.color.w { discard; }
    let size = vec2i(textureDimensions(sceneDepth));
    let uv = input.position.xy / settings.viewport.xy + settings.depthOffset.xy;
    let pixel = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - 1);
    let depth = textureLoad(sceneDepth, pixel, 0);
    let near = settings.viewport.w;
    // Compare in metres so ground-contact tolerance stays stable at any distance.
    let hidden = depth > 0 && near / max(input.position.z, 0.000000001) > near / max(depth, 0.000000001) + settings.depthOffset.z;
    if hidden && fract((input.phase + input.local.x) / settings.depthOffset.w) > 0.625 { discard; }
    let body = input.color * (0.82 + weave - selvedge * 0.08);
    let emission = sweep * 0.32 + streak * 0.26;
    let color = mix(body, vec3f(1.0), emission) + input.color * sweep * 0.08;
    // Surface light never punches holes in the band. Only scene occlusion does.
    return vec4f(color, 0.98 * edge);
}
