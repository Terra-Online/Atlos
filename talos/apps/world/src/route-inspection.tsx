import type { Candidate, RoutePreview } from './services/routing';
import { useEffect, useRef, useState } from 'react';
import type { Viewer } from '@endfield-noclip/viewer/host';
import { Panel } from './panel';
import { createPortal } from 'react-dom';
import { sampleJourney, type Vec3 } from '@opendfieldmap/ganglia';
import './route-inspection.css';
import { createRouteLines } from './route-lines-renderer';
import { routeStyle } from './route-lines';
import { boxSegments, supportBoxes } from './moving-bounds';

export type { Candidate } from './services/routing';
const dot = (a: number[], b: number[]) =>
    a.reduce((s, v, i) => s + v * b[i], 0);

function matchesRouteScene(
    viewer: Viewer,
    route: Pick<Candidate, 'scene' | 'generation' | 'source'>,
) {
    const manifest = viewer.scene?.pkg.manifest;
    return (
        manifest?.scene.id === route.scene &&
        (route.generation === undefined ||
            manifest.generation === route.generation) &&
        manifest.source.buildGuid === route.source.buildGuid &&
        manifest.source.contentHash === route.source.contentHash
    );
}

/** Display the route returned by World’s development planner. */
export default function RouteInspection({
    viewer,
    panelRoot,
    candidate,
    preview,
    onRoute,
    message,
    log,
}: {
    viewer: Viewer;
    panelRoot: HTMLElement | null;
    candidate?: Candidate | null;
    preview?: RoutePreview;
    onRoute?: (points: Vec3[] | null) => void;
    message?: string;
    log?: string | null;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [received, setData] = useState<Candidate | null>(null);
    const [playing, setPlaying] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const time = useRef(0);
    const [visible, setVisible] = useState(true);
    const [hideOccluded, setHideOccluded] = useState(false);
    const draft = !received || received.partial ? preview : undefined;
    const data = draft ? null : received;
    const displayed = data ?? draft;
    useEffect(() => {
        onRoute?.(
            draft
                ? draft.segments.flatMap((segment, index) =>
                      index ? segment.points.slice(1) : segment.points,
                  )
                : data?.route.points ?? null,
        );
    }, [data, draft, onRoute]);
    useEffect(() => {
        if (
            !import.meta.env.DEV ||
            !new URL(location.href).searchParams.has('benchmark')
        )
            return;
        const receive = (event: Event) => {
            if (event instanceof CustomEvent)
                setData((event as CustomEvent<Candidate>).detail);
        };
        window.addEventListener('world:benchmark-route', receive);
        return () =>
            window.removeEventListener('world:benchmark-route', receive);
    }, []);
    useEffect(() => {
        if (
            candidate !== undefined &&
            candidate !== received &&
            (!playing || candidate === null)
        ) {
            setData(candidate);
            time.current = 0;
            setSeconds(0);
            setPlaying(false);
        }
    }, [candidate, playing, received]);
    useEffect(() => {
        const segments = draft?.segments ?? data?.route.segments;
        if (!displayed || !segments || !visible) return;
        let renderers: ReturnType<typeof createRouteLines>[] | undefined;
        const boxes = supportBoxes(data?.supportBoxes);
        const boarding = boxes
            .filter((box) => box.role !== 'leave')
            .flatMap(boxSegments);
        const leaving = boxes
            .filter((box) => box.role === 'leave')
            .flatMap(boxSegments);
        const remove = viewer.addOverlay(
            (frame) => {
                if (!matchesRouteScene(viewer, displayed)) return;
                renderers ??= [
                    createRouteLines(
                        frame.device,
                        frame.format,
                        segments,
                        draft
                            ? {
                                  color: [0.75, 0.85, 0.95],
                                  halfWidth: 2,
                                  hideOccluded,
                              }
                            : { halfWidth: 3.5, hideOccluded },
                    ),
                    ...(boarding.length
                        ? [
                              createRouteLines(
                                  frame.device,
                                  frame.format,
                                  boarding,
                                  {
                                      color: [0.05, 0.85, 0.95],
                                      halfWidth: 2,
                                      hideOccluded,
                                  },
                              ),
                          ]
                        : []),
                    ...(leaving.length
                        ? [
                              createRouteLines(
                                  frame.device,
                                  frame.format,
                                  leaving,
                                  {
                                      color: [1, 0.48, 0.08],
                                      halfWidth: 2,
                                      hideOccluded,
                                  },
                              ),
                          ]
                        : []),
                ];
                for (const renderer of renderers)
                    renderer.encode(frame, viewer.camera);
            },
            { animated: true },
        );
        return () => {
            remove();
            renderers?.forEach((renderer) => renderer.destroy());
        };
    }, [viewer, data, draft, displayed, visible, hideOccluded]);
    useEffect(() => {
        const element = canvas.current;
        if (!element) return;
        const context = element.getContext('2d');
        if (!context) return;
        if (!data) {
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, element.width, element.height);
            return;
        }
        let frame = 0,
            previous = performance.now(),
            lastReadout = 0;
        const draw = (now: number) => {
            const dt = Math.min((now - previous) / 1000, 0.1);
            previous = now;
            const duration =
                data.terminal?.wait.firstContactBySeconds ?? data.route.cost;
            if (playing && duration > 0)
                time.current = (time.current + dt) % duration;
            if (now - lastReadout > 100) {
                setSeconds(time.current);
                lastReadout = now;
            }
            const w = innerWidth,
                h = innerHeight,
                dpr = devicePixelRatio;
            if (
                element.width !== Math.round(w * dpr) ||
                element.height !== Math.round(h * dpr)
            ) {
                element.width = Math.round(w * dpr);
                element.height = Math.round(h * dpr);
            }
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, w, h);
            if (visible && matchesRouteScene(viewer, data)) {
                const camera = viewer.camera,
                    f = h / (2 * Math.tan(camera.fovY / 2));
                const space = (p: Vec3) => {
                    const delta = p.map((v, i) => v - camera.position[i]);
                    return [
                        dot(delta, camera.right()),
                        dot(delta, camera.up()),
                        dot(delta, camera.forward()),
                    ];
                };
                const screen = (p: number[]) => [
                    w / 2 + (f * p[0]) / p[2],
                    h / 2 - (f * p[1]) / p[2],
                ];
                const mark = (p: Vec3, label: string, color: string) => {
                    const local = space(p);
                    if (local[2] < 0.1) return;
                    const [x, y] = screen(local);
                    context.beginPath();
                    context.moveTo(x, y - 5);
                    context.lineTo(x + 5, y);
                    context.lineTo(x, y + 5);
                    context.lineTo(x - 5, y);
                    context.closePath();
                    context.fillStyle = color;
                    context.fill();
                    context.lineWidth = 2;
                    context.strokeStyle = '#18212c';
                    context.stroke();
                    context.font = 'bold 14px sans-serif';
                    context.lineWidth = 4;
                    context.strokeText(label, x + 10, y - 9);
                    context.fillStyle = '#fff';
                    context.fillText(label, x + 10, y - 9);
                };
                for (const marker of data.markers)
                    mark(marker.position, marker.label, '#fff');
                let position = sampleJourney(
                    data.route,
                    Math.min(time.current, data.route.cost),
                ).position;
                if (data.terminal && time.current >= data.route.cost) {
                    const settle = data.terminal.wait.settleSeconds;
                    const fraction =
                        settle > 0
                            ? Math.min(
                                  1,
                                  (time.current - data.route.cost) / settle,
                              )
                            : 1;
                    position = [
                        position[0] +
                            fraction *
                                (data.terminal.position[0] - position[0]),
                        position[1] +
                            fraction *
                                (data.terminal.position[1] - position[1]),
                        position[2] +
                            fraction *
                                (data.terminal.position[2] - position[2]),
                    ];
                }
                mark(position, '', '#8bd9ff');
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(frame);
    }, [viewer, data, playing, visible]);
    const logUrl = log ?? data?.log;
    const duration =
        data?.terminal?.wait.firstContactBySeconds ?? data?.route.cost;
    if (!displayed && !message && !logUrl) return null;
    const pose = (kind: 'side' | 'top') => {
        if (!data || !matchesRouteScene(viewer, data)) return;
        const points = data.route.points;
        const min = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i])));
        const max = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
        const center = min.map((v, i) => (v + max[i]) / 2);
        const radius = Math.hypot(...max.map((v, i) => (v - min[i]) / 2));
        const distance =
            (radius /
                Math.sin(
                    Math.min(
                        viewer.camera.fovY,
                        2 *
                            Math.atan(
                                (Math.tan(viewer.camera.fovY / 2) *
                                    innerWidth) /
                                    innerHeight,
                            ),
                    ) / 2,
                )) *
            1.2;
        const offset = kind === 'side' ? [1, 0.35, 0.35] : [0.05, 1, 0.05];
        const scale = distance / Math.hypot(...offset);
        const position = center.map((v, i) => v + offset[i] * scale) as Vec3;
        const delta = center.map((v, i) => v - position[i]);
        viewer.controls.flyTo({
            position,
            yaw: Math.atan2(delta[0], delta[2]),
            pitch: Math.atan2(delta[1], Math.hypot(delta[0], delta[2])),
        });
    };
    return (
        <>
            <canvas
                ref={canvas}
                className='route-inspection-canvas'
                aria-label='Route projection'
            />
            {panelRoot &&
                createPortal(
                    <Panel
                        title='Route'
                        label='Route'
                        className='route-inspection-panel'
                        actions={
                            <>
                                <button
                                    type='button'
                                    aria-pressed={hideOccluded}
                                    disabled={!displayed}
                                    onClick={() => setHideOccluded(!hideOccluded)}
                                >
                                    Hide occluded
                                </button>
                                <button
                                    type='button'
                                    disabled={!displayed}
                                    onClick={() => setVisible(!visible)}
                                >
                                    {visible ? 'Hide' : 'Show'}
                                </button>
                            </>
                        }
                    >
                        {data?.partial && <p>{data.title}</p>}
                        {(draft || message) && (
                            <p role='status'>
                                {draft
                                    ? 'Connecting the remaining route…'
                                    : message}
                            </p>
                        )}
                        {data && (
                            <>
                                {data.route.locomotion?.dashes !==
                                    undefined && (
                                    <p>
                                        Dash × {data.route.locomotion.dashes} ·
                                        {data.terminal
                                            ? 'Arrival stamina'
                                            : 'Remaining stamina'}{' '}
                                        {data.route.locomotion.final.toFixed(2)}
                                    </p>
                                )}
                                <ul
                                    className='route-legend'
                                    aria-label='Route actions'
                                >
                                    {[
                                        ...new Set(
                                            data.route.segments.map(routeStyle),
                                        ),
                                    ].map((style) => (
                                        <li key={style.label}>
                                            <span
                                                aria-hidden='true'
                                                style={{
                                                    backgroundColor: `rgb(${style.color.map((value) => Math.round(value * 255)).join(',')})`,
                                                }}
                                            />
                                            {style.label}
                                        </li>
                                    ))}
                                </ul>
                                {data.route.boosts?.map((boost) => (
                                    <p key={boost.id}>
                                        Vortex {boost.id} · {boost.multiplier}×
                                        · {boost.elapsed.toFixed(2)} /{' '}
                                        {boost.duration.toFixed(1)} s
                                    </p>
                                ))}
                                {data.route.segments.some(
                                    (segment) =>
                                        segment.boostExpiry !== undefined,
                                ) && (
                                    <p>
                                        The vortex buff expires during the final
                                        jump.
                                    </p>
                                )}
                                {data.terminal && (
                                    <p>
                                        Wait here for the moving coin. Arrival{' '}
                                        {(
                                            data.route.cost +
                                            data.terminal.wait.settleSeconds
                                        ).toFixed(1)}{' '}
                                        s · wait up to{' '}
                                        {data.terminal.wait.maximumSeconds.toFixed(
                                            1,
                                        )}{' '}
                                        s.
                                    </p>
                                )}
                                {data.route.goalHit && (
                                    <p>
                                        Route ends when the airborne target is
                                        collected.
                                    </p>
                                )}
                                <div className='world-panel-actions route-playback-actions'>
                                    <button
                                        type='button'
                                        onClick={() => pose('side')}
                                    >
                                        Side overview
                                    </button>
                                    <button
                                        type='button'
                                        onClick={() => pose('top')}
                                    >
                                        Top view
                                    </button>
                                    <button
                                        type='button'
                                        onClick={() => setPlaying(!playing)}
                                    >
                                        {playing ? 'Pause' : 'Play'}
                                    </button>
                                </div>
                                <input
                                    aria-label='Route playback position'
                                    type='range'
                                    min='0'
                                    max={duration}
                                    step='.01'
                                    value={seconds}
                                    onChange={(e) => {
                                        time.current = Number(e.target.value);
                                        setSeconds(time.current);
                                    }}
                                />
                            </>
                        )}
                        {(data || logUrl) && (
                            <div className='route-playback-readout'>
                                {duration !== undefined && (
                                    <small>
                                        {seconds.toFixed(1)} /{' '}
                                        {duration.toFixed(1)} s
                                    </small>
                                )}
                                {logUrl && (
                                    <a
                                        href={logUrl}
                                        target='_blank'
                                        rel='noreferrer'
                                    >
                                        Task log
                                    </a>
                                )}
                            </div>
                        )}
                    </Panel>,
                    panelRoot,
                )}
        </>
    );
}
