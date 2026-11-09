import { memo, useMemo, type FC, type SVGProps } from 'react';
import { DEFAULT_SUBCATEGORY_ORDER, MARKER_TYPE_TREE } from '@/data/marker';
import { BINDER_GROUPS_BY_SUB } from '@/data/marker/binder';
import { VERSION_NEW_FILTER_GROUPS } from '@/data/marker/versionNew';
import { useFontRegion } from '@/locale/useFontRegion';
import { useLocale, useTranslateGame, useTranslateUI } from '@/locale';
import MarkFilter from '@/pages/markFilter/markFilter';
import { MarkFilterDragProvider } from '@/pages/markFilter/reorderContext';
import MarkSelector from '@/pages/markSelector/markSelector';
import MarkBinder from '@/pages/markBinder/markBinder';
import styles from '@/component/shared/siteShell/sideBar.module.scss';
import filterStyles from '@/pages/markFilter/markFilter.module.scss';
import { computeBinderColumns } from './binderMasonry';
import { useSidebarModel } from './useSidebarModel';
import { SelectorRows } from './sidebarWindow';
import type { SelectorItem } from './model';
import BossIcon from '@/assets/images/category/boss.svg?react';
import MobIcon from '@/assets/images/category/mob.svg?react';
import NaturalIcon from '@/assets/images/category/natural.svg?react';
import ExplorationIcon from '@/assets/images/category/exploration.svg?react';
import ValuableIcon from '@/assets/images/category/valuable.svg?react';
import CollectionIcon from '@/assets/images/category/collection.svg?react';
import CombatIcon from '@/assets/images/category/combat.svg?react';
import NpcIcon from '@/assets/images/category/npc.svg?react';
import FacilityIcon from '@/assets/images/category/facility.svg?react';
import ArchivesIcon from '@/assets/images/category/archives.svg?react';

const icons: Record<string, FC<SVGProps<SVGSVGElement>>> = {
    boss: BossIcon, mob: MobIcon, natural: NaturalIcon, exploration: ExplorationIcon,
    valuable: ValuableIcon, collection: CollectionIcon, combat: CombatIcon,
    npc: NpcIcon, facility: FacilityIcon, archives: ArchivesIcon,
};
const order = [...DEFAULT_SUBCATEGORY_ORDER.filter(key => key in MARKER_TYPE_TREE), ...Object.keys(MARKER_TYPE_TREE).filter(key => !(DEFAULT_SUBCATEGORY_ORDER as readonly string[]).includes(key))];
export const categoryCount = VERSION_NEW_FILTER_GROUPS.length + order.length;

export const SidebarFilters = memo(function SidebarFilters({ preparedCount, columns = 2, mobile = false }: { preparedCount: number; columns?: 2 | 3 | 4; mobile?: boolean }) {
    const model = useSidebarModel(mobile);
    const t = useTranslateUI(), game = useTranslateGame(), locale = useLocale();
    // Prepare the current region's text independently of row admission. Scrolling
    // must not grow a font collection and invalidate every measured name.
    const fontRuns = useMemo(() => [
        { faces: ['db' as const, 'm' as const], text: [...model.selectors.values()].filter(item => item.count.total > 0).map(item => item.name).join('') + [...model.binders.values()].filter(item => item.count.total > 0).map(item => item.name).join(''), localized: 'game' as const },
        { faces: ['m' as const], text: order.map(category => String(game(`markerType.category.${category}`))).join(''), localized: 'game' as const },
        { faces: ['m' as const], text: VERSION_NEW_FILTER_GROUPS.map(group => String(t(group.titleKey))).join('') + String(t('markFilter.archiveHub')) + '0123456789/', localized: 'ui' as const },
    ], [model, game, t]);
    const fontRef = useFontRegion(fontRuns);
    const isCJK = /^(zh|ja|ko)(-|$)/i.test(locale);
    const countMap = new Map([...model.selectors].map(([key, item]) => [key, item.count]));
    const renderRows = (items: SelectorItem[]) => <SelectorRows items={items} columns={columns} renderItem={(item, index, style) => <MarkSelector key={item.typeInfo.key} item={item} style={style} index={index} />} />;
    return <MarkFilterDragProvider><div data-sidebar-fonts="true" ref={fontRef} style={{ display: 'contents' }}>
        {VERSION_NEW_FILTER_GROUPS.slice(0, preparedCount).map(group => {
            const items = model.version.get(group.key) ?? [];
            return <MarkFilter key={group.key} idKey={group.key} title={t(group.titleKey)} dataCategory="versionNew"
                columns={columns} itemCount={items.length} initialEmpty={items.length === 0} variant="versionNew" reorderable={false} typeKeys={group.types.map(type => type.key)}>
                {renderRows(items)}
            </MarkFilter>;
        })}
        {order.slice(0, Math.max(0, preparedCount - VERSION_NEW_FILTER_GROUPS.length)).map(category => {
            const types = MARKER_TYPE_TREE[category];
            const binderData = (mobile || columns >= 3) ? BINDER_GROUPS_BY_SUB[category] : undefined;
            const items = (binderData?.remaining ?? types).map(type => model.selectors.get(type.key)!).filter(item => item.visible);
            const binders = binderData?.groups.map(group => model.binders.get(group.id)!).filter(item => item.visible) ?? [];
            const binderColumns = binderData ? mobile ? { left: binderData.groups, right: [] } : computeBinderColumns(binderData.groups, countMap, key => model.selectors.get(key)?.visible ?? false) : { left: [], right: [] };
            return <MarkFilter key={category} idKey={category} title={String(game(`markerType.category.${category}`))}
                titleSuffix={category === 'archives' ? <a className={filterStyles.filterTitleLink} href="https://oem.re/intel" target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>
                    {isCJK ? '「' : '('}{String(t('markFilter.archiveHub'))}{isCJK ? '」' : ')'}
                </a> : undefined}
                icon={icons[category]} dataCategory={category} columns={columns} binderMode={!!binderData}
                itemCount={items.length + binders.reduce((count, item) => count + 1 + (item.collapseChildren ? 0 : item.children.length), 0)} initialEmpty={items.length === 0 && binders.length === 0} typeKeys={types.map(type => type.key)}>
                {binderData ? <>
                    <div className={styles.binderSection}>
                        {[binderColumns.left, ...(mobile ? [] : [binderColumns.right])].map((groups, index) => <div className={styles.binderColumn} key={index}>
                            {groups.map(group => model.binders.get(group.id)!).filter(item => item.visible).map(item => <MarkBinder key={item.group.id} item={item} mobile={mobile} />)}
                        </div>)}
                    </div>
                    {items.length > 0 && <div className={styles.remainingSection} style={{ gridTemplateColumns: `var(--mark-filter-columns, repeat(${columns}, minmax(0, 1fr)))` }}>
                        {renderRows(items)}
                    </div>}
                </> : renderRows(items)}
            </MarkFilter>;
        })}
    </div></MarkFilterDragProvider>;
});
