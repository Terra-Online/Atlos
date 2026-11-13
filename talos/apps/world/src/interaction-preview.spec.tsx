import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import type { Viewer } from '@endfield-noclip/viewer/host';
import type { PointView } from '@endfield-noclip/package-format/oem';
import { afterEach, expect, it, vi } from 'vitest';
import { InteractionPreview } from './interaction-preview';

const view: PointView = {
    key: `noclip-point-view-v5:${'a'.repeat(64)}`,
    position: [0, 3, -10],
    yaw: 0,
    pitch: -0.3,
    clear: true,
    interactions: [{ control: 'door:1', label: 'Door', before: 0, after: 1 }],
};
function fixture() {
    const picks: Record<string, number> = { unrelated: 7 };
    const setSceneValues = vi.fn((values: Record<string, number | null>) => {
        for (const [id, value] of Object.entries(values)) {
            if (value === null) delete picks[id];
            else picks[id] = value;
        }
    });
    // Only the scene controls and overrides are used by this component.
    const viewer = {
        scene: {
            pkg: {
                manifest: {
                    states: {
                        controls: [
                            {
                                id: 'door:1',
                                source: { kind: 'user' },
                                values: [{ value: 0 }, { value: 1 }],
                            },
                        ],
                    },
                },
            },
        },
        controls: {
            get flying() {
                return false;
            },
        },
        scenePicks: picks,
        setSceneValues,
    } as unknown as Viewer;
    return { viewer, picks, setSceneValues };
}
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

it('shows original then result, supports replay, and cancels/restores on leaving the point', () => {
    vi.useFakeTimers();
    const { viewer, picks, setSceneValues } = fixture();
    const rendered = render(
        <InteractionPreview viewer={viewer} view={view} enabled />,
    );
    expect(picks).toEqual({ unrelated: 7, 'door:1': 0 });
    void act(() => vi.advanceTimersByTime(800));
    expect(picks['door:1']).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(picks['door:1']).toBe(0);
    rendered.unmount();
    expect(picks).toEqual({ unrelated: 7 });
    const calls = setSceneValues.mock.calls.length;
    void act(() => vi.advanceTimersByTime(3000));
    expect(setSceneValues).toHaveBeenCalledTimes(calls);
});

it('does not overwrite manual scene edits or run while a different preset is selected', () => {
    vi.useFakeTimers();
    const { viewer, picks } = fixture();
    const rendered = render(
        <InteractionPreview viewer={viewer} view={view} enabled={false} />,
    );
    void act(() => vi.advanceTimersByTime(3000));
    expect(picks).toEqual({ unrelated: 7 });
    rendered.rerender(
        <InteractionPreview viewer={viewer} view={view} enabled />,
    );
    delete picks['door:1'];
    void act(() => vi.advanceTimersByTime(3000));
    expect(picks).toEqual({ unrelated: 7 });
});

it('waits for camera arrival before showing the result', () => {
    vi.useFakeTimers();
    const { viewer, picks } = fixture();
    const flying = vi.spyOn(viewer.controls, 'flying', 'get');
    flying.mockReturnValue(true);
    render(<InteractionPreview viewer={viewer} view={view} enabled />);
    void act(() => vi.advanceTimersByTime(5000));
    expect(picks['door:1']).toBe(0);
    flying.mockReturnValue(false);
    void act(() => vi.advanceTimersByTime(100));
    void act(() => vi.advanceTimersByTime(799));
    expect(picks['door:1']).toBe(0);
    void act(() => vi.advanceTimersByTime(1));
    expect(picks['door:1']).toBe(1);
});
