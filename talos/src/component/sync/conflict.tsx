import React, { useEffect, useMemo, useState } from 'react';
import Modal from '@/component/modal/modal';
import { AccessButton } from '@/component/login/access';
import { REGION_DICT, SUBREGION_DICT } from '@/data/map';
import { loadAllMarkers, type IMarkerData } from '@/data/marker';
import { useLocale, useTranslateGame, useTranslateUI } from '@/locale';
import { formatAbsoluteTime, formatRelativeTime, parseTimestamp } from '@/lib/format/time';
import ConflictIcon from '@/assets/logos/conflict.svg?react';
import styles from './conflict.module.scss';

export type SyncConflictSource = {
    side: 'local' | 'remote';
    remoteSource?: 'official' | 'oemDb';
    updatedAt?: number | string | null;
    pointIds: string[];
    archiveIds?: string[];
};

export type SyncConflictChoice = 'a' | 'b' | 'merge';

interface SyncConflictModalProps {
    open: boolean;
    sourceA: SyncConflictSource;
    sourceB: SyncConflictSource;
    onResolve: (choice: SyncConflictChoice) => void;
    onClose: () => void;
    archiveLabel?: string;
    totalLabel?: string;
}

type SubregionCounts = Record<string, number>;

const formatTime = (value: SyncConflictSource['updatedAt'], fallback: string, locale: string): string => {
    const date = parseTimestamp(value);
    if (!date) return fallback;
    const absolute = formatAbsoluteTime(date, { locale, precision: 'dateTime' });
    return `${absolute} (${formatRelativeTime(date, { locale })})`;
};

const REGION_CODE_MAP: Record<string, string> = {
    Valley_4: 'VL',
    Wuling: 'WL',
    Dijiang: 'DJ',
    Weekraid_1: 'ES',
};

const getRegionForMarker = (marker: IMarkerData): string => {
    const entry = Object.entries(REGION_DICT).find(([, region]) => region.subregions.includes(marker.subregId));
    return entry?.[0] ?? marker.subregId;
};

const countBySubregion = (pointIds: string[], markers: IMarkerData[]): SubregionCounts => {
    const pointSet = new Set(pointIds.map(String));
    return markers.reduce<SubregionCounts>((acc, marker) => {
        if (!pointSet.has(marker.id)) return acc;
        acc[marker.subregId] = (acc[marker.subregId] ?? 0) + 1;
        return acc;
    }, {});
};

const getSubregionLabel = (
    subregionId: string,
    tGame: (key: string) => unknown,
): string => {
    const regionKey = getRegionForMarker({ id: '', z: 0, x: 0, y: 0, tier: 0, pos: [0, 0], type: '', subregId: subregionId });
    const regionCode = REGION_CODE_MAP[regionKey] ?? regionKey;
    const subKey = SUBREGION_DICT[subregionId]?.name;
    let sub: unknown;

    if (subKey) {
        sub = tGame(`region.${regionCode}.sub.${subKey}.name`);
    }
    if (typeof sub !== 'string' || !sub.trim()) {
        const fallback: Record<string, string> = {
            WL_5: 'region.WL.sub.TA.name',
            DJ_1: 'region.DJ.sub.name',
        };
        sub = fallback[subregionId] ? tGame(fallback[subregionId]) : undefined;
    }

    const subText = typeof sub === 'string' && sub.trim() ? sub : subregionId;
    return `${subText}`;
};

const sourceLabel = (source: SyncConflictSource, t: (key: string) => string): string => {
    if (source.side === 'local') return t('sync.conflict.local');
    const remote = source.remoteSource === 'official'
        ? t('sync.conflict.official')
        : t('sync.conflict.oemDb');
    return `${t('sync.conflict.remote')}-${remote}`;
};

const sourceShortLabel = (source: SyncConflictSource, t: (key: string) => string): string => (
    source.side === 'local' ? t('sync.conflict.local') : t('sync.conflict.remote')
);

const RegionCountTable: React.FC<{
    subregions: string[];
    aCounts: SubregionCounts;
    bCounts: SubregionCounts;
    aLabel: string;
    bLabel: string;
    regionLabel: string;
    tGame: (key: string) => unknown;
    archiveRow?: { label: string; aCount: number; bCount: number };
}> = ({ subregions, aCounts, bCounts, aLabel, bLabel, regionLabel, tGame, archiveRow }) => (
    <div className={styles.tableFrame}>
        <div className={styles.regionTable}>
            <div className={styles.regionHeader}>{regionLabel}</div>
            <div className={styles.regionHeader}>{aLabel}</div>
            <div className={styles.regionHeader}>{bLabel}</div>
            {subregions.map((subregion) => {
                const aCount = aCounts[subregion] ?? 0;
                const bCount = bCounts[subregion] ?? 0;
                return (
                    <React.Fragment key={subregion}>
                        <div className={styles.regionName}>{getSubregionLabel(subregion, tGame)}</div>
                        <div className={styles.regionCount} data-strong={aCount > bCount ? 'true' : undefined}>{aCount}</div>
                        <div className={styles.regionCount} data-strong={bCount > aCount ? 'true' : undefined}>{bCount}</div>
                    </React.Fragment>
                );
            })}
            {archiveRow && (
                <>
                    <div className={styles.regionName}>{archiveRow.label}</div>
                    <div className={styles.regionCount} data-strong={archiveRow.aCount > archiveRow.bCount ? 'true' : undefined}>{archiveRow.aCount}</div>
                    <div className={styles.regionCount} data-strong={archiveRow.bCount > archiveRow.aCount ? 'true' : undefined}>{archiveRow.bCount}</div>
                </>
            )}
        </div>
    </div>
);

