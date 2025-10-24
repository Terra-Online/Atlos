import { useMemo } from 'react';
import styles from './sideBar.module.scss';

import Icon from '../../assets/images/UI/observator_6.webp';
import SidebarIcon from '../../assets/logos/sideCollap.svg?react';

import Search from '../search/search';
import MarkFilter from '../markFilter/markFilter';
import MarkSelector from '../markSelector/markSelector';

import { MARKER_TYPE_TREE } from '@/data/marker';
import { useTranslateGame, useTranslateUI } from '@/locale';
import { useSetSidebarOpen, useSidebarOpen } from '@/store/uiPrefs';

console.log('[MARKER]', MARKER_TYPE_TREE);

interface SideBarProps {
    // TODO: fix this after region is nonNull
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
}

const SideBar = ({ currentRegion, onToggle }: SideBarProps) => {
    const t = useTranslateUI();
    const tGame = useTranslateGame();
    const isOpen = useSidebarOpen();
    const setIsOpen = useSetSidebarOpen();
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
        <div
            className={`${styles.sidebarContainer} ${isOpen ? styles.open : ''}`}
        >
            <button
                className={`${styles.sidebarToggle} ${isOpen ? styles.open : ''}`}
                onClick={toggleSidebar}
            >
                <SidebarIcon />
            </button>

            <div className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
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
                        {Object.entries(MARKER_TYPE_TREE).map(
                            ([key, value]) => (
                                <MarkFilter idKey={key} title={String(tGame(`markerType.types.${key}`))} key={key}>
                                    {Object.values(value)
                                        .flat()
                                        .map((typeInfo) => (
                                            <MarkSelector
                                                key={typeInfo.key}
                                                typeInfo={typeInfo}
                                            />
                                        ))}
                                </MarkFilter>
                            ),
                        )}
                    </div>
                </div>
                <div className={styles.copyright}>
                    <a href='https://beian.miit.gov.cn/'>
                        {t('footer.icp')}
                    </a>
                </div>
            </div>
        </div>
    );
};

export default SideBar;
