import React, { useMemo } from 'react';
import styles from './regSwitch.module.scss';
import useRegion from '@/store/region';
import { REGION_DICT, SUBREGION_DICT } from '@/data/map';
import classNames from 'classnames';

import Valley4 from '../../assets/logos/_Valley_4.svg?react';
import Wuling from '../../assets/logos/_Wuling.svg?react';
import Dijiang from '../../assets/logos/_Dijiang.svg?react';
import Æther from '../../assets/logos/Æther.svg?react';
import { useForceSubregionOpen } from '@/store/uiPrefs';
import { useTranslateGame } from '@/locale';

const REGION_ICON_DICT: Record<string, React.FC> = {
    Valley_4: Valley4,
    Wuling: Wuling,
    Dijiang: Dijiang,
    Æther: Æther,
};

// i18n region code mapping (locale/data/region/*.json)
const REGION_I18N_CODE: Record<string, string> = {
    Valley_4: 'VL',
    Wuling: 'WL',
    Dijiang: 'DJ',
};

const getContainerStyle = (selectedIndex: number, hasLabel: boolean) => {
    if (selectedIndex < 0) return {};

    const itemHeight = 2.5; // rem
    const itemGap = 0.6; // rem
    const labelHeight = itemHeight / 2.25; // rem

    const top = selectedIndex * (itemHeight + itemGap) + (hasLabel ? itemHeight / 2 + labelHeight + itemGap : itemHeight / 2);
    return {
        transform: `translateY(calc(${top}rem - 50%))`,
    };
};

const RegionContainer: React.FC<{
    isSidebarOpen: boolean;
}> = ({ isSidebarOpen }) => {
    const tGame = useTranslateGame();
    const {
        currentRegionKey,
        currentSubregionKey,
        setCurrentRegion,
        requestSubregionSwitch,
    } = useRegion();
    const forceSubregionOpen = useForceSubregionOpen();
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
                style={getContainerStyle(regionIndex, true)}
            ></div>
            {Object.entries(REGION_DICT).map(([key, region]) => {
                const Icon: React.FC = REGION_ICON_DICT[key];
                const regionCode = REGION_I18N_CODE[key] ?? key;
                const subRegionIndex = currentSubregionKey
                    ? region.subregions.indexOf(currentSubregionKey)
                    : -1;
                return (
                    <button
                        key={key}
                        className={classNames(
                            styles.regItem,
                            currentRegionKey === key && styles.selected,
                        )}
                        onClick={() => {
                            setCurrentRegion(key);
                        }}
                    >
                        <div className={styles.icon}>
                            <Icon />
                        </div>
                        {region.subregions.length > 1 && (
                            <div
                                className={classNames(styles.subregionSwitchContainer, {
                                    [styles.forceOpen]: forceSubregionOpen && currentRegionKey === key,
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
                                            subRegionIndex, false
                                        )}
                                    ></div>
                                    {region.subregions.map((subregion) => (
                                        <div
                                            key={subregion}
                                            className={classNames(
                                                styles.subregItem,
                                                currentSubregionKey ===
                                                    subregion &&
                                                    styles.selected,
                                            )}
                                            onClick={() => {
                                                requestSubregionSwitch(subregion);
                                            }}
                                        >
                                            <div className={styles.subregName}>
                                                {(() => {
                                                    const subKey = SUBREGION_DICT[subregion]?.name;
                                                    if (!subKey) return subregion;
                                                    const v = tGame(`region.${regionCode}.sub.${subKey}.short`);
                                                    return typeof v === 'string' && v.trim() ? v : subKey;
                                                })()}
                                            </div> 
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export { RegionContainer };
