struct Settings {
    viewport: vec4f,
    depthOffset: vec4f,
}
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var sceneDepth: texture_depth_2d;

struct Vertex {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) @interpolate(flat) length: f32,
    @location(2) @interpolate(flat) phase: f32,
}

@vertex fn vs(@builtin(vertex_index) index: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> Vertex {
    let corners = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
    let corner = corners[index];
    let t = (corner.x + 1) * 0.5;
    let delta = (b.xy - a.xy) * settings.viewport.xy * vec2f(0.5, -0.5) / settings.viewport.z;
    let segmentLength = length(delta);
    let direction = delta / max(segmentLength, 0.000001);
    let normal = vec2f(-direction.y, direction.x);
    let halfWidth = 3.5;
    let offset = (direction * corner.x + normal * corner.y) * halfWidth;
    let xy = mix(a.xy, b.xy, t) + offset * vec2f(2,-2) * settings.viewport.z / settings.viewport.xy;
    var out: Vertex;
    out.position = vec4f(xy, mix(a.z, b.z, t), 1);
    out.local = vec2f(t * segmentLength + corner.x * halfWidth, corner.y * halfWidth);
    out.length = segmentLength;
    out.phase = a.w;
    return out;
}

@fragment fn fs(input: Vertex) -> @location(0) vec4f {
    let radius = length(vec2f(max(max(-input.local.x, input.local.x - input.length), 0), input.local.y));
    if radius > 3.5 { discard; }
    let size = vec2i(textureDimensions(sceneDepth));
    let uv = input.position.xy / settings.viewport.xy + settings.depthOffset.xy;
    let pixel = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - 1);
    let depth = textureLoad(sceneDepth, pixel, 0);
    let near = settings.viewport.w;
    // Compare in metres so ground-contact tolerance stays stable at any distance.
    let hidden = depth > 0 && near / max(input.position.z, 0.000000001) > near / max(depth, 0.000000001) + settings.depthOffset.z;
    if hidden && fract((input.phase + input.local.x) / settings.depthOffset.w) > 0.625 { discard; }
    let glow = 0.12 * (1 - smoothstep(2.5, 3.5, radius));
    let outer = 0.6 * (1 - smoothstep(1.0, 1.6, radius));
    let core = 1 - smoothstep(0.35, 0.85, radius);
    let alpha = 1 - (1 - glow) * (1 - outer) * (1 - core);
    return vec4f(mix(vec3f(0.35, 0.78, 1), vec3f(0.89, 0.97, 1), core), alpha);
}
