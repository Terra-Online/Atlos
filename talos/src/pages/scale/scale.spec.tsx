import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Scale from './scale';
import { mapFixture } from '../../../test-support/pages';
import { setRect } from '../../../test-support/browser';
import styles from './scale.module.scss';

const state = vi.hoisted(() => ({ mobile: false, toggle: vi.fn(), t: (key: string) => key }));
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: state.mobile }) }));
vi.mock('@/locale', () => ({ useTranslateUI: () => state.t }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppPictureInPicture: () => ({ supported: true, active: false, toggle: state.toggle }) }));
const maps: ReturnType<typeof mapFixture>[] = [];
const fixture = (zoom = 1) => { const value = mapFixture(zoom); maps.push(value); return value.map; };
beforeEach(() => { state.mobile = false; state.toggle.mockReset(); state.toggle.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); maps.splice(0).forEach((value) => value.dispose()); vi.restoreAllMocks(); vi.useRealTimers(); });

it('steps within real map bounds, follows region changes and releases map event subscriptions', () => {
    const map = fixture();
    const view = render(<Scale map={map} />);
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(map.getZoom()).toBe(1.5);
    act(() => { map.setZoom(3); });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '+' }).disabled).toBe(true);
    act(() => { map.setMinZoom(2); map.setMaxZoom(4); map.fire('talos:regionSwitched'); });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '+' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '-' }));
    expect(map.getZoom()).toBe(2.5);
    fireEvent.click(screen.getByRole('button', { name: 'scale.pip.enterMode' }));
    expect(state.toggle).toHaveBeenCalledOnce();
    const off = vi.spyOn(map, 'off');
    view.unmount();
    expect(map.listens('zoom')).toBe(false);
    expect(off).toHaveBeenCalledWith('talos:regionSwitched', expect.any(Function));
});

it('clamps a progress click and maps its local vertical position to zoom', () => {
    const map = fixture();
    const { container } = render(<Scale map={map} />);
    const bar = container.querySelector<HTMLElement>(`.${styles.scalerWrapper}`)!;
    setRect(bar, 10, 20, 20, 200);
    fireEvent.click(bar, { clientY: 120 });
    expect(map.getZoom()).toBe(1.5);
    fireEvent.click(bar, { clientY: -50 });
    expect(map.getZoom()).toBe(3);
    fireEvent.click(bar, { clientY: 999 });
    expect(map.getZoom()).toBe(0);
});

it('flushes the final mobile touch before its queued frame and snaps to the map increment', () => {
    state.mobile = true;
    vi.useFakeTimers();
    const map = fixture();
    const { container } = render(<Scale map={map} />);
    const bar = container.querySelector<HTMLElement>(`.${styles.scalerWrapperMobile}`)!;
    setRect(bar, 0, 0, 20, 300);
    fireEvent.touchStart(bar, { touches: [{ clientY: 200 }] });
    expect(map.dragging.enabled()).toBe(false);
    fireEvent.touchMove(bar, { touches: [{ clientY: 125 }] });
    expect(map.getZoom()).toBe(1);
    fireEvent.touchEnd(bar);
    expect(map.getZoom()).toBe(2);
    expect(map.dragging.enabled()).toBe(true);
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(map.getZoom()).toBe(2);
});

it.each([true, false])('restores the original dragging state (%s) on touch cancellation and responsive unmount', (enabled) => {
    state.mobile = true;
    const map = fixture();
    if (!enabled) map.dragging.disable();
    const view = render(<Scale map={map} />);
    const bar = view.container.querySelector<HTMLElement>(`.${styles.scalerWrapperMobile}`)!;
    fireEvent.touchStart(bar, { touches: [{ clientY: 200 }] });
    fireEvent.touchCancel(bar);
    expect(map.dragging.enabled()).toBe(enabled);
    fireEvent.touchStart(bar, { touches: [{ clientY: 200 }] });
    state.mobile = false;
    view.rerender(<Scale map={map} />);
    expect(map.dragging.enabled()).toBe(enabled);
});
