import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Loading from './Loading';
import styles from './Loading.module.scss';

const device = vi.hoisted(() => ({ isMobile: false }));
vi.mock('@/platform/device', () => ({ useDevice: () => device }));
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); device.isMobile = false; });

const progress = (container: HTMLElement) => container.querySelector<HTMLElement>(`.${styles.loadingProgress}`)!;
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

it('counts up one percent every 30ms and holds at the current ceiling', () => {
    const { container } = render(<Loading maxProgress={3} />);
    expect(screen.getByText('0%')).toBeTruthy();
    advance(30);
    expect(screen.getByText('1%')).toBeTruthy();
    advance(60);
    expect(screen.getByText('3%')).toBeTruthy();
    expect(progress(container).style.height).toBe('3%');
    advance(300);
    expect(screen.getByText('3%')).toBeTruthy();
    expect(container.querySelector(`.${styles.completionEffect}`)).toBeNull();
});

it('defaults to a 50% ceiling', () => {
    render(<Loading />);
    advance(30 * 60);
    expect(screen.getByText('50%')).toBeTruthy();
});

it('continues from the current value when the ceiling is raised', () => {
    const { rerender } = render(<Loading maxProgress={2} />);
    advance(90);
    expect(screen.getByText('2%')).toBeTruthy();
    rerender(<Loading maxProgress={4} />);
    advance(30);
    expect(screen.getByText('3%')).toBeTruthy();
    advance(30);
    expect(screen.getByText('4%')).toBeTruthy();
});

it('plays the completion effect 300ms after reaching 100% and completes 450ms later', () => {
    const complete = vi.fn();
    const { container } = render(<Loading maxProgress={100} completeController={complete} />);
    advance(30 * 100);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(container.querySelector(`.${styles.completionEffect}`)).toBeNull();
    // The first tick that observes 100% schedules completion.
    advance(30);
    advance(299);
    expect(container.querySelector(`.${styles.completionEffect}`)).toBeNull();
    advance(1);
    expect(container.querySelector(`.${styles.completionEffect}`)).not.toBeNull();
    expect(complete).not.toHaveBeenCalled();
    advance(449);
    expect(complete).not.toHaveBeenCalled();
    advance(1);
    expect(complete).toHaveBeenCalled();
});

it('fills horizontally on mobile and vertically elsewhere', () => {
    device.isMobile = true;
    const { container } = render(<Loading maxProgress={5} />);
    advance(150);
    const bar = container.querySelector(`.${styles.loadingBar}`)!;
    expect(bar.classList.contains(styles.mobile)).toBe(true);
    expect(progress(container).style.width).toBe('5%');
    expect(progress(container).style.height).toBe('');
});

it('stops ticking after unmount', () => {
    const clear = vi.spyOn(window, 'clearInterval');
    const { unmount } = render(<Loading maxProgress={100} />);
    unmount();
    expect(clear).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
});
