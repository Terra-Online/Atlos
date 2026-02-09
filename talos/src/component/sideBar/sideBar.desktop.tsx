import React, { useMemo, useState } from 'react';
import styles from './sideBar.module.scss';
import drawerStyles from './triggerDrawer.module.scss';

import Icon from '../../assets/images/UI/observator_6.webp';
import SidebarIcon from '../../assets/logos/sideCollap.svg?react';

// Category icons
import BossIcon from '../../assets/images/category/boss.svg?react';
import MobIcon from '../../assets/images/category/mob.svg?react';
import NaturalIcon from '../../assets/images/category/natural.svg?react';
import ExplorationIcon from '@/assets/images/category/exploration.svg?react';
import ValuableIcon from '../../assets/images/category/valuable.svg?react';
import CollectionIcon from '../../assets/images/category/collection.svg?react';
import CombatIcon from '../../assets/images/category/combat.svg?react';
import NpcIcon from '../../assets/images/category/npc.svg?react';
import FacilityIcon from '../../assets/images/category/facility.svg?react';

import Search from '../search/search';
import Drawer from '../drawer/drawer';
import { Trigger, TriggerBar } from '../trigger/trigger';
import MarkFilter from '../markFilter/markFilter';
import { MarkFilterDragProvider } from '../markFilter/reorderContext';
import MarkSelector from '../markSelector/markSelector';
import Notice from '../notice/notice';
//import IDCard from '../login/idcard';
import SupportModal from '../support/support';

// Social media icons
import GithubIcon from '../../assets/images/UI/media/ghicon.svg?react';
import DiscordIcon from '../../assets/images/UI/media/discordicon.svg?react';
import QQIcon from '../../assets/images/UI/media/qqicon.svg?react';

import { DEFAULT_SUBCATEGORY_ORDER, MARKER_TYPE_TREE, type IMarkerType } from '@/data/marker';
import { useTranslateGame, useTranslateUI } from '@/locale';
import { useSetSidebarOpen, useSidebarOpen, useTriggerCluster, useTriggerBoundary, useTriggerlabelName, useSetTriggerCluster, useSetTriggerBoundary, useSetTriggerlabelName, useDesktopDrawerSnapIndex } from '@/store/uiPrefs';
import { SelectionLayer } from './selectionLayer';

//console.log('[MARKER]', MARKER_TYPE_TREE);

const DEFAULT_SUBCATEGORY_ORDER_LIST = DEFAULT_SUBCATEGORY_ORDER as readonly string[];
const DEFAULT_SUBCATEGORY_ORDER_SET = new Set<string>(DEFAULT_SUBCATEGORY_ORDER_LIST);

const CATEGORY_ICON_MAP: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
    boss: BossIcon,
    mob: MobIcon,
    natural: NaturalIcon,
    valuable: ValuableIcon,
    collection: CollectionIcon,
    combat: CombatIcon,
    npc: NpcIcon,
    facility: FacilityIcon,
    exploration: ExplorationIcon,
};

interface SideBarProps {
    // TODO: fix this after region is nonNull
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
    visible?: boolean;
}

