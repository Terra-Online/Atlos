import IconButton from '@/component/button/IconButton';
import React, { useMemo } from 'react';
import styles from '@/pages/regSwitch/regSwitch.module.scss';
import { useCurrentLayer, useSetCurrentLayer, useLayerStore } from '@/store/layer';
import classNames from 'classnames';
import LayerIcon from '@/assets/images/UI/layer.svg?react';
import SatelliteIcon from '@/assets/images/UI/satellite.svg?react';
import { getAvailableLayers, hasSatelliteTiles } from '@/services/map/tileCoverage';
import { useForceLayerSubOpen } from '@/store/uiPrefs';
import useRegion from '@/store/region';
import { useDevice } from '@/platform/device';
import PopoverTooltip from '@/component/popover/popover';
import { useTranslateUI } from '@/locale';
import { useSwitchMenu } from '@/pages/regSwitch/useSwitchMenu';
import { usePresence } from '@/lib/dom/usePresence';

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
    const satellite = useLayerStore((state) => state.satellite);
    const setSatellite = useLayerStore((state) => state.setSatellite);
    const supportsSatellite = hasSatelliteTiles(currentRegionKey);
    const setCurrentLayer = useSetCurrentLayer();
    const forceLayerSubOpen = useForceLayerSubOpen();

    // Get available layers for current region
    const availableLayers = getAvailableLayers(currentRegionKey);
    const hasSubmenu = availableLayers.length > 1 || availableLayers[0] !== 'M';
    const menu = useSwitchMenu(hasSubmenu);
    const open = hasSubmenu && (menu.activeKey !== null || forceLayerSubOpen);
    const submenu = usePresence({ open, exitDuration: 200 });

    const layerIndex = useMemo(
        () => availableLayers.indexOf(currentLayer),
        [currentLayer, availableLayers],
    );

    // Regions with neither extra floors nor satellite imagery need no control.
    if (!hasSubmenu && !supportsSatellite) {
        return null;
    }

    return (
        <div
            ref={menu.ref}
            className={classNames(
                styles.regswitch,
                styles.layerswitch,
                isMobile && styles.mobile,
                isSidebarOpen && styles.sidebarOpen,
            )}
        >
            <div className={classNames(styles.regLabel, styles.layerLabel)}></div>
            {supportsSatellite && (
                <PopoverTooltip content={t('mapControls.satellite')} placement="left" disabled={isMobile || !isSidebarOpen}>
                    <div className={classNames(styles.regItem, satellite && currentLayer === 'M' && styles.selected)}>
                        <IconButton className={styles.mainAction} label={t('mapControls.satellite')} pressed={satellite && currentLayer === 'M'} onClick={() => setSatellite(!(satellite && currentLayer === 'M'))}>
                            <div className={styles.icon}><SatelliteIcon /></div>
                        </IconButton>
                    </div>
                </PopoverTooltip>
            )}
            {hasSubmenu && <PopoverTooltip
                content={t('mapControls.layerSelect')}
                placement="left"
                disabled={isMobile || !isSidebarOpen}
            >
                <div
                    {...menu.getItemProps('layers')}
                    className={classNames(
                        styles.regItem,
                        currentLayer !== 'M' && styles.selected,
                    )}
                >
                    <IconButton className={styles.mainAction} data-guide="layer-main-toggle" label={t('mapControls.layerSelect')} pressed={currentLayer !== 'M'} onClick={() => {
                        menu.open('layers');
                        setCurrentLayer('M');
                    }}>
                        <div className={styles.icon}><LayerIcon /></div>
                    </IconButton>
                    {submenu.present && (
                        <div
                            className={styles.subregionSwitchContainer}
                            data-state={submenu.phase}
                            inert={!open}
                            aria-hidden={!open}
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
                                            type="button"
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
                    )}
                </div>
            </PopoverTooltip>}
        </div>
    );
};

export { LayerSwitch };
