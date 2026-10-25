import IconButton from '@/component/button/IconButton';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';

import styles from '@/pages/regSwitch/regSwitch.module.scss';

import PopoverTooltip from '@/component/popover/popover';
import useRegion from '@/store/region';
import { preloadMapFonts, useTranslateGame } from '@/locale';
import { REGION_DICT, SUBREGION_DICT } from '@/data/map';
import { useForceRegionSubOpen } from '@/store/uiPrefs';
import { useDevice } from '@/platform/device';
import { useSwitchMenu } from './useSwitchMenu';
import { loadRegionMarkers } from '@/data/marker';
import { preloadMapTiles } from '@/services/map/preload';
import { usePresence } from '@/lib/dom/usePresence';

import Valley4 from '@/assets/logos/_Valley_4.svg?react';
import Wuling from '@/assets/logos/_Wuling.svg?react';
import Dijiang from '@/assets/logos/_Dijiang.svg?react';
import Weekraid1 from '@/assets/logos/_Weekraid_1.svg?react';

const REGION_ICON_DICT: Record<string, React.FC> = {
    Valley_4: Valley4,
    Wuling: Wuling,
    Dijiang: Dijiang,
    Weekraid_1: Weekraid1,
};

// i18n region code mapping (locale/data/region/*.json)
const REGION_I18N_CODE: Record<string, string> = {
    Valley_4: 'VL',
    Wuling: 'WL',
    Dijiang: 'DJ',
    Weekraid_1: 'ES',
};
const getContainerStyle = (selectedIndex: number, hasLabel: boolean, isMobile: boolean) => {
    if (selectedIndex < 0) return {};

    const itemHeight = 2.5; // rem
    const itemGap = 0.6; // rem
    const labelHeight = itemHeight / 2.25; // rem

    const mobileItemHeight = 2.25; // rem
    const mobileItemGap = 0.4;
    const mobileLabelHeight = mobileItemHeight / 2.25; // rem


    const top = isMobile ? selectedIndex * (mobileItemHeight + mobileItemGap) + (hasLabel ? mobileItemHeight / 2 + mobileLabelHeight + mobileItemGap : mobileItemHeight / 2) : selectedIndex * (itemHeight + itemGap) + (hasLabel ? itemHeight / 2 + labelHeight + itemGap : itemHeight / 2);
    return {
        transform: `translateY(calc(${top}rem - 50%))`,
    };
};

type SubregionSwitchItem = {
    key: string;
    label?: React.ReactNode;
    icon?: React.FC<React.SVGProps<SVGSVGElement>>;
    selected?: boolean;
    tooltip?: React.ReactNode;
    ariaLabel?: string;
    onClick: () => void;
};

interface SubregionSwitchProps {
    open: boolean;
    items: SubregionSwitchItem[];
    selectedIndex?: number;
    showIndicator?: boolean;
    isMobile?: boolean;
}

const SubregionSwitch: React.FC<SubregionSwitchProps> = ({
    open,
    items,
    selectedIndex = -1,
    showIndicator = true,
    isMobile = false,
}) => {
    const { present, phase } = usePresence({ open, exitDuration: 200 });
    if (!present) return null;
    return (
        <div
            className={styles.subregionSwitchContainer}
            data-state={phase}
            inert={!open}
            aria-hidden={!open}
            onClick={(e) => {
                e.stopPropagation();
            }}
        >
            <div className={styles.subregionSwitch}>
                {showIndicator && (
                    <div
                        className={classNames(
                            styles.indicator,
                            selectedIndex < 0 && styles.hidden,
                        )}
                        style={getContainerStyle(selectedIndex, false, isMobile)}
                    ></div>
                )}
                {items.map((item) => {
                    const Icon = item.icon;
                    const button = (
                        <button
                            className={classNames(
                                styles.subregItem,
                                item.selected && styles.selected,
                            )}
                            onClick={item.onClick}
                            aria-label={item.ariaLabel}
                            type="button"
                        >
                            {Icon ? (
                                <div className={styles.subregIcon}>
                                    <Icon />
                                </div>
                            ) : (
                                <div className={styles.subregName}>{item.label}</div>
                            )}
                        </button>
                    );

                    if (!item.tooltip) {
                        return <React.Fragment key={item.key}>{button}</React.Fragment>;
                    }

                    return (
                        <PopoverTooltip
                            key={item.key}
                            content={item.tooltip}
                            placement="right"
                        >
                            {button}
                        </PopoverTooltip>
                    );
                })}
            </div>
        </div>
    );
};

