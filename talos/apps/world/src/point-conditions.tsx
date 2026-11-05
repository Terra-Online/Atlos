import { conditionVisible } from '@endfield-noclip/package-format/conditions';
import type {
    Companion,
    Point,
    PointView,
} from '@endfield-noclip/package-format/oem';

import type { Viewer } from '@endfield-noclip/viewer/host';

import { Panel, useViewerState } from '@endfield-noclip/viewer/host';
import { useState } from 'react';
import { InteractionPreview } from './interaction-preview';

/** Prerequisites and story presets use the same host panel as the renderer controls. */
export const PointConditions = ({
    viewer,
    view,
    point,
    companion,
    preset,
    disabled,
    onPreset,
}: {
    viewer: Viewer;
    view: PointView | null;
    point: Point;
    companion: Companion;
    preset: string;
    disabled: boolean;
    onPreset: (id: string) => void;
}) => {
    useViewerState(viewer);
    const [focusError, setFocusError] = useState<string | null>(null);
    const requirement = (id: string, mask: number): string => {
        const control = companion.controls.find((c) => c.id === id);
        const name = companion.labels['en-US']?.[id] ?? control?.name ?? id;
        const values = control?.values
            .filter((v) => (mask >>> v.value) & 1)
            .map((v) => v.label)
            .join(' / ');
        return values ? `${name}: ${values}` : name;
    };
    return (
        <Panel
            title='Preview'
            label='point prerequisites'
            className='scene-controls oem-point-conditions'
            actions={
                <>
                    <button
                        type='button'
                        disabled={disabled}
                        onClick={() =>
                            setFocusError(
                                viewer.focusAt(point.position)
                                    ? null
                                    : point.id,
                            )
                        }
                    >
                        Focus on target
                    </button>
                    <button
                        type='button'
                        disabled={disabled}
                        onClick={() => onPreset('completed')}
                    >
                        Reset
                    </button>
                </>
            }
        >
            {focusError === point.id && (
                <p className='muted small' role='status'>
                    Turn toward the target before focusing on it.
                </p>
            )}
            {view?.interactions?.length ? (
                <InteractionPreview
                    viewer={viewer}
                    view={view}
                    enabled={!disabled && preset === 'completed'}
                />
            ) : null}
            {point.condition ? (
                <div className='scene-choice'>
                    <span>Known story prerequisites</span>
                    {point.condition.alternatives.map((alternative, index) => (
                        <p key={JSON.stringify(alternative)}>
                            {index > 0 && 'or '}
                            {alternative
                                .map((r) => requirement(r.control, r.mask))
                                .join(' and ') || 'Always satisfied'}
                        </p>
                    ))}
                </div>
            ) : (
                <p className='muted small'>
                    No quest prerequisite is recorded.
                </p>
            )}
            {point.locks.length > 0 && (
                <div className='scene-choice'>
                    <span>Additional interaction locks</span>
                    <p className='muted small'>
                        {point.locks
                            .map((lock) =>
                                [lock.kind, ...lock.quests, ...lock.games].join(
                                    ' · ',
                                ),
                            )
                            .join('; ')}
                    </p>
                </div>
            )}
            {point.unknown.length > 0 && (
                <p className='muted small'>
                    Some spawn, script or interaction conditions remain unknown;
                    the preview applies known story conditions only.
                </p>
            )}
            {point.condition &&
                !conditionVisible(point.condition, viewer.sceneValues) && (
                    <p className='muted small'>
                        The selected preview state does not satisfy this point's
                        recorded prerequisite.
                    </p>
                )}
            {view && !view.clear && (
                <p className='muted small'>
                    No clear target view was confirmed. This view shows the
                    surrounding enclosure or approach; the target marker remains
                    available.
                </p>
            )}
            <label className='scene-choice'>
                <span>Preview state</span>
                <select
                    value={preset}
                    disabled={disabled}
                    onChange={(event) => onPreset(event.currentTarget.value)}
                >
                    <option value='completed'>Fully enabled</option>
                    {point.presets.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.id === 'default' ? 'Viewer defaults' : p.label}
                        </option>
                    ))}
                </select>
            </label>
        </Panel>
    );
};
