import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import SideBarFrame from '@main/component/sideBar/sideBar.frame';
import Drawer from '@main/component/drawer/drawer';
import { Trigger, TriggerBar } from '@main/component/trigger/trigger';
import drawerStyles from '@main/component/sideBar/triggerDrawer.module.scss';
import { useTranslateGame, useTranslateUI } from '@intel/locale';
import { useTranslateUI as useTranslateMainUI } from '@main/locale';
import { useDevice } from '@main/platform/device';
import {
  useUiPrefsStore,
  useIntelCardsExpanded,
  useIntelSidebarWidth,
  useSetIntelCardsExpanded,
  useSetMobileDrawerSnapIndex,
} from '@main/store/uiPrefs';
import { archiveById, intelArchives, type ArchiveCategory, type IntelArchive } from '@intel/data/types';
import {
  decodeIntelImportToken,
  getIntelImportToken,
  INTEL_IMPORT_PREFIXES,
  isIntelImportDebugLocation,
} from '@intel/data/importContract';
import { useIntelCollection } from '@intel/state/collection';
import ArchiveProgressSyncHost from '@intel/state/ArchiveProgressSyncHost';
import IntelCard from '@intel/components/intelCard/intelCard';
import CategoryFilter from '@intel/components/categoryFilter/categoryFilter';
import BoxSelection from '@intel/components/boxSelection/boxSelection';
import IntelHeadBar from '@intel/components/intelHeadBar/intelHeadBar';
import IntelSidebarBrand from '@intel/components/intelSidebarBrand/intelSidebarBrand';
import SearchShared from '@main/component/search/search.shared';
import SearchMobile from '@main/component/search/search.mobile';
import PopoverTooltip from '@main/component/popover/popover';
import EmptyStateIcon from '@main/assets/images/UI/observator_6.webp';
import filterStyles from '@intel/components/categoryFilter/categoryFilter.module.scss';
import cardStyles from '@intel/components/intelCard/intelCard.module.scss';
import Banner from '@main/component/banner/banner';

const CATEGORY_ORDER: ArchiveCategory[] = ['paper', 'digital', 'collection', 'document', 'report', 'media'];
const CATEGORY_GROUPS: Array<{ id: 'intel' | 'central' | 'media'; categories: ArchiveCategory[] }> = [
  { id: 'intel', categories: ['paper', 'digital', 'collection'] },
  { id: 'central', categories: ['document', 'report'] },
  { id: 'media', categories: ['media'] },
];

const cleanTitle = (value: string) => value.replace(/<[^>]*>/g, '').trim();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INTEL_IMPORT_PATH_PATTERN = new RegExp(
  `/i/(?:${INTEL_IMPORT_PREFIXES.map(escapeRegex).join('|')})[A-Za-z0-9_-]+(?:/_debug)?/?$`,
);

const getInitialImportToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  if (isIntelImportDebugLocation(window.location)) return null;
  return getIntelImportToken(window.location);
};

const clearImportTokenFromUrl = (): void => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const pathMatch = url.pathname.match(INTEL_IMPORT_PATH_PATTERN);
  const hadImportQuery = url.searchParams.has('import');
  if (!pathMatch && !hadImportQuery) return;
  if (pathMatch) {
    url.pathname = `${url.pathname.slice(0, pathMatch.index)}\/`;
  }
  if (hadImportQuery) url.searchParams.delete('import');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
};

const getInitialTypeTarget = () => {
  if (typeof window === 'undefined') return null;
  const typeCandidates = new URLSearchParams(window.location.search)
    .getAll('type')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim());
  return typeCandidates.find((value) => value.startsWith('nar_') && archiveById.has(value)) ?? null;
};

const bucketCount = (
  archives: IntelArchive[],
  categoryId: ArchiveCategory | null,
  bucket: 'uncollected' | 'collected',
  collectedIds: Set<string>,
) => {
  const scoped = categoryId
    ? archives.filter((archive) => archive.categoryId === categoryId)
    : archives;
  const current = scoped.filter((archive) => {
    const isCollected = collectedIds.has(archive.id);
    return bucket === 'uncollected' ? !isCollected : isCollected;
  }).length;
  return { initial: scoped.length, removed: Math.max(0, scoped.length - current) };
};

const CountChange = ({ initial, removed }: { initial: number; removed: number }) => (
  <span className={cardStyles.countChange}>
    (<span className={cardStyles.countBase}>{initial}</span>
    {removed > 0 && <>{' - '}<span className={cardStyles.countRemoved}>{removed}</span></>})
  </span>
);

