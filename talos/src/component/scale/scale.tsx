import { useDevice } from '@/utils/device';
import type { TalosMap } from '@/component/mapCore/engine';
import ScaleDesktop from './scale.desktop';
import ScaleMobile from './scale.mobile';

const Scale = ({ map }: { map: TalosMap }) => {
    const { isMobile } = useDevice();
    return isMobile ? <ScaleMobile map={map} /> : <ScaleDesktop map={map} />;
};

export default Scale;