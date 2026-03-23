import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import styles from './detail.module.scss';
import Button from '@/component/button/button';
import Modal from '@/component/modal/modal';
import PopoverTooltip from '@/component/popover/popover';

import parse from 'html-react-parser';
import { getItemIconUrl, getFileContentUrl, fetchArchiveFile } from '@/utils/resource.ts';
import { parseArchiveJsonResponse, createArchiveHtmlParserOptions } from './archiveFullText';
import { MARKER_TYPE_DICT } from '@/data/marker';
import { generatePointShareShortUrl } from '@/utils/urlState';

import BossIcon from '@/assets/images/category/boss.svg?react';
import CollectionIcon from '@/assets/images/category/collection.svg?react';
import ExplorationIcon from '@/assets/images/category/exploration.svg?react';
import CombatIcon from '@/assets/images/category/combat.svg?react';
import FacilityIcon from '@/assets/images/category/facility.svg?react';
import MobIcon from '@/assets/images/category/mob.svg?react';
import NaturalIcon from '@/assets/images/category/natural.svg?react';
import NpcIcon from '@/assets/images/category/npc.svg?react';
import ValuableIcon from '@/assets/images/category/valuable.svg?react';
import ArchivesIcon from '@/assets/images/category/archives.svg?react';

import {
    useMarkerStore,
    useRegionMarkerCount,
    useWorldMarkerCount,
    useSubregionMarkerCount,
} from '@/store/marker.ts';
import {
    useAddPoint,
    useDeletePoint,
    useUserRecord,
} from '@/store/userRecord.ts';
import classNames from 'classnames';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslateGame, useTranslateUI, useLocale } from '@/locale';
import { useForceDetailOpen } from '@/store/uiPrefs';

// Category icon mapping
const CATEGORY_ICON_MAP: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
    boss: BossIcon,
    collection: CollectionIcon,
    archives: ArchivesIcon,
    combat: CombatIcon,
    facility: FacilityIcon,
    mob: MobIcon,
    natural: NaturalIcon,
    npc: NpcIcon,
    valuable: ValuableIcon,
    exploration: ExplorationIcon,
};

// const mockPoint = {
//   id: "001",
//   pos: [-656.19, 645.58],
//   region: {
//     main: "Valley_4",
//     sub: "pane_1"
//   },
//   type: {
//     main: "resource",
//     sub: "natural",
//     key: "originium_ore"
//   },
//   status: {
//     user: {
//       isCollected: false,
//       localNote: "Complete E1M7 to enable the secret path to the point. Open on SAT/SUN only."
//     }
//   },
//   meta: {
//     addedBy: "cirisus",
//     addedAt: "2025-03-09T15:30:00Z"
//   }
// };

