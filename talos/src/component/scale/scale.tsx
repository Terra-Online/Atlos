import { useState, useEffect } from 'react';
import ScaleDesktop from './scale.desktop';
import ScaleMobile from './scale.mobile';
import L from 'leaflet';

// Main Scale component with responsive detection
const Scale = ({ map }: { map: L.Map }) => {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    return isMobile ? <ScaleMobile map={map} /> : <ScaleDesktop map={map} />;
};

export default Scale;