const SyncConflictModal: React.FC<SyncConflictModalProps> = ({
    open,
    sourceA,
    sourceB,
    onResolve,
    onClose,
    archiveLabel,
    totalLabel,
}) => {
    const t = useTranslateUI();
    const tGame = useTranslateGame();
    const locale = useLocale();
    const [markers, setMarkers] = useState<IMarkerData[]>([]);
    const hasMapPoints = sourceA.pointIds.length > 0 || sourceB.pointIds.length > 0;

    useEffect(() => {
        if (!open || !hasMapPoints) return;
        void loadAllMarkers().then(setMarkers);
    }, [hasMapPoints, open]);

    const aLabel = sourceLabel(sourceA, t);
    const bLabel = sourceLabel(sourceB, t);
    const aShortLabel = sourceShortLabel(sourceA, t);
    const bShortLabel = sourceShortLabel(sourceB, t);
    const aCounts = useMemo(() => countBySubregion(sourceA.pointIds, markers), [markers, sourceA.pointIds]);
    const bCounts = useMemo(() => countBySubregion(sourceB.pointIds, markers), [markers, sourceB.pointIds]);
    const aArchiveIds = sourceA.archiveIds ?? [];
    const bArchiveIds = sourceB.archiveIds ?? [];
    const aTotal = sourceA.pointIds.length + aArchiveIds.length;
    const bTotal = sourceB.pointIds.length + bArchiveIds.length;
    const aHasMorePoints = aTotal > bTotal;
    const bHasMorePoints = bTotal > aTotal;
    const mergedCount = new Set([
        ...sourceA.pointIds.map((id) => `point:${id}`),
        ...sourceB.pointIds.map((id) => `point:${id}`),
        ...aArchiveIds.map((id) => `archive:${id}`),
        ...bArchiveIds.map((id) => `archive:${id}`),
    ]).size;
    const subregions = useMemo(() => {
        const keys = new Set([...Object.keys(aCounts), ...Object.keys(bCounts)]);
        return Object.values(REGION_DICT)
            .flatMap((region) => region.subregions)
            .filter((subregion) => keys.has(subregion));
    }, [aCounts, bCounts]);

    return (
        <Modal
            open={open}
            size="l"
            title={t('sync.conflict.title')}
            icon={<ConflictIcon />}
            iconScale={0.85}
            onClose={onClose}
            customHeight='70dvh'
        >
            <div className={styles.conflict}>
                <div className={styles.sourceGrid}>
                    {[
                        { source: sourceA, label: aLabel, highlighted: aHasMorePoints },
                        { source: sourceB, label: bLabel, highlighted: bHasMorePoints },
                    ].map(({ source, label, highlighted }) => (
                        <section key={label} className={styles.sourceCard}>
                            <div className={styles.cardBar} data-highlighted={highlighted ? 'true' : undefined}></div>
                            <div className={styles.sourceLabel}>{label}</div>
                            <div className={styles.metric}>
                                <div className={styles.metricLabel}>{t('sync.conflict.updatedAt')}</div>
                                <div className={styles.lastUpdate}>{formatTime(
                                    source.updatedAt,
                                    'N/A',
                                    locale,
                                )}</div>
                            </div>
                            <div className={styles.metric}>
                                <div className={styles.metricLabel}>{totalLabel || t('sync.conflict.total')}</div>
                                <div className={styles.totalNum}>{source.pointIds.length + (source.archiveIds?.length ?? 0)}</div>
                            </div>
                        </section>
                    ))}
                </div>

                <RegionCountTable
                    subregions={subregions}
                    aCounts={aCounts}
                    bCounts={bCounts}
                    aLabel={aShortLabel}
                    bLabel={bShortLabel}
                    regionLabel={t('sync.conflict.region')}
                    tGame={tGame}
                    archiveRow={aArchiveIds.length > 0 || bArchiveIds.length > 0 ? {
                        label: archiveLabel || 'Archives',
                        aCount: aArchiveIds.length,
                        bCount: bArchiveIds.length,
                    } : undefined}
                />

                <div className={styles.actions}>
                    <AccessButton
                        label={(t('sync.conflict.keepA')).replace('{label}', aShortLabel)}
                        onClick={() => onResolve('a')}
                    />
                    <AccessButton
                        label={(t('sync.conflict.keepB')).replace('{label}', bShortLabel)}
                        onClick={() => onResolve('b')}
                    />
                    <div className={styles.actionWide}>
                        <AccessButton
                            label={(t('sync.conflict.merge'))
                                .replace('{count}', String(mergedCount))}
                            onClick={() => onResolve('merge')}
                        />
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default React.memo(SyncConflictModal);
