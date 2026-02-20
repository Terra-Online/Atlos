import React, { useMemo } from 'react';
import classNames from 'classnames';

import styles from './regSwitch.module.scss';

import PopoverTooltip from '@/component/popover/popover';
import useRegion from '@/store/region';
import { useTranslateGame } from '@/locale';
import { REGION_DICT, SUBREGION_DICT } from '@/data/map';
import { useForceRegionSubOpen } from '@/store/uiPrefs';
import { useDevice } from '@/utils/device';

import Valley4 from '../../assets/logos/_Valley_4.svg?react';
import Wuling from '../../assets/logos/_Wuling.svg?react';
import Dijiang from '../../assets/logos/_Dijiang.svg?react';
import Weekraid1 from '../../assets/logos/_Weekraid_1.svg?react';

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
const getContainerStyle = (selectedIndex: number, hasLabel: boolean, isMobile) => {
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
    const regionIndex = useMemo(
        () => Object.keys(REGION_DICT).indexOf(currentRegionKey),
        [currentRegionKey],
    );
    return (
        <div
            className={classNames(
                styles.regswitch,
                isSidebarOpen && styles.sidebarOpen,
            )}
        >
             <div
                className={styles.regLabel}
            ></div>
            <div
                className={styles.indicator}
                style={getContainerStyle(regionIndex, true, isMobile)}
            ></div>
            {Object.entries(REGION_DICT).map(([key, region]) => {
                const Icon: React.FC = REGION_ICON_DICT[key];
                const regionCode = REGION_I18N_CODE[key] ?? key;
                const subRegionIndex = currentSubregionKey
                    ? region.subregions.indexOf(currentSubregionKey)
                    : -1;
                return (
                    <div
                        key={key}
                        className={classNames(
                            styles.regItem,
                            currentRegionKey === key && styles.selected,
                        )}
                        onClick={() => {
                            setCurrentRegion(key);
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={tGame(`region.${regionCode}.main`)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setCurrentRegion(key);
                            }
                        }}
                    >
                        <div className={styles.icon}>
                            <Icon />
                        </div>
                        {region.subregions.length > 1 && (
                            <div
                                className={classNames(styles.subregionSwitchContainer, {
                                    [styles.forceOpen]: forceRegionSubOpen && currentRegionKey === key,
                                })}
                                onClick={(e) => {
                                    e.stopPropagation();
                                }}
                            >
                                <div className={styles.subregionSwitch}>
                                    <div
                                        className={classNames(
                                            styles.indicator,
                                            subRegionIndex < 0 && styles.hidden,
                                        )}
                                        style={getContainerStyle(
                                            subRegionIndex, false, isMobile
                                        )}
                                    ></div>
                                    {region.subregions.map((subregion) => {
                                        const subKey = SUBREGION_DICT[subregion]?.name;
                                        const fullName = subKey ? tGame(`region.${regionCode}.sub.${subKey}.name`) : subregion;
                                        return (
                                            <PopoverTooltip
                                                key={subregion}
                                                content={fullName}
                                                placement="right"
                                            >
                                                <button
                                                    className={classNames(
                                                        styles.subregItem,
                                                        currentSubregionKey ===
                                                            subregion &&
                                                            styles.selected,
                                                    )}
                                                    onClick={() => {
                                                        requestSubregionSwitch(subregion);
                                                    }}
                                                    aria-label={fullName}
                                                >
                                                    <div className={styles.subregName}>
                                                        {(() => {
                                                            if (!subKey) return subregion;
                                                            const v = tGame(`region.${regionCode}.sub.${subKey}.short`);
                                                            return typeof v === 'string' && v.trim() ? v : subKey;
                                                        })()}
                                                    </div>
                                                </button>
                                            </PopoverTooltip>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export { RegionContainer };
