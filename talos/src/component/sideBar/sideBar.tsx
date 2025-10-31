import { useEffect, useState } from 'react';
import Desktop from './sideBar.desktop';
import Mobile from './sideBar.mobile';

interface SideBarProps {
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
}

const SideBar = ({ currentRegion, onToggle }: SideBarProps) => {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth <= 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    return isMobile ? (
        <Mobile currentRegion={currentRegion} onToggle={onToggle} />
    ) : (
        <Desktop currentRegion={currentRegion} onToggle={onToggle} />
    );
};

export default SideBar;
