import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PanelProps } from '@endfield-noclip/viewer/host';
import type { TextRun } from '@/locale/fontShards';
import { registerFontRegion } from '@/locale/fontLoader';
import './panel.scss';

/** World panel chrome; the viewer supplies the same controls through named slots. */
export function Panel({
    title,
    label,
    className = '',
    actions,
    children,
}: PanelProps) {
    const [expanded, setExpanded] = useState(true);
    const [visible, setVisible] = useState(true);
    const animation = useRef<Animation | null>(null);
    const startHeight = useRef<number | null>(null);
    const bodyId = useId();
    const root = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const element = root.current;
        const from = startHeight.current;
        if (!element || from === null) return;
        startHeight.current = null;
        const header = element.querySelector<HTMLElement>(
            '.world-panel-header',
        )!;
        if (
            !element.animate ||
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ) {
            setVisible(expanded);
            return;
        }
        const maximumHeight = Number.parseFloat(
            getComputedStyle(element).maxHeight,
        );
        const endHeight = expanded
            ? Math.min(
                  element.scrollHeight + 2,
                  Number.isFinite(maximumHeight) ? maximumHeight : Infinity,
              )
            : header.offsetHeight + 2;
        const current = element.animate(
            { height: [`${from}px`, `${endHeight}px`] },
            { duration: 240, easing: 'cubic-bezier(0.6, 0, 0, 1)' },
        );
        animation.current = current;
        current.onfinish = () => {
            if (animation.current !== current) return;
            animation.current = null;
            setVisible(expanded);
        };
        return () => {
            current.cancel();
            if (animation.current === current) animation.current = null;
        };
    }, [expanded]);
    useLayoutEffect(() => {
        const element = root.current;
        if (!element) return;
        let glyphs = '';
        const runs = (): TextRun[] => [
            { text: glyphs, faces: ['db', 'm', 'r', 'h'] },
        ];
        const owner = registerFontRegion(element, []);
        const update = () => {
            // Game-sourced labels are outside the static UI catalog. Only new glyph demand
            // reaches the shared font loader; live statistics must not reload fonts every frame.
            const next = [
                ...new Set(
                    glyphs + (element.textContent || '').normalize('NFC'),
                ),
            ]
                .sort()
                .join('');
            if (next === glyphs) return;
            glyphs = next;
            owner.update(runs());
        };
        const observer = new MutationObserver(update);
        observer.observe(element, {
            subtree: true,
            childList: true,
            characterData: true,
        });
        update();
        return () => {
            observer.disconnect();
            owner.stop();
        };
    }, []);
    return (
        <section
            ref={root}
            className={`world-panel ${className}`}
            aria-label={label}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <header className='world-panel-header'>
                <h2>
                    <button
                        type='button'
                        className='world-panel-heading'
                        aria-expanded={expanded}
                        aria-controls={bodyId}
                        onClick={() => {
                            startHeight.current =
                                root.current!.getBoundingClientRect().height;
                            animation.current?.cancel();
                            setVisible(true);
                            setExpanded((value) => !value);
                        }}
                    >
                        <span
                            className='world-panel-disclosure'
                            aria-hidden='true'
                        />
                        <span>{title}</span>
                    </button>
                </h2>
                {actions && (
                    <div className='world-panel-actions'>{actions}</div>
                )}
            </header>
            <div
                id={bodyId}
                className='panel-body'
                hidden={!visible}
                inert={!expanded}
                aria-hidden={!expanded}
            >
                {children}
            </div>
        </section>
    );
}
