import { useTranslateGame, useTranslateUI } from '@/locale';
import { useMarkerStore } from '@/store/marker';
import { getSubregionLabel } from '@/services/map/subregionLabel';
import styles from './ScopeIndicator.module.scss';

const ScopeIndicator = () => {
    const tUI = useTranslateUI();
    const tGame = useTranslateGame();
    const visibleSubregionKey = useMarkerStore((state) => state.visibleSubregionKey);
    if (!visibleSubregionKey) return null;

    const regionName = getSubregionLabel(visibleSubregionKey, (key) => String(tGame(key)));
    const scopeLabel = String(tUI('contextMenu.scopeLabel') || '{region}');
    const [prefix, suffix = ''] = scopeLabel.split('{region}');
    const clearScopeLabel = String(tUI('contextMenu.showAllSubregions'));

    return (
        <div className={styles.indicator} role="status">
            {prefix && <span>{prefix}</span>}
            <button
                type="button"
                aria-label={clearScopeLabel}
                onClick={() => useMarkerStore.getState().setVisibleSubregionKey(null)}
            >
                {regionName}
            </button>
            {suffix && <span>{suffix}</span>}
        </div>
    );
};

export default ScopeIndicator;
