import { Step } from 'react-joyride';
import parse from 'html-react-parser';

const baseStep: Step = {
    disableBeacon: false,
    spotlightClicks: true,
};

export default function generateSteps(contents: Array<string>) {
    const userGuideSteps: Array<Step> = [
        {
            ...baseStep,
            target: '[class*="sidebarToggle"]',
            content: parse(contents[0] ?? ''),
            placement: 'right',
        },
    ];
}