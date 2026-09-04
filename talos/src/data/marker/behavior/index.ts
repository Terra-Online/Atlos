import behaviorManifest from './data/index.json';

type MapPoint = [number, number];
type StageMode = 'collinear' | 'branch' | 'multiline';
type SegmentPhase = 'group-entry' | 'group-members' | 'chest-entry';
type SegmentKind = 'solid' | 'dash';

export type BehaviorOverlay =
    | {
          kind: 'butterfly-path';
          anchorId: string;
          stages: Array<{
              center?: MapPoint;
              mode: StageMode;
              orderedPoints: Array<MapPoint>;
              lineGroups?: Array<Array<MapPoint>>;
          }>;
          targetPos?: MapPoint;
          segments: Array<{
              order: number;
              stageIndex: number;
              phase: SegmentPhase;
              kind: SegmentKind;
              points: Array<MapPoint>;
          }>;
      }
    | {
          kind: 'relation';
          anchorId: string;
          targetId: string;
          anchorPos: MapPoint;
          targetPos: MapPoint;
      }
    | {
          kind: 'unlock-group';
          anchorId: string;
          anchorPos: MapPoint;
          helpers: Array<{ pos: MapPoint }>;
      }
    | {
          kind: 'trajectory';
          anchorId: string;
          points: Array<MapPoint>;
          closed: boolean;
      };

type CompactLayout = {
    records: {
        relation: string;
        butterflyPath: string;
        unlockGroup: string;
        trajectory: string;
    };
    stageModes: Record<StageMode, number>;
};

type BehaviorManifest = { encoding: string; layout: CompactLayout };
type CompactBehaviorRecord = unknown[];
type BehaviorModule = { default: CompactBehaviorRecord[] };

const manifest = behaviorManifest as unknown as BehaviorManifest;
const layout = manifest.layout;

const codeFor = <T extends string>(
    table: Record<T, number>,
    value: unknown,
): T | null => {
    const entry = Object.entries(table).find(([, code]) => code === value);
    return entry ? (entry[0] as T) : null;
};

const decodeId = (value: unknown): string | null => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    return String(value);
};

const decodePoint = (value: unknown): MapPoint | null => {
    if (!Array.isArray(value) || value.length !== 2) return null;
    if (typeof value[0] !== 'number' || typeof value[1] !== 'number')
        return null;
    if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) return null;
    return [value[0], value[1]];
};

const decodePoints = (value: unknown): MapPoint[] | null => {
    if (!Array.isArray(value)) return null;
    const points: MapPoint[] = [];
    for (const item of value) {
        const point = decodePoint(item);
        if (!point) return null;
        points.push(point);
    }
    return points;
};

