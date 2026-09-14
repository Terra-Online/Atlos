import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type TransitionEvent,
} from 'react';
import parse from 'html-react-parser';
import type { IntelArchive, ShopLocation } from '@intel/data/types';
import { useLocale, useTranslateGame, useTranslateUI } from '@intel/locale';
import { useTranslateGame as useTranslateMainGame } from '@main/locale';
import { useLayoutVersion } from '@main/store/uiPrefs';
import styles from './intelCard.module.scss';

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const POINT_SHARE_CN_HOSTNAME = 'opendfieldmap.cn';
const PROD_PREFIX = '/_dev/endfield/atlos';
const R2_PREFIX = __INTEL_DEPLOY_CHANNEL__ === 'beta' ? '/_beta/endfield/atlos' : PROD_PREFIX;
const OSS_OG_BASE = `https://cdn.opendfieldmap.cn${PROD_PREFIX}/seo/og/oss`;
const R2_OG_BASE = `https://cdn.opendfieldmap.org${R2_PREFIX}/seo/og/r2`;

const encodePointToken = (pointId: string): string | null => {
  if (!/^\d+$/.test(pointId)) return null;
  const modulus = 1n << 36n;
  const id = BigInt(pointId);
  if (id >= modulus) return null;
  let value = (id * 25214903917n + 11n) % modulus;
  let encoded = '';
  while (value > 0n) {
    encoded = BASE62[Number(value % 62n)] + encoded;
    value /= 62n;
  }
  return (encoded || '0').padStart(7, '0');
};

const pointHref = (token: string) => {
  const isCn = window.location.hostname === POINT_SHARE_CN_HOSTNAME
    || window.location.hostname.endsWith(`.${POINT_SHARE_CN_HOSTNAME}`);
  return `${isCn ? 'https://opendfieldmap.cn' : 'https://oem.re'}/${token}`;
};

const PointLink = ({ pointId, label }: { pointId: string; label: string }) => {
  const token = encodePointToken(pointId);
  if (!token) return null;
  return (
    <a
      className={styles.pointLink}
      href={pointHref(token)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
    >
      <span className={styles.pointLinkText}>{label}</span>
      <span className={styles.pointLinkArrow} aria-hidden="true">↗</span>
    </a>
  );
};

const MapPreviewLink = ({ pointId, label, locale }: { pointId: string; label: string; locale: string }) => {
  const token = encodePointToken(pointId);
  if (!token) return null;
  const ogBase = locale.toLowerCase().startsWith('zh-') ? OSS_OG_BASE : R2_OG_BASE;
  return (
    <a
      className={styles.mapPreview}
      href={pointHref(token)}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    >
      <img
        src={`${ogBase}/${token}.jpg`}
        alt=""
        loading="lazy"
        draggable="false"
        referrerPolicy="no-referrer"
      />
      <span className={styles.mapPreviewLabel}>
        <span className={styles.mapPreviewText} data-label={label}>{label}</span>
        <span className={styles.mapPreviewArrow} aria-hidden="true">↗</span>
      </span>
    </a>
  );
};

const DetailLine = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className={styles.detailLine}>
    <strong className={styles.detailLabel}>{label}</strong>
    <span>{children}</span>
  </div>
);

const gameLabel = (tGame: (key: string) => string, id: string) => (tGame(id) || id).replace(/<[^>]*>/g, '');
const gameRichLabel = (tGame: (key: string) => string, id: string) => parse(tGame(id) || id);

const methodLabel = (archive: IntelArchive, tUI: (key: string) => string) => (
  tUI(`intel.method.${archive.acquisition.method}`)
);

const InterpolatedTemplate = ({
  template,
  values,
}: {
  template: string;
  values: Record<string, ReactNode>;
}) => (
  <>
    {template.split(/(\{[a-zA-Z]+\})/g).map((part, index) => {
      const key = part.startsWith('{') ? part.slice(1, -1) : '';
      return key && Object.prototype.hasOwnProperty.call(values, key)
        ? <Fragment key={`${key}-${index}`}>{values[key]}</Fragment>
        : part;
    })}
  </>
);

const HighlightedTemplate = ({
  template,
  values,
}: {
  template: string;
  values: Record<string, ReactNode>;
}) => (
  <InterpolatedTemplate
    template={template}
    values={Object.fromEntries(Object.entries(values).map(([key, value]) => [
      key,
      <span className={styles.detailHighlight} key={key}>{value}</span>,
    ]))}
  />
);