const CollectionTooltip = ({
  entries,
  tUI,
  tGame,
}: {
  entries: Array<{ categoryId: ArchiveCategory; count: number }>;
  tUI: (key: string) => string;
  tGame: (key: string) => string;
}) => {
  const locale = document.documentElement.lang.toLowerCase();
  const separator = locale.startsWith('zh') ? '，' : ', ';
  const summaryTemplate = tUI('intel.collectionSummary');
  const itemsToken = '{items}';
  const tokenIndex = summaryTemplate.indexOf(itemsToken);
  const summaryPrefix = tokenIndex >= 0
    ? summaryTemplate.slice(0, tokenIndex)
    : `${summaryTemplate}: `;
  const summarySuffix = tokenIndex >= 0
    ? summaryTemplate.slice(tokenIndex + itemsToken.length)
    : '';
  return (
    <span className={cardStyles.collectionTooltip}>
      {summaryPrefix}
      {entries.map(({ categoryId, count }, index) => (
        <Fragment key={categoryId}>
          {index > 0 && separator}
          <span className={cardStyles.collectionTooltipCategory}>{tGame(`category.${categoryId}`)}</span>
          <span>{`*${count}`}</span>
        </Fragment>
      ))}
      {summarySuffix}
    </span>
  );
};

const IntelCardsExpansionScope = ({
  sidebarWidth,
  children,
}: {
  sidebarWidth: number;
  children: ReactNode;
}) => {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const { isMobile } = useDevice();

  useEffect(() => useUiPrefsStore.subscribe((state, previousState) => {
    if (state.intelCardsExpanded === previousState.intelCardsExpanded) return;
    if (scopeRef.current) {
      scopeRef.current.dataset.cardsExpanded = state.intelCardsExpanded ? 'true' : 'false';
    }
  }), []);

  return (
    <div
      ref={scopeRef}
      className="app theme-transition-scope"
      data-app="intel"
      data-sidebar-open={!isMobile ? 'true' : 'false'}
      data-cards-expanded={useUiPrefsStore.getState().intelCardsExpanded ? 'true' : 'false'}
      style={{
        '--sidebar-width': `${sidebarWidth}px`,
        '--sidebar-id-card-padding-top': '1rem',
      } as CSSProperties}
    >
      {children}
    </div>
  );
};

const IntelCardsExpansionControl = () => {
  const tUI = useTranslateUI();
  const { isMobile } = useDevice();
  const cardsExpanded = useIntelCardsExpanded();
  const setCardsExpanded = useSetIntelCardsExpanded();

  if (isMobile) {
    return (
      <div className="intelMobileTriggerBar">
        <Trigger
          isActive={cardsExpanded}
          onToggle={setCardsExpanded}
          label={tUI('intel.showDetails')}
        />
      </div>
    );
  }

  return (
    <div className="intelBottomTools">
      <Drawer
        side="bottom"
        initialSize={0}
        snap={[0, 56]}
        snapThreshold={[28, 28]}
        handleSize={28}
        className={drawerStyles.triggerDrawer}
        handleClassName={drawerStyles.triggerDrawerHandle}
        contentClassName={drawerStyles.triggerDrawerContent}
        backdropClassName={drawerStyles.triggerDrawerBackdrop}
      >
        <TriggerBar>
          <Trigger
            isActive={cardsExpanded}
            onToggle={setCardsExpanded}
            label={tUI('intel.showDetails')}
          />
        </TriggerBar>
      </Drawer>
    </div>
  );
};

