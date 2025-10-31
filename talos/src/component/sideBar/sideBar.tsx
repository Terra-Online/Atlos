import { useDevice } from '@/utils/device';
import Desktop from './sideBar.desktop';
import Mobile from './sideBar.mobile';

interface SideBarProps {
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
}

const SideBar = ({ currentRegion, onToggle }: SideBarProps) => {
    const { isMobile } = useDevice();

    return isMobile ? (
        <Mobile currentRegion={currentRegion} onToggle={onToggle} />
    ) : (
        <Desktop currentRegion={currentRegion} onToggle={onToggle} />
    );
};

export default SideBar;