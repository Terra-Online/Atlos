import React, { useEffect, useRef, useState } from 'react';
import useRegion from '@/store/region';
import { preloadMapFonts } from '@/locale';
import { loadRegionMarkers } from '@/data/marker';
import { preloadMapTiles } from '@/services/map/preload';
import { RegionMenu } from '@/component/regionSwitch/regionSwitch';

const RegionContainer: React.FC<{
    isSidebarOpen: boolean;
}> = ({ isSidebarOpen }) => {
    const {
        currentRegionKey,
        currentSubregionKey,
        setCurrentRegion,
        requestSubregionSwitch,
    } = useRegion();
    const selection = useRef(0);
    const [preparing, setPreparing] = useState<string | null>(null);
    const tilePreload = useRef<{ key: string; cancel: () => void } | undefined>(undefined);
    const preloadRegion = (key: string) => {
        if (key === currentRegionKey) return;
        if (tilePreload.current?.key !== key) {
            tilePreload.current?.cancel();
            tilePreload.current = { key, cancel: preloadMapTiles(key) };
        }
        // These loaders own deduplication and the current locale. Do not let an
        // earlier hover suppress a retry or a newly selected language's fonts.
        const ready = Promise.all([loadRegionMarkers(key), preloadMapFonts(key)]);
        void ready.catch(() => undefined);
        return ready;
    };
    useEffect(() => {
        selection.current++;
        setPreparing(null);
    }, [currentRegionKey]);
    useEffect(() => () => { selection.current++; tilePreload.current?.cancel(); }, []);
    const selectRegion = (key: string, subregion?: string) => {
        const request = ++selection.current;
        if (key === currentRegionKey) {
            setPreparing(null);
            tilePreload.current?.cancel();
            tilePreload.current = undefined;
            if (subregion) requestSubregionSwitch(subregion);
            return;
        }
        setPreparing(key);
        // Keep the working map and its current controls until the destination
        // data and text are ready. Fast repeated taps can only commit the latest.
        void preloadRegion(key)?.then(() => {
            if (selection.current !== request) return;
            setPreparing(null);
            setCurrentRegion(key);
            if (subregion) requestSubregionSwitch(subregion);
        }, (error: unknown) => {
            if (selection.current !== request) return;
            setPreparing(null);
            console.warn('Region preparation failed:', error);
        });
    };
    return <RegionMenu
        currentRegionKey={currentRegionKey}
        currentSubregionKey={currentSubregionKey}
        isSidebarOpen={isSidebarOpen}
        preparing={preparing}
        onSelect={selectRegion}
        onPreload={(key) => { void preloadRegion(key); }}
    />;
};

export { RegionContainer };
export { SubregionSwitch } from '@/component/regionSwitch/regionSwitch';
export type { SubregionSwitchItem } from '@/component/regionSwitch/regionSwitch';
