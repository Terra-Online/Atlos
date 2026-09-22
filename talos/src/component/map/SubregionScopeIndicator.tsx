import { useTranslateGame, useTranslateUI } from '@/locale';
import { useMarkerStore } from '@/store/marker';
import { getSubregionLabel } from './subregionLabel';
import styles from './SubregionScopeIndicator.module.scss';

const SubregionScopeIndicator = () => {
    const tUI = useTranslateUI();
    const tGame = useTranslateGame();
    const visibleSubregionKey = useMarkerStore((state) => state.visibleSubregionKey);
    if (!visibleSubregionKey) return null;

    const regionName = getSubregionLabel(visibleSubregionKey, (key) => String(tGame(key)));
    const label = String(tUI('contextMenu.scopeLabel') || '{region}').replace('{region}', regionName);
    return (
        <div className={styles.indicator} role="status">
            <span>{label}</span>
            <button
                type="button"
                aria-label={String(tUI('contextMenu.showAllSubregions'))}
                title={String(tUI('contextMenu.showAllSubregions'))}
                onClick={() => useMarkerStore.getState().setVisibleSubregionKey(null)}
            >
                ×
            </button>
        </div>
    );
};

export default SubregionScopeIndicator;