const shopLocationLabel = (location: ShopLocation, tGame: (key: string) => string) => {
  const region = gameLabel(tGame, `region:${location.regionId}`);
  const subregion = location.subregionId
    ? gameLabel(tGame, `region:${location.regionId}:${location.subregionId}`)
    : '';
  return subregion ? `${region} - ${subregion}` : region;
};

const AcquisitionDetails = ({
  archive,
  tUI,
  tGame,
  tMainGame,
}: {
  archive: IntelArchive;
  tUI: (key: string) => string;
  tGame: (key: string) => string;
  tMainGame: (key: string) => string;
}) => {
  const acquisition = archive.acquisition;
  switch (acquisition.method) {
    case 'mission': {
      const mission = gameLabel(tGame, acquisition.missionId);
      const interaction = acquisition.interaction;
      const stageId = interaction?.stageId ?? acquisition.questId;
      const stage = stageId ? gameRichLabel(tGame, stageId) : '';
      const pointType = interaction
        ? gameLabel(tMainGame, 'markerType.key.aero_salvage')
        : '';
      const point = pointType
        ? tUI('intel.pointPuzzle').replace('{point}', pointType)
        : '';
      const missionSequence = (
        <DetailLine label={tUI('intel.label.missionSequence')}>
          {mission}{stage && <> » {stage}</>}
          {interaction && <span className={styles.optionalCondition}>{tUI('intel.optionalCondition')}</span>}
        </DetailLine>
      );
      if (acquisition.special) {
        const special = acquisition.special;
        return (
          <>
            {missionSequence}
            <DetailLine label={tUI('intel.label.npc')}>
              <InterpolatedTemplate
                template={tUI('intel.specialNpcDialog')}
                values={{
                  npc: gameLabel(tGame, special.npcId),
                  dialog: <span className={styles.detailHighlight}>{gameLabel(tGame, special.dialogOptionId)}</span>,
                }}
              />
            </DetailLine>
            <DetailLine label={tUI('intel.source')}>{tUI('intel.specialAcquisition')}</DetailLine>
          </>
        );
      }
      return (
        <>
          {interaction && (
            <DetailLine label={tUI('intel.source')}>
              <HighlightedTemplate
                template={tUI('intel.missionMapInteraction')}
                values={{ point: <PointLink pointId={String(interaction.pointId)} label={point} /> }}
              />
            </DetailLine>
          )}
          {interaction
            ? <div className={styles.optionalMission}>{missionSequence}</div>
            : missionSequence}
        </>
      );
    }
    case 'shop': {
      const region = gameLabel(tGame, `region:${acquisition.location.regionId}`);
      const npc = acquisition.npcId ? gameLabel(tGame, acquisition.npcId) : '';
      const shop = gameLabel(
        tGame,
        acquisition.npcId ? acquisition.shopGroupId : acquisition.shopId,
      );
      const pointId = acquisition.pointId ? String(acquisition.pointId) : undefined;
      const npcLink = pointId ? <PointLink pointId={pointId} label={npc} /> : npc;
      const shopLink = pointId ? <PointLink pointId={pointId} label={shop} /> : shop;
      return (
        <>
          <DetailLine label={tUI('intel.label.acquisitionLocation')}>
            {shopLocationLabel(acquisition.location, tGame)}
          </DetailLine>
          {acquisition.npcId && <DetailLine label={tUI('intel.label.npc')}>{npcLink}</DetailLine>}
          <DetailLine label={tUI('intel.source')}>
            <HighlightedTemplate
              template={tUI(acquisition.npcId ? 'intel.shopNpcPurchase' : 'intel.shopSystemPurchase')}
              values={acquisition.npcId ? { npc, shop: shopLink } : { region, shop }}
            />
          </DetailLine>
        </>
      );
    }
    default:
      return null;
  }
};

interface ArchiveCardProps {
  archive: IntelArchive;
  collected: boolean;
  isTypeTarget: boolean;
  stackOrder: number;
  onToggle: (archive: IntelArchive) => void;
  onTypeTargetHover: (archiveId: string) => void;
}

interface IntelTitleStyle extends CSSProperties {
  '--expanded-title-height'?: string;
}

interface PendingCardMeasurement {
  card: HTMLElement;
  canMeasure: () => boolean;
}

const pendingCardMeasurements = new Map<HTMLElement, PendingCardMeasurement>();
let cardMeasurementFrame = 0;
let cardMotionObserver: IntersectionObserver | null = null;

