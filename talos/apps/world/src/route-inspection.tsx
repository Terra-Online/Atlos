import { useEffect, useRef, useState } from 'react';
import { Panel, type Viewer } from '@endfield-noclip/viewer/host';
import { createPortal } from 'react-dom';
import { sampleJourney, type Route, type Vec3 } from '@opendfieldmap/ganglia';
import './route-inspection.css';
import { createRouteLines } from './route-lines-renderer';
import { routeStyle } from './route-lines';
import { boxSegments, supportBoxes, type SupportBox } from './moving-bounds';

export type Candidate = {
    version: 1;
    scene: string;
    level: string;
    source: { buildGuid: string; contentHash: string };
    title: string;
    status: 'candidate';
    draft?: boolean;
    log?: string;
    coverage?: string;
    assumptions?: string[];
    overview?: { position: Vec3; yaw: number; pitch: number; fovY: number };
    route: Extract<Route, { status: 'complete' }>;
    supportBoxes?: SupportBox[];
    markers: { label: string; position: Vec3 }[];
};
const dot = (a: number[], b: number[]) =>
    a.reduce((s, v, i) => s + v * b[i], 0);

/** Development-only inspection of local candidate trajectories, never a verified route result. */
export default function RouteInspection({
    viewer,
    source,
    panelRoot,
    candidate,
    message,
    log,
}: {
    viewer: Viewer;
    source: string | null;
    panelRoot: HTMLElement | null;
    candidate?: Candidate | null;
    message?: string;
    log?: string | null;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [data, setData] = useState<Candidate | null>(null);
    const [error, setError] = useState('');
    const [playing, setPlaying] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const time = useRef(0);
    const [visible, setVisible] = useState(true);
    const [hideOccluded, setHideOccluded] = useState(false);
    const [localSource, setLocalSource] = useState<string | null>(null);
    const activeSource = localSource ?? source;
    useEffect(() => {
        if (candidate !== undefined) {
            setData(candidate);
            time.current = 0;
            setSeconds(0);
            setPlaying(false);
        }
    }, [candidate]);
    useEffect(() => {
        if (!activeSource) return;
        setError('');
        const abort = new AbortController();
        void (async () => {
            const url = new URL(activeSource, location.href);
            if (
                url.origin !== location.origin ||
                !(url.pathname.startsWith('/oem/') || url.pathname === '/__routes/preview')
            )
                throw new Error('Route preview only reads local route data');
            const response = await fetch(url, { signal: abort.signal });
            if (!response.ok) throw new Error('Unable to load candidate route');
            const value: Candidate = await response.json();
            const vector = (p: number[]) =>
                Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
            if (
                value.version !== 1 ||
                value.status !== 'candidate' ||
                !value.source ||
                !Array.isArray(value.markers) ||
                value.markers.some((m) => !vector(m.position)) ||
                value.route?.status !== 'complete' ||
                !Number.isFinite(value.route.cost) ||
                value.route.cost <= 0 ||
                !Array.isArray(value.route.points) ||
                !value.route.points.length ||
                value.route.points.some((p) => !vector(p)) ||
                !Array.isArray(value.route.segments) ||
                !value.route.segments.length ||
                value.route.segments.some(
                    (s) =>
                        !['walk', 'jump', 'drop', 'rope', 'launch'].includes(
                            s.mode,
                        ) ||
                        !Array.isArray(s.points) ||
                        s.points.length < 2 ||
                        s.points.some((p) => !vector(p)) ||
                        !Array.isArray(s.times) ||
                        s.times.length !== s.points.length ||
                        s.times[0] !== 0 ||
                        s.times.some(
                            (t, i) =>
                                !Number.isFinite(t) ||
                                t < 0 ||
                                (i > 0 && t < s.times[i - 1]),
                        ),
                )
            )
                throw new Error('Invalid candidate route format');
            if (!abort.signal.aborted) setData(value);
        })().catch((e) => {
            if (!abort.signal.aborted) setError(String(e));
        });
        return () => abort.abort();
    }, [activeSource]);
    useEffect(() => {
        if (!data || !visible) return;
        let renderers: ReturnType<typeof createRouteLines>[] | undefined;
        const boxes = supportBoxes(data.supportBoxes);
        const boarding = boxes
            .filter((box) => box.role !== 'leave')
            .flatMap(boxSegments);
        const leaving = boxes
            .filter((box) => box.role === 'leave')
            .flatMap(boxSegments);
        const remove = viewer.addOverlay((frame) => {
            const manifest = viewer.scene?.pkg.manifest;
            if (
                manifest?.scene.id !== data.scene ||
                (!data.draft && viewer.level !== data.level) ||
                manifest.source.buildGuid !== data.source.buildGuid ||
                manifest.source.contentHash !== data.source.contentHash
            )
                return;
            renderers ??= [
                createRouteLines(
                    frame.device,
                    frame.format,
                    data.route.segments,
                    { halfWidth: 3.5, hideOccluded },
                ),
                ...(boarding.length
                    ? [
                          createRouteLines(
                              frame.device,
                              frame.format,
                              boarding,
                              { color: [0.05, 0.85, 0.95], halfWidth: 2, hideOccluded },
                          ),
                      ]
                    : []),
                ...(leaving.length
                    ? [
                          createRouteLines(
                              frame.device,
                              frame.format,
                              leaving,
                              { color: [1, 0.48, 0.08], halfWidth: 2, hideOccluded },
                          ),
                      ]
                    : []),
            ];
            for (const renderer of renderers)
                renderer.encode(frame, viewer.camera);
        }, { animated: true });
        return () => {
            remove();
            renderers?.forEach((renderer) => renderer.destroy());
        };
    }, [viewer, data, visible, hideOccluded]);
    useEffect(() => {
        if (!data || !canvas.current) return;
        let frame = 0,
            previous = performance.now(),
            lastReadout = 0;
        const element = canvas.current;
        const context = element.getContext('2d');
        if (!context) return;
        const draw = (now: number) => {
            const dt = Math.min((now - previous) / 1000, 0.1);
            previous = now;
            if (playing && data.route.cost > 0)
                time.current = (time.current + dt) % data.route.cost;
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
            const manifest = viewer.scene?.pkg.manifest;
            const matches =
                manifest?.scene.id === data.scene &&
                (data.draft || viewer.level === data.level) &&
                manifest.source.buildGuid === data.source.buildGuid &&
                manifest.source.contentHash === data.source.contentHash;
            if (visible && matches) {
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
                mark(
                    sampleJourney(data.route, time.current).position,
                    '',
                    '#8bd9ff',
                );
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(frame);
    }, [viewer, data, playing, visible]);
    if (!source && candidate === null && !message) return null;
    const pose = (kind: 'side' | 'top') => {
        if (!data || viewer.scene?.pkg.manifest.scene.id !== data.scene) return;
        if (kind === 'side' && data.overview) {
            const v = data.overview;
            if (
                v.position.length === 3 &&
                v.position.every(Number.isFinite) &&
                [v.yaw, v.pitch, v.fovY].every(Number.isFinite) &&
                v.fovY > 0.1 &&
                v.fovY < 3
            ) {
                viewer.camera.fovY = v.fovY;
                viewer.controls.flyTo(v);
                viewer.setOptions({});
                return;
            }
        }
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
                        title='Route preview'
                        label='Route preview'
                        className='route-inspection-panel'
                        actions={
                            <>
                                {candidate === undefined && (
                                    <button type='button' onClick={() => setLocalSource('/__routes/preview')}>
                                        South → North
                                    </button>
                                )}
                                {(log ?? data?.log) && (
                                    <a
                                        href={log ?? data?.log}
                                        target='_blank'
                                        rel='noreferrer'
                                    >
                                        Task log
                                    </a>
                                )}
                                <button
                                    type='button'
                                    disabled={!data}
                                    onClick={() => setVisible(!visible)}
                                >
                                    {visible ? 'Hide' : 'Show'}
                                </button>
                            </>
                        }
                    >
                        <p>{data?.title ?? 'Nearest teleport route'}</p>
                        {message && <p role='status'>{message}</p>}
                        {error && <p role='alert'>{error}</p>}
                        {data && (
                            <>
                                {data.route.locomotion?.dashes !== undefined && (
                                    <p>
                                        Dash × {data.route.locomotion.dashes} · Remaining stamina{' '}
                                        {data.route.locomotion.final.toFixed(2)}
                                    </p>
                                )}
                                <ul className='route-legend' aria-label='Route actions'>
                                    {[...new Set(data.route.segments.map(routeStyle))].map((style) => (
                                        <li key={style.label}>
                                            <span aria-hidden='true' style={{ backgroundColor: `rgb(${style.color.map(value => Math.round(value * 255)).join(',')})` }} />
                                            {style.label}
                                        </li>
                                    ))}
                                </ul>
                                {data.route.boosts?.map((boost) => (
                                    <p key={boost.id}>
                                        Vortex {boost.id} · {boost.multiplier}× ·{' '}
                                        {boost.elapsed.toFixed(2)} / {boost.duration.toFixed(1)} s
                                    </p>
                                ))}
                                {data.route.segments.some((segment) => segment.boostExpiry !== undefined) && (
                                    <p>The vortex buff expires during the final jump.</p>
                                )}
                                {data.route.goalHit && (
                                    <p>Route ends when the airborne target is collected.</p>
                                )}
                                <div className='world-panel-actions'>
                                    <label>
                                        <input type='checkbox' checked={hideOccluded}
                                            onChange={(event) => setHideOccluded(event.target.checked)} />
                                        Hide occluded
                                    </label>
                                    <button onClick={() => pose('side')}>
                                        Side overview
                                    </button>
                                    <button onClick={() => pose('top')}>
                                        Top view
                                    </button>
                                    <button
                                        hidden={data.draft}
                                        onClick={() => setPlaying(!playing)}
                                    >
                                        {playing ? 'Pause' : 'Play'}
                                    </button>
                                </div>
                                <input
                                    hidden={data.draft}
                                    aria-label='Route playback position'
                                    type='range'
                                    min='0'
                                    max={data.route.cost}
                                    step='.01'
                                    value={seconds}
                                    onChange={(e) => {
                                        time.current = Number(e.target.value);
                                        setSeconds(time.current);
                                    }}
                                />
                                <small hidden={data.draft}>
                                    {seconds.toFixed(1)} /{' '}
                                    {data.route.cost.toFixed(1)} s
                                </small>
                            </>
                        )}
                    </Panel>,
                    panelRoot,
                )}
        </>
    );
}