const RegionContainer: React.FC<{
    isSidebarOpen: boolean;
}> = ({ isSidebarOpen }) => {
    const tGame = useTranslateGame();
    const { isMobile } = useDevice();
    const {
        currentRegionKey,
        currentSubregionKey,
        setCurrentRegion,
        requestSubregionSwitch,
    } = useRegion();
    const forceRegionSubOpen = useForceRegionSubOpen();
    const menu = useSwitchMenu();
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
        menu.open(key);
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
    const openRegionKey = menu.activeKey ?? (forceRegionSubOpen ? currentRegionKey : null);
    const regionIndex = useMemo(
        () => Object.keys(REGION_DICT).indexOf(currentRegionKey),
        [currentRegionKey],
    );
    return (
        <div
            ref={menu.ref}
            className={classNames(
                styles.regswitch,
                isMobile && styles.mobile,
                isSidebarOpen && styles.sidebarOpen,
            )}
        >
            <div className={styles.regLabel}></div>
            <div
                className={styles.indicator}
                style={getContainerStyle(regionIndex, true, isMobile)}
            ></div>
            {Object.entries(REGION_DICT).map(([key, region]) => {
                const Icon: React.FC = REGION_ICON_DICT[key];
                const regionCode = REGION_I18N_CODE[key] ?? key;
                const regionName = tGame(`region.${regionCode}.main`);
                const subRegionIndex = currentSubregionKey
                    ? region.subregions.indexOf(currentSubregionKey)
                    : -1;
                return (
                    <PopoverTooltip
                        key={key}
                        content={regionName}
                        placement="left"
                        disabled={isMobile || !isSidebarOpen}
                    >
                        <div
                            {...menu.getItemProps(key)}
                            className={classNames(
                                styles.regItem,
                                currentRegionKey === key && styles.selected,
                                preparing === key && styles.preparing,
                            )}
                        >
                            <IconButton
                                className={styles.mainAction}
                                label={regionName}
                                pressed={currentRegionKey === key}
                                aria-busy={preparing === key}
                                onPointerEnter={() => { void preloadRegion(key); }}
                                onFocus={() => { void preloadRegion(key); }}
                                onPointerDown={() => { void preloadRegion(key); }}
                                onClick={() => selectRegion(key)}
                            >
                                <div className={styles.icon}><Icon /></div>
                            </IconButton>
                            {region.subregions.length > 1 && (
                                <SubregionSwitch
                                    open={openRegionKey === key}
                                    selectedIndex={subRegionIndex}
                                    isMobile={isMobile}
                                    items={region.subregions.map((subregion) => {
                                        const subKey = SUBREGION_DICT[subregion]?.name;
                                        const fullName = subKey ? tGame(`region.${regionCode}.sub.${subKey}.name`) : subregion;
                                        const shortName = (() => {
                                            if (!subKey) return subregion;
                                            const v = tGame(`region.${regionCode}.sub.${subKey}.short`);
                                            return typeof v === 'string' && v.trim() ? v : subKey;
                                        })();

                                        return {
                                            key: subregion,
                                            label: shortName,
                                            selected: currentSubregionKey === subregion,
                                            tooltip: fullName,
                                            ariaLabel: fullName,
                                            onClick: () => {
                                                selectRegion(key, subregion);
                                            },
                                        };
                                    })}
                                />
                            )}
                        </div>
                    </PopoverTooltip>
                );
            })}
        </div>
    );
};

export { RegionContainer, SubregionSwitch };
export type { SubregionSwitchItem };
