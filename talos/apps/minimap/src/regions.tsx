import { useEffect, useRef, useState } from 'react';
import {
    UIOverlayLayer,
    SwitchArea,
} from '@/component/shared/uiOverlay/UIOverlayLayer';
import { useDevice } from '@/platform/device';
import overlayStyles from '@/component/shared/uiOverlay/UIOverlay.module.scss';
import '@/styles/global.scss';
import './regions.css';
import { RegionMenu } from '@/component/regionSwitch/regionSwitch';
import { REGION_DICT } from '@/data/map';
import { useTranslate, useLocale } from '@/locale';
import { useFontRegion } from '@/locale/useFontRegion';
import { regionFontRuns } from '@/locale/mapFonts';
import { record, VERSION } from '@/services/noclip/types';

export function Regions({
    origin,
    session,
}: {
    origin: string;
    session: string;
}) {
    const [region, setRegion] = useState('Valley_4');
    const [subregion, setSubregion] = useState<string | null>(null);
    const [preparing, setPreparing] = useState<string | null>(null);
    const host = useRef<HTMLDivElement>(null);
    const { isMobile } = useDevice();
    const t = useTranslate();
    useLocale();
    const fonts = useFontRegion(regionFontRuns(t));
    useEffect(() => {
        const receive = (event: MessageEvent<unknown>) => {
            const d = event.data;
            if (
                event.origin !== origin ||
                event.source !== parent ||
                !record(d) ||
                d.version !== VERSION ||
                d.session !== session ||
                !['region-state', 'region-error'].includes(String(d.type))
            )
                return;
            if (d.type === 'region-error') {
                setPreparing(null);
                return;
            }
            if (
                typeof d.region !== 'string' ||
                !Object.prototype.hasOwnProperty.call(REGION_DICT, d.region)
            )
                return;
            const key =
                typeof d.subregion === 'string' &&
                REGION_DICT[d.region].subregions.includes(d.subregion)
                    ? d.subregion
                    : null;
            setRegion(d.region);
            setSubregion(key);
            setPreparing(null);
        };
        window.addEventListener('message', receive);
        parent.postMessage(
            { version: VERSION, session, type: 'regions-ready' },
            origin,
        );
        return () => window.removeEventListener('message', receive);
    }, [origin, session]);
    useEffect(() => {
        const root = host.current;
        if (!root) return;
        let frame: number | null = null;
        const report = () => {
            frame = null;
            const controls = [
                root.firstElementChild,
                ...root.querySelectorAll('[data-state]:not([inert])'),
                ...document.querySelectorAll('[popover]:popover-open'),
            ];
            const rects = controls
                .filter((x): x is Element => !!x)
                .map((x) => {
                    const r = x.getBoundingClientRect();
                    return [
                        Math.max(0, r.left - 8),
                        Math.max(0, r.top - 8),
                        Math.min(innerWidth, r.right + 8),
                        Math.min(innerHeight, r.bottom + 8),
                    ];
                })
                .filter((r) => r[2] > r[0] && r[3] > r[1]);
            parent.postMessage(
                {
                    version: VERSION,
                    session,
                    type: 'overlay-layout',
                    rects,
                },
                origin,
            );
        };
        const schedule = () => {
            if (frame === null) frame = requestAnimationFrame(report);
        };
        const resize = new ResizeObserver(schedule);
        resize.observe(root);
        const changes = new MutationObserver(schedule);
        changes.observe(document.body, {
            subtree: true,
            attributes: true,
            childList: true,
        });
        window.addEventListener('resize', schedule);
        document.addEventListener('scroll', schedule, true);
        // The initially clipped frame may have RAF throttled until its first hit regions are reported.
        report();
        return () => {
            resize.disconnect();
            changes.disconnect();
            window.removeEventListener('resize', schedule);
            document.removeEventListener('scroll', schedule, true);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [origin, session]);
    return (
        <UIOverlayLayer mobile={isMobile} sidebarOpen={false}>
            <div className={overlayStyles.overlayContent}>
                <SwitchArea style={{ top: 'max(26%, 236px)' }}>
                    <div ref={host}>
                        <div ref={fonts} className='region-controls'>
                            <RegionMenu
                                currentRegionKey={region}
                                currentSubregionKey={subregion}
                                isSidebarOpen={false}
                                preparing={preparing}
                                onSelect={(key, sub) => {
                                    setPreparing(key);
                                    parent.postMessage(
                                        {
                                            version: VERSION,
                                            session,
                                            type: 'open-region',
                                            region: key,
                                            subregion:
                                                sub ??
                                                REGION_DICT[key].subregions[0],
                                        },
                                        origin,
                                    );
                                }}
                            />
                        </div>
                    </div>
                </SwitchArea>
            </div>
        </UIOverlayLayer>
    );
}
