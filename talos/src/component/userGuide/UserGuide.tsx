import { UserGuideTooltip } from '@/component/userGuide/tooltip/UserGuideTooltip.tsx';
import Joyride, { Step } from 'react-joyride';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import { useEffect, useState } from 'react';

const UserGuide = () => {
    const [steps, setSteps] = useState<Array<Step>>([{
        target: '[class*="sidebarToggle"]',
        content: 'test',
        placement: 'right',
        disableBeacon: false,
        spotlightClicks: true,
    },]);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const localSteps:Array<Record<string, string>> = useTranslateUI()('guide');
    useEffect(() => {

        const userGuideSteps: Array<Step> = [
            {
                target: '[class*="sidebarToggle"]',
                content: parse(localSteps[0]['content'] ?? ''),
                placement: 'right',
                disableBeacon: false,
                spotlightClicks: true,
            },
        ];

        setSteps(userGuideSteps);
    }, [localSteps, setSteps]);

    return (
        <Joyride
            steps={steps}
            run={true}
            continuous={true}
            debug={true}
            tooltipComponent={UserGuideTooltip}
            styles={{
                options: {
                    arrowColor: 'rgba(0,0,0,0)',
                    zIndex: 100000,
                },
            }}
        />
    );
};

export default UserGuide;
