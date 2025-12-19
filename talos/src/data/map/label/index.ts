import raw from './labels.json';
import type { AnyLabel, LabelDataV1 } from './types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const isPoint = (v: unknown): v is [number, number] =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';

const isLabel = (v: unknown): v is AnyLabel => {
    if (!isObject(v)) return false;
    if (typeof v.id !== 'string') return false;
    if (v.type !== 'sub' && v.type !== 'site') return false;
    if (typeof v.region !== 'string') return false;
    if (typeof v.sub !== 'string') return false;
    if (!isPoint(v.point)) return false;
    if (v.type === 'site' && typeof v.site !== 'string') return false;
    return true;
};

const sanitize = (data: unknown): LabelDataV1 => {
    if (!isObject(data)) return { version: 1, regions: {} };
    if (data.version !== 1) return { version: 1, regions: {} };
    if (!isObject(data.regions)) return { version: 1, regions: {} };

    const out: LabelDataV1 = { version: 1, regions: {} };
    for (const [region, bucket] of Object.entries(data.regions)) {
        if (!isObject(bucket) || !isObject(bucket.labels)) continue;
        const labels: Record<string, AnyLabel> = {};
        for (const [id, label] of Object.entries(bucket.labels)) {
            if (isLabel(label)) labels[id] = label;
        }
        out.regions[region] = { labels };
    }
    return out;
};

export const getLabelData = (): LabelDataV1 => {
    const data: unknown = raw;
    return sanitize(data);
};

export const getLabelsForRegion = (region: string): AnyLabel[] => {
    const data = getLabelData();
    const bucket = data.regions[region];
    if (!bucket || !bucket.labels) return [];
    return Object.values(bucket.labels);
};

export const serializeLabelData = (data: LabelDataV1): string => {
    return JSON.stringify(data, null, 2) + '\n';
};

export const tryParseLabelData = (text: string): LabelDataV1 | null => {
    try {
        const parsed: unknown = JSON.parse(text);
        const out = sanitize(parsed);
        // Reject totally-empty parses unless the input actually represents version 1
        if (!isObject(parsed) || parsed.version !== 1) return null;
        return out;
    } catch {
        return null;
    }
};

// Merge strategy: per-label-id last-write-wins from incoming over base.
// This makes it easy to re-import / merge across branches.
export const mergeLabelData = (base: LabelDataV1, incoming: LabelDataV1): LabelDataV1 => {
    const out: LabelDataV1 = { version: 1, regions: { ...base.regions } };

    for (const [region, incomingBucket] of Object.entries(incoming.regions)) {
        const baseBucket = out.regions[region];
        const mergedLabels: Record<string, AnyLabel> = {
            ...(baseBucket?.labels ?? {}),
            ...(incomingBucket?.labels ?? {}),
        };
        out.regions[region] = { labels: mergedLabels };
    }

    return out;
};
