import { useDevice } from '@/platform/device';
import L from 'leaflet';
import ScaleDesktop from '@/pages/scale/scale.desktop';
import ScaleMobile from '@/pages/scale/scale.mobile';

const Scale = ({ map }: { map: L.Map }) => {
    const { isMobile } = useDevice();
    return isMobile ? <ScaleMobile map={map} /> : <ScaleDesktop map={map} />;
};

export default Scale;