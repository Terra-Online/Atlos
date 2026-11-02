import type { PointView } from '@endfield-noclip/package-format/oem';
import type { Viewer } from '@endfield-noclip/viewer/host';
import { useEffect, useRef, useState } from 'react';

/** Replays only the obstruction controls validated by the framing pass. */
export function InteractionPreview({
    viewer,
    view,
    enabled,
}: {
    viewer: Viewer;
    view: PointView;
    enabled: boolean;
}) {
    const [after, setAfter] = useState(false);
    const action = useRef<(after: boolean, replay?: boolean) => void>(() => {});
    useEffect(() => {
        if (!enabled || !view.interactions?.length) return;
        const scene = viewer.scene;
        const interactions = view.interactions.filter((item) => {
            const control = scene?.pkg.manifest.states.controls.find(
                (c) => c.id === item.control,
            );
            return (
                control &&
                control.derived === null &&
                control.values.some((v) => v.value === item.before) &&
                control.values.some((v) => v.value === item.after)
            );
        });
        if (!interactions.length) return;
        const previous = Object.fromEntries(
            interactions.map((item) => [
                item.control,
                viewer.scenePicks[item.control] ?? null,
            ]),
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        let written: Record<string, number> = {};
        const apply = (next: boolean, replay = false) => {
            clearTimeout(timer);
            if (viewer.scene !== scene) return;
            written = Object.fromEntries(
                interactions.map((item) => [
                    item.control,
                    next ? item.after : item.before,
                ]),
            );
            viewer.setSceneValues(written);
            setAfter(next);
            if (replay) {
                const ownsState = () =>
                    viewer.scene === scene &&
                    interactions.every(
                        (item) =>
                            viewer.scenePicks[item.control] ===
                            written[item.control],
                    );
                const waitForArrival = () => {
                    // Keep the original state throughout flight, then give it a full
                    // inspection interval. Manual scene edits cancel the demonstration.
                    if (!ownsState()) return;
                    if (viewer.controls.flying) {
                        timer = setTimeout(waitForArrival, 100);
                    } else {
                        timer = setTimeout(() => {
                            if (ownsState()) apply(true);
                        }, 2400);
                    }
                };
                waitForArrival();
            }
        };
        action.current = apply;
        apply(false, true);
        return () => {
            clearTimeout(timer);
            action.current = () => {};
            if (viewer.scene === scene) {
                const restore = Object.fromEntries(
                    interactions
                        .filter(
                            (item) =>
                                viewer.scenePicks[item.control] ===
                                written[item.control],
                        )
                        .map((item) => [item.control, previous[item.control]]),
                );
                viewer.setSceneValues(restore);
            }
        };
    }, [viewer, view, enabled]);
    return (
        <div className='scene-choice'>
            <span>Obstruction state preview</span>
            {view.interactions?.map((item) => (
                <p key={item.control}>{item.label}</p>
            ))}
            <p className='muted small'>
                Authored before/after states; interaction effects are not
                simulated.
            </p>
            <div className='world-panel-actions'>
                <button
                    type='button'
                    disabled={!enabled}
                    onClick={() => action.current(!after)}
                >
                    {after ? 'Show original' : 'Show result'}
                </button>
                <button
                    type='button'
                    disabled={!enabled}
                    onClick={() => action.current(false, true)}
                >
                    Replay
                </button>
            </div>
        </div>
    );
}
