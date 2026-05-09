import type { IMarkerData } from '@/data/marker';

export const MARKER_PREVIEW_ENTER_EVENT = 'talos:PreviewEnter';
export const MARKER_PREVIEW_LEAVE_EVENT = 'talos:PreviewLeave';

export type PreviewEnterDetail = {
    marker: IMarkerData;
};

export type PreviewLeaveDetail = {
    markerId: string;
};

