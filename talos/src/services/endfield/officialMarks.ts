import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import { replacePointProgressFromExternal } from '@/store/history';
import { getEFOfficialMarks } from './backendClient';

export type OfficialMarksImportResult = {
    imported: number;
    alreadyImported: number;
    unresolved: number;
};

export type OfficialMarksSnapshot = {
    localPointIds: string[];
    officialPointIds: string[];
    localUpdatedAt: number;
    officialUpdatedAt: string | null;
    unresolved: number;
};

export const loadOfficialMarksSnapshot = async (): Promise<OfficialMarksSnapshot> => {
    const response = await getEFOfficialMarks();
    return {
        localPointIds: [...useUserRecordStore.getState().activePoints],
        officialPointIds: [...new Set(response.pointIds.map((id) => String(id)).filter(Boolean))],
        localUpdatedAt: useUserRecordStore.getState().updatedAt,
        officialUpdatedAt: response.timestamp ?? null,
        unresolved: Math.max(0, response.markedIds.length - response.pointIds.length),
    };
};

export const hasOfficialMarksConflict = (snapshot: OfficialMarksSnapshot): boolean => {
    const local = new Set(snapshot.localPointIds);
    const official = new Set(snapshot.officialPointIds);
    if (local.size !== official.size) return true;
    return [...official].some((id) => !local.has(id));
};

export const applyOfficialMarks = (
    pointIds: string[],
    unresolved = 0,
): OfficialMarksImportResult => {
    const normalized = [...new Set(pointIds.map((id) => String(id)).filter(Boolean))];
    const existing = new Set(useUserRecordStore.getState().activePoints);
    const importedPointIds = normalized.filter((id) => !existing.has(id));
    const markerStore = useMarkerStore.getState();

    replacePointProgressFromExternal(normalized);
    normalized.forEach((id) => {
        markerStore.setSelected(id, true);
    });

    return {
        imported: importedPointIds.length,
        alreadyImported: normalized.length - importedPointIds.length,
        unresolved,
    };
};

export const importOfficial = async (): Promise<OfficialMarksImportResult> => {
    const snapshot = await loadOfficialMarksSnapshot();
    return applyOfficialMarks(snapshot.officialPointIds, snapshot.unresolved);
};
