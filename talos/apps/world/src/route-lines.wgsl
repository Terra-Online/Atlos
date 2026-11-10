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
    @location(5) @interpolate(flat) before: vec4f,
    @location(6) @interpolate(flat) after: vec4f,
}

@vertex fn vs(@builtin(vertex_index) index: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) color: vec4f, @location(3) before: vec4f, @location(4) after: vec4f) -> Vertex {
    let corners = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
    let corner = corners[index];
    let t = (corner.x + 1) * 0.5;
    let delta = (b.xy - a.xy) * settings.viewport.xy * vec2f(0.5, -0.5) / settings.viewport.z;
    let segmentLength = length(delta);
    let direction = delta / max(segmentLength, 0.000001);
    let normal = vec2f(-direction.y, direction.x);
    let halfWidth = settings.color.w + 4.0;
    let offset = (direction * corner.x + normal * corner.y) * halfWidth;
    let xy = mix(a.xy, b.xy, t) + offset * vec2f(2,-2) * settings.viewport.z / settings.viewport.xy;
    var out: Vertex;
    out.position = vec4f(xy, mix(a.z, b.z, t), 1);
    out.local = vec2f(t * segmentLength + corner.x * halfWidth, corner.y * halfWidth);
    out.length = segmentLength;
    out.phase = a.w;
    out.color = color.rgb;
    out.wirePhase = color.a;
    out.before = before;
    out.after = after;
    return out;
}

// A bright, almost opaque core with a narrow coloured halo approximates the
// simplified mobile cable without textures, scene lighting or a bloom pass.
@fragment fn fs(input: Vertex) -> @location(0) vec4f {
    let along = input.wirePhase + input.local.x;
    let distance = length(vec2f(max(max(-input.local.x, input.local.x - input.length), 0), input.local.y));
    let size = vec2i(textureDimensions(sceneDepth));
    let uv = input.position.xy / settings.viewport.xy + settings.depthOffset.xy;
    let pixel = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - 1);
    let depth = textureLoad(sceneDepth, pixel, 0);
    let near = settings.viewport.w;
    let hidden = depth > 0 && near / max(input.position.z, 0.000000001) > near / max(depth, 0.000000001) + settings.depthOffset.z;
    // 22px strokes and 10px gaps read as dashes even on a 7px-wide cable.
    if hidden && fract((input.phase + input.local.x) / settings.depthOffset.w) > 0.6875 { discard; }
    let runPosition = input.before.w + clamp(input.local.x, 0.0, input.length);
    let blendWidth = max(0.001, min(8.0, input.after.w * 0.5));
    let entry = 0.5 * (1 - smoothstep(0.0, blendWidth, runPosition));
    let exit = 0.5 * (1 - smoothstep(0.0, blendWidth, input.after.w - runPosition));
    let tint = input.color + (input.before.rgb - input.color) * entry + (input.after.rgb - input.color) * exit;
    let pulse = 1 - smoothstep(0.04, 0.25, abs(fract(along / settings.animation.y - settings.animation.x * 0.35) - 0.5));
    let core = 1 - smoothstep(settings.color.w - 0.8, settings.color.w, distance);
    let hot = 1 - smoothstep(settings.color.w * 0.15, settings.color.w * 0.85, abs(input.local.y));
    let halo = 1 - smoothstep(settings.color.w - 0.2, settings.color.w + 4.0, distance);
    let coreColor = mix(tint, vec3f(1.0), 0.22 + hot * 0.30 + pulse * 0.10);
    let bodyAlpha = core * 0.98;
    let haloAlpha = halo * halo * 0.25;
    let alpha = bodyAlpha + haloAlpha * (1 - bodyAlpha);
    if alpha < 0.001 { discard; }
    return vec4f((coreColor * bodyAlpha + tint * haloAlpha * (1 - bodyAlpha)) / alpha, alpha);
}