export const Detail = ({ inline = false }: { inline?: boolean }) => {
    /**
     * @type {import('../mapContainer/store/marker.type').IMarkerData}
     */
    const currentPoint = useMarkerStore((state) => state.currentActivePoint);
    const pointsRecord = useUserRecord();
    const addPoint = useAddPoint();
    const deletePoint = useDeletePoint();

    const isCollected = currentPoint
        ? pointsRecord.includes(currentPoint.id)
        : false;

    const categorySubKey = currentPoint ? MARKER_TYPE_DICT[currentPoint.type]?.category?.sub : undefined;
    const CategoryIcon = categorySubKey ? CATEGORY_ICON_MAP[categorySubKey] : undefined;
    
    const typeEntry = currentPoint ? MARKER_TYPE_DICT[currentPoint.type] : undefined;
    const iconKey = typeEntry?.icon ?? (currentPoint ? currentPoint.type : 'UKN');
    const iconUrl = getItemIconUrl(iconKey);
    const isFilesType = typeEntry?.category?.main === 'files';

    const tGame = useTranslateGame();
    const tUI = useTranslateUI();
    const locale = useLocale();
    const pointNameRaw = tGame(`markerType.key.${currentPoint?.type}`);
    const pointName = typeof pointNameRaw === 'string' && pointNameRaw.trim()
        ? pointNameRaw
        : (currentPoint?.type ?? '');
    const pointShareShortUrl = useMemo(
        () => (currentPoint ? generatePointShareShortUrl(currentPoint) : ''),
        [currentPoint],
    );
    const [copiedPopupVisible, setCopiedPopupVisible] = useState(false);
    const copyPopupTimerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (copyPopupTimerRef.current !== null) {
                window.clearTimeout(copyPopupTimerRef.current);
            }
        };
    }, []);

    const handleCopyPointShareUrl = useCallback(async () => {
        if (!pointShareShortUrl || typeof window === 'undefined') return;
        try {
            const fullUrl = `${window.location.origin}${window.location.pathname}${pointShareShortUrl}`;
            await navigator.clipboard.writeText(fullUrl);
            setCopiedPopupVisible(false);
            requestAnimationFrame(() => {
                setCopiedPopupVisible(true);
            });
            if (copyPopupTimerRef.current !== null) {
                window.clearTimeout(copyPopupTimerRef.current);
            }
            copyPopupTimerRef.current = window.setTimeout(() => {
                setCopiedPopupVisible(false);
            }, 1500);
        } catch {
            // ignore clipboard errors
        }
    }, [pointShareShortUrl]);

    // Archive full-text state — content may be plain text and/or HTML (<i>, <del>, <img>, …)
    const [hasFullText, setHasFullText] = useState(false);
    const [textModalOpen, setTextModalOpen] = useState(false);
    const [fullTextContent, setFullTextContent] = useState<string | null>(null);
    const [isLoadingFullText, setIsLoadingFullText] = useState(false);

    // GET + validate JSON (HEAD is unreliable: Vite may return 200 + index.html for missing paths)
    useEffect(() => {
        setHasFullText(false);
        setFullTextContent(null);
        setTextModalOpen(false);
        if (!isFilesType || !currentPoint) return;
        const url = getFileContentUrl(locale, currentPoint.type);
        const controller = new AbortController();
        fetchArchiveFile(url, controller.signal)
            .then((res) => parseArchiveJsonResponse(res))
            .then((content) => {
                if (controller.signal.aborted) return;
                if (content !== null) {
                    setHasFullText(true);
                    setFullTextContent(content);
                }
            })
            .catch(() => { /* network / abort */ });
        return () => controller.abort();
    }, [isFilesType, currentPoint, locale]);

    const handleOpenFullText = useCallback(async () => {
        if (!currentPoint) return;
        setTextModalOpen(true);
        if (fullTextContent !== null) return; // already loaded by effect
        setIsLoadingFullText(true);
        try {
            const url = getFileContentUrl(locale, currentPoint.type);
            const res = await fetchArchiveFile(url);
            const content = await parseArchiveJsonResponse(res);
            if (content !== null) setFullTextContent(content);
        } catch { /* ignore */ } finally {
            setIsLoadingFullText(false);
        }
    }, [currentPoint, locale, fullTextContent]);

    const archiveJsonUrl = useMemo(
        () => (isFilesType && currentPoint ? getFileContentUrl(locale, currentPoint.type) : ''),
        [isFilesType, currentPoint, locale],
    );

    const fullTextDom = useMemo(() => {
        if (fullTextContent == null) return null;
        const options = createArchiveHtmlParserOptions(archiveJsonUrl);
        return fullTextContent.split(/\r?\n/).map((line, i) => (
            <p key={i}>
                {line.trim() ? parse(line, options) : null}
            </p>
        ));
    }, [fullTextContent, archiveJsonUrl]);

    // const noteContent = currentPoint?.status?.user?.localNote;
    const [isVisible, setIsVisible] = useState(false);
    const forceDetailOpen = useForceDetailOpen();
    const ref = useRef<HTMLDivElement | null>(null);
    
    // 当 currentPoint 更新时，显示 detail
    useEffect(() => {
        if (currentPoint) {
            console.log('[Detail] currentPoint changed:', currentPoint, 'forceDetailOpen:', forceDetailOpen);
            setIsVisible(true);
        }
    }, [currentPoint, forceDetailOpen]);

    // const handleNextPoint = () => addPoint(currentPoint.id);

    // marks
    const worldCnt = useWorldMarkerCount(currentPoint?.type);
    const regionCnt = useRegionMarkerCount(currentPoint?.type);
    const subCnt = useSubregionMarkerCount(currentPoint?.type, currentPoint?.subregId);

    const statItems = useMemo(
        () => [
            { label: tUI('detail.stat.world'), data: worldCnt, index: 0 },
            { label: tUI('detail.stat.main'), data: regionCnt, index: 1 },
            { label: tUI('detail.stat.sub'), data: subCnt, index: 2 },
        ],
        [worldCnt, regionCnt, subCnt, tUI],
    );

    return (
        <>
        <AnimatePresence mode='wait'>
            {isVisible && currentPoint && (
                <motion.div
                    initial={{ x: '150%' }}
                    animate={{ x: '0%' }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    key={currentPoint ? 'active' : 'null'}
                    className={`${styles.detailContainer} ${inline ? styles.inline : ''}`}
                    ref={ref}
                >
                    {/* Head */}
                    <div className={styles.detailHeader}>
                        <div className={styles.pointInfo}>
                            {CategoryIcon && (
                                <span className={styles.categoryIcon}>
                                    <CategoryIcon className={styles.icon} />
                                </span>
                            )}
                            <span className={styles.pointName}>{pointName}</span>
                        </div>
                        <div className={styles.headerActions}>
                            <Button
                                text={tUI('common.close')}
                                aria-label={tUI('common.close') || 'Close'}
                                buttonType='close'
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsVisible(false);
                                }}
                            />
                        </div>
                    </div>
                    {/* Content */}
                    <div className={styles.detailContent}>
                        {/* Icon & Stats */}
                        <div className={styles.iconStatsContainer}>
                            <div
                                className={classNames(styles.pointIcon, {
                                    [styles.collected]: isCollected,
                                })}
                                onClick={() => {
                                    if (isCollected) {
                                        deletePoint(currentPoint.id);
                                    } else {
                                        addPoint(currentPoint.id);
                                    }
                                }}
                            >
                                <AnimatePresence mode='wait'>
                                    {iconUrl && (
                                        <motion.img
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.3 }}
                                            key={currentPoint?.id ?? 'null'}
                                            src={iconUrl}
                                            alt={pointName}
                                        />
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className={styles.pointStats}>
                                <div className={styles.statsTxt}>
                                    {statItems.map((item) => (
                                        <div
                                            className={styles.statRow}
                                            key={item.label}
                                            style={{
                                                transform: `translateY(${3 - item.index * 2}px)`,
                                            }}
                                        >
                                            <span className={styles.statLabel}>
                                                {item.label}:{' '}
                                            </span>
                                            <div className={styles.statValue}>
                                                <span
                                                    className={`user-value ${item.data.collected === item.data.total ? 'check' : ''}`}
                                                >
                                                    {item.data.collected}
                                                </span>
                                                <span className='value-separator'>
                                                    /
                                                </span>
                                                <span className='total-value'>
                                                    {item.data.total}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className={styles.statsProg}>
                                    {statItems.map((item) => (
                                        <div
                                            key={`prog-${item.label}`}
                                            className={classNames(
                                                styles.progBar,
                                                {
                                                    [styles.check]:
                                                        item.data.collected ===
                                                        item.data.total,
                                                },
                                            )}
                                            style={{
                                                '--prog':
                                                    item.data.collected /
                                                    item.data.total,
                                            }}
                                        ></div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {/* Circumstance */}
                        {/* <div className="point-image">
            <div className="no-image">No info.</div>
          </div> */}


                        {/* Note — shown when an archive full-text file is available */}
                        {hasFullText && (
                            <div className={styles.detailNotes}>
                                <a
                                    className={styles.readFullText}
                                    onClick={() => void handleOpenFullText()}
                                    role="button"
                                >
                                    {String(tUI('detail.readFullText'))}
                                </a>
                            </div>
                        )}
                        <div className={styles.detailUrl}>
                            <PopoverTooltip
                                content={String(tUI('detail.copied'))}
                                placement="top"
                                gap={4}
                                visible={copiedPopupVisible}
                                disabled={false}
                            >
                                <a
                                    className={styles.pointShareLink}
                                    onClick={() => void handleCopyPointShareUrl()}
                                    role="button"
                                >
                                    {String(tUI('detail.share'))}
                                </a>
                            </PopoverTooltip>
                        </div>
                    </div>
                    {/* Meta
      <div className="detail-meta">
        <span>Provided by: {mockPoint.meta?.addedBy || 'UKN'}</span>
        <span>At: {mockPoint.meta?.addedAt ?
          new Date(mockPoint.meta.addedAt).toLocaleDateString() : 'UKN'}</span>
      </div>
      */}
                </motion.div>
            )}
        </AnimatePresence>
        {/* Full-text modal — rendered as a portal, independent of detail visibility */}
        <Modal
            open={textModalOpen}
            title={pointName}
            size="m"
            icon={CategoryIcon ? <CategoryIcon /> : undefined}
            onClose={() => setTextModalOpen(false)}
            iconScale={0.8}
        >
            <div className={styles.fullTextContent}>
                {isLoadingFullText ? null : fullTextDom}
            </div>
        </Modal>
        </>
    );
};

export default Detail;
