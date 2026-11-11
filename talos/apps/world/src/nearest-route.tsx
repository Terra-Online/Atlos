import { sceneReference } from './services/scene';
import { routing, type RouteUpdate } from './services/routing';
import { useEffect, useState } from 'react';
import { useViewerState, type Viewer } from '@endfield-noclip/viewer/host';
import type { Point } from '@endfield-noclip/package-format/oem';
import type { Vec3 } from '@opendfieldmap/ganglia';
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
    useViewerState(viewer);
    const sceneKey = JSON.stringify([
        viewer.scene?.pkg.manifest.generation,
        Object.entries(viewer.scenePicks).sort(),
    ]);
    const [log, setLog] = useState<string | null>(null);
    const [data, setData] = useState<Candidate | null>(null);
    const [message, setMessage] = useState(
        'Calculating route from the nearest teleport…',
    );
    useEffect(() => {
        const abort = new AbortController();
        setData(null);
        setLog(null);
        onRoute(null);
        setMessage('Calculating route from the nearest teleport…');
        void (async () => {
            const source = viewer.scene?.pkg.manifest.source;
            if (!source) throw new Error('Scene is not ready');
            const query = {
                ...sceneReference(viewer),
                scene: point.scene,
                level: point.level,
                point: point.id,
                x: String(point.position[0]),
                y: String(point.position[1]),
                z: String(point.position[2]),
                buildGuid: source.buildGuid,
                contentHash: source.contentHash,
            };
            let result: RouteUpdate | undefined;
            let routeSignature = '';
            for await (const update of routing.nearest(query, abort.signal)) {
                result = update;
                if (abort.signal.aborted) return;
                setLog(result.log ?? null);
                if (result.status === 'candidate') {
                    const signature = JSON.stringify([
                        result.route,
                        result.supportBoxes,
                    ]);
                    if (signature !== routeSignature) {
                        routeSignature = signature;
                        setData(result);
                        onRoute(result.route.points);
                    }
                }
                setMessage(
                    result.optimizationMessage ||
                        result?.message ||
                        'Comparing jump alternatives…',
                );
            }
            if (abort.signal.aborted) return;
            if (!result || result.status !== 'candidate')
                throw new Error(
                    result?.message ||
                        'No route is available in the current data',
                );
            if (abort.signal.aborted) return;
            setMessage('');
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
    }, [viewer, point, onRoute, sceneKey]);
    return (
        <RouteInspection
            viewer={viewer}
            source={null}
            panelRoot={panelRoot}
            candidate={data}
            message={message}
            log={log}
        />
    );
}
