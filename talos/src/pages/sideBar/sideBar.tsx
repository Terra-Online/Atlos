import { useAppDocument } from '@/platform/pictureInPicture';
import { useDevice } from '@/platform/device';
import { useIncrementLayoutVersion } from '@/store/uiPrefs';
import { useLayoutEffect, useRef } from 'react';
import Desktop from '@/pages/sideBar/sideBar.desktop';
import Mobile from '@/pages/sideBar/sideBar.mobile';

interface SideBarProps {
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
    visible?: boolean;
}

const SideBar = ({ currentRegion, onToggle, visible = true }: SideBarProps) => {
    const { isMobile } = useDevice();
    const ownerDocument = useAppDocument();
    const incrementLayoutVersion = useIncrementLayoutVersion();
    const fontLayoutFrame = useRef<number | null>(null);

    // Font region commits change text metrics without changing React props.
    // Coalesce shell and sidebar font commits into one layout pass so Motion does not keep
    // a stale projection on binder rows while the shard set is being swapped.
    useLayoutEffect(() => {
        const view = ownerDocument?.defaultView;
        if (!ownerDocument || !view) return undefined;
        const onFontRegionChange = (event: Event) => {
            const target = event.target;
            // Adopted PiP nodes can retain the opener's Element prototype.
            const sidebarCommit = (target instanceof Element || target instanceof view.Element) && target.hasAttribute('data-sidebar-fonts');
            if (fontLayoutFrame.current !== null || (target !== ownerDocument.body && !sidebarCommit)) return;
            fontLayoutFrame.current = view.requestAnimationFrame(() => {
                fontLayoutFrame.current = null;
                incrementLayoutVersion();
            });
        };
        ownerDocument.addEventListener('fontregionchange', onFontRegionChange);
        return () => {
            ownerDocument.removeEventListener('fontregionchange', onFontRegionChange);
            if (fontLayoutFrame.current !== null) {
                view.cancelAnimationFrame(fontLayoutFrame.current);
                fontLayoutFrame.current = null;
            }
        };
    }, [incrementLayoutVersion, ownerDocument]);

    return isMobile ? (
        <Mobile currentRegion={currentRegion} onToggle={onToggle} visible={visible} />
    ) : (
        <Desktop currentRegion={currentRegion} onToggle={onToggle} visible={visible} />
    );
};

export default SideBar;