const decodeBehaviorRecord = (value: unknown): BehaviorOverlay | null => {
    if (!Array.isArray(value) || typeof value[0] !== 'string') return null;
    const recordCode = value[0];

    if (recordCode === layout.records.relation) {
        const anchorId = decodeId(value[1]);
        const targetId = decodeId(value[2]);
        const anchorPos = decodePoint(value[3]);
        const targetPos = decodePoint(value[4]);
        if (!anchorId || !targetId || !anchorPos || !targetPos) return null;
        return { kind: 'relation', anchorId, targetId, anchorPos, targetPos };
    }

    if (recordCode === layout.records.butterflyPath) {
        const anchorId = decodeId(value[1]);
        const leaderPos = decodePoint(value[2]);
        const targetPos = value[3] == null ? undefined : decodePoint(value[3]);
        if (
            !anchorId ||
            !leaderPos ||
            (value[3] != null && !targetPos) ||
            !Array.isArray(value[4])
        ) {
            return null;
        }

        const stages: Array<{
            center?: MapPoint;
            mode: StageMode;
            orderedPoints: Array<MapPoint>;
            lineGroups?: Array<Array<MapPoint>>;
        }> = [];
        for (const row of value[4]) {
            if (!Array.isArray(row) || row.length < 2) return null;
            const mode = codeFor(layout.stageModes, row[0]);
            if (!mode) return null;
            if (mode === 'multiline') {
                if (!Array.isArray(row[1]) || row[1].length < 2) return null;
                const lineGroups: Array<MapPoint[]> = [];
                for (const line of row[1]) {
                    const points = decodePoints(line);
                    if (!points || points.length < 2) return null;
                    lineGroups.push(points);
                }
                const orderedPoints = lineGroups.flat();
                stages.push({ orderedPoints, mode, lineGroups });
                continue;
            }
            const orderedPoints = decodePoints(row[1]);
            if (!orderedPoints || orderedPoints.length === 0) return null;
            const center = row.length > 2 ? decodePoint(row[2]) : undefined;
            if (row.length > 2 && !center) return null;
            if (mode === 'branch' && !center) return null;
            stages.push({
                orderedPoints,
                mode,
                ...(center ? { center } : {}),
            });
        }

        // Segment geometry is deterministic from the baked stage mode/order.
        // Rebuild it in memory instead of repeating every line wrapper in the
        // sidecar file.
        const segments: Array<{
            order: number;
            stageIndex: number;
            phase: SegmentPhase;
            kind: SegmentKind;
            points: Array<MapPoint>;
        }> = [];
        let current = leaderPos;
        let order = 0;
        const appendSegment = (
            stageIndex: number,
            phase: SegmentPhase,
            kind: SegmentKind,
            points: MapPoint[],
        ) => {
            if (points.length < 2) return;
            if (
                Math.hypot(
                    points[0][0] - points[points.length - 1][0],
                    points[0][1] - points[points.length - 1][1],
                ) <= 0.01
            ) {
                return;
            }
            segments.push({ order, stageIndex, phase, kind, points });
            order += 1;
        };
        stages.forEach((stage, stageIndex) => {
            if (stage.mode === 'collinear') {
                appendSegment(stageIndex, 'group-entry', 'solid', [
                    current,
                    stage.orderedPoints[0],
                ]);
                for (
                    let index = 1;
                    index < stage.orderedPoints.length;
                    index += 1
                ) {
                    appendSegment(stageIndex, 'group-members', 'dash', [
                        stage.orderedPoints[index - 1],
                        stage.orderedPoints[index],
                    ]);
                }
                current = stage.orderedPoints[stage.orderedPoints.length - 1];
                return;
            }
            if (stage.mode === 'multiline') {
                for (const line of stage.lineGroups ?? []) {
                    if (line.length < 2) continue;
                    appendSegment(stageIndex, 'group-entry', 'solid', [
                        current,
                        line[0],
                    ]);
                    for (let index = 1; index < line.length; index += 1) {
                        appendSegment(stageIndex, 'group-members', 'dash', [
                            line[index - 1],
                            line[index],
                        ]);
                    }
                    current = line[line.length - 1];
                }
                return;
            }
            const center = stage.center;
            if (!center) return;
            appendSegment(stageIndex, 'group-entry', 'solid', [
                current,
                center,
            ]);
            stage.orderedPoints.forEach((point) => {
                appendSegment(stageIndex, 'group-members', 'dash', [
                    center,
                    point,
                ]);
            });
            current = center;
        });
        if (targetPos) {
            appendSegment(stages.length, 'chest-entry', 'solid', [
                current,
                targetPos,
            ]);
        }

        return {
            kind: 'butterfly-path',
            anchorId,
            stages,
            ...(targetPos ? { targetPos } : {}),
            segments,
        };
    }

    if (recordCode === layout.records.unlockGroup) {
        const anchorId = decodeId(value[1]);
        const anchorPos = decodePoint(value[2]);
        const helperPoints = decodePoints(value[3]);
        if (
            !anchorId ||
            !anchorPos ||
            !helperPoints ||
            helperPoints.length !== 3
        )
            return null;
        return {
            kind: 'unlock-group',
            anchorId,
            anchorPos,
            helpers: helperPoints.map((pos) => ({ pos })),
        };
    }

    if (recordCode === layout.records.trajectory) {
        const anchorId = decodeId(value[1]);
        const points = decodePoints(value[2]);
        if (
            !anchorId ||
            !points ||
            points.length < 2 ||
            typeof value[3] !== 'boolean'
        )
            return null;
        return { kind: 'trajectory', anchorId, points, closed: value[3] };
    }

    return null;
};

const modules = import.meta.glob('./data/*.json') as Record<
    string,
    () => Promise<BehaviorModule>
>;
const loaded = new Map<string, BehaviorOverlay[]>();
const pending = new Map<string, Promise<BehaviorOverlay[]>>();

export const loadBehaviorForSubregion = async (
    subregionId: string,
): Promise<BehaviorOverlay[]> => {
    const cached = loaded.get(subregionId);
    if (cached) return cached;
    const loader = modules[`./data/${subregionId}.json`];
    if (!loader) {
        loaded.set(subregionId, []);
        return [];
    }
    const existing = pending.get(subregionId);
    if (existing) return existing;
    const request = loader()
        .then((module) => {
            const records = Array.isArray(module.default)
                ? module.default
                      .map(decodeBehaviorRecord)
                      .filter(
                          (record): record is BehaviorOverlay =>
                              record !== null,
                      )
                : [];
            loaded.set(subregionId, records);
            return records;
        })
        .finally(() => {
            // A transient chunk/network failure must not poison this key for
            // the lifetime of the page. A subsequent selection can retry.
            pending.delete(subregionId);
        });
    pending.set(subregionId, request);
    return request;
};

export const findBehaviorForMarker = async (
    subregionId: string,
    markerId: string,
): Promise<BehaviorOverlay[]> => {
    const records = await loadBehaviorForSubregion(subregionId);
    const normalizedId = String(markerId);
    const direct = records.filter((record) => {
        if (record.anchorId === normalizedId) return true;
        return record.kind === 'relation' && record.targetId === normalizedId;
    });
    // Relations are stored once with the butterfly as anchor. When a chest is
    // selected, include its butterfly route as well so the reverse interaction
    // renders the same complete animation as selecting the butterfly itself.
    const butterflyIds = new Set(
        direct
            .filter(
                (
                    record,
                ): record is Extract<BehaviorOverlay, { kind: 'relation' }> =>
                    record.kind === 'relation',
            )
            .map((record) => record.anchorId),
    );
    if (butterflyIds.size === 0) return direct;
    const directSet = new Set(direct);
    const paths = records.filter(
        (
            record,
        ): record is Extract<BehaviorOverlay, { kind: 'butterfly-path' }> =>
            record.kind === 'butterfly-path' &&
            butterflyIds.has(record.anchorId) &&
            !directSet.has(record),
    );
    return [...direct, ...paths];
};
