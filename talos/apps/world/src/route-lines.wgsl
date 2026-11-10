struct Settings {
    viewport: vec4f,
    depthOffset: vec4f,
    color: vec4f,
    animation: vec4f, // x: elapsed seconds
}
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
@group(0) @binding(2) var flowTexture: texture_2d<f32>;
@group(0) @binding(3) var flowSampler: sampler;
@group(0) @binding(4) var maskTexture: texture_2d<f32>;
@group(0) @binding(5) var maskSampler: sampler;

struct Vertex {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) @interpolate(flat) length: f32,
    @location(2) @interpolate(flat) phase: f32,
    @location(3) @interpolate(flat) color: vec3f,
    @location(4) world: vec4f,
    @location(5) distance: f32,
}

@vertex fn vs(@builtin(vertex_index) index: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) color: vec4f, @location(3) worldA: vec4f, @location(4) worldB: vec4f) -> Vertex {
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
    // The screen-space ribbon has clip w=1. Carry reciprocal depth explicitly
    // so the game's world-space texture stays attached to the route in perspective.
    out.world = vec4f(mix(worldA.xyz * a.z, worldB.xyz * b.z, t), mix(a.z, b.z, t));
    out.distance = mix(worldA.w * a.z, worldB.w * b.z, t);
    return out;
}

@fragment fn fs(input: Vertex) -> @location(0) vec4f {
    let world = input.world.xyz / input.world.w;
    // HGRP/Effect/VFXLine, M_UI_lightingtrail: rotate world XZ by 90 degrees
    // after UV speed (-0.27, 0), then multiply both sampled red channels into alpha.
    let flowUV = vec2f(world.z, 1 - world.x + settings.animation.x * 0.27);
    let maskUV = vec2f(input.distance / input.world.w - 3.43, input.local.y / (2 * settings.color.w) + 0.5);
    let flow = textureSample(flowTexture, flowSampler, flowUV).r;
    let mask = textureSample(maskTexture, maskSampler, maskUV).r;
    let radius = length(vec2f(max(max(-input.local.x, input.local.x - input.length), 0), input.local.y));
    let edge = 1 - smoothstep(settings.color.w - 0.75, settings.color.w, radius);
    if radius > settings.color.w { discard; }
    let size = vec2i(textureDimensions(sceneDepth));
    let uv = input.position.xy / settings.viewport.xy + settings.depthOffset.xy;
    let pixel = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - 1);
    let depth = textureLoad(sceneDepth, pixel, 0);
    let near = settings.viewport.w;
    // Compare in metres so ground-contact tolerance stays stable at any distance.
    let hidden = depth > 0 && near / max(input.position.z, 0.000000001) > near / max(depth, 0.000000001) + settings.depthOffset.z;
    if hidden && fract((input.phase + input.local.x) / settings.depthOffset.w) > 0.625 { discard; }
    return vec4f(input.color * 1.5, clamp(flow * mask, 0, 1) * edge);
}