function App() {
  const tUI = useTranslateUI();
  const tGame = useTranslateGame();
  const tMainUI = useTranslateMainUI();
  const pageTitleTemplate = tUI('intel.pageTitle');
  const pageTitle = pageTitleTemplate.includes('{site}')
    ? pageTitleTemplate.replace('{site}', tMainUI('meta.title'))
    : pageTitleTemplate;
  const sidebarWidth = useIntelSidebarWidth();
  const { isMobile } = useDevice();
  const setMobileDrawerSnapIndex = useSetMobileDrawerSnapIndex();
  const { collectedIds, toggle, applyCollectedState, isReady } = useIntelCollection(intelArchives);
  const [importToken] = useState<string | null>(getInitialImportToken);
  const [importStatus, setImportStatus] = useState<'none' | 'pending' | 'success' | 'error'>(
    () => importToken ? 'pending' : 'none',
  );
  const [importCount, setImportCount] = useState<number | null>(null);
  const [selectIncompleteCategories, setSelectIncompleteCategories] = useState(false);
  const [bannerSchema, setBannerSchema] = useState<'light' | 'dark'>('light');
  const didHandleImportRef = useRef(false);
  const [areUiPrefsReady, setAreUiPrefsReady] = useState(() => useUiPrefsStore.persist.hasHydrated());
  const [categories, setCategories] = useState<ArchiveCategory[]>([]);
  const [query, setQuery] = useState('');
  const [collectedAtLoad, setCollectedAtLoad] = useState<Set<string> | null>(null);
  const [typeTargetId, setTypeTargetId] = useState<string | null>(getInitialTypeTarget);
  const sidebarSelectionRef = useRef<HTMLDivElement | null>(null);
  const contentSelectionRef = useRef<HTMLDivElement | null>(null);
  const suppressContentClickRef = useRef(false);
  const didScrollToTypeTargetRef = useRef(false);
  const hadSearchQueryRef = useRef(false);

  const toggleArchive = useCallback((archive: IntelArchive) => {
    toggle(archive);
  }, [toggle]);

  useEffect(() => {
    if (pageTitle) document.title = pageTitle;
  }, [pageTitle]);

  useEffect(() => {
    if (isMobile) setMobileDrawerSnapIndex(0);
  }, [isMobile, setMobileDrawerSnapIndex]);

  useEffect(() => {
    const root = document.documentElement;
    const readTheme = () => setBannerSchema(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hasSearchQuery = query.trim().length > 0;
    if (isMobile && !hadSearchQueryRef.current && hasSearchQuery) {
      setMobileDrawerSnapIndex(1);
    }
    hadSearchQueryRef.current = hasSearchQuery;
  }, [isMobile, query, setMobileDrawerSnapIndex]);

  useEffect(() => {
    const markReady = () => setAreUiPrefsReady(true);
    const unsubscribe = useUiPrefsStore.persist.onFinishHydration(markReady);
    if (useUiPrefsStore.persist.hasHydrated()) markReady();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!importToken || !isReady || didHandleImportRef.current) return;
    didHandleImportRef.current = true;

    const knownArchiveIds = new Set(intelArchives.map((archive) => archive.id));
    void decodeIntelImportToken(importToken, knownArchiveIds)
      .then(({ payload }) => {
        const importedIds = new Set([...payload.collected, ...payload.notCollected]);
        const importedCollectedIds = new Set(payload.collected);
        const importedArchives = intelArchives.filter((archive) => importedIds.has(archive.id));
        applyCollectedState(importedArchives, importedCollectedIds);
        // Keep the initial card snapshot aligned with the state written by the
        // import. This prevents the first render after import from using the
        // pre-import hydration snapshot.
        const nextCollectedIds = new Set(collectedIds);
        importedArchives.forEach((archive) => {
          if (importedCollectedIds.has(archive.id)) nextCollectedIds.add(archive.id);
          else nextCollectedIds.delete(archive.id);
        });
        setCollectedAtLoad(nextCollectedIds);
        setImportCount(payload.collected.length);
        setSelectIncompleteCategories(true);
        setImportStatus('success');
        clearImportTokenFromUrl();
      })
      .catch(() => {
        setImportStatus('error');
        clearImportTokenFromUrl();
      });
  }, [applyCollectedState, collectedIds, importToken, isReady]);

  useEffect(() => {
    if (!areUiPrefsReady || !isReady || collectedAtLoad || importStatus === 'pending') return;
    setCollectedAtLoad(new Set(collectedIds));
  }, [areUiPrefsReady, collectedAtLoad, collectedIds, importStatus, isReady]);

  useEffect(() => {
    if (!collectedAtLoad || !typeTargetId || didScrollToTypeTargetRef.current) return;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const target = Array.from(
          contentSelectionRef.current?.querySelectorAll<HTMLElement>('[data-intel-archive]') ?? [],
        ).find((element) => element.dataset.intelArchive === typeTargetId);
        if (!target) return;
        didScrollToTypeTargetRef.current = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [collectedAtLoad, typeTargetId]);

  const stats = useMemo(() => Object.fromEntries(CATEGORY_ORDER.map((categoryId) => {
    const archives = intelArchives.filter((archive) => archive.categoryId === categoryId);
    return [categoryId, {
      total: archives.length,
      collected: archives.filter((archive) => collectedIds.has(archive.id)).length,
    }];
  })) as Record<ArchiveCategory, { total: number; collected: number }>, [collectedIds]);

  useEffect(() => {
    if (!selectIncompleteCategories || !collectedAtLoad) return;
    setCategories(CATEGORY_ORDER.filter((categoryId) => stats[categoryId].collected < stats[categoryId].total));
    setSelectIncompleteCategories(false);
  }, [collectedAtLoad, selectIncompleteCategories, stats]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => intelArchives.filter((archive) => {
    if (categories.length > 0 && !categories.includes(archive.categoryId)) return false;
    if (!normalizedQuery) return true;
    return cleanTitle(tGame(archive.id)).toLocaleLowerCase().includes(normalizedQuery);
  }), [categories, normalizedQuery, tGame]);
  const uncollected = collectedAtLoad ? visible.filter((archive) => !collectedAtLoad.has(archive.id)) : [];
  const collected = collectedAtLoad ? visible.filter((archive) => collectedAtLoad.has(archive.id)) : [];

  const toggleCategory = useCallback((categoryId: ArchiveCategory) => {
    setCategories((current) => current.includes(categoryId)
      ? current.filter((id) => id !== categoryId)
      : [...current, categoryId]);
  }, []);

  const changeCategories = useCallback((keys: string[]) => {
    setCategories(keys.filter((key): key is ArchiveCategory => CATEGORY_ORDER.includes(key as ArchiveCategory)));
  }, []);

  const changeArchives = useCallback((keys: string[]) => {
    suppressContentClickRef.current = true;
    window.requestAnimationFrame(() => { suppressContentClickRef.current = false; });
    applyCollectedState(visible, new Set(keys));
  }, [applyCollectedState, visible]);

  const dismissTypeTarget = useCallback((archiveId: string) => {
    setTypeTargetId((current) => current === archiveId ? null : current);
  }, []);

  const externalSearch = {
    value: query,
    resultCount: visible.length,
    placeholder: tUI('intel.search'),
    onChange: setQuery,
  };

  const sidebarContent = (
    <div className="intelSidebarSelection">
      <BoxSelection
        containerRef={sidebarSelectionRef}
        itemSelector="[data-intel-category]"
        keyAttribute="data-intel-category"
        activeAttribute="data-active"
        getInitialKeys={() => categories}
        onChange={changeCategories}
      />
      <div className="intelSearchBar">
        {isMobile
          ? <SearchMobile external={externalSearch} />
          : <SearchShared external={externalSearch} />}
      </div>
      <div className={filterStyles.intelCtgr}>
        {CATEGORY_GROUPS.map((group, groupIndex) => {
          const groupCollected = group.categories.reduce((sum, categoryId) => sum + stats[categoryId].collected, 0);
          const groupTotal = group.categories.reduce((sum, categoryId) => sum + stats[categoryId].total, 0);
          return (
            <Fragment key={group.id}>
              {groupIndex > 0 && <div className={filterStyles.categoryDivide} aria-hidden="true" />}
              <section className={filterStyles.categoryGroup}>
                <h2 className={filterStyles.categoryGroupTitle} data-complete={groupCollected === groupTotal ? 'true' : 'false'}>
                  <span>{tGame(`group.${group.id}`)}</span><span aria-hidden="true">|</span><span>{groupCollected}/{groupTotal}</span>
                </h2>
                <nav className={filterStyles.categoryFilters} aria-label={tGame(`group.${group.id}`)}>
                  {group.categories.map((categoryId) => (
                    <CategoryFilter
                      key={categoryId}
                      categoryId={categoryId}
                      label={tGame(`category.${categoryId}`)}
                      statusLabel={stats[categoryId].collected === stats[categoryId].total ? tUI('intel.collectionComplete') : tUI('intel.collecting')}
                      collected={stats[categoryId].collected}
                      total={stats[categoryId].total}
                      active={categories.includes(categoryId)}
                      onToggle={toggleCategory}
                    />
                  ))}
                </nav>
              </section>
            </Fragment>
          );
        })}
      </div>
    </div>
  );

  const renderBucket = (
    bucket: 'uncollected' | 'collected',
    archives: IntelArchive[],
    stackOffset: number,
  ) => {
    if (!collectedAtLoad) return null;
    const totalCount = bucketCount(archives, null, bucket, collectedIds);
    const collectedEntries = bucket === 'uncollected'
      ? CATEGORY_ORDER.flatMap((categoryId) => {
        const { removed } = bucketCount(archives, categoryId, bucket, collectedIds);
        return removed > 0 ? [{ categoryId, count: removed }] : [];
      })
      : [];
    const hasCollectionTooltip = collectedEntries.length > 0;
    let categoryOffset = 0;
    return (
      <section className={cardStyles.archiveSection} aria-labelledby={`${bucket}-title`}>
        <PopoverTooltip
          content={<CollectionTooltip entries={collectedEntries} tUI={tUI} tGame={tGame} />}
          placement="top"
          gap={4}
          disabled={!hasCollectionTooltip}
        >
          <h2 id={`${bucket}-title`} data-has-tooltip={hasCollectionTooltip ? 'true' : undefined}>
            {tUI(`intel.${bucket}`)} <CountChange {...totalCount} />
          </h2>
        </PopoverTooltip>
        {CATEGORY_ORDER.map((categoryId) => {
          const categoryArchives = archives.filter((archive) => archive.categoryId === categoryId);
          if (categoryArchives.length === 0) return null;
          const categoryCount = bucketCount(archives, categoryId, bucket, collectedIds);
          const categoryTooltipEntries = bucket === 'uncollected' && categoryCount.removed > 0
            ? [{ categoryId, count: categoryCount.removed }]
            : [];
          const hasCategoryTooltip = categoryTooltipEntries.length > 0;
          const categoryStackOffset = categoryOffset;
          categoryOffset += categoryArchives.length;
          return (
            <section key={categoryId} className={cardStyles.categorySection} aria-labelledby={`${bucket}-${categoryId}-title`}>
              <PopoverTooltip
                content={<CollectionTooltip entries={categoryTooltipEntries} tUI={tUI} tGame={tGame} />}
                placement="top"
                gap={4}
                disabled={!hasCategoryTooltip}
              >
                <h3 id={`${bucket}-${categoryId}-title`} data-has-tooltip={hasCategoryTooltip ? 'true' : undefined}>
                  {tGame(`category.${categoryId}`)} <CountChange {...categoryCount} />
                </h3>
              </PopoverTooltip>
              <div className={cardStyles.grid}>
                {categoryArchives.map((archive, archiveIndex) => (
                  <IntelCard
                    key={archive.id}
                    archive={archive}
                    collected={collectedIds.has(archive.id)}
                    isTypeTarget={archive.id === typeTargetId}
                    stackOrder={visible.length - stackOffset - categoryStackOffset - archiveIndex}
                    onToggle={toggleArchive}
                    onTypeTargetHover={dismissTypeTarget}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </section>
    );
  };

  return (
    <IntelCardsExpansionScope sidebarWidth={sidebarWidth}>
      <Banner
        open={importStatus !== 'none'}
        content={
          importStatus === 'pending'
            ? tUI('intel.importPending')
            : importStatus === 'success'
              ? tUI('intel.importSuccess').replace('{count}', String(importCount ?? 0))
              : tUI('intel.importError')
        }
        onClose={() => setImportStatus('none')}
        schema={bannerSchema}
      />
      <ArchiveProgressSyncHost />
      <SideBarFrame
        lockedOpen
        fixedWidth={sidebarWidth}
        contentRef={sidebarSelectionRef}
        headIcon={<IntelSidebarBrand />}
        bottomTools={<IntelCardsExpansionControl />}
      >{sidebarContent}</SideBarFrame>
      <IntelHeadBar />
      <main className="intelMain">
        <div
          ref={contentSelectionRef}
          className="intelContent"
          onClickCapture={(event) => {
            if (!suppressContentClickRef.current) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <BoxSelection containerRef={contentSelectionRef} itemSelector="[data-intel-archive]" keyAttribute="data-intel-archive" activeAttribute="data-collected" getInitialKeys={() => collectedIds} onChange={changeArchives} />
          {!collectedAtLoad ? null : visible.length === 0 ? (
            <div className={cardStyles.emptyState} role="status">
              <img src={EmptyStateIcon} alt="" draggable="false" />
              <strong>{tUI('intel.noResults')}</strong>
              <span>{tUI('intel.noResultsHint')}</span>
            </div>
          ) : <>{uncollected.length > 0 && renderBucket('uncollected', uncollected, 0)}{collected.length > 0 && renderBucket('collected', collected, uncollected.length)}</>}
        </div>
      </main>
    </IntelCardsExpansionScope>
  );
}

export default App;
