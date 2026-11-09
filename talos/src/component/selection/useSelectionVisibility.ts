import { usePresence } from '@/lib/dom/usePresence';

export const useSelectionVisibility = (selecting: boolean, fadeMs: number) => {
    const { present, phase } = usePresence({ open: selecting, exitDuration: fadeMs, animateOnOpen: false });
    return { visible: present, fading: phase === 'exiting' };
};
