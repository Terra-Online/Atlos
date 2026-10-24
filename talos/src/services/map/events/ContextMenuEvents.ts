import type { IMarkerData } from '@/data/marker';

export const MARKER_CONTEXT_MENU_EVENT = 'talos:markerContextMenu';

export type MarkerContextMenuPayload = {
    marker: IMarkerData;
    originalEvent: MouseEvent;
};
