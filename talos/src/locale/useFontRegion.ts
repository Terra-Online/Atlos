import { useCallback, useLayoutEffect, useRef } from 'react';
import { registerFontRegion } from './fontLoader';
import type { TextRun } from './fontShards';

/** Supply rendered text from component data. Updating the alias before paint
 * prevents new text from using a previously prepared, incomplete collection. */
export function useFontRegion(runs: TextRun[]) {
    const owner = useRef<ReturnType<typeof registerFontRegion>>(undefined);
    const latest = useRef(runs);
    useLayoutEffect(() => {
        latest.current = runs;
        owner.current?.update(runs);
    });
    return useCallback((element: HTMLElement | null) => {
        owner.current?.stop();
        owner.current = element
            ? registerFontRegion(element, latest.current)
            : undefined;
    }, []);
}
