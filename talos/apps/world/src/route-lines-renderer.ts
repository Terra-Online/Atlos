import type { OverlayFrame, Viewer } from '@endfield-noclip/viewer/host';
import type { Segment } from '@opendfieldmap/ganglia';
import shader from './route-lines.wgsl?raw';
import { DASH_PERIOD, WIRE_PERIOD, projectLines, routeStyle, softenLines } from './route-lines';

/** Own the route's GPU resources for one viewer. Dispose after unregistering its overlay. */
export function createRouteLines(
    device: GPUDevice,
    format: GPUTextureFormat,
    segments: Segment[],
    style: { color?: number[]; halfWidth: number } = { halfWidth: 3.5 },
) {
    if (!style.color) segments = softenLines(segments);
    const module = device.createShaderModule({
        label: 'Route braided ribbon',
        code: shader,
    });
    const pipeline = device.createRenderPipeline({
        label: 'Route braided ribbon',
        layout: 'auto',
        vertex: {
            module,
            entryPoint: 'vs',
            buffers: [
                {
                    arrayStride: 48,
                    stepMode: 'instance',
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x4' },
                        { shaderLocation: 1, offset: 16, format: 'float32x4' },
                        { shaderLocation: 2, offset: 32, format: 'float32x4' },
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
        size: Math.max(48, count * 48),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const uniforms = device.createBuffer({
        label: 'Route viewport',
        size: 80,
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
                (segment) => style.color ?? routeStyle(segment).color,
            );
            if (!projected.length) return;
            device.queue.writeBuffer(vertices, 0, projected);
            const sun = frame.sunDirection ?? [0, 1, 0];
            const dot = (axis: readonly number[]) => axis.reduce((sum, value, i) => sum + value * sun[i], 0);
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
                    frame.time, WIRE_PERIOD, 0, 0,
                    dot(camera.right()), -dot(camera.up()), -dot(camera.forward()), 0,
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
            pass.draw(6, projected.length / 12);
            pass.end();
        },
        destroy() {
            vertices.destroy();
            uniforms.destroy();
        },
    };
}
