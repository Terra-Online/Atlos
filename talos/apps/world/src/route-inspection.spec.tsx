import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Viewer, OverlayFrame } from '@endfield-noclip/viewer/host';
import RouteInspection, { type Candidate } from './route-inspection';
import { createRouteLines } from './route-lines-renderer';

vi.mock('@endfield-noclip/viewer/host', async () => {
    const { Panel } = await import(
        '../../../.cache/noclip/packages/viewer/src/ui/panel'
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
    const addOverlay = vi.fn((callback: typeof overlay) => { overlay = callback; return remove; });
    const viewer = {
        scene: { pkg: { manifest: { scene: { id: 'map02' }, source } } },
        level: 'map02_lv009',
        camera: {},
        addOverlay,
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
    expect(addOverlay).toHaveBeenCalledWith(expect.any(Function), { animated: true });
    overlay!({ device: {}, format: 'rgba8unorm' } as OverlayFrame);
    const renderers = vi
        .mocked(createRouteLines)
        .mock.results.map((result) => result.value as ReturnType<typeof createRouteLines>);
    expect(createRouteLines).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createRouteLines).mock.calls[1][2]).toHaveLength(12);
    expect(vi.mocked(createRouteLines).mock.calls[0][3]?.hideOccluded).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide occluded' }));
    expect(remove).toHaveBeenCalledTimes(1);
    overlay!({ device: {}, format: 'rgba8unorm' } as OverlayFrame);
    expect(createRouteLines).toHaveBeenCalledTimes(4);
    expect(vi.mocked(createRouteLines).mock.calls[2][3]?.hideOccluded).toBe(true);
    expect(vi.mocked(createRouteLines).mock.calls[3][3]?.hideOccluded).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(remove).toHaveBeenCalledTimes(2);
    for (const renderer of renderers)
        expect(vi.mocked(renderer).destroy.mock.calls).toHaveLength(1);
    view.unmount();
    panelRoot.remove();
});
