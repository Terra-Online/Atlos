import type L from 'leaflet';
import { getCoverageBounds } from './coverageBounds';

/** Share the camera's resting coverage boundary with the overdrag indicator. */
export const isMapOverdragged = (map: L.Map): boolean =>
    getCoverageBounds(map)?.isOverdragged() ?? false;
