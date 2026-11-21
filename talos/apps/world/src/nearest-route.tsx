import {
    routing,
    type RoutePreview,
    type RouteRequest,
    type RouteUpdate,
} from './services/routing';
import { useEffect, useState } from 'react';
import type { Viewer } from '@endfield-noclip/viewer/host';
import type { Vec3 } from '@opendfieldmap/ganglia';
import RouteInspection, { type Candidate } from './route-inspection';

/** Query the development planner after the normal point view has opened. */
export default function NearestRoute({
    viewer,
    request,
    panelRoot,
    onRoute,
}: {
    viewer: Viewer;
    request: RouteRequest;
    panelRoot: HTMLElement | null;
    onRoute: (points: Vec3[] | null) => void;
}) {
    const [log, setLog] = useState<string | null>(null);
    const [data, setData] = useState<Candidate | null>(null);
    const [preview, setPreview] = useState<RoutePreview>();
    const [message, setMessage] = useState(
        'Calculating route from the nearest teleport…',
    );
    useEffect(() => {
        const abort = new AbortController();
        setData(null);
        setPreview(undefined);
        setLog(null);
        onRoute(null);
        setMessage('Calculating route from the nearest teleport…');
        void (async () => {
            let result: RouteUpdate | undefined;
            let routeSignature = '';
            let previewSignature: string | undefined;
            for await (const update of routing.nearest(request, abort.signal)) {
                result = update;
                if (abort.signal.aborted) return;
                if (result.log) setLog(result.log);
                const nextPreview = JSON.stringify(result.preview);
                if (nextPreview !== previewSignature) {
                    previewSignature = nextPreview;
                    setPreview(result.preview);
                }
                if (result.status === 'candidate') {
                    const signature = JSON.stringify([
                        result.route,
                        result.supportBoxes,
                        result.terminal,
                    ]);
                    if (signature !== routeSignature) {
                        routeSignature = signature;
                        setData(result);
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
            if (!abort.signal.aborted) {
                setPreview(undefined);
                setMessage(
                    error instanceof Error ? error.message : String(error),
                );
            }
        });
        return () => {
            abort.abort();
            onRoute(null);
        };
    }, [request, onRoute]);
    return (
        <RouteInspection
            viewer={viewer}
            panelRoot={panelRoot}
            candidate={data}
            preview={preview}
            onRoute={onRoute}
            message={message}
            log={log}
        />
    );
}