const observeCardMotion = (skeleton: HTMLElement) => {
  if (!('IntersectionObserver' in window)) {
    skeleton.dataset.motionNearby = 'true';
    return () => {
      delete skeleton.dataset.motionNearby;
    };
  }

  cardMotionObserver ??= new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const target = entry.target as HTMLElement;
      if (entry.isIntersecting) target.dataset.motionNearby = 'true';
      else delete target.dataset.motionNearby;
    });
  }, { rootMargin: '100% 0px 100% 0px' });
  cardMotionObserver.observe(skeleton);

  return () => {
    cardMotionObserver?.unobserve(skeleton);
    delete skeleton.dataset.motionNearby;
  };
};

const scheduleCardMeasurement = (
  skeleton: HTMLElement,
  card: HTMLElement,
  canMeasure: () => boolean,
) => {
  pendingCardMeasurements.set(skeleton, {
    card,
    canMeasure,
  });
  if (cardMeasurementFrame) return;
  cardMeasurementFrame = window.requestAnimationFrame(() => {
    cardMeasurementFrame = 0;
    const entries = Array.from(pendingCardMeasurements.entries())
      .filter(([, measurement]) => measurement.canMeasure());
    pendingCardMeasurements.clear();

    // Keep writes and reads in separate passes. Interleaving them forces the
    // browser to recalculate the full grid once per card on large result sets.
    entries.forEach(([targetSkeleton]) => {
      targetSkeleton.dataset.layoutSync = 'true';
      targetSkeleton.dataset.measuring = 'true';
    });

    const measurements = entries.map(([targetSkeleton, { card }]) => ({
      skeleton: targetSkeleton,
      height: Math.ceil(card.getBoundingClientRect().height) + 1,
    }));

    entries.forEach(([targetSkeleton]) => {
      delete targetSkeleton.dataset.measuring;
    });

    measurements.forEach(({ skeleton: targetSkeleton, height }) => {
      if (height <= 0) return;
      const previousHeight = Number.parseFloat(
        targetSkeleton.style.getPropertyValue('--intel-card-expanded-height'),
      );
      if (!Number.isFinite(previousHeight) || Math.abs(previousHeight - height) > 0.5) {
        targetSkeleton.style.setProperty('--intel-card-expanded-height', `${height}px`);
      }
      targetSkeleton.dataset.heightReady = 'true';
    });

    window.requestAnimationFrame(() => {
      measurements.forEach(({ skeleton: targetSkeleton }) => {
        if (!targetSkeleton.isConnected) return;
        delete targetSkeleton.dataset.layoutSync;
        if (targetSkeleton.dataset.motionReady !== 'true') {
          targetSkeleton.dataset.motionReady = 'true';
        }
      });
    });
  });
};

