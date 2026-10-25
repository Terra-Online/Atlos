import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import Drawer from './drawer';

afterEach(cleanup);

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
