import React, { useMemo } from 'react';
import styles from '../regSwitch/regSwitch.module.scss';
import { useCurrentLayer, useSetCurrentLayer, type LayerType } from '@/store/layer';
import classNames from 'classnames';
import LayerIcon from '../../assets/images/UI/layer.svg?react';
import { useForceSubregionOpen } from '@/store/uiPrefs';

const LAYER_ORDER: LayerType[] = ['L3', 'L2', 'L1', 'M', 'B1', 'B2', 'B3', 'B4'];

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

const LayerSwitch: React.FC<{
    isSidebarOpen: boolean;
}> = ({ isSidebarOpen }) => {
    const currentLayer = useCurrentLayer();
    const setCurrentLayer = useSetCurrentLayer();
    const forceSubregionOpen = useForceSubregionOpen();

    const layerIndex = useMemo(
        () => LAYER_ORDER.indexOf(currentLayer),
        [currentLayer],
    );

    return (
        <div
            className={classNames(
                styles.regswitch,
                styles.layerswitch,
                isSidebarOpen && styles.sidebarOpen,
            )}
        >
            <div className={classNames(styles.regLabel, styles.layerLabel)}></div>
            <div
                className={styles.indicator}
                style={getContainerStyle(0, true)}
            ></div>
            <div
                className={classNames(
                    styles.regItem,
                    styles.selected,
                )}
                role="button"
                tabIndex={0}
                aria-label="Layer switcher"
            >
                <div className={styles.icon}>
                    <LayerIcon />
                </div>
                <div
                    className={classNames(styles.subregionSwitchContainer, {
                        [styles.forceOpen]: forceSubregionOpen,
                    })}
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                >
                    <div className={styles.subregionSwitch}>
                        <div
                            className={classNames(
                                styles.indicator,
                                layerIndex < 0 && styles.hidden,
                            )}
                            style={getContainerStyle(layerIndex, false)}
                        ></div>
                        {LAYER_ORDER.map((layer) => {
                            return (
                                <button
                                    key={layer}
                                    className={classNames(
                                        styles.subregItem,
                                        currentLayer === layer && styles.selected,
                                    )}
                                    onClick={() => {
                                        setCurrentLayer(layer);
                                    }}
                                    aria-label={`Layer ${layer}`}
                                >
                                    <div className={styles.subregName}>{layer}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export { LayerSwitch };
