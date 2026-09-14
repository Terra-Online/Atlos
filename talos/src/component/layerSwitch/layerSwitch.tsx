import React, { useMemo } from 'react';
import styles from '../regSwitch/regSwitch.module.scss';
import { useCurrentLayer, useSetCurrentLayer, type LayerType } from '@/store/layer';
import classNames from 'classnames';
import LayerIcon from '../../assets/images/UI/layer.svg?react';
import { useForceLayerSubOpen } from '@/store/uiPrefs';
import useRegion from '@/store/region';
import { REGION_DICT } from '@/data/map';
import { useDevice } from '@/platform/device';
import PopoverTooltip from '@/component/popover/popover';
import { useTranslateUI } from '@/locale';

const PREDEFINED_LAYER_ORDER: LayerType[] = ['L4', 'L3', 'L2', 'L1', 'M', 'B1', 'B2', 'B3', 'B4'];

const getContainerStyle = (selectedIndex: number, isMobile: boolean) => {
    if (selectedIndex < 0) return {};

    const itemHeight = 2.5; // rem
    const itemGap = 0.6; // rem
    const mobileItemHeight = 2.25; // rem
    const mobileItemGap = 0.4; // rem

    const top = isMobile
        ? selectedIndex * (mobileItemHeight + mobileItemGap) + mobileItemHeight / 2
        : selectedIndex * (itemHeight + itemGap) + itemHeight / 2;

    return {
        transform: `translateY(calc(${top}rem - 50%))`,
    };
};

const LayerSwitch: React.FC<{
    isSidebarOpen: boolean;
}> = ({ isSidebarOpen }) => {
    const { isMobile } = useDevice();
    const t = useTranslateUI();
    const { currentRegionKey } = useRegion();
    const currentLayer = useCurrentLayer();
    const setCurrentLayer = useSetCurrentLayer();
    const forceLayerSubOpen = useForceLayerSubOpen();

    // Get available layers for current region
    const availableLayers = useMemo(() => {
        const region = REGION_DICT[currentRegionKey];
        const layers = region?.layers as LayerType[] | undefined;
        if (!layers || layers.length === 0) return ['M'] as LayerType[];

        // Filter and sort based on PREDEFINED_LAYER_ORDER to maintain consistent order
        return PREDEFINED_LAYER_ORDER.filter(l => l === 'M' || layers.includes(l));
    }, [currentRegionKey]);

    const layerIndex = useMemo(
        () => availableLayers.indexOf(currentLayer),
        [currentLayer, availableLayers],
    );

    // If only M layer is available (or no layers configured), hide the switcher
    if (availableLayers.length <= 1 && availableLayers[0] === 'M') {
        return null;
    }

    return (
        <div
            className={classNames(
                styles.regswitch,
                styles.layerswitch,
                isMobile && styles.mobile,
                isSidebarOpen && styles.sidebarOpen,
            )}
        >
            <div className={classNames(styles.regLabel, styles.layerLabel)}></div>
            <PopoverTooltip
                content={t('mapControls.layerSelect')}
                placement="left"
                disabled={isMobile || !isSidebarOpen}
            >
                <div
                    className={classNames(
                        styles.regItem,
                        currentLayer !== 'M' && styles.selected,
                    )}
                    data-guide='layer-main-toggle'
                    role="button"
                    tabIndex={0}
                    aria-label={t('mapControls.layerSelect')}
                    onClick={() => {
                        if (currentLayer !== 'M') {
                            setCurrentLayer('M');
                        }
                    }}
                >
                    <div className={styles.icon}>
                        <LayerIcon />
                    </div>
                    <div
                        className={classNames(styles.subregionSwitchContainer, {
                            [styles.forceOpen]: forceLayerSubOpen,
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
                                style={getContainerStyle(layerIndex, isMobile)}
                            ></div>
                            {availableLayers.map((layer) => {
                                return (
                                    <button
                                        key={layer}
                                        className={classNames(
                                            styles.subregItem,
                                            currentLayer === layer && styles.selected,
                                        )}
                                        data-guide='layer-switch-item'
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
            </PopoverTooltip>
        </div>
    );
};

export { LayerSwitch };
