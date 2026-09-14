export type ProgressPointBaseline = {
    pointIds: string[];
    retainedPointIds?: string[];
};

export const normalizePointIds = (pointIds: string[]): string[] =>
    [...new Set(pointIds.map((pointId) => String(pointId).trim()).filter(Boolean))];

export const arePointSetsEqual = (first: string[], second: string[]): boolean => {
    const firstSet = new Set(normalizePointIds(first));
    const secondSet = new Set(normalizePointIds(second));
    return firstSet.size === secondSet.size && [...secondSet].every((pointId) => firstSet.has(pointId));
};

export const buildPointPatch = (basePointIds: string[], nextPointIds: string[]): {
    setPointIds: string[];
    clearPointIds: string[];
} => {
    const baseSet = new Set(normalizePointIds(basePointIds));
    const nextSet = new Set(normalizePointIds(nextPointIds));
    return {
        setPointIds: [...nextSet].filter((pointId) => !baseSet.has(pointId)),
        clearPointIds: [...baseSet].filter((pointId) => !nextSet.has(pointId)),
    };
};

export const splitByKnownPointIds = (pointIds: string[], knownPointIds: Set<string>): {
    known: string[];
    unknown: string[];
} => {
    const known: string[] = [];
    const unknown: string[] = [];
    for (const pointId of normalizePointIds(pointIds)) {
        (knownPointIds.has(pointId) ? known : unknown).push(pointId);
    }
    return { known, unknown };
};

export const getUnacknowledgedRetainedPointIds = (pointIds: string[], retainedPointIds: string[] = []): string[] => {
    const acknowledged = new Set(normalizePointIds(retainedPointIds));
    return normalizePointIds(pointIds).filter((pointId) => !acknowledged.has(pointId));
};

export const areLocalPointsSynced = (localPointIds: string[], baseline: ProgressPointBaseline | null): boolean => {
    if (!baseline) return false;
    const visible = new Set(normalizePointIds(baseline.pointIds));
    const retained = new Set(normalizePointIds(baseline.retainedPointIds ?? [])
        .filter((pointId) => !visible.has(pointId)));
    return arePointSetsEqual(localPointIds.filter((pointId) => !retained.has(String(pointId).trim())), baseline.pointIds);
};

export const acknowledgeRetainedPointIds = (
    returnedPointIds: string[] | undefined,
    previousPointIds: string[],
    sentPointIds: string[],
): string[] => normalizePointIds(returnedPointIds ?? [...previousPointIds, ...sentPointIds]);
