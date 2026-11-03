import { useEffect, useState } from 'react';
import type { Viewer } from '@endfield-noclip/viewer/host';
import type { Point } from '@endfield-noclip/package-format/oem';
import type { Vec3 } from '@oem/ganglia';
import RouteInspection, { type Candidate } from './route-inspection';

/** Query the development planner after the normal point view has opened. */
export default function NearestRoute({
    viewer,
    point,
    panelRoot,
    onRoute,
}: {
    viewer: Viewer;
    point: Point;
    panelRoot: HTMLElement | null;
    onRoute: (points: Vec3[] | null) => void;
}) {
    const [details, setDetails] = useState<string[]>([]);
    const [data, setData] = useState<Candidate | null>(null);
    const [message, setMessage] = useState(
        'Calculating route from the nearest teleport…',
    );
    useEffect(() => {
        const abort = new AbortController();
        setData(null);
        setDetails([]);
        onRoute(null);
        setMessage('Calculating route from the nearest teleport…');
        void (async () => {
            const source = viewer.scene?.pkg.manifest.source;
            if (!source) throw new Error('Scene is not ready');
            const query = new URLSearchParams({
                scene: point.scene,
                level: point.level,
                point: point.id,
                x: String(point.position[0]),
                y: String(point.position[1]),
                z: String(point.position[2]),
                buildGuid: source.buildGuid,
                contentHash: source.contentHash,
            });
            let result;
            let response;
            let routeSignature = '';
            let pending = false;
            do {
                response = await fetch(`/__routes/nearest?${query}`, {
                    signal: abort.signal,
                });
                result = await response.json();
                if (abort.signal.aborted) return;
                if (response.ok && result.status === 'candidate') {
                    const signature = JSON.stringify(result.route);
                    if (signature !== routeSignature) {
                        routeSignature = signature;
                        setData(result);
                        onRoute(result.route.points);
                    }
                }
                pending =
                    response.ok &&
                    (result.status === 'building-ground' ||
                        (result.status === 'candidate' && result.optimizing));
                if (pending) {
                    setMessage(
                        result.optimizationMessage ||
                            result.message ||
                            'Comparing jump alternatives…',
                    );
                    await new Promise<void>((resolve, reject) => {
                        const stop = () => {
                            clearTimeout(timer);
                            reject(new DOMException('Aborted', 'AbortError'));
                        };
                        const timer = setTimeout(() => {
                            abort.signal.removeEventListener('abort', stop);
                            resolve();
                        }, 1000);
                        abort.signal.addEventListener('abort', stop, {
                            once: true,
                        });
                        if (abort.signal.aborted) stop();
                    });
                }
            } while (pending && !abort.signal.aborted);
            if (abort.signal.aborted) return;
            const summary = [];
            if (result.anchor?.id)
                summary.push(`Nearest anchor · ${result.anchor.id}`);
            if (result.category) summary.push(`Result · ${result.category}`);
            if (result.status !== 'candidate' && result.coverage)
                summary.push(result.coverage);
            if (result.interaction?.status === 'source-derived')
                summary.push(
                    `Interaction endpoint · ${result.interaction.template} · source-derived volume`,
                );
            else
                summary.push(
                    'Interaction endpoint · unresolved; ground projection used',
                );
            if (result.diagnostics?.traversal?.truncated)
                summary.push('Movement search · candidate coverage is partial');
            if (result.route?.locomotion?.search?.truncated)
                summary.push('Sprint scheduling · search budget reached');
            const attempts = result.diagnostics?.attempts;
            const last = Array.isArray(attempts) ? attempts.at(-1) : null;
            if (last)
                summary.push(
                    `Ground projection · Anchor ${last.anchor.mapped ? 'found' : 'missing'} · Target ${last.target.mapped ? 'found' : 'missing'} · ${last.surfaces} polygons checked`,
                );
            setDetails(summary);
            if (!response.ok || result.status !== 'candidate')
                throw new Error(
                    result.message ||
                        'No route is available in the current data',
                );
            if (abort.signal.aborted) return;
            setMessage(result.optimizationMessage || '');
        })().catch((error) => {
            if (!abort.signal.aborted)
                setMessage(
                    error instanceof Error ? error.message : String(error),
                );
        });
        return () => {
            abort.abort();
            onRoute(null);
        };
    }, [viewer, point, onRoute]);
    return (
        <RouteInspection
            viewer={viewer}
            source={null}
            panelRoot={panelRoot}
            candidate={data}
            message={message}
            details={details}
        />
    );
}
