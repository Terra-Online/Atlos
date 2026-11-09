import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('releases an active gesture when dragging becomes disabled and allows the next gesture', async () => {
    const content = <div data-testid="surface">Content</div>;
    const style = { touchAction: 'pan-y', overscrollBehavior: 'auto' } as const;
    const view = render(<Drawer initialSize={100} snap={[0, 100, 300]} style={style}>{content}</Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    const surface = screen.getByTestId('surface'), handle = screen.getByRole('separator');
    touch(surface, 'touchstart', 400);
    touch(surface, 'touchmove', 300);
    expect(handle.hasAttribute('data-dragging')).toBe(true);
    view.rerender(<Drawer initialSize={100} snap={[0, 100, 300]} style={style} dragDisabled>{content}</Drawer>);
    touch(surface, 'touchend', 300);
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(drawer.style.overscrollBehavior).toBe('auto');
    expect(drawer.style.touchAction).toBe('pan-y');
    view.rerender(<Drawer initialSize={100} snap={[0, 100, 300]} style={style}>{content}</Drawer>);
    touch(surface, 'touchstart', 300);
    touch(surface, 'touchmove', 200);
    touch(surface, 'touchend', 200);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
});

it('releases an accepted drag when reversing direction gives the scrollable content priority', async () => {
    const style = { touchAction: 'pan-y', overscrollBehavior: 'auto' } as const;
    const view = render(<Drawer initialSize={100} snap={[0, 100, 300]} style={style}><div data-testid="scroll" style={{ overflowY: 'auto' }}>Scroll</div><div data-testid="surface">Content</div></Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    const scroll = screen.getByTestId('scroll'), handle = screen.getByRole('separator');
    Object.defineProperties(scroll, { clientHeight: { configurable: true, value: 100 }, scrollHeight: { configurable: true, value: 500 } });
    scroll.scrollTop = 0;
    touch(scroll, 'touchstart', 200);
    touch(scroll, 'touchmove', 300);
    expect(handle.hasAttribute('data-dragging')).toBe(true);
    const releasedSize = drawer.style.getPropertyValue('--drawer-size');
    // At the top, down belongs to the drawer; reversing past the start lets
    // the content scroll down. Cancellation must release the accepted owner.
    touch(scroll, 'touchmove', 100);
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(drawer.style.touchAction).toBe('pan-y');
    expect(drawer.style.overscrollBehavior).toBe('auto');
    touch(scroll, 'touchend', 100);
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe(releasedSize);
    const surface = screen.getByTestId('surface');
    touch(surface, 'touchstart', 400);
    touch(surface, 'touchmove', 80);
    touch(surface, 'touchend', 80);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
    expect(drawer.style.touchAction).toBe('pan-y');
    expect(drawer.style.overscrollBehavior).toBe('auto');
});

it('lets a touch drag take ownership from an unfinished snap animation', async () => {
    const view = render(<Drawer snap={[0, 100, 300]}><div data-testid="surface">Content</div></Drawer>);
    const drawer = view.container.firstElementChild as HTMLElement;
    fireEvent.click(screen.getByRole('separator'));
    await waitFor(() => {
        const size = parseFloat(drawer.style.getPropertyValue('--drawer-size'));
        expect(size).toBeGreaterThan(0);
        expect(size).toBeLessThan(100);
    });
    const surface = screen.getByTestId('surface');
    touch(surface, 'touchstart', 400);
    touch(surface, 'touchmove', 120);
    const held = drawer.style.getPropertyValue('--drawer-size');
    expect(parseFloat(held)).toBeGreaterThan(200);
    // The pending 250ms snap must not continue moving beneath the held pointer.
    await act(() => new Promise<void>((resolve) => window.setTimeout(resolve, 300)));
    expect(drawer.style.getPropertyValue('--drawer-size')).toBe(held);
    touch(surface, 'touchend', 120);
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('300px'));
});
