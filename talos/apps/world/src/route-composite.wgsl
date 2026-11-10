@group(0) @binding(0) var cable: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(positions[index], 0, 1);
}

@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    return textureLoad(cable, vec2i(position.xy), 0);
}
