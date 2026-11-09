import { useCallback, useLayoutEffect, useRef } from 'react';
import { registerFontRegion, type FontRegionOptions } from './fontLoader';
import type { TextRun } from './fontShards';

/** Supply rendered text before paint. The owner prepares changed demand while
 * retaining its previous complete aliases until the replacement is ready. */
export function useFontRegion(
    runs: TextRun[],
    options?: FontRegionOptions,
) {
    const scope = options?.scope;
    const owner = useRef<ReturnType<typeof registerFontRegion>>(undefined);
    const latest = useRef(runs);
    const latestOptions = useRef<FontRegionOptions | undefined>(options);
    useLayoutEffect(() => {
        latest.current = runs;
        latestOptions.current = scope ? { scope } : undefined;
        owner.current?.update(runs);
    }, [runs, scope]);
    return useCallback((element: HTMLElement | null) => {
        owner.current?.stop();
        owner.current = element
            ? registerFontRegion(element, latest.current, latestOptions.current)
            : undefined;
    }, [scope]);
}
