import type { OverlayFrame, Viewer } from '@endfield-noclip/viewer/host';
import type { Segment } from '@opendfieldmap/ganglia';
import shader from './route-lines.wgsl?raw';
import { DASH_PERIOD, projectLines, routeStyle } from './route-lines';
import flowData from './assets/wire-flow.bin?url&inline';
import maskData from './assets/wire-mask.bin?url&inline';

// The source BC7 textures are opaque greyscale. Store their original sRGB red
// channel and mip chain, then restore RGBA for hardware sRGB filtering.
function wireTexture(device: GPUDevice, data: string, label: string) {
    const bytes = atob(data.slice(data.indexOf(',') + 1));
    const texture = device.createTexture({
        label,
        size: [256, 256],
        mipLevelCount: 9,
        format: 'rgba8unorm-srgb',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    let offset = 0;
    for (let mipLevel = 0; mipLevel < 9; mipLevel++) {
        const size = Math.max(1, 256 >> mipLevel);
        const rgba = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) {
            const value = bytes.charCodeAt(offset++);
            const pixel = i * 4;
            rgba[pixel] = value;
            rgba[pixel + 1] = value;
            rgba[pixel + 2] = value;
            rgba[pixel + 3] = 255;
        }
        device.queue.writeTexture(
            { texture, mipLevel },
            rgba,
            { bytesPerRow: size * 4 },
            [size, size],
        );
    }
    return texture;
}

/** Own the route's GPU resources for one viewer. Dispose after unregistering its overlay. */
export function createRouteLines(
    device: GPUDevice,
    format: GPUTextureFormat,
    segments: Segment[],
    style: { color?: number[]; halfWidth: number } = { halfWidth: 3.5 },
) {
    const module = device.createShaderModule({
        label: 'Route link-wire material',
        code: shader,
    });
    const pipeline = device.createRenderPipeline({
        label: 'Route link-wire material',
        layout: 'auto',
        vertex: {
            module,
            entryPoint: 'vs',
            buffers: [
                {
                    arrayStride: 80,
                    stepMode: 'instance',
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x4' },
                        { shaderLocation: 1, offset: 16, format: 'float32x4' },
                        { shaderLocation: 2, offset: 32, format: 'float32x4' },
                        { shaderLocation: 3, offset: 48, format: 'float32x4' },
                        { shaderLocation: 4, offset: 64, format: 'float32x4' },
                    ],
                },
            ],
        },
        fragment: {
            module,
            entryPoint: 'fs',
            targets: [
                {
                    format,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one-minus-src-alpha',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                        },
                    },
                },
            ],
        },
    });
    const count = segments.reduce(
        (sum, segment) => sum + segment.points.length - 1,
        0,
    );
    const vertices = device.createBuffer({
        label: 'Route segments',
        size: Math.max(80, count * 80),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const uniforms = device.createBuffer({
        label: 'Route viewport',
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const flow = wireTexture(device, flowData, 'T_fx_flow_30_M');
    const mask = wireTexture(device, maskData, 'T_fx_mask_24_C_M');
    const flowSampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
    });
    const maskSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
    });
    let depth: GPUTextureView | undefined, group: GPUBindGroup;
    return {
        encode(frame: OverlayFrame, camera: Viewer['camera']) {
            const ratio = frame.width / innerWidth;
            const projected = projectLines(
                segments,
                camera,
                frame.width,
                frame.height,
                ratio,
                (segment) => style.color ?? routeStyle(segment).color,
            );
            if (!projected.length) return;
            device.queue.writeBuffer(vertices, 0, projected);
            device.queue.writeBuffer(
                uniforms,
                0,
                new Float32Array([
                    frame.width,
                    frame.height,
                    ratio,
                    camera.near,
                    frame.jitter[0] * 0.5,
                    -frame.jitter[1] * 0.5,
                    0.15,
                    DASH_PERIOD,
                    0, 0, 0,
                    style.halfWidth,
                    frame.time, 0, 0, 0,
                ]),
            );
            if (depth !== frame.depth) {
                depth = frame.depth;
                group = device.createBindGroup({
                    layout: pipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniforms } },
                        { binding: 1, resource: depth },
                        { binding: 2, resource: flow.createView() },
                        { binding: 3, resource: flowSampler },
                        { binding: 4, resource: mask.createView() },
                        { binding: 5, resource: maskSampler },
                    ],
                });
            }
            const pass = frame.encoder.beginRenderPass({
                label: 'Route overlay',
                colorAttachments: [
                    { view: frame.target, loadOp: 'load', storeOp: 'store' },
                ],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.setVertexBuffer(0, vertices);
            pass.draw(6, projected.length / 20);
            pass.end();
        },
        destroy() {
            vertices.destroy();
            uniforms.destroy();
            flow.destroy();
            mask.destroy();
        },
    };
}
