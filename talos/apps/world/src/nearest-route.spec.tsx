import { render } from '@testing-library/react';
import type { Viewer } from '@endfield-noclip/viewer/host';
import { expect, it, vi } from 'vitest';
import NearestRoute from './nearest-route';
import { routing, type RouteRequest } from './services/routing';

vi.mock('./route-inspection', () => ({ default: () => null }));

it('keeps polling the target request while roaming and aborts on a new target', () => {
    const nearest = vi.spyOn(routing, 'nearest').mockImplementation(
        async function* (_request, signal) {
            await new Promise<void>((resolve) =>
                signal.addEventListener('abort', () => resolve(), { once: true }),
            );
        },
    );
    const camera = { level: 'map01_lv001' };
    const viewer = camera as unknown as Viewer;
    const request: RouteRequest = {
        scene: 'map01',
        level: 'map01_lv001',
        point: 'first-point',
        generation: 'target-generation',
        state: 'fully-enabled',
        buildGuid: 'build',
        contentHash: 'content',
        x: '0',
        y: '0',
        z: '0',
    };
    const props = { viewer, panelRoot: null, onRoute: vi.fn() };
    const view = render(<NearestRoute {...props} request={request} />);
    try {
        const signal = nearest.mock.calls[0][1];
        camera.level = 'map01_lv002';
        view.rerender(<NearestRoute {...props} request={request} />);
        expect(nearest).toHaveBeenCalledTimes(1);
        expect(signal.aborted).toBe(false);

        const next = { ...request, point: 'next-point' };
        view.rerender(<NearestRoute {...props} request={next} />);
        expect(nearest).toHaveBeenCalledTimes(2);
        expect(nearest.mock.calls[1][0]).toEqual(next);
        expect(signal.aborted).toBe(true);
    } finally {
        view.unmount();
        nearest.mockRestore();
    }
});