const IntelCard = ({
  archive,
  collected,
  isTypeTarget,
  stackOrder,
  onToggle,
  onTypeTargetHover,
}: ArchiveCardProps) => {
  const tUI = useTranslateUI();
  const tGame = useTranslateGame();
  const tMainGame = useTranslateMainGame();
  const locale = useLocale();
  const layoutVersion = useLayoutVersion();
  const title = gameLabel(tGame, archive.id);
  const cardSkeletonRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const expandedTitleRef = useRef<HTMLDivElement | null>(null);
  const previousCollectedRef = useRef(collected);
  const titleTransitionRef = useRef(false);
  const [isTitleTruncated, setIsTitleTruncated] = useState(false);
  const [expandedTitleHeight, setExpandedTitleHeight] = useState<number | null>(null);
  const isUncollecting = previousCollectedRef.current && !collected;
  const canMeasureCard = useCallback(
    () => !titleTransitionRef.current,
    [],
  );
  const syncCardSkeleton = useCallback(() => {
    const skeleton = cardSkeletonRef.current;
    const card = cardRef.current;
    if (!skeleton || !card || !canMeasureCard()) return;
    scheduleCardMeasurement(skeleton, card, canMeasureCard);
  }, [canMeasureCard]);
  const toggleCard = () => onToggle(archive);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleCard();
    }
  };

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const titleElement = titleRef.current;
        const expandedElement = expandedTitleRef.current;
        if (!titleElement || !expandedElement) return;
        setIsTitleTruncated(titleElement.scrollWidth > titleElement.clientWidth);
        const nextHeight = expandedElement.scrollHeight;
        if (Number.isFinite(nextHeight) && nextHeight > 0) {
          setExpandedTitleHeight(nextHeight);
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [layoutVersion, locale, title]);

  useEffect(() => {
    previousCollectedRef.current = collected;
  }, [collected]);

  useEffect(() => {
    const skeleton = cardSkeletonRef.current;
    return skeleton ? observeCardMotion(skeleton) : undefined;
  }, []);

  useEffect(() => {
    const skeleton = cardSkeletonRef.current;
    if (!skeleton) return;

    let observedWidth = skeleton.getBoundingClientRect().width;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? skeleton.getBoundingClientRect().width;
      if (Math.abs(nextWidth - observedWidth) <= 0.5) return;
      observedWidth = nextWidth;
      syncCardSkeleton();
    });
    resizeObserver.observe(skeleton);

    return () => {
      resizeObserver.disconnect();
    };
  }, [syncCardSkeleton]);

  useLayoutEffect(() => {
    // Folding only changes presentation. The natural expanded height remains
    // valid, so toggling the whole grid must not enqueue hundreds of reads.
    syncCardSkeleton();
    return () => {
      const skeleton = cardSkeletonRef.current;
      if (skeleton) pendingCardMeasurements.delete(skeleton);
    };
  }, [layoutVersion, locale, syncCardSkeleton, title]);

  const handleTitleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== expandedTitleRef.current || event.propertyName !== 'max-height') return;
    if (event.currentTarget.matches(':hover')) return;
    titleTransitionRef.current = false;
    syncCardSkeleton();
  };

  return (
    <div
      ref={cardSkeletonRef}
      className={styles.cardSkeleton}
      style={{ zIndex: stackOrder }}
    >
      <article
        ref={cardRef}
        className={styles.card}
        data-collected={collected ? 'true' : 'false'}
        data-collection-transition={isUncollecting ? 'uncollect' : undefined}
        data-intel-archive={archive.id}
        data-type-target={isTypeTarget ? 'true' : undefined}
        role="button"
        tabIndex={0}
        aria-pressed={collected}
        onClick={toggleCard}
        onKeyDown={handleKeyDown}
        onMouseEnter={isTypeTarget ? () => onTypeTargetHover(archive.id) : undefined}
      >
        <span className={`${styles.progressBar} ${styles.progressHorizontal}`} aria-hidden="true" />
        <span className={`${styles.progressBar} ${styles.progressVertical}`} aria-hidden="true" />
        <header className={styles.header}>
          <img src={archive.iconUrl} alt="" draggable="false" />
          <div className={styles.heading}>
            <div
              className={styles.titleCell}
              data-truncated={isTitleTruncated ? 'true' : 'false'}
              onMouseEnter={() => {
                if (isTitleTruncated) titleTransitionRef.current = true;
              }}
              onTransitionEnd={handleTitleTransitionEnd}
              onTransitionCancel={handleTitleTransitionEnd}
              style={expandedTitleHeight
                ? { '--expanded-title-height': `${expandedTitleHeight}px` } as IntelTitleStyle
                : undefined}
            >
              <div ref={titleRef} className={styles.titleSingle}>{title}</div>
              <div ref={expandedTitleRef} className={styles.titleExpanded} aria-hidden="true">{title}</div>
            </div>
            <div className={styles.method}>{methodLabel(archive, tUI)}</div>
          </div>
        </header>
        <div className={styles.detailShell}>
          <div className={styles.detailContent}>
          {archive.acquisition.method === 'map' ? (
            <MapPreviewLink pointId={String(archive.acquisition.pointId)} label={tUI('intel.mapSite')} locale={locale} />
          ) : (
            <>
              <div className={styles.rule} />
              <div className={styles.details}>
                {archive.acquisition.method !== 'shop' && archive.acquisition.method !== 'mission' && (
                  <DetailLine label={tUI('intel.source')}>
                    {archive.acquisition.method === 'invstgt' ? (
                      <HighlightedTemplate
                        template={tUI('intel.investUnlock')}
                        values={{ mission: gameLabel(tGame, archive.acquisition.researchId) }}
                      />
                    ) : archive.categoryId === 'document' && archive.acquisition.method === 'auto' ? (
                      tUI('intel.centralUnlock')
                    ) : methodLabel(archive, tUI)}
                  </DetailLine>
                )}
                <AcquisitionDetails archive={archive} tUI={tUI} tGame={tGame} tMainGame={tMainGame} />
              </div>
            </>
          )}
          </div>
        </div>
      </article>
    </div>
  );
};

export { IntelCard };
export default memo(IntelCard);
