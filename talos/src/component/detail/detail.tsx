import React, { useState, useMemo, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import styles from './detail.module.scss';
import Button from '@/component/button/button';
import Modal from '@/component/modal/modal';
import Viewer from './viewer/viewer';
import PopoverTooltip from '@/component/popover/popover';

import parse from 'html-react-parser';
import { getItemIconUrl, getFileContentUrl, fetchArchiveFile } from '@/utils/resource.ts';
import { parseArchiveJsonResponse, createArchiveHtmlParserOptions } from './archiveFullText';
import { MARKER_TYPE_DICT } from '@/data/marker';
import { generatePointShareUrl } from '@/utils/urlState';
import { getAnnouncementLocaleKey } from '@/utils/announcement';
import { openOemAuthModal } from '@/component/login/authEvents';
import { useAuthStore } from '@/store/auth';
import {
    listUGCImages,
    listUGCMyImages,
    resolveUGCUploadTarget,
    uploadUGCImage,
    getUGCImageTransformedUrl,
    UGCClientError,
    type UGCImage,
    type UGCSubmissionImage,
    type UGCUploadSubmission,
} from '@/utils/ugcClient';

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

type UGCImageState = 'noImage' | 'pending' | 'hasImage';

const isPendingSubmission = (image: UGCSubmissionImage): boolean => (
    image.status === 'pending_openai' || image.status === 'pending_audit'
);

const isPublicSubmission = (image: UGCSubmissionImage): boolean => (
    image.status === 'active' || image.status === 'flagged' || image.status === 'remove_request'
);

const formatUGCImageCreatedAt = (value: string | undefined, locale: string): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    try {
        return new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(date);
    } catch {
        return date.toISOString().replace('T', ' ').slice(0, 19);
    }
};

