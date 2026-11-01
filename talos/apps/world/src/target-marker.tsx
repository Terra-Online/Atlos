import type { Point } from '@endfield-noclip/package-format/oem';

import { useLayoutEffect, useRef } from 'react';

import type { Viewer } from '@endfield-noclip/viewer/host';

const dot = (a: readonly number[], b: readonly number[]) =>
    a.reduce((sum, v, i) => sum + v * b[i], 0);

/** positions the target each camera frame without re-rendering the preview's condition panel */
export const TargetMarker = ({
    viewer,
    point,
}: {
    viewer: Viewer;
    point: Point;
}) => {
    const root = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const update = () => {
            const marker = root.current;
            if (!marker) {
                return;
            }
            const camera = viewer.camera;
            const delta = point.position.map((v, i) => v - camera.position[i]);
            const depth = dot(delta, camera.forward());
            const aspect = window.innerWidth / window.innerHeight;
            const f = 1 / Math.tan(camera.fovY / 2);
            const x =
                depth > 0
                    ? 50 +
                      ((dot(delta, camera.right()) * f) / aspect / depth) * 50
                    : 50;
            const y =
                depth > 0
                    ? 50 - ((dot(delta, camera.up()) * f) / depth) * 50
                    : 95;
            marker.style.left = `${Math.min(97, Math.max(3, x))}%`;
            marker.style.top = `${Math.min(95, Math.max(5, y))}%`;
        };
        const stop = viewer.subscribeCamera(update);
        window.addEventListener('resize', update);
        update();
        return () => {
            stop();
            window.removeEventListener('resize', update);
        };
    }, [viewer, point]);
    return (
        <div
            ref={root}
            className='oem-target'
            aria-label={`Target ${point.id}`}
        >
            <span>◇</span>
        </div>
    );
};
