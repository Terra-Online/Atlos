import { useFontRegion } from '@main/locale/useFontRegion';
import { useEffect, useState } from 'react';
import { CommentContent } from '@main/component/detail/comment/emoji';
import { useTranslateGame } from '@main/locale';
import { useLocale, useTranslateUI } from '@hub/locale';
import PopoverTooltip from '@main/component/popover/popover';
import {
    formatAbsoluteTime,
    formatRelativeTime,
    parseTimestamp,
} from '@main/lib/format/time';
import {
    loadAllMarkers,
    MARKER_TYPE_DICT,
    type IMarkerData,
} from '@main/data/marker';
import { generatePointShareUrl } from '@main/services/routing/share';
import { getSubregionLabel } from '@main/services/map/subregionLabel';
import type { Contribution } from '../../types';
import { formatDate } from '../../config';
import styles from './list.module.scss';

function Preview({ item }: { item: Contribution }) {
    const t = useTranslateUI();
    const [failed, setFailed] = useState(false);
    return (
        <div className={styles.preview}>
            {item.previewUrl && !failed ? (
                <img
                    src={item.previewUrl}
                    alt={t('userHub.kinds.image')}
                    loading='lazy'
                    onError={() => setFailed(true)}
                />
            ) : (
                <span>{t('userHub.previewUnavailable')}</span>
            )}
        </div>
    );
}

function Progress({ item }: { item: Contribution }) {
    const t = useTranslateUI();
    const locale = useLocale();
    const archived = item.status === 'stale';
    const manual = item.review?.manual ?? item.status === 'pending_audit';
    const published =
        item.review?.published ??
        ['active', 'flagged', 'remove_request'].includes(item.status);
    const terminal = archived || published;
    const times = item.review?.times;
    const path = item.review?.path ?? [
        { key: 'uploaded' as const, at: item.createdAt },
        ...(!archived || times?.ai || published
            ? [{ key: 'ai' as const, at: times?.ai ?? null }]
            : []),
        ...(manual
            ? [{ key: 'manual' as const, at: times?.manual ?? null }]
            : []),
        ...(published
            ? [{ key: 'public' as const, at: times?.public ?? null }]
            : []),
        ...(archived
            ? [{ key: 'archived' as const, at: times?.archived ?? null }]
            : []),
    ];
    const currentIndex = path.length - 1;
    const stages = path.map((step, index) => ({
        ...step,
        complete: terminal || index < currentIndex,
    }));
    if (!terminal) stages.push({ key: 'public', at: null, complete: false });
    return (
        <ol
            className={styles.progress}
            aria-label={`${t('userHub.reviewStatus')}: ${t(`userHub.status.${item.status}`)}`}
        >
            {stages.map(({ key, at, complete }, index) => {
                const state =
                    currentIndex === index
                        ? 'current'
                        : complete
                          ? 'complete'
                          : 'pending';
                const label = t(
                    key === 'uploaded'
                        ? 'userHub.steps.uploaded'
                        : `userHub.steps.${key}.${complete ? 'complete' : 'current'}`,
                );
                const date = parseTimestamp(at);
                const tooltip = (
                    <>
                        {label}
                        {date ? (
                            <>
                                {' - '}
                                <time dateTime={date.toISOString()}>
                                    {formatAbsoluteTime(date, { locale })}
                                    {' ('}
                                    {formatRelativeTime(date, { locale })}
                                    {')'}
                                </time>
                            </>
                        ) : null}
                    </>
                );
                return (
                    <li
                        key={`${key}-${index}`}
                        className={styles.step}
                        data-state={state}
                        data-terminal={key === 'public' || key === 'archived'}
                        aria-current={state === 'current' ? 'step' : undefined}
                        aria-label={label}
                    >
                        <PopoverTooltip
                            content={tooltip}
                            placement='top'
                            gap={12}
                        >
                            <span className={styles.node} aria-label={label} />
                        </PopoverTooltip>
                    </li>
                );
            })}
        </ol>
    );
}

export default function List({
    items,
    kind,
}: {
    items: Contribution[];
    kind: 'image' | 'comment';
}) {
    const t = useTranslateUI();
    const game = useTranslateGame();
    const [markers, setMarkers] = useState<Record<string, IMarkerData>>({});
    useEffect(() => {
        if (kind !== 'comment' || !items.length) return;
        let active = true;
        const ids = new Set(items.map((item) => item.markerId));
        void loadAllMarkers()
            .then((all) => {
                if (active)
                    setMarkers(
                        Object.fromEntries(
                            all
                                .filter((marker) => ids.has(marker.id))
                                .map((marker) => [marker.id, marker]),
                        ),
                    );
            })
            .catch(() => {
                if (active) setMarkers({});
            });
        return () => {
            active = false;
        };
    }, [items, kind]);
    const pointText = items.map((item) => {
        const marker = markers[item.markerId];
        return (game(`markerType.key.${item.poiType}`) || item.poiType)
            + (marker ? getSubregionLabel(marker.subregId, game) : '');
    }).join('');
    const fontRef = useFontRegion([
        { faces: ['h', 'm'], text: items.map((item) => item.content || '').join('') },
        { faces: ['m'], text: pointText, localized: 'game' },
    ]);
    if (!items.length)
        return (
            <p className={styles.empty}>{t('userHub.emptyContributions')}</p>
        );
    return (
        <ul ref={fontRef} className={kind === 'image' ? styles.images : styles.list}>
            {items.map((item) => {
                const pointName =
                    game(`markerType.key.${item.poiType}`) || item.poiType;
                const marker = markers[item.markerId];
                const area =
                    marker &&
                    MARKER_TYPE_DICT[item.poiType]?.category.main !== 'files'
                        ? getSubregionLabel(marker.subregId, game)
                        : '';
                const point = [
                    pointName,
                    area && area !== marker?.subregId ? area : '',
                ]
                    .filter(Boolean)
                    .join(t('userHub.pointSeparator'));
                const href = generatePointShareUrl(
                    {
                        id: item.markerId,
                        type: item.poiType,
                        subregId: marker?.subregId ?? '',
                    },
                    { content: { kind, id: item.id } },
                );
                const [beforePoint, afterPoint] = t(
                    'userHub.commentLocation',
                ).split('{point}');
                return (
                    <li key={item.id}>
                        {kind === 'image' ? (
                            <article className={styles.image}>
                                <a
                                    className={styles.imageLink}
                                    href={href}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    aria-label={point}
                                >
                                    <Preview
                                        key={item.previewUrl}
                                        item={item}
                                    />
                                </a>
                                <Progress item={item} />
                            </article>
                        ) : (
                            <article
                                className={styles.comment}
                                data-status={item.status}
                            >
                                <div className={styles.body}>
                                    <p className={styles.text}>
                                        <CommentContent
                                            content={item.content || ''}
                                        />
                                    </p>
                                    <div className={styles.meta}>
                                        <time dateTime={item.createdAt}>
                                            {formatDate(
                                                item.createdAt,
                                                'zh-CN',
                                            )}
                                        </time>
                                        {point && (
                                            <>
                                                {beforePoint}
                                                <a
                                                    className={styles.pointName}
                                                    href={href}
                                                    target='_blank'
                                                    rel='noopener noreferrer'
                                                >
                                                    {point}
                                                </a>
                                                {afterPoint}
                                            </>
                                        )}
                                    </div>
                                </div>
                                <Progress item={item} />
                            </article>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
