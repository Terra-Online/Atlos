import { useLayerStore } from '@/store/layer';

const SATELLITE_HOSTS = new Set([
    'satellite.oem.re',
    'satellite.opendfieldmap.org',
    'satellite.opendfieldmap.cn',
]);

/** Apply entry defaults before warming tiles or constructing the first map. */
export const applyMapEntry = (location: Pick<Location, 'hostname' | 'pathname'>): void => {
    if (SATELLITE_HOSTS.has(location.hostname.toLowerCase().replace(/\.$/, ''))
        || /^\/satellite(?:\/|$)/.test(location.pathname)) {
        useLayerStore.getState().setSatellite(true);
    }
};
