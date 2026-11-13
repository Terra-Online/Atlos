import type { IMarkerType } from '@/data/marker';
import { getItemIconUrl, getMarkerSubIconUrl } from '@/services/assets/resource';
import { SceneIcon } from '@/services/map/core/canvas/markerModel';

/** Shared artwork and anchors for the main map and passive preview minimap. */
export const createMarkerIcon = (type: IMarkerType): SceneIcon =>
    new SceneIcon({
        image: getItemIconUrl(type.subIcon ? type.key : type.icon ?? type.key),
        subImage: type.subIcon ? getMarkerSubIconUrl(type.subIcon) : '',
        noFrame: !!type.noFrame && !type.subIcon,
        tier: '',
    }, type.key);
