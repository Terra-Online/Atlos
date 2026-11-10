import type { OverlayFrame, Viewer } from '@endfield-noclip/viewer/host';
import type { Segment } from '@opendfieldmap/ganglia';
import shader from './route-lines.wgsl?raw';
import compositeShader from './route-composite.wgsl?raw';
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
        label: 'Route emissive cable',
        code: shader,
    });
    const pipeline = device.createRenderPipeline({
        label: 'Route emissive cable',
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
                    format: 'rgba8unorm',
                    blend: {
                        color: {
                            operation: 'max',
                            srcFactor: 'one',
                            dstFactor: 'one',
                        },
                        alpha: {
                            operation: 'max',
                            srcFactor: 'one',
                            dstFactor: 'one',
                        },
                    },
                },
            ],
        },
    });
    const compositeModule = device.createShaderModule({ code: compositeShader });
    const composite = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: compositeModule, entryPoint: 'vs' },
        fragment: {
            module: compositeModule, entryPoint: 'fs',
            targets: [{ format, blend: {
                color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            } }],
        },
    });
    let layer: GPUTexture | undefined, layerView: GPUTextureView, compositeGroup: GPUBindGroup;
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
                true,
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
                    frame.time, WIRE_PERIOD, frame.height / ratio / (2 * Math.tan(camera.fovY / 2)) * 0.045 / 3.5, 0,
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
            if (!layer || layer.width !== frame.width || layer.height !== frame.height) {
                layer?.destroy();
                layer = device.createTexture({
                    label: 'Route coverage', size: [frame.width, frame.height], format: 'rgba8unorm',
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                });
                layerView = layer.createView();
                compositeGroup = device.createBindGroup({
                    layout: composite.getBindGroupLayout(0),
                    entries: [{ binding: 0, resource: layerView }],
                });
            }
            const pass = frame.encoder.beginRenderPass({
                label: 'Route overlay',
                colorAttachments: [
                    { view: layerView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
                ],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.setVertexBuffer(0, vertices);
            pass.draw(6, projected.length / 20);
            pass.end();
            const resolve = frame.encoder.beginRenderPass({
                label: 'Route composite',
                colorAttachments: [{ view: frame.target, loadOp: 'load', storeOp: 'store' }],
            });
            resolve.setPipeline(composite);
            resolve.setBindGroup(0, compositeGroup);
            resolve.draw(3);
            resolve.end();
        },
        destroy() {
            layer?.destroy();
            vertices.destroy();
            uniforms.destroy();
        },
    };
}
