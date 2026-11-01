import { useLayerStore } from '@/store/layer';
import { getCurrentLocale, setLocale } from '@/locale';
import { pointPath } from '@/services/noclip/route';
import {
    isCatalog,
    isCompanion,
    type Catalog,
    type Companion,
    type Point,
} from '@endfield-noclip/package-format/oem';
import { completedProgressionPicks } from '@endfield-noclip/package-format/story';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { httpSource, type Viewer } from '@endfield-noclip/viewer/host';

import { createMinimap, type Sample } from './minimap';
import { Regions } from './regions';
import { REGION_DICT } from '@/data/map';
import { connectWorld } from './bridge';
import type { Launch } from './route';
import { PointConditions } from './point-conditions.tsx';
import { TargetMarker } from './target-marker.tsx';

type Request = { point: string } | { region: string; subregion: string };
/** existing viewer with an OEM launch bridge and a passive, OEM-owned minimap */
export const Preview = ({
    viewer,
    launch,
    panelRoot,
}: {
    viewer: Viewer;
    launch: Launch;
    panelRoot: HTMLElement | null;
}) => {
    const mapRoot = useRef<HTMLDivElement>(null);
    const navigate = useRef<(request: Request) => void>(() => {});
    const [area, setArea] = useState({ region: 'Valley_4', subregion: '' });
    const channel = useRef<ReturnType<typeof connectWorld> | null>(null);
    const [point, setPoint] = useState<Point | null>(null);
    const [metadata, setMetadata] = useState<Companion | null>(null);
    const [preset, setPreset] = useState('');
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('Opening OEM preview…');
    const reply = useCallback((type: string, payload: object = {}) => {
        channel.current?.send(type, payload);
    }, []);
    const apply = useCallback(
        (target: Point, presetId?: string) => {
            let id: string, picks: Record<string, number>;
            if (presetId === undefined || presetId === 'completed') {
                id = 'completed';
                picks = completedProgressionPicks(
                    viewer.scene?.pkg.manifest.states.controls ?? [],
                );
            } else {
                const chosen = target.presets.find((p) => p.id === presetId);
                if (!chosen) {
                    throw new Error('point has no preview preset');
                }
                id = chosen.id;
                picks = chosen.picks;
            }
            viewer.resetSceneValues();
            viewer.setSceneValues(picks);
            setPreset(id);
            reply('state', {
                point: target.id,
                preset: id,
                unknown: target.unknown,
            });
        },
        [viewer, reply],
    );

    useEffect(() => {
        const abort = new AbortController();
        const map = mapRoot.current ? createMinimap(mapRoot.current) : null;
        let framing: AbortController | null = null;
        let catalog: Catalog | null = null,
            selected: Point | null = null,
            preparing: Point | null = null;
        let desired: Request | null = launch.point
                ? { point: launch.point }
                : { region: launch.region, subregion: launch.subregion },
            busy = false,
            loaded = '';
        const companions = new Map<string, Companion>();
        let pointTarget = true;
        const minimap = () => {
            const target = selected ?? preparing;
            if (!target) return;
            const camera = viewer.camera;
            const ground = viewer.groundHeight;
            const sample: Sample = {
                point: target,
                tracking: selected !== null,
                target: pointTarget,
                position: selected ? [...camera.position] : target.position,
                forward: selected ? [...camera.forward()] : [0, 0, 1],
                ...(selected
                    ? {
                          view: {
                              groundY:
                                  ground !== null && ground < camera.position[1]
                                      ? ground
                                      : target.position[1],
                              fovY: camera.fovY,
                              aspect: innerWidth / Math.max(1, innerHeight),
                          },
                      }
                    : {}),
            };
            map?.update(sample);
        };
        const read = async (path: string): Promise<unknown> => {
            const response = await fetch(new URL(path, launch.catalog), {
                signal: abort.signal,
            });
            if (!response.ok) {
                throw new Error(`OEM data: HTTP ${response.status}`);
            }
            return response.json();
        };
        const drain = async () => {
            if (busy) {
                return;
            }
            busy = true;
            setLoading(true);
            try {
                while (desired && !abort.signal.aborted) {
                    const request = desired;
                    desired = null;
                    try {
                        if (!catalog) {
                            const value = await read(launch.catalog);
                            if (!isCatalog(value)) {
                                throw new Error('OEM release mismatch');
                            }
                            catalog = value;
                        }
                        const partition =
                                'point' in request
                                    ? catalog.pointIndex[request.point]
                                    : request.subregion,
                            file = catalog.files[partition];
                        if (!file) {
                            throw new Error('point is not in this OEM release');
                        }
                        let companion = companions.get(partition);
                        if (!companion) {
                            const value = await read(file);
                            if (
                                !isCompanion(value) ||
                                value.release !== catalog.release
                            ) {
                                throw new Error('OEM companion mismatch');
                            }
                            companion = value;
                            companions.set(partition, companion);
                        }
                        if (desired || abort.signal.aborted) {
                            continue;
                        }
                        const target = companion.points.find((p) =>
                                'point' in request
                                    ? p.id === request.point
                                    : p.subregion === request.subregion &&
                                      (!request.region ||
                                          p.region === request.region),
                            ),
                            pack = target && catalog.packages[target.scene];
                        if (!target || !pack) {
                            throw new Error('point has no scene package');
                        }
                        const animate =
                            selected !== null &&
                            viewer.scene?.pkg.manifest.scene.id ===
                                target.scene &&
                            viewer.scene.pkg.manifest.generation ===
                                pack.generation;
                        selected = null;
                        pointTarget = 'point' in request;
                        preparing = target;
                        minimap();
                        setStatus('Opening scene…');
                        const key = `${target.scene}/${pack.generation}`;
                        if (
                            loaded !== key ||
                            viewer.scene?.pkg.manifest.generation !==
                                pack.generation
                        ) {
                            await viewer.load(
                                httpSource(
                                    new URL(pack.path, launch.catalog).href,
                                ),
                                target.level,
                                setStatus,
                            );
                            loaded = key;
                        }
                        if (desired || abort.signal.aborted) {
                            continue;
                        }
                        const manifest = viewer.scene?.pkg.manifest;
                        if (
                            !manifest ||
                            manifest.generation !== pack.generation ||
                            manifest.version !== pack.version ||
                            manifest.source.buildGuid !==
                                catalog.source.buildGuid ||
                            manifest.source.contentHash !==
                                catalog.source.contentHash ||
                            !manifest.levels.some(
                                (l) => l.id === target.level && l.instances > 0,
                            )
                        ) {
                            loaded = '';
                            throw new Error(
                                'scene package does not match OEM release',
                            );
                        }
                        if (viewer.level !== target.level) {
                            viewer.showLevel(target.level);
                        }
                        viewer.setCompanion(
                            companion.controls,
                            companion.missions,
                        );
                        apply(target);
                        pointTarget = 'point' in request;
                        if (pointTarget) {
                            setStatus('Finding a clear view…');
                            framing = new AbortController();
                            await viewer.framePoint(
                                target.position,
                                framing.signal,
                                { baked: target.view, animate },
                            );
                        } else {
                            viewer.flyToLevel(target.level);
                        }
                        if (desired || abort.signal.aborted) {
                            continue;
                        }
                        selected = target;
                        preparing = null;
                        setPoint(pointTarget ? target : null);
                        setMetadata(companion);
                        const url = new URL(location.href);
                        url.pathname = pointTarget ? pointPath(target.id) : '/';
                        url.search = pointTarget
                            ? ''
                            : new URLSearchParams({
                                  region: target.subregion,
                              }).toString();
                        url.hash = '';
                        history.replaceState(null, '', url);
                        setStatus('');
                        setArea({
                            region: target.region,
                            subregion: target.subregion,
                        });
                        minimap();
                    } catch (error) {
                        if (!abort.signal.aborted && !desired) {
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : String(error);
                            setStatus(message);
                            selected = null;
                            preparing = null;
                            setPoint(null);
                            reply('error', {
                                message,
                                point: 'point' in request ? request.point : '',
                            });
                        }
                    }
                }
            } finally {
                busy = false;
                setLoading(false);
            }
        };
        const request = (next: Request) => {
            framing?.abort();
            desired = next;
            void drain();
        };
        navigate.current = request;
        let localeRevision = 0;
        channel.current = connectWorld(
            (id) => request({ point: id }),
            (preferences) => {
                useLayerStore.getState().setSatellite(preferences.satellite);
                const revision = ++localeRevision;
                if (preferences.locale !== getCurrentLocale())
                    void setLocale(
                        preferences.locale,
                        () =>
                            !abort.signal.aborted &&
                            revision === localeRevision,
                    );
            },
        );
        window.addEventListener('resize', minimap, { signal: abort.signal });
        const stop = viewer.subscribeCamera(() => {
            if (selected) {
                minimap();
            }
        });
        void drain();
        return () => {
            abort.abort();
            framing?.abort();
            stop();
            channel.current?.close();
            channel.current = null;
            map?.destroy();
            navigate.current = () => {};
        };
    }, [viewer, launch, reply, apply]);
    return (
        <>
            <Regions
                {...area}
                preparing={loading ? area.region : null}
                onSelect={(region, subregion) =>
                    navigate.current({
                        region,
                        subregion:
                            subregion ?? REGION_DICT[region].subregions[0],
                    })
                }
            />
            {panelRoot &&
                point &&
                metadata &&
                createPortal(
                    <PointConditions
                        viewer={viewer}
                        point={point}
                        companion={metadata}
                        preset={preset}
                        disabled={loading}
                        onPreset={(id) => apply(point, id)}
                    />,
                    panelRoot,
                )}
            <div ref={mapRoot} className='oem-minimap' aria-label='Minimap' />
            {status && <output className='panel oem-status'>{status}</output>}
            {point && <TargetMarker viewer={viewer} point={point} />}
        </>
    );
};
