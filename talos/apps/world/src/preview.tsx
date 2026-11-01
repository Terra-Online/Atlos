import { useLayerStore } from '@/store/layer';
import { getCurrentLocale, setLocale } from '@/locale';
import {
    isNavigation,
    matchesNavigation,
    type Navigation,
} from '@endfield-noclip/package-format/navigation';
import {
    Crossing,
    destinationAt,
    destinationKey,
    rebasePosition,
    type Destination,
} from './navigation';
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
import { readView, writeView, displayOptions } from './view-storage';

type Request =
    | { point: string }
    | { region: string; subregion: string }
    | { stream: Destination };
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
        const saved = readView(viewer.options);
        let resume =
            saved?.route === location.pathname + location.search ? saved : null;
        if (saved) {
            viewer.setOptions(saved.options);
            viewer.camera.fovY = saved.fovY;
            viewer.controls.speed = saved.speed;
        }
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
        let goal: Point | null = null;
        let navigation: Navigation | null = null;
        let anchor: number[] | null = null;
        let armed = false;
        let failedCrossing = '';
        const crossing = new Crossing();
        let groundSample: {
            context: string;
            at: number;
            height: number | null;
        } | null = null;
        const readMinimap = (): Sample | null => {
            const target = selected ?? preparing;
            if (!target) return null;
            const camera = viewer.camera;
            const context = `${target.scene}/${target.level}/${target.tier}`;
            const now = performance.now();
            // Position/bearing follow every display frame; terrain queries only
            // influence zoom and need not compete with the renderer at that rate.
            if (
                !groundSample ||
                groundSample.context !== context ||
                now - groundSample.at >= 100
            ) {
                groundSample = {
                    context,
                    at: now,
                    height: viewer.groundHeight,
                };
            }
            const ground = groundSample.height;
            const sample: Sample = {
                point: target,
                tracking: selected !== null,
                target: goal,
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
            return sample;
        };
        const minimap = () => map?.update(readMinimap);
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
                    const before = selected;
                    try {
                        if (!catalog) {
                            const value = await read(launch.catalog);
                            if (!isCatalog(value)) {
                                throw new Error('OEM release mismatch');
                            }
                            catalog = value;
                            if (catalog.navigation) {
                                const data = await read(catalog.navigation);
                                if (
                                    !isNavigation(data) ||
                                    !matchesNavigation(data, catalog)
                                )
                                    throw new Error(
                                        'navigation does not match OEM release',
                                    );
                                navigation = data;
                            }
                        }
                        const partition =
                                'point' in request
                                    ? catalog.pointIndex[request.point]
                                    : 'stream' in request
                                      ? request.stream.route.subregion
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
                        const target =
                                ('stream' in request
                                    ? companion.points.find(
                                          (p) =>
                                              p.scene ===
                                                  request.stream.route.scene &&
                                              p.level ===
                                                  request.stream.route.level &&
                                              p.tier === request.stream.tier,
                                      )
                                    : undefined) ??
                                companion.points.find((p) =>
                                    'point' in request
                                        ? p.id === request.point
                                        : 'stream' in request
                                          ? p.scene ===
                                                request.stream.route.scene &&
                                            p.level ===
                                                request.stream.route.level
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
                        const previous = selected;
                        const streaming = 'stream' in request;
                        if (!streaming) {
                            selected = null;
                            goal = 'point' in request ? target : null;
                            pointTarget = 'point' in request;
                            anchor = null;
                            armed = false;
                            failedCrossing = '';
                            crossing.reset();
                        }
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
                                { preserveCamera: streaming },
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
                            viewer.showLevel(target.level, { fly: !streaming });
                        }
                        viewer.setCompanion(
                            companion.controls,
                            companion.missions,
                        );
                        if (streaming) {
                            if (previous && previous.scene !== target.scene) {
                                // Both position and heading pass through the shared map frame; height stays source-authored.
                                const camera = viewer.camera;
                                const eye = rebasePosition(
                                    previous,
                                    target,
                                    camera.position,
                                );
                                const forward = camera.forward();
                                const ahead = rebasePosition(
                                    previous,
                                    target,
                                    camera.position.map(
                                        (v, i) => v + forward[i],
                                    ),
                                );
                                camera.position = eye;
                                camera.yaw = Math.atan2(
                                    ahead[0] - eye[0],
                                    ahead[2] - eye[2],
                                );
                                camera.pitch = Math.atan2(
                                    ahead[1] - eye[1],
                                    Math.hypot(
                                        ahead[0] - eye[0],
                                        ahead[2] - eye[2],
                                    ),
                                );
                            }
                            setPreset('completed');
                            viewer.resetSceneValues();
                            viewer.setSceneValues(
                                completedProgressionPicks(
                                    viewer.scene?.pkg.manifest.states
                                        .controls ?? [],
                                ),
                            );
                        } else {
                            apply(target);
                        }
                        if (resume && resume.release !== catalog.release)
                            resume = null;
                        const restoring =
                            resume &&
                            resume.scene === target.scene &&
                            resume.level === target.level;
                        if (restoring && resume) {
                            viewer.controls.cancelFlight();
                            viewer.camera.position = [...resume.position];
                            viewer.camera.yaw = resume.yaw;
                            viewer.camera.pitch = resume.pitch;
                            viewer.camera.fovY = resume.fovY;
                            viewer.controls.speed = resume.speed;
                            viewer.setOptions({});
                        } else if (!streaming && pointTarget) {
                            setStatus('Finding a clear view…');
                            framing = new AbortController();
                            await viewer.framePoint(
                                target.position,
                                framing.signal,
                                { baked: target.view, animate },
                            );
                        } else if (!streaming) {
                            viewer.flyToLevel(target.level);
                        }
                        if (desired || abort.signal.aborted) {
                            continue;
                        }
                        selected = streaming
                            ? { ...target, tier: request.stream.tier }
                            : target;
                        preparing = null;
                        if (restoring && resume) {
                            selected = {
                                ...selected,
                                tier: resume.tier,
                                subregion: resume.subregion,
                            };
                            resume = null;
                        } else if (resume) {
                            // Load the public destination first to retain its target/panel,
                            // then resume the scene reached by automatic roaming.
                            const route = navigation?.routes.find(
                                (r) =>
                                    r.scene === resume?.scene &&
                                    r.level === resume.level &&
                                    r.subregion === resume.subregion,
                            );
                            if (route)
                                desired = {
                                    stream: { route, tier: resume.tier },
                                };
                            else resume = null;
                        }
                        if (!streaming) {
                            setPoint(goal);
                            setMetadata(companion);
                        }
                        const url = new URL(location.href);
                        url.pathname = goal ? pointPath(goal.id) : '/';
                        url.search = goal
                            ? ''
                            : new URLSearchParams({
                                  region: target.subregion,
                              }).toString();
                        url.hash = '';
                        history.replaceState(null, '', url);
                        setStatus('');
                        setArea({
                            region: selected.region,
                            subregion: selected.subregion,
                        });
                        minimap();
                    } catch (error) {
                        if (!abort.signal.aborted && !desired) {
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : String(error);
                            setStatus(message);
                            if ('stream' in request) {
                                failedCrossing = destinationKey(request.stream);
                                selected =
                                    before &&
                                    viewer.scene?.pkg.manifest.scene.id ===
                                        before.scene &&
                                    viewer.level === before.level
                                        ? before
                                        : null;
                            } else {
                                selected = null;
                                setPoint(null);
                                goal = null;
                            }
                            preparing = null;
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
            resume = null;
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
        let saveTimer: ReturnType<typeof setTimeout> | undefined;
        const save = () => {
            clearTimeout(saveTimer);
            saveTimer = undefined;
            if (
                !selected ||
                !catalog ||
                busy ||
                desired ||
                viewer.controls.flying
            )
                return;
            writeView({
                version: 1,
                route: location.pathname + location.search,
                release: catalog.release,
                scene: selected.scene,
                level: selected.level,
                subregion: selected.subregion,
                tier: selected.tier,
                position: [...viewer.camera.position],
                yaw: viewer.camera.yaw,
                pitch: viewer.camera.pitch,
                fovY: viewer.camera.fovY,
                speed: viewer.controls.speed,
                options: displayOptions(viewer.options, viewer.options),
            });
        };
        const scheduleSave = () => {
            if (saveTimer === undefined) saveTimer = setTimeout(save, 500);
        };
        let stateRevision = viewer.stateRevision;
        const stopSettings = viewer.subscribe(() => {
            if (stateRevision !== viewer.stateRevision) {
                stateRevision = viewer.stateRevision;
                scheduleSave();
            }
        });
        window.addEventListener('pagehide', save, { signal: abort.signal });
        document.addEventListener(
            'visibilitychange',
            () => {
                if (document.hidden) save();
            },
            { signal: abort.signal },
        );
        window.addEventListener('wheel', scheduleSave, {
            passive: true,
            signal: abort.signal,
        });
        window.addEventListener('resize', minimap, { signal: abort.signal });
        const stop = viewer.subscribeCamera(() => {
            if (selected) {
                minimap();
                scheduleSave();
            }
        });
        const auto = window.setInterval(() => {
            if (
                !navigation ||
                !selected ||
                busy ||
                desired ||
                viewer.controls.flying
            ) {
                if (viewer.controls.flying) anchor = null;
                crossing.reset();
                return;
            }
            const eye = viewer.camera.position;
            if (!anchor) {
                anchor = [...eye];
                return;
            }
            if (!armed)
                armed = Math.hypot(...eye.map((v, i) => v - anchor![i])) > 1;
            if (!armed) return;
            const next = destinationAt(navigation, selected, eye);
            const current = `${selected.scene}/${selected.level}/${selected.subregion}/${selected.tier}`;
            if (next && destinationKey(next) === failedCrossing) return;
            const destination = crossing.update(
                next,
                current,
                performance.now(),
            );
            if (destination) request({ stream: destination });
        }, 150);
        void drain();
        return () => {
            save();
            stopSettings();
            clearInterval(auto);
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
                        disabled={
                            loading ||
                            viewer.scene?.pkg.manifest.scene.id !==
                                point.scene ||
                            viewer.level !== point.level
                        }
                        onPreset={(id) => apply(point, id)}
                    />,
                    panelRoot,
                )}
            <div ref={mapRoot} className='oem-minimap' aria-label='Minimap' />
            {status && <output className='panel oem-status'>{status}</output>}
            {point && viewer.scene?.pkg.manifest.scene.id === point.scene && (
                <TargetMarker viewer={viewer} point={point} />
            )}
        </>
    );
};
