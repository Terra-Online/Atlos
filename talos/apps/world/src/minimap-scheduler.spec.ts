import { afterEach, expect, it, vi } from 'vitest';
import { scheduleMinimap } from './minimap-scheduler';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it('coalesces bursts, samples the latest value and does no idle work', () => {
    vi.useFakeTimers();
    let value = 0;
    const samples: number[] = [];
    const draw = vi.fn(() => {
        samples.push(value);
    });
    const scheduler = scheduleMinimap(draw);
    for (let i = 0; i < 120; i++) {
        value = i;
        scheduler.request();
        vi.advanceTimersByTime(1000 / 120);
    }
    vi.advanceTimersByTime(100);
    expect(draw.mock.calls.length).toBeGreaterThan(50);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(65);
    expect(samples.at(-1)).toBe(119);
    const count = draw.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledTimes(count);
    scheduler.destroy();
});

it('pauses in the background, resumes pending work and cancels teardown', () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(true);
    const draw = vi.fn();
    const scheduler = scheduleMinimap(draw);
    scheduler.request();
    vi.advanceTimersByTime(1000);
    expect(draw).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(50);
    expect(draw).toHaveBeenCalledTimes(1);
    scheduler.request();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(100);
    expect(draw).toHaveBeenCalledTimes(1);
    scheduler.destroy();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(100);
    expect(draw).toHaveBeenCalledTimes(1);
});

it('finishes a zoom transition without new camera events, then becomes idle', () => {
    vi.useFakeTimers();
    let frames = 0;
    const scheduler = scheduleMinimap(() => ++frames < 15);
    scheduler.request();
    scheduler.request();
    vi.advanceTimersByTime(500);
    expect(frames).toBe(15);
    vi.advanceTimersByTime(1000);
    expect(frames).toBe(15);
    scheduler.destroy();
});
