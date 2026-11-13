import {
    UIOverlayLayer,
    SwitchArea,
} from '@/component/shared/uiOverlay/UIOverlayLayer';
import overlayStyles from '@/component/shared/uiOverlay/UIOverlay.module.scss';
import { RegionMenu } from '@/component/regionSwitch/regionSwitch';
import { useDevice } from '@/platform/device';
import { useTranslate } from '@/locale';
import { useFontRegion } from '@/locale/useFontRegion';
import { regionFontRuns } from '@/locale/mapFonts';

export function Regions({
    region,
    subregion,
    preparing,
    onSelect,
}: {
    region: string;
    subregion: string | null;
    preparing: string | null;
    onSelect: (region: string, subregion?: string) => void;
}) {
    const { isMobile } = useDevice();
    const t = useTranslate();
    const fonts = useFontRegion(regionFontRuns(t));
    return (
        <UIOverlayLayer mobile={isMobile} sidebarOpen={false}>
            <div className={overlayStyles.overlayContent}>
                <SwitchArea style={{ top: 'max(26%, 236px)' }}>
                    <div ref={fonts} className='world-regions'>
                        <RegionMenu
                            currentRegionKey={region}
                            currentSubregionKey={subregion}
                            isSidebarOpen={false}
                            preparing={preparing}
                            onSelect={onSelect}
                        />
                    </div>
                </SwitchArea>
            </div>
        </UIOverlayLayer>
    );
}