const SideBarDesktop = ({ currentRegion, onToggle, visible = true }: SideBarProps) => {
    const t = useTranslateUI();
    const tGame = useTranslateGame();
    const isOpen = useSidebarOpen();
    const setIsOpen = useSetSidebarOpen();
    // Persistent trigger states
    const trigCluster = useTriggerCluster();
    const trigBoundary = useTriggerBoundary();
    const trigOptimal = useTriggerlabelName();
    const setTrigCluster = useSetTriggerCluster();
    const setTrigBoundary = useSetTriggerBoundary();
    const setTrigOptimal = useSetTriggerlabelName();
    const drawerSnapIndex = useDesktopDrawerSnapIndex();

    const [supportOpen, setSupportOpen] = useState(false);

    const sidebarRef = React.useRef<HTMLDivElement>(null);

    useMemo(() => {
        if (!currentRegion) return null;
        return {
            // @ts-expect-error TODO: fix this after region is nonNull
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            main: currentRegion.main,
            // @ts-expect-error TODO: fix this after region is nonNull
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            sub: currentRegion.sub,
        };
    }, [currentRegion]);

    const toggleSidebar = () => {
        const newState = !isOpen;
        setIsOpen(newState);
        if (onToggle) {
            onToggle(newState);
        }
    };

    return (
        <div className={`${styles.sidebarContainer} ${isOpen ? styles.open : ''} ${!visible ? styles.hidden : ''}`}>
            <button
                className={`${styles.sidebarToggle} ${isOpen ? styles.open : ''} ${!visible ? styles.hidden : ''}`}
                onClick={toggleSidebar}
                aria-label={isOpen ? t('common.collapse') : t('common.expand')}
            >
                <SidebarIcon />
            </button>

            <div ref={sidebarRef} className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
                <SelectionLayer containerRef={sidebarRef} />
                <div className={styles.headIcon}>
                    <img
                        src={Icon}
                        alt={String(t('sidebar.alt.supportedBy'))}
                        draggable={'false'}
                    />
                </div>
                <div className={styles.sidebarContent}>
                    <Search />
                    <div className={styles.filters}>
                        <MarkFilterDragProvider>
                            {(
                                DEFAULT_SUBCATEGORY_ORDER_LIST.filter(
                                    (k) => Object.prototype.hasOwnProperty.call(MARKER_TYPE_TREE, k),
                                )
                            )
                                .concat(
                                    Object.keys(MARKER_TYPE_TREE).filter(
                                        (k) => !DEFAULT_SUBCATEGORY_ORDER_SET.has(k),
                                    ),
                                )
                                .map((subCategory) => {
                                    const types: IMarkerType[] = MARKER_TYPE_TREE[subCategory] ?? [];
                                    const CategoryIcon = CATEGORY_ICON_MAP[subCategory];
                                    return (
                                        <MarkFilter
                                            idKey={subCategory}
                                            title={String(tGame(`markerType.category.${subCategory}`))}
                                            icon={CategoryIcon}
                                            dataCategory={subCategory}
                                            key={subCategory}
                                        >
                                            {types.map((typeInfo) => (
                                                <MarkSelector key={typeInfo.key} typeInfo={typeInfo} />
                                            ))}
                                        </MarkFilter>
                                    );
                                })}
                        </MarkFilterDragProvider>
                    </div>
                    <Notice />
                    {/* 
                    <div className={styles.idCardContainer}>
                        <IDCard />
                    </div>
                    */}
                </div>
                <div className={styles.copyright}>
                    <a href='https://beian.miit.gov.cn/'>
                        {t('footer.icp')}
                    </a>
                </div>
                <div className={styles.socialBar}>
                    <a
                        href="https://github.com/Terra-Online/Atlos"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.socialLink}
                        data-platform="github"
                        aria-label="GitHub"
                    >
                        <GithubIcon />
                    </a>
                    <a
                        href="https://discord.gg/SJCEjH9hmr"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.socialLink}
                        data-platform="discord"
                        aria-label="Discord"
                    >
                        <DiscordIcon />
                    </a>
                    <a
                        href="https://qm.qq.com/q/BVsCJgzBL2"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.socialLink}
                        data-platform="qq"
                        aria-label="QQ"
                    >
                        <QQIcon />
                    </a>
                    <span className={styles.divide}></span>
                    <button className={styles.supportBtn} type="button" onClick={() => setSupportOpen(true)}>
                        {t('support.title')}
                    </button>
                </div>

                <SupportModal
                    open={supportOpen}
                    onClose={() => setSupportOpen(false)}
                    onChange={(open) => setSupportOpen(open)}
                />
                {/* Drawer placed above footer */}
                <Drawer
                    side='bottom'
                    initialSize={0}
                    snap={[0, 150]}
                    snapThreshold={[50, 50]}
                    snapToIndex={drawerSnapIndex}
                    handleSize={28}
                    className={drawerStyles.triggerDrawer}
                    handleClassName={drawerStyles.triggerDrawerHandle}
                    contentClassName={drawerStyles.triggerDrawerContent}
                    backdropClassName={drawerStyles.triggerDrawerBackdrop}
                    style={{ bottom: 'var(--drawer-bottom)', left: 0, right: 0 }}
                    debug={false}
                >
                    <TriggerBar>
                        <Trigger isActive={trigCluster} onToggle={(v) => setTrigCluster(v)} label={t('trigger.clusterMode')} />
                        <Trigger isActive={trigBoundary} onToggle={(v) => setTrigBoundary(v)} label={t('trigger.boundaryMode')} />
                        <Trigger isActive={trigOptimal} onToggle={(v) => setTrigOptimal(v)} label={t('trigger.labelName')} />
                    </TriggerBar>
                </Drawer>
            </div>
        </div>
    );
};

export default SideBarDesktop;