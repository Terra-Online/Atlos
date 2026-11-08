import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Viewer, OverlayFrame } from '@endfield-noclip/viewer/host';
import RouteInspection, { type Candidate } from './route-inspection';
import { createRouteLines } from './route-lines-renderer';

vi.mock('@endfield-noclip/viewer/host', async () => {
    const { Panel } = await import(
        '../../../vendor/endfield-noclip/packages/viewer/src/ui/panel'
    );
    return { Panel };
});

vi.mock('./route-lines-renderer', () => ({
    createRouteLines: vi.fn(() => ({ encode: vi.fn(), destroy: vi.fn() })),
}));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(createRouteLines).mockClear();
});

it('draws only selected contact boxes in the existing route overlay and releases them with Hide', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    let overlay: ((frame: OverlayFrame) => void) | undefined;
    const remove = vi.fn();
    const source = { buildGuid: 'build', contentHash: 'hash' };
    const viewer = {
        scene: { pkg: { manifest: { scene: { id: 'map02' }, source } } },
        level: 'map02_lv009',
        camera: {},
        addOverlay: vi.fn((callback: typeof overlay) => {
            overlay = callback;
            return remove;
        }),
    } as unknown as Viewer;
    const candidate: Candidate = {
        version: 1,
        scene: 'map02',
        level: 'map02_lv009',
        source,
        title: 'Teleport → Target',
        status: 'candidate',
        markers: [],
        route: {
            status: 'complete',
            start: 'anchor',
            cost: 1,
            arrivalCost: 0,
            length: 1,
            points: [
                [0, 0, 0],
                [1, 0, 0],
            ],
            segments: [
                {
                    mode: 'walk',
                    points: [
                        [0, 0, 0],
                        [1, 0, 0],
                    ],
                    times: [0, 1],
                },
            ],
        },
        supportBoxes: [
            {
                device: 'box',
                family: 'conveyor',
                role: 'use',
                min: [4, 1, -1],
                max: [6, 3, 1],
            },
        ],
    };
    const panelRoot = document.createElement('div');
    document.body.append(panelRoot);
    const view = render(
        <RouteInspection
            viewer={viewer}
            source={null}
            panelRoot={panelRoot}
            candidate={candidate}
        />,
    );
    expect(screen.queryByText('Moving devices')).toBeNull();
    expect(overlay).toBeDefined();
    overlay!({ device: {}, format: 'rgba8unorm' } as OverlayFrame);
    const renderers = vi
        .mocked(createRouteLines)
        .mock.results.map((result) => result.value);
    expect(createRouteLines).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createRouteLines).mock.calls[1][2]).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(remove).toHaveBeenCalledTimes(1);
    for (const renderer of renderers)
        expect(renderer.destroy).toHaveBeenCalledTimes(1);
    view.unmount();
    panelRoot.remove();
});
