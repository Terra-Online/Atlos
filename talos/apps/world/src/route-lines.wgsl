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

// Coverage and rounded crown of one diagonal yarn. Derivative filtering keeps
// the weave stable when the ribbon or the render target is narrow.
fn yarn(phase: f32) -> vec2f {
    let distance = abs(fract(phase) - 0.5) * 2;
    let filterWidth = min(fwidth(phase), 0.35);
    let coverage = 1 - smoothstep(0.55 - filterWidth, 0.85 + filterWidth, distance);
    return vec2f(coverage, coverage * (1 - distance));
}

@fragment fn fs(input: Vertex) -> @location(0) vec4f {
    let along = input.wirePhase + input.local.x;
    let across = input.local.y / settings.color.w;
    let pitch = settings.animation.y / 8;
    let strands = vec2f(along / pitch + across * 1.5, along / pitch - across * 1.5);
    let first = yarn(strands.x);
    let second = yarn(strands.y);
    // Alternate the upper yarn at each intersection, like a dense braided sleeve.
    let firstOver = fract((floor(strands.x) + floor(strands.y)) * 0.5) < 0.5;
    let upper = select(second, first, firstOver);
    let lower = select(first, second, firstOver);
    let detail = 1 - smoothstep(0.4, 0.9, max(fwidth(strands.x), fwidth(strands.y)));
    let weave = mix(0.9, 0.62 + lower.x * 0.23 + upper.x * 0.16 + upper.y * 0.18, detail);
    let crown = sqrt(max(0, 1 - across * across));
    let lighting = weave * (0.78 + crown * 0.22);
    let pulseDistance = abs(fract(along / settings.animation.y - settings.animation.x * 0.22) - 0.5);
    let pulse = 1 - smoothstep(0.06, 0.22, pulseDistance);
    let radius = length(vec2f(max(max(-input.local.x, input.local.x - input.length), 0), input.local.y));
    let edge = 1 - smoothstep(settings.color.w - 0.75, settings.color.w, radius);
    let rim = smoothstep(settings.color.w - 1.1, settings.color.w - 0.35, radius);
    if radius > settings.color.w { discard; }
    let size = vec2i(textureDimensions(sceneDepth));
    let uv = input.position.xy / settings.viewport.xy + settings.depthOffset.xy;
    let pixel = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - 1);
    let depth = textureLoad(sceneDepth, pixel, 0);
    let near = settings.viewport.w;
    // Compare in metres so ground-contact tolerance stays stable at any distance.
    let hidden = depth > 0 && near / max(input.position.z, 0.000000001) > near / max(depth, 0.000000001) + settings.depthOffset.z;
    if hidden && fract((input.phase + input.local.x) / settings.depthOffset.w) > 0.625 { discard; }
    let body = input.color * (lighting + pulse * 0.12);
    let highlight = vec3f(0.08) * upper.y * crown * detail + vec3f(0.04) * pulse;
    let color = mix(body + highlight, input.color * 0.22, rim);
    // The braid and travelling highlight affect light only. Continuous geometry
    // stays nearly opaque, and only the depth-driven dash rule opens gaps.
    return vec4f(color, 0.98 * edge);
}
