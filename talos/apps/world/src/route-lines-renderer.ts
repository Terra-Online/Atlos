import type { OverlayFrame, Viewer } from '@endfield-noclip/viewer/host';
import type { Segment } from '@oem/ganglia';
import shader from './route-lines.wgsl?raw';
import { DASH_PERIOD, projectLines } from './route-lines';

/** Own the route's GPU resources for one viewer. Dispose after unregistering its overlay. */
export function createRouteLines(
    device: GPUDevice,
    format: GPUTextureFormat,
    segments: Segment[],
) {
    const module = device.createShaderModule({
        label: 'Route depth and dashes',
        code: shader,
    });
    const pipeline = device.createRenderPipeline({
        label: 'Route depth and dashes',
        layout: 'auto',
        vertex: {
            module,
            entryPoint: 'vs',
            buffers: [
                {
                    arrayStride: 32,
                    stepMode: 'instance',
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x4' },
                        { shaderLocation: 1, offset: 16, format: 'float32x4' },
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
        size: Math.max(32, count * 32),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const uniforms = device.createBuffer({
        label: 'Route viewport',
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
                ]),
            );
            if (depth !== frame.depth) {
                depth = frame.depth;
                group = device.createBindGroup({
                    layout: pipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: uniforms } },
                        { binding: 1, resource: depth },
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
            pass.draw(6, projected.length / 8);
            pass.end();
        },
        destroy() {
            vertices.destroy();
            uniforms.destroy();
        },
    };
}
