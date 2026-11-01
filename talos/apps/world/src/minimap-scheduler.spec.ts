import { afterEach, expect, it, vi } from 'vitest';
import { scheduleMinimap } from './minimap-scheduler';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it('coalesces bursts, samples the latest value and does no idle work', () => {
    vi.useFakeTimers();
    let value = 0;
    const draw = vi.fn(() => value);
    const scheduler = scheduleMinimap(draw);
    for (let i = 0; i < 120; i++) {
        value = i;
        scheduler.request();
        vi.advanceTimersByTime(1000 / 120);
    }
    vi.advanceTimersByTime(100);
    expect(draw.mock.calls.length).toBeGreaterThan(15);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(31);
    expect(draw.mock.results.at(-1)?.value).toBe(119);
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
