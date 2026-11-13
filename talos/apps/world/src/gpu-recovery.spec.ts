import { afterEach, expect, it, vi } from 'vitest';
import { createGfxDevice } from '../../../.cache/noclip/packages/viewer/src/gfx/device';

afterEach(() => vi.unstubAllGlobals());

it('falls back to the default adapter when the performance preference is unavailable', async () => {
    const device = { lost: new Promise(() => {}), addEventListener: vi.fn() };
    const adapter = { features: new Set(), limits: {}, info: {}, requestDevice: vi.fn().mockResolvedValue(device) };
    const requestAdapter = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(adapter);
    vi.stubGlobal('navigator', { gpu: { requestAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const result = await createGfxDevice(vi.fn());
    expect(result.device).toBe(device);
    expect(requestAdapter.mock.calls).toEqual([[{ powerPreference: 'high-performance' }], []]);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
});

it('fails with recovery guidance after two unavailable adapters without looping', async () => {
    const requestAdapter = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    await expect(createGfxDevice(vi.fn())).rejects.toThrow('restart the browser');
    expect(requestAdapter).toHaveBeenCalledTimes(2);
});

it('does not retry or hide a device allocation failure', async () => {
    const requestDevice = vi.fn().mockRejectedValue(new Error('allocation failed'));
    const requestAdapter = vi.fn().mockResolvedValue({ features: new Set(), limits: {}, requestDevice });
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    await expect(createGfxDevice(vi.fn())).rejects.toThrow('allocation failed');
    expect(requestAdapter).toHaveBeenCalledTimes(1);
});

it('limits outstanding GPU frames and releases capacity after completion or loss', async () => {
    const { FrameQueue } = await import('../../../.cache/noclip/packages/viewer/src/viewer/frame-queue');
    const frames = new FrameQueue();
    let complete!: () => void, fail!: (reason: Error) => void;
    const first = new Promise<void>(resolve => { complete = resolve; });
    const second = new Promise<void>((_, reject) => { fail = reject; });
    const queue = { onSubmittedWorkDone: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    expect(frames.full).toBe(false);
    frames.submitted(queue);
    expect(frames.full).toBe(false);
    frames.submitted(queue);
    expect(frames.full).toBe(true);
    complete();
    await Promise.resolve();
    expect(frames.full).toBe(false);
    fail(new Error('device lost'));
    await Promise.resolve();
    expect(frames.full).toBe(false);
});
