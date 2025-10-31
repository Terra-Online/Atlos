import { useDevice } from '@/utils/device';
import L from 'leaflet';
import ScaleDesktop from './scale.desktop';
import ScaleMobile from './scale.mobile';

const Scale = ({ map }: { map: L.Map }) => {
    const { isMobile } = useDevice();
    return isMobile ? <ScaleMobile map={map} /> : <ScaleDesktop map={map} />;
};

export default Scale;