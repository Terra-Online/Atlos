import { useDevice } from '@/platform/device';
import { useIncrementLayoutVersion } from '@/store/uiPrefs';
import { useEffect, useRef } from 'react';
import Desktop from '@/pages/sideBar/sideBar.desktop';
import Mobile from '@/pages/sideBar/sideBar.mobile';

interface SideBarProps {
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
    visible?: boolean;
}

const SideBar = ({ currentRegion, onToggle, visible = true }: SideBarProps) => {
    const { isMobile } = useDevice();
    const incrementLayoutVersion = useIncrementLayoutVersion();
    const fontLayoutFrame = useRef<number | null>(null);

    // Font region commits change text metrics without changing React props.
    // Coalesce body-level commits into one layout pass so Motion does not keep
    // a stale projection on binder rows while the shard set is being swapped.
    useEffect(() => {
        const onFontRegionChange = (event: Event) => {
            if (event.target !== document.body || fontLayoutFrame.current !== null) return;
            fontLayoutFrame.current = window.requestAnimationFrame(() => {
                fontLayoutFrame.current = null;
                incrementLayoutVersion();
            });
        };
        document.addEventListener('fontregionchange', onFontRegionChange);
        return () => {
            document.removeEventListener('fontregionchange', onFontRegionChange);
            if (fontLayoutFrame.current !== null) {
                window.cancelAnimationFrame(fontLayoutFrame.current);
                fontLayoutFrame.current = null;
            }
        };
    }, [incrementLayoutVersion]);

    return isMobile ? (
        <Mobile currentRegion={currentRegion} onToggle={onToggle} visible={visible} />
    ) : (
        <Desktop currentRegion={currentRegion} onToggle={onToggle} visible={visible} />
    );
};

export default SideBar;
