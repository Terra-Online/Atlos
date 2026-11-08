import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import type { Viewer } from '@endfield-noclip/viewer/host';
import type { Point } from '@endfield-noclip/package-format/oem';
import { afterEach, expect, it, vi } from 'vitest';
import MovingBoundsPreview from './moving-bounds-preview';
import { createRouteLines } from './route-lines-renderer';
import { movingCatalog, nearbyMovingBounds } from './moving-bounds';

const resources = vi.hoisted(
    () =>
        [] as {
            encode: ReturnType<typeof vi.fn>;
            destroy: ReturnType<typeof vi.fn>;
        }[],
);

vi.mock('@endfield-noclip/viewer/host', () => ({
    Panel: ({ children }: { children: React.ReactNode }) => (
        <section>{children}</section>
    ),
}));
vi.mock('./route-lines-renderer', () => ({
    createRouteLines: vi.fn(() => {
        const renderer = { encode: vi.fn(), destroy: vi.fn() };
        resources.push(renderer);
        return renderer;
    }),
}));

const source = { buildGuid: 'build', contentHash: 'hash' };
const bounds = { min: [0, 0, 0], max: [2, 1, 2] };
const point = { id: 'target', scene: 'map02', level: 'map02_lv010' } as Point;
const data = nearbyMovingBounds(
    movingCatalog(
        {
            version: 1,
            scene: 'map02',
            source,
            movingSupports: [
                {
                    id: 'lotus',
                    level: point.level,
                    family: 'platform',
                    endpoints: {
                        initial: bounds,
                        terminal: { min: [10, 4, 0], max: [12, 5, 2] },
                    },
                    surfaces: [],
                },
            ],
        },
        'map02',
    ),
    point.level,
    [1, 1, 1],
);
const fixture = () => {
    let overlay: (frame: unknown) => void = () => {};
    const remove = vi.fn(),
        stop = vi.fn();
    const addOverlay = vi.fn((callback: (frame: unknown) => void) => {
        overlay = callback;
        return remove;
    });
    const viewer = {
        scene: { pkg: { manifest: { scene: { id: 'map02' }, source } } },
        level: point.level,
        camera: { position: [1, 1, 1] },
        subscribeCamera: vi.fn(() => stop),
        addOverlay,
    } as unknown as Viewer;
    return {
        viewer,
        addOverlay,
        remove,
        stop,
        draw: () => overlay({ device: {}, format: 'rgba8unorm' }),
    };
};

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    resources.length = 0;
});

it('owns only its two colored endpoint overlays and disposes buffers and requests when hidden', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, _options?: RequestInit) =>
        Promise.resolve({
            ok: true,
            json: () => Promise.resolve(data),
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const { viewer, remove, stop, draw } = fixture();
    const view = render(
        <MovingBoundsPreview
            viewer={viewer}
            point={point}
            panelRoot={document.body}
        />,
    );
    await screen.findByText('1 devices within 200 m');
    act(draw);
    const created = vi.mocked(createRouteLines);
    expect(created).toHaveBeenCalledTimes(2);
    expect(created.mock.calls[0][2]).toHaveLength(12);
    expect(created.mock.calls[1][2]).toHaveLength(12);
    expect(created.mock.calls[0][3]!.color).toEqual([0.05, 0.85, 0.95]);
    expect(created.mock.calls[1][3]!.color).toEqual([1, 0.48, 0.08]);
    expect(
        resources.every((renderer) => renderer.encode.mock.calls.length === 1),
    ).toBe(true);
    const signal = fetch.mock.calls[0][1]?.signal;
    fireEvent.click(
        screen.getByRole('checkbox', { name: 'Show endpoint boxes' }),
    );
    expect(remove).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(
        resources.every((renderer) => renderer.destroy.mock.calls.length === 1),
    ).toBe(true);
    expect(signal?.aborted).toBe(true);
    view.unmount();
    expect(remove).toHaveBeenCalledOnce();
});

it('rejects a response from another build before allocating GPU resources', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(() =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        ...data,
                        source: { ...source, contentHash: 'other' },
                    }),
            }),
        ),
    );
    const { viewer, addOverlay } = fixture();
    render(
        <MovingBoundsPreview
            viewer={viewer}
            point={point}
            panelRoot={document.body}
        />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
        'Endpoint boxes do not match the loaded scene',
    );
    expect(addOverlay).not.toHaveBeenCalled();
    expect(createRouteLines).not.toHaveBeenCalled();
});
