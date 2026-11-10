struct Settings {
    viewport: vec4f,
    depthOffset: vec4f,
    color: vec4f, // x: hide occluded fragments; w: line half-width
    animation: vec4f, // x: viewer time; y: material repeat in CSS pixels; z: focal length times world radius / base width
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
    @location(7) halfWidth: f32,
}

@vertex fn vs(@builtin(vertex_index) index: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) color: vec4f, @location(3) before: vec4f, @location(4) after: vec4f) -> Vertex {
    let corners = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
    let corner = corners[index];
    let t = (corner.x + 1) * 0.5;
    let delta = (b.xy - a.xy) * settings.viewport.xy * vec2f(0.5, -0.5) / settings.viewport.z;
    let segmentLength = length(delta);
    let direction = delta / max(segmentLength, 0.000001);
    let normal = vec2f(-direction.y, direction.x);
    // World-sized cable with a readability floor and a close-up cap.
    let width = clamp(settings.color.w * settings.animation.z * mix(a.z, b.z, t) / settings.viewport.w, settings.color.w * 0.45, settings.color.w * 1.2);
    let halfWidth = width + 2.5;
    let offset = (direction * corner.x + normal * corner.y) * halfWidth;
    let xy = mix(a.xy, b.xy, t) + offset * vec2f(2,-2) * settings.viewport.z / settings.viewport.xy;
    var out: Vertex;
    out.position = vec4f(xy, mix(a.z, b.z, t), 1);
    out.local = vec2f(t * segmentLength + corner.x * halfWidth, corner.y * halfWidth);
    out.halfWidth = width;
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
    let separation = near / max(input.position.z, 0.000000001) - near / max(depth, 0.000000001);
    let hidden = depth > 0 && separation > settings.depthOffset.z;
    if hidden && settings.color.x > 0.5 { discard; }
    // Ease into occlusion over 45 cm instead of switching opacity and gaps at once.
    let occlusion = select(0.0, smoothstep(settings.depthOffset.z, settings.depthOffset.z + 0.45, separation), depth > 0);
    // A capsule gives the 22px strokes rounded, antialiased ends inside the 32px period.
    let dashPosition = fract((input.phase + input.local.x) / settings.depthOffset.w) * settings.depthOffset.w;
    let capRadius = min(input.halfWidth, 3.0);
    let capDistance = length(vec2f(max(abs(dashPosition - 11.0) - (11.0 - capRadius), 0.0), input.local.y * capRadius / input.halfWidth));
    let dash = 1 - smoothstep(capRadius - 0.6, capRadius + 0.6, capDistance);
    let coverage = mix(1.0, dash, occlusion);
    let runPosition = input.before.w + clamp(input.local.x, 0.0, input.length);
    let blendWidth = max(0.001, min(8.0, input.after.w * 0.5));
    let entry = 0.5 * (1 - smoothstep(0.0, blendWidth, runPosition));
    let exit = 0.5 * (1 - smoothstep(0.0, blendWidth, input.after.w - runPosition));
    let tint = input.color + (input.before.rgb - input.color) * entry + (input.after.rgb - input.color) * exit;
    let pulse = 1 - smoothstep(0.04, 0.25, abs(fract(along / settings.animation.y - settings.animation.x * 0.35) - 0.5));
    let core = 1 - smoothstep(max(0.0, input.halfWidth - 0.65), input.halfWidth + 0.15, distance);
    let hot = 1 - smoothstep(input.halfWidth * 0.15, input.halfWidth * 0.85, distance);
    let halo = 1 - smoothstep(input.halfWidth, input.halfWidth + 2.5, distance);
    let coreColor = mix(tint, vec3f(1.0), 0.12 + hot * 0.22 + pulse * 0.06);
    let bodyAlpha = core * mix(0.98, 0.62, occlusion) * coverage;
    let haloAlpha = halo * halo * mix(0.14, 0.025, occlusion) * coverage;
    let alpha = bodyAlpha + haloAlpha * (1 - bodyAlpha);
    if alpha < 0.001 { discard; }
    // Premultiplied max blending builds one cable layer without accumulating
    // brightness at overlapping segment caps or dense bends.
    return vec4f(coreColor * bodyAlpha + tint * haloAlpha * (1 - bodyAlpha), alpha);
}
