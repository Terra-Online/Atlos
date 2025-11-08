import { ComponentType, useEffect, useState } from 'react';
import Loading from '@/component/loading/Loading.tsx';
import { fontLoader } from '@/utils/fontLoader.ts';

export default function LazyApp() {
    const [App, setApp] = useState<ComponentType | null>(null);
    const [maxProgress, setMaxProgress] = useState(20);
    const [resolveFn, setResolveFn] = useState<(() => void) | undefined>(
        undefined,
    );
    useEffect(() => {
        const complete = new Promise((resolve): void => {
            setResolveFn(() => resolve);
        });
        const load = async () => {
            setMaxProgress(60);
            fontLoader();
            setMaxProgress(90);
            const module = await import('./App');
            setMaxProgress(100);
            await complete; // 等待loading播放完成
            setApp(() => module.default);
        };
        void load();
    }, []);

    if (!App) {
        return (
            <Loading maxProgress={maxProgress} completeController={resolveFn} />
        );
    }

    return <App />;
}
