import { useDevice } from '@/utils/device';
import Desktop from './sideBar.desktop';
import Mobile from './sideBar.mobile';

interface SideBarProps {
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
    visible?: boolean;
}

const SideBar = ({ currentRegion, onToggle, visible = true }: SideBarProps) => {
    const { isMobile } = useDevice();

    return isMobile ? (
        <Mobile currentRegion={currentRegion} onToggle={onToggle} visible={visible} />
    ) : (
        <Desktop currentRegion={currentRegion} onToggle={onToggle} visible={visible} />
    );
};

export default SideBar;