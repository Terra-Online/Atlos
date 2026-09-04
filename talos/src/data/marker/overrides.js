export const OVERRIDE_SCHEMA_VERSION = 1;
const UPDATE_FIELDS = new Set(['z', 'x', 'y', 'tier', 'type', 'subregId', 'pos']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizePosition = (marker) => {
    const z = marker.z ?? marker.pos?.[0] ?? 0;
    const x = marker.x ?? marker.pos?.[1] ?? 0;
    const y = marker.y ?? marker.pos?.[2] ?? 0;
    return { z, x, y, pos: [z, x] };
};

const normalizeMarker = (marker, fallbackSubregionId) => {
    if (!isObject(marker) || marker.id == null) return null;
    const markerFields = Object.fromEntries(Object.entries(marker).filter(([field]) => field !== 'op'));
    const position = normalizePosition(marker);
    return {
        ...markerFields,
        id: String(marker.id),
        ...position,
        tier: marker.tier ?? 0,
        subregId: marker.subregId ?? fallbackSubregionId,
        type: marker.type ?? '',
    };
};

const applyUpdate = (marker, entry) => {
    const next = { ...marker };
    if (entry.pos !== undefined) {
        if (!Array.isArray(entry.pos) || entry.pos.length < 2) {
            throw new Error(`Invalid override position for marker ${marker.id}`);
        }
        next.z = entry.pos[0];
        next.x = entry.pos[1];
    }
    for (const [field, value] of Object.entries(entry)) {
        if (field === 'id' || field === 'op' || field === 'pos') continue;
        next[field] = value;
    }
    const position = normalizePosition(next);
    return { ...next, ...position };
};

export const getManualOverridesForSubregion = (overrides, subregionId) =>
    (overrides ?? []).filter((entry) =>
        entry.op === 'add'
            ? subregionId === undefined || entry.subregId === subregionId
            : true,
    );

export const applyMarkerOverrides = (markers, overrides, { subregionId } = {}) => {
    const entries = getManualOverridesForSubregion(overrides, subregionId);
    const byId = new Map(markers.map((marker) => [String(marker.id), marker]));

    for (const entry of entries) {
        const id = String(entry.id ?? '');
        if (!id) continue;
        if (!entry.op || entry.op === 'update') {
            const marker = byId.get(id);
            if (marker) byId.set(id, applyUpdate(marker, entry));
        } else if (entry.op === 'delete') {
            byId.delete(id);
        } else if (entry.op === 'add') {
            byId.set(id, normalizeMarker(entry, subregionId));
        }
    }

    return [...byId.values()].filter(Boolean);
};

export const validateManualOverrides = (overrides, markers, typeMap, subregionIds) => {
    if (!Array.isArray(overrides)) {
        throw new Error(`Invalid marker override data: expected an array (schema v${OVERRIDE_SCHEMA_VERSION}).`);
    }
    const markerById = new Map(markers.map((marker) => [String(marker.id), marker]));
    const seen = new Set();
    for (const [index, entry] of overrides.entries()) {
        if (!isObject(entry)) throw new Error(`Override ${index + 1} is not an object.`);
        const id = String(entry.id ?? '');
        if (!id) throw new Error(`Override ${index + 1} has no id.`);
        if (seen.has(id)) throw new Error(`Duplicate marker override: ${id}`);
        seen.add(id);
        const operation = entry.op ?? 'update';
        if (!['update', 'delete', 'add'].includes(operation)) {
            throw new Error(`Override ${id} has unsupported operation: ${entry.op}`);
        }
        if (operation === 'update') {
            if (!markerById.has(id)) throw new Error(`Update target does not exist: ${id}`);
            if (Object.keys(entry).some((field) => !['id', 'op'].includes(field) && !UPDATE_FIELDS.has(field))) {
                throw new Error(`Update ${id} contains unsupported fields.`);
            }
            if (entry.pos !== undefined && (!Array.isArray(entry.pos) || entry.pos.length !== 2 || entry.pos.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) {
                throw new Error(`Update ${id} has an invalid pos.`);
            }
            for (const field of ['z', 'x', 'y', 'tier']) {
                if (entry[field] !== undefined && (typeof entry[field] !== 'number' || !Number.isFinite(entry[field]))) {
                    throw new Error(`Update ${id} has an invalid ${field}.`);
                }
            }
            if (entry.type !== undefined && (typeof entry.type !== 'string' || !typeMap[entry.type])) {
                throw new Error(`Update ${id} has an unknown type: ${entry.type}`);
            }
            if (entry.subregId !== undefined && (typeof entry.subregId !== 'string' || !subregionIds.has(entry.subregId))) {
                throw new Error(`Update ${id} has an unknown subregion: ${entry.subregId}`);
            }
        }
        if (operation === 'delete' && !markerById.has(id)) {
            throw new Error(`Delete target does not exist: ${id}`);
        }
        if (operation === 'add') {
            if (markerById.has(id)) throw new Error(`Added marker already exists: ${id}`);
            const marker = normalizeMarker(entry, entry.subregId);
            if (!marker || marker.id !== id) throw new Error(`Invalid added marker: ${id}`);
            if (!subregionIds.has(marker.subregId)) throw new Error(`Unknown add subregion: ${marker.subregId}`);
            if (!typeMap[marker.type]) throw new Error(`Unknown add marker type: ${marker.type}`);
        }
    }
};