export const Detail = ({ inline = false }: { inline?: boolean }) => {
    /**
     * @type {import('../mapContainer/store/marker.type').IMarkerData}
     */
    const currentPoint = useMarkerStore((state) => state.currentActivePoint);
    const pointsRecord = useUserRecord();
    const addPoint = useAddPoint();
    const deletePoint = useDeletePoint();
    const sessionUser = useAuthStore((state) => state.sessionUser);

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
    const pointShareUrl = useMemo(
        () => (currentPoint ? generatePointShareUrl(currentPoint) : ''),
        [currentPoint],
    );
    const ugcUploadTarget = useMemo(
        () => (currentPoint ? resolveUGCUploadTarget(currentPoint) : null),
        [currentPoint],
    );
    const [copiedPopupVisible, setCopiedPopupVisible] = useState(false);
    const copyPopupTimerRef = useRef<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [ugcImages, setUgcImages] = useState<UGCImage[]>([]);
    const [ugcMyImages, setUgcMyImages] = useState<UGCSubmissionImage[]>([]);
    const [ugcLoading, setUgcLoading] = useState(false);
    const [ugcUploading, setUgcUploading] = useState(false);
    const [ugcUploadProgress, setUgcUploadProgress] = useState(0);
    const [ugcUploadError, setUgcUploadError] = useState<string | null>(null);
    const [ugcViewerOpen, setUgcViewerOpen] = useState(false);
    const [pendingUploadAfterLogin, setPendingUploadAfterLogin] = useState(false);
    const [lastUploadSubmission, setLastUploadSubmission] = useState<UGCUploadSubmission | null>(null);
    const ownPublicUgcImage = useMemo(
        () => ugcMyImages.find(isPublicSubmission) ?? null,
        [ugcMyImages],
    );
    const activeUgcImage = ugcImages[0] ?? ownPublicUgcImage;
    const activeUgcPreviewUrl = useMemo(
        () => (activeUgcImage
            ? getUGCImageTransformedUrl(activeUgcImage.url, { width: 400 })
            : ''),
        [activeUgcImage],
    );
    const activeUgcAuthorNickname = useMemo(
        () => activeUgcImage?.author?.nickname ?? '',
        [activeUgcImage],
    );
    const activeUgcAuthorPublicUid = useMemo(
        () => activeUgcImage?.author?.publicUid ?? '',
        [activeUgcImage],
    );
    const activeUgcCreatedAtLabel = useMemo(
        () => formatUGCImageCreatedAt(activeUgcImage?.createdAt, locale),
        [activeUgcImage, locale],
    );
    const pendingOwnSubmission = useMemo(
        () => ugcMyImages.find(isPendingSubmission) ?? null,
        [ugcMyImages],
    );
    const lastUploadIsPending = lastUploadSubmission?.status === 'pending_openai'
        || lastUploadSubmission?.status === 'pending_audit';
    const ugcImageState: UGCImageState = pendingOwnSubmission || lastUploadIsPending
        ? 'pending'
        : activeUgcImage
            ? 'hasImage'
            : 'noImage';
    const canUploadUGCImage = Boolean(ugcUploadTarget)
        && ugcImageState !== 'hasImage'
        && ugcImageState !== 'pending'
        && !ugcUploading;
    const userKarma = Number.isFinite(sessionUser?.karma)
        ? Math.max(0, sessionUser?.karma as number)
        : 0;
    const shouldShowCommunityRule = canUploadUGCImage && ugcImageState === 'noImage' && userKarma < 2;
    const canPreviewUGCImage = Boolean(activeUgcImage);
    const pointImageInteractive = canPreviewUGCImage || canUploadUGCImage;
    const communityGuidelinesUrl = useMemo(
        () => `https://blog.opendfieldmap.org/${getAnnouncementLocaleKey(locale)}/docs/community-guidelines`,
        [locale],
    );

    useEffect(() => {
        return () => {
            if (copyPopupTimerRef.current !== null) {
                window.clearTimeout(copyPopupTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        setUgcImages([]);
        setUgcMyImages([]);
        setUgcUploadError(null);
        setLastUploadSubmission(null);
        setUgcViewerOpen(false);
        if (!currentPoint || !ugcUploadTarget) return;

        let disposed = false;
        setUgcLoading(true);
        void listUGCImages(currentPoint.id)
            .then((images) => {
                if (!disposed) setUgcImages(images);
            })
            .catch(() => {
                if (!disposed) setUgcImages([]);
            })
            .finally(() => {
                if (!disposed) setUgcLoading(false);
            });

        if (sessionUser) {
            void listUGCMyImages(currentPoint.id)
                .then((images) => {
                    if (!disposed) setUgcMyImages(images);
                })
                .catch(() => {
                    if (!disposed) setUgcMyImages([]);
                });
        }

        return () => {
            disposed = true;
        };
    }, [currentPoint, sessionUser, ugcUploadTarget]);

    useEffect(() => {
        if (!pendingUploadAfterLogin || !sessionUser) return;
        setPendingUploadAfterLogin(false);
        requestAnimationFrame(() => fileInputRef.current?.click());
    }, [pendingUploadAfterLogin, sessionUser]);

    const handleCopyPointShareUrl = useCallback(async () => {
        if (!pointShareUrl || typeof window === 'undefined') return;
        try {
            await navigator.clipboard.writeText(pointShareUrl);
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
    }, [pointShareUrl]);

    const tDetail = useCallback((key: string, fallback: string): string => {
        const value = tUI(`detail.${key}`);
        return typeof value === 'string' && value ? value : fallback;
    }, [tUI]);

    const resolveUploadError = useCallback((error: unknown): string => {
        if (error instanceof UGCClientError) {
            const key = `detail.errors.${error.code}`;
            const fallbackKey = error.status ? 'detail.errors.backendUnknown' : 'detail.errors.uploadFailed';
            const translated = tUI(key);
            const fallback = tUI(fallbackKey);
            const text = typeof translated === 'string' && translated ? translated : String(fallback || 'Upload failed.');
            return error.status ? `ERR(${error.code})-${text}` : text;
        }

        return String(tUI('detail.errors.uploadFailed') || 'Upload failed.');
    }, [tUI]);

    const handleRequestImageUpload = useCallback(() => {
        if (!canUploadUGCImage) return;
        setUgcUploadError(null);
        if (!sessionUser) {
            setPendingUploadAfterLogin(true);
            openOemAuthModal('login');
            return;
        }
        fileInputRef.current?.click();
    }, [canUploadUGCImage, sessionUser]);

    const handleImageInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !currentPoint || !ugcUploadTarget) return;

        setUgcUploading(true);
        setUgcUploadProgress(0.02);
        setUgcUploadError(null);
        try {
            const submission = await uploadUGCImage(ugcUploadTarget, file, setUgcUploadProgress);
            setLastUploadSubmission(submission);
            const [images, myImages] = await Promise.all([
                listUGCImages(currentPoint.id),
                listUGCMyImages(currentPoint.id).catch(() => []),
            ]);
            setUgcImages(images);
            setUgcMyImages(myImages);
        } catch (error) {
            setUgcUploadError(resolveUploadError(error));
        } finally {
            setUgcUploading(false);
            setUgcUploadProgress(0);
        }
    }, [currentPoint, resolveUploadError, ugcUploadTarget]);

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
                        {(ugcUploadTarget || ugcImages.length > 0) && (
                            <>
                                <div
                                    className={classNames(styles.pointImage, {
                                        [styles.noImage]: ugcImageState === 'noImage',
                                        [styles.pending]: ugcImageState === 'pending',
                                        [styles.hasImage]: ugcImageState === 'hasImage',
                                        [styles.isClickable]: pointImageInteractive,
                                        [styles.isUploading]: ugcUploading,
                                    })}
                                    style={{
                                        '--ugc-upload-progress': `${Math.round(ugcUploadProgress * 100)}%`,
                                    } as CSSProperties}
                                    onClick={() => {
                                        if (canPreviewUGCImage) {
                                            setUgcViewerOpen(true);
                                            return;
                                        }
                                        if (canUploadUGCImage) handleRequestImageUpload();
                                    }}
                                    role={pointImageInteractive ? 'button' : undefined}
                                    tabIndex={pointImageInteractive ? 0 : undefined}
                                    onKeyDown={(event) => {
                                        if (!pointImageInteractive) return;
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            if (canPreviewUGCImage) {
                                                setUgcViewerOpen(true);
                                                return;
                                            }
                                            handleRequestImageUpload();
                                        }
                                    }}
                                >
                                    {ugcImageState === 'hasImage' && activeUgcImage ? (
                                        <img src={activeUgcPreviewUrl} alt={activeUgcImage.content || pointName} />
                                    ) : (
                                        <div className={styles.noImage}>
                                            {ugcUploading
                                                ? tDetail('uploading', 'Uploading...')
                                                : ugcLoading
                                                    ? ''
                                                    : ugcImageState === 'pending'
                                                        ? tDetail('uploadPending', 'Upload received. Waiting for review.')
                                                        : tDetail('uploadCta', 'No info. Click to upload.')}
                                            {shouldShowCommunityRule && !ugcUploading && !ugcLoading && (
                                                <div className={styles.communityRule}>
                                                    <span>{tDetail('communityRule1', 'By uploading, you confirm you have read')}</span>
                                                    {' '}
                                                    <a
                                                        href={communityGuidelinesUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={(event) => event.stopPropagation()}
                                                    >
                                                        {tDetail('communityRule2', 'Community Guidelines')}
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <input
                                    ref={fileInputRef}
                                    className={styles.imageInput}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/avif"
                                    onChange={(event) => void handleImageInputChange(event)}
                                />
                                {ugcUploadError && (
                                    <div className={styles.uploadHint}>{ugcUploadError}</div>
                                )}
                            </>
                        )}
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
        <Viewer
            open={ugcViewerOpen && Boolean(activeUgcImage)}
            imageUrl={activeUgcImage?.url ?? ''}
            alt={activeUgcImage?.content || pointName}
            authorNickname={activeUgcAuthorNickname}
            authorPublicUid={activeUgcAuthorPublicUid}
            createdAtLabel={activeUgcCreatedAtLabel}
            onClose={() => setUgcViewerOpen(false)}
        />
        </>
    );
};

export default Detail;
