import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Viewer, OverlayFrame } from '@endfield-noclip/viewer/host';
import RouteInspection, { type Candidate } from './route-inspection';
import { createRouteLines } from './route-lines-renderer';

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
    const addOverlay = vi.fn((callback: typeof overlay) => {
        overlay = callback;
        return remove;
    });
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
        log: '/__routes/log?path=player-routes%2Fmap02-test.json.progress.jsonl',
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
            panelRoot={panelRoot}
            candidate={candidate}
        />,
    );
    expect(screen.queryByText('Moving devices')).toBeNull();
    expect(screen.queryByText('Teleport → Target')).toBeNull();
    const time = screen.getByText('0.0 / 1.0 s');
    const taskLog = screen.getByRole('link', { name: 'Task log' });
    expect(time.nextElementSibling).toBe(taskLog);
    expect(taskLog.getAttribute('href')).toBe(candidate.log);
    expect(overlay).toBeDefined();
    expect(addOverlay).toHaveBeenCalledWith(expect.any(Function), {
        animated: true,
    });
    overlay!({ device: {}, format: 'rgba8unorm' } as OverlayFrame);
    const renderers = vi
        .mocked(createRouteLines)
        .mock.results.flatMap((result) =>
            result.type === 'return' ? [result.value] : [],
        );
    expect(createRouteLines).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createRouteLines).mock.calls[1][2]).toHaveLength(12);
    expect(vi.mocked(createRouteLines).mock.calls[0][3]?.hideOccluded).toBe(
        false,
    );
    const hideOccluded = screen.getByRole('button', { name: 'Hide occluded' });
    const hide = screen.getByRole('button', { name: 'Hide' });
    expect(hideOccluded.nextElementSibling).toBe(hide);
    fireEvent.click(hideOccluded);
    expect(hideOccluded.getAttribute('aria-pressed')).toBe('true');
    expect(remove).toHaveBeenCalledTimes(1);
    overlay!({ device: {}, format: 'rgba8unorm' } as OverlayFrame);
    expect(createRouteLines).toHaveBeenCalledTimes(4);
    expect(vi.mocked(createRouteLines).mock.calls[2][3]?.hideOccluded).toBe(
        true,
    );
    expect(vi.mocked(createRouteLines).mock.calls[3][3]?.hideOccluded).toBe(
        true,
    );
    fireEvent.click(hide);
    expect(remove).toHaveBeenCalledTimes(2);
    for (const renderer of renderers)
        expect(renderer.destroy).toHaveBeenCalledTimes(1);
    view.unmount();
    panelRoot.remove();
});

it('keeps a verified prefix visible across levels of the same scene', () => {
    let overlay: ((frame: OverlayFrame) => void) | undefined;
    const source = { buildGuid: 'build', contentHash: 'hash' };
    const remove = vi.fn();
    const viewer = {
        scene: { pkg: { manifest: { scene: { id: 'map01' }, source } } },
        level: 'map01_lv002',
        camera: {},
        addOverlay(callback: typeof overlay) {
            overlay = callback;
            return remove;
        },
    } as unknown as Viewer;
    const panelRoot = document.createElement('div');
    document.body.append(panelRoot);
    const onRoute = vi.fn();
    const props = { viewer, panelRoot, onRoute, message: 'Planning route' };
    const view = render(
        <RouteInspection
            {...props}
            preview={{
                scene: 'map01',
                level: 'map01_lv001',
                source,
                segments: [
                    { mode: 'walk', points: [[0, 0, 0], [3, 0, 0]], times: [0, 1] },
                ],
            }}
        />,
    );
    expect(screen.getByRole('status').textContent).toBe('Connecting the remaining route…');
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(onRoute).toHaveBeenLastCalledWith([[0, 0, 0], [3, 0, 0]]);
    overlay!({ device: {}, format: 'rgba8unorm' } as OverlayFrame);
    expect(vi.mocked(createRouteLines).mock.calls[0][3]?.halfWidth).toBe(2);
    view.rerender(<RouteInspection {...props} />);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(onRoute).toHaveBeenLastCalledWith(null);
    view.unmount();
    panelRoot.remove();
});
