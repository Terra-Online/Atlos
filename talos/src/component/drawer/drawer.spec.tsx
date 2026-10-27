import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Drawer from './drawer';

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.style.fontSize = ''; });

it('preserves an open drawer while search changes its collapsed height', async () => {
    const view = render(<Drawer initialSize={64} snap={[64, 450, 700]} snapToIndex={2} />);
    const drawer = view.container.firstElementChild as HTMLDivElement;
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('700px'));
    for (const height of [136, 58]) {
        view.rerender(<Drawer initialSize={height} snap={[height, 450, 700]} snapToIndex={2} />);
        expect(drawer.style.getPropertyValue('--drawer-size')).toBe('700px');
        expect(drawer.dataset.snap).toBe('2');
    }
    view.rerender(<Drawer initialSize={58} snap={[58, 450, 700]} snapToIndex={1} />);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('450px'));
});

it('cycles normalized snaps through the handle, reports progress and ignores disabled activation', async () => {
    const onSnapChange = vi.fn(), onProgressChange = vi.fn();
    const view = render(<Drawer snap={[300, 0, 100, 100]} onSnapChange={onSnapChange} onProgressChange={onProgressChange}>Content</Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    const handle = screen.getByRole('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    fireEvent.click(handle);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('100px'));
    expect(drawer.dataset.snap).toBe('1');
    expect(onSnapChange).toHaveBeenLastCalledWith(1);
    expect(onProgressChange).toHaveBeenLastCalledWith(1 / 3);
    fireEvent.click(handle);
    await waitFor(() => expect(drawer.dataset.snap).toBe('2'));
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
    fireEvent.click(handle);
    await waitFor(() => expect(drawer.dataset.snap).toBe('0'));
    // data-snap reports proximity before Motion reaches its exact target.
    // Disabled-input assertions start from a settled pose, not a fractional frame.
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('0px'));
    view.rerender(<Drawer snap={[300, 0, 100]} dragDisabled />);
    expect(handle.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(handle);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe('0px');
});

it('resolves rem lengths and reapplies an active snap when the dimensions change', async () => {
    document.documentElement.style.fontSize = '20px';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, 0, this.style.width === '1rem' ? 20 : 0, this.style.height === '1rem' ? 20 : 0);
    });
    const view = render(<Drawer initialSize="2rem" snap={['2rem', '10rem']} handleSize="1rem" side="left" fullWidth={false} snapToIndex={1} />);
    const drawer = view.container.firstElementChild as HTMLElement;
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical');
    expect(drawer.style.getPropertyValue('--handle-size')).toBe('20px');
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('200px'));
    view.rerender(<Drawer initialSize={40} snap={[40, 250]} handleSize={24} side="left" snapToIndex={1} />);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('250px'));
    view.unmount();
    document.documentElement.style.fontSize = '';
});

function touch(target: HTMLElement, type: string, y: number) {
    const point: Touch = { identifier: 1, target, clientX: 80, clientY: y, pageX: 80, pageY: y, screenX: 80, screenY: y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 };
    fireEvent(target, new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point], targetTouches: type === 'touchend' ? [] : [point] }));
}

it('handles a real touch drag and gives scrollable content and controls priority', async () => {
    const view = render(<Drawer initialSize={100} snap={[0, 100, 300]}><div data-testid="surface">Content</div><div data-testid="scroll" style={{ overflowY: 'auto' }}>Scroll</div><button>Action</button></Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    const surface = screen.getByTestId('surface');
    touch(surface, 'touchstart', 400);
    touch(surface, 'touchmove', 180);
    touch(surface, 'touchend', 180);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
    const scroll = screen.getByTestId('scroll');
    Object.defineProperties(scroll, { clientHeight: { configurable: true, value: 100 }, scrollHeight: { configurable: true, value: 500 } });
    scroll.scrollTop = 100;
    touch(scroll, 'touchstart', 200);
    touch(scroll, 'touchmove', 400);
    touch(scroll, 'touchend', 400);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px');
    const action = screen.getByRole('button');
    touch(action, 'touchstart', 200);
    touch(action, 'touchmove', 400);
    touch(action, 'touchend', 400);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px');
    expect(screen.getByRole('separator').hasAttribute('data-dragging')).toBe(false);
    expect(drawer.style.overscrollBehavior).toBe('');
});
