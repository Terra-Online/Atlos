import React, { useMemo } from 'react';
import styles from './regSwitch.module.scss';
import useRegion from '@/store/region';
import { REGION_DICT } from '@/data/map';
import classNames from 'classnames';

import Valley4 from '../../assets/logos/_Valley_4.svg?react';
import Jinlong from '../../assets/logos/_Jinlong.svg?react';
import Dijiang from '../../assets/logos/_Dijiang.svg?react';
import Æther from '../../assets/logos/Æther.svg?react';

const REGION_ICON_DICT = {
    Valley_4: Valley4,
    Jinlong: Jinlong,
    Dijiang: Dijiang,
    Æther: Æther,
};

const getContainerStyle = (selectedIndex: number) => {
    if (selectedIndex < 0) return {};

    const itemHeight = 2.5; // rem
    const itemGap = 0.6; // rem

    const top = selectedIndex * (itemHeight + itemGap) + itemHeight / 2;
    return {
        transform: `translateY(calc(${top}rem - 50%))`,
    };
};

const RegionContainer: React.FC<{
    isSidebarOpen: boolean;
}> = ({ isSidebarOpen }) => {
    const {
        currentRegionKey,
        currentSubregionKey,
        setCurrentRegion,
        requestSubregionSwitch,
    } = useRegion();
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
                className={styles.indicator}
                style={getContainerStyle(regionIndex)}
            ></div>
            {Object.entries(REGION_DICT).map(([key, region]) => {
                const Icon = REGION_ICON_DICT[key as keyof typeof REGION_ICON_DICT];
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
                                className={styles.subregionSwitchContainer}
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
                                            subRegionIndex,
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
                                        ></div>
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
