import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Panel, type Viewer } from '@endfield-noclip/viewer/host';
import type { Point } from '@endfield-noclip/package-format/oem';
import type { Vec3 } from '@oem/ganglia';
import {
    boxSegments,
    isMovingBounds,
    MOVING_BOUNDS_RADIUS,
    type MovingBounds,
} from './moving-bounds';
import { createRouteLines } from './route-lines-renderer';
import './moving-bounds-preview.css';

/** Local endpoint diagrams follow the selected level and a bounded camera neighborhood. */
export default function MovingBoundsPreview({
    viewer,
    point,
    panelRoot,
}: {
    viewer: Viewer;
    point: Point;
    panelRoot: HTMLElement | null;
}) {
    const [visible, setVisible] = useState(true);
    const [data, setData] = useState<MovingBounds | null>(null);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState('');
    useEffect(() => {
        if (selected && !data?.devices.some((device) => device.id === selected))
            setSelected('');
    }, [data, selected]);
    useEffect(() => {
        setData(null);
        setError('');
        if (!visible) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let pending: AbortController | undefined;
        let previous: Vec3 | undefined;
        let closed = false;
        const read = async () => {
            const manifest = viewer.scene?.pkg.manifest;
            if (
                manifest?.scene.id !== point.scene ||
                viewer.level !== point.level
            )
                return;
            const position: Vec3 = [...viewer.camera.position];
            previous = position;
            pending?.abort();
            const abort = new AbortController();
            pending = abort;
            const query = new URLSearchParams({
                scene: point.scene,
                level: point.level,
                buildGuid: manifest.source.buildGuid,
                contentHash: manifest.source.contentHash,
                x: String(position[0]),
                y: String(position[1]),
                z: String(position[2]),
            });
            try {
                const response = await fetch(
                    '/__routes/moving-bounds?' + query.toString(),
                    { signal: abort.signal },
                );
                const result: unknown = await response.json();
                if (!response.ok)
                    throw new Error(
                        typeof result === 'object' &&
                        result !== null &&
                        'message' in result
                            ? String(result.message)
                            : 'Unable to load endpoint boxes',
                    );
                if (
                    !isMovingBounds(result) ||
                    result.scene !== point.scene ||
                    result.source.buildGuid !== manifest.source.buildGuid ||
                    result.source.contentHash !== manifest.source.contentHash ||
                    result.devices.some(
                        (device) => device.level !== point.level,
                    )
                )
                    throw new Error(
                        'Endpoint boxes do not match the loaded scene',
                    );
                if (!closed && !abort.signal.aborted) {
                    setData(result);
                    setError('');
                }
            } catch (error) {
                if (!closed && !abort.signal.aborted) {
                    setData(null);
                    setError(
                        String(error instanceof Error ? error.message : error),
                    );
                }
            }
        };
        const update = () => {
            if (
                previous &&
                Math.hypot(
                    ...previous.map(
                        (v, axis) => v - viewer.camera.position[axis],
                    ),
                ) <
                    MOVING_BOUNDS_RADIUS / 4
            )
                return;
            clearTimeout(timer);
            timer = setTimeout(() => void read(), 300);
        };
        const stop = viewer.subscribeCamera(update);
        void read();
        return () => {
            closed = true;
            stop();
            clearTimeout(timer);
            pending?.abort();
        };
    }, [viewer, point, visible]);
    useEffect(() => {
        if (!visible || !data?.devices.length) return;
        const devices = data.devices.filter(
            (device) => !selected || device.id === selected,
        );
        const initial = devices.flatMap((device) =>
            boxSegments(device.endpoints.initial),
        );
        const terminal = devices.flatMap((device) =>
            boxSegments(device.endpoints.terminal),
        );
        let renderers: ReturnType<typeof createRouteLines>[] | undefined;
        const remove = viewer.addOverlay((frame) => {
            const manifest = viewer.scene?.pkg.manifest;
            if (
                manifest?.scene.id !== data.scene ||
                viewer.level !== point.level ||
                manifest.source.buildGuid !== data.source.buildGuid ||
                manifest.source.contentHash !== data.source.contentHash
            )
                return;
            renderers ??= [
                createRouteLines(frame.device, frame.format, initial, {
                    color: [0.05, 0.85, 0.95],
                    halfWidth: 2.25,
                }),
                createRouteLines(frame.device, frame.format, terminal, {
                    color: [1, 0.48, 0.08],
                    halfWidth: 1.15,
                }),
            ];
            for (const renderer of renderers)
                renderer.encode(frame, viewer.camera);
        });
        return () => {
            remove();
            renderers?.forEach((renderer) => renderer.destroy());
        };
    }, [viewer, point.level, data, visible, selected]);
    if (!panelRoot) return null;
    return createPortal(
        <Panel
            title='Moving devices'
            label='Moving device endpoint boxes'
            className='moving-bounds-panel'
        >
            <label>
                <input
                    type='checkbox'
                    checked={visible}
                    onChange={(event) => setVisible(event.target.checked)}
                />{' '}
                Show endpoint boxes
            </label>
            {visible && (
                <>
                    <div className='moving-bounds-legend'>
                        <span className='moving-bounds-initial'>
                            Path start
                        </span>
                        <span className='moving-bounds-terminal'>Path end</span>
                    </div>
                    {error ? (
                        <p role='alert'>{error}</p>
                    ) : (
                        <p>
                            {data ? data.devices.length : 'Loading'} devices
                            within {MOVING_BOUNDS_RADIUS} m
                        </p>
                    )}
                    {data?.devices.some(
                        (device) => device.family === 'seesaw',
                    ) && <p>Seesaw end boxes show a tilt limit.</p>}
                    {Boolean(data?.missing) && (
                        <p>
                            {data!.missing} devices in this scene have no
                            endpoint export.
                        </p>
                    )}
                    {Boolean(data?.devices.length) && (
                        <select
                            aria-label='Moving device'
                            value={selected}
                            onChange={(event) =>
                                setSelected(event.target.value)
                            }
                        >
                            <option value=''>All nearby devices</option>
                            {data!.devices.map((device) => (
                                <option key={device.id} value={device.id}>
                                    {device.id} {device.family}
                                </option>
                            ))}
                        </select>
                    )}
                </>
            )}
        </Panel>,
        panelRoot,
    );
}
