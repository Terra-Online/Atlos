import {
    faceKeys,
    loadManifest,
    prepareFonts,
    selectRuns,
    type Face,
    type Prepared,
    type Region,
    type TextRun,
    type Selection,
} from './fontShards';
import type { FontRegion } from '@/lib/i18n/lang';

// Articles are independent content cards; portals/dialogs opt into their own
// boundary. An explicit boundary can also be used on any non-semantic container.
const boundarySelector =
    '[data-font-region], [role="dialog"], [role="tooltip"], article';
const facePattern = /^Atlos-(?:pending|area\d+-\d+)-(b|db|m|r|h)$/;
let nextAreaId = 0;
const pendingName = (face: Face) => `"Atlos-pending-${face}"`;
const fontFace = (name: string): Face | undefined =>
    name
        .trim()
        .replace(/^["']|["']$/g, '')
        .match(facePattern)?.[1] as Face | undefined;
const isVisible = (element: Element, doc: Document) => {
    const style = doc.defaultView!.getComputedStyle(element);
    if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
    )
        return false;
    const rect = element.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < doc.defaultView!.innerHeight &&
        rect.left < doc.defaultView!.innerWidth
    );
};

const collectText = (root: HTMLElement, doc: Document): TextRun[] => {
    const runs: TextRun[] = [];
    const add = (text: string, style: CSSStyleDeclaration) => {
        const families = style.fontFamily.split(',');
        const faces = families.flatMap((family) => fontFace(family) || []);
        if (!faces.length || !text.trim()) return;
        const first = families.findIndex((family) => fontFace(family));
        // Existing Latin faces take precedence. Never count ICU argument names:
        // this collector sees the formatted DOM, including dynamic values.
        const visible =
            first > 0
                ? [...text]
                      .filter((char) => char.codePointAt(0)! > 0x24f)
                      .join('')
                : text;
        if (visible) runs.push({ faces, text: visible });
    };
    const visit = (element: Element) => {
        if (element !== root && element.matches(boundarySelector)) return;
        if (
            ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS'].includes(
                element.tagName.toUpperCase(),
            )
        )
            return;
        const style = doc.defaultView!.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (isVisible(element, doc)) {
            for (const child of element.childNodes)
                if (child.nodeType === 3) add(child.textContent || '', style);
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                const input = element as HTMLInputElement | HTMLTextAreaElement;
                add(input.value, style);
                if (!input.value && input.placeholder)
                    add(
                        input.placeholder,
                        doc.defaultView!.getComputedStyle(
                            element,
                            '::placeholder',
                        ),
                    );
            }
            if (element.tagName === 'SELECT')
                add(
                    (element as HTMLSelectElement).selectedOptions[0]?.text ||
                        '',
                    style,
                );
            for (const pseudo of ['::before', '::after']) {
                const pseudoStyle = doc.defaultView!.getComputedStyle(
                    element,
                    pseudo,
                );
                let content = pseudoStyle.content;
                if (!content || content === 'none' || content === 'normal')
                    continue;
                // Browsers normally expose resolved content; support attr() too.
                content = content.replace(
                    /attr\(([\w-]+)\)/g,
                    (_all, attr: string) => element.getAttribute(attr) || '',
                );
                if (/^["']/.test(content)) content = content.slice(1, -1);
                add(content, pseudoStyle);
            }
        }
        // A display:contents parent has no box; its children can still be visible.
        for (const child of element.children) visit(child);
    };
    visit(root);
    return runs;
};

interface Area {
    revision: number;
    signature: string;
    fonts: FontFace[];
    dispose?: () => void;
    pending?: () => void;
    family: string;
    binding: string;
    variables: string[];
    region?: Region;
    selection?: string;
}

/** Each document owns its observers and FontFaces, including picture-in-picture. */
export const observeFontRegions = (
    doc: Document,
    initialRegion: FontRegion,
) => {
    const areas = new Map<HTMLElement, Area>();
    const batches = new Map<
        string,
        {
            ready: Promise<Prepared>;
            refs: number;
            registered: boolean;
            prepared?: Prepared;
        }
    >();
    const leaseFonts = (key: string, selection: Selection[]) => {
        let batch = batches.get(key);
        if (!batch) {
            batch = {
                ready: prepareFonts(selection, `area${++nextAreaId}-0`),
                refs: 0,
                registered: false,
            };
            batches.set(key, batch);
        }
        const entry = batch;
        entry.refs++;
        let released = false;
        return {
            ready: entry.ready,
            activate(prepared: Prepared) {
                if (released) return;
                if (!entry.registered) {
                    try {
                        for (const font of prepared.fonts) doc.fonts.add(font);
                    } catch (error) {
                        for (const font of prepared.fonts)
                            doc.fonts.delete(font);
                        throw error;
                    }
                    entry.prepared = prepared;
                    entry.registered = true;
                }
            },
            release: () => {
                if (released) return;
                released = true;
                if (--entry.refs === 0) {
                    for (const font of entry.prepared?.fonts || [])
                        doc.fonts.delete(font);
                    if (batches.get(key) === entry) batches.delete(key);
                }
            },
        };
    };
    const ownStyles = new WeakMap<HTMLElement, string | null>();
    let region = initialRegion;
    let stopped = false;
    let scheduled = false;
    let frame = 0;
    let allDirty = true;
    const dirty = new Set<HTMLElement>();
    const styleWritten = (element: HTMLElement) =>
        ownStyles.set(element, element.getAttribute('style'));
    const fallback = (element: HTMLElement) => {
        for (const face of faceKeys)
            element.style.setProperty(`--font-${face}`, pendingName(face));
        styleWritten(element);
    };
    const release = (area: Area) => {
        area.pending?.();
        area.pending = undefined;
        area.dispose?.();
        area.dispose = undefined;
        area.fonts = [];
    };
    const activate = (
        element: HTMLElement,
        area: Area,
        prepared: Prepared,
        lease: ReturnType<typeof leaseFonts>,
    ) => {
        // Equal complete selections can share one loaded alias. Pending regions
        // never refer to it; a different selection always gets another alias.
        lease.activate(prepared);
        area.dispose?.();
        area.dispose = lease.release;
        area.pending = undefined;
        area.fonts = prepared.fonts;
        for (const face of faceKeys)
            element.style.setProperty(
                `--font-${face}`,
                prepared.families[face]
                    ? `"${prepared.families[face]}"`
                    : pendingName(face),
            );
        styleWritten(element);
        element.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
    };
    const refresh = (element: HTMLElement) => {
        let area = areas.get(element);
        if (!area) {
            area = {
                revision: 0,
                signature: '',
                fonts: [],
                family: element.style.fontFamily,
                binding: '',
                variables: faceKeys.map((face) =>
                    element.style.getPropertyValue(`--font-${face}`),
                ),
            };
            areas.set(element, area);
            fallback(element);
        }
        // Re-evaluate the original declaration so responsive styles and class
        // changes on a boundary keep their existing precedence.
        if (area.binding && element.style.fontFamily !== area.binding)
            area.family = element.style.fontFamily;
        element.style.fontFamily = area.family;
        const inherited = doc.defaultView!.getComputedStyle(element).fontFamily;
        element.style.fontFamily = inherited
            .split(',')
            .map((family) => {
                const face = fontFace(family);
                return face
                    ? `var(--font-${face}, ${pendingName(face)})`
                    : family;
            })
            .join(',');
        area.binding = element.style.fontFamily;
        styleWritten(element);
        const runs =
            element === doc.body || isVisible(element, doc)
                ? collectText(element, doc)
                : [];
        const signature = JSON.stringify([region, runs]);
        if (signature === area.signature) return;
        area.signature = signature;
        const revision = ++area.revision;
        area.pending?.();
        area.pending = undefined;
        const current = area;
        // MutationObserver runs before paint: new content never uses an
        // incomplete alias while its additional shards are in flight.
        fallback(element);
        element.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
        if (!region || !runs.length) {
            release(area);
            area.selection = undefined;
            return;
        }
        const requestedRegion = region;
        void (async () => {
            const { manifest, url } = await loadManifest(requestedRegion);
            if (
                stopped ||
                current.revision !== revision ||
                !element.isConnected
            )
                return;
            const selection = selectRuns(manifest, url, runs);
            const key = JSON.stringify(
                selection.map((part) => [part.face, part.url]),
            );
            if (
                current.selection === key &&
                current.region === requestedRegion
            ) {
                for (const face of faceKeys) {
                    const font = current.fonts.find((font) =>
                        font.family.endsWith(`-${face}`),
                    );
                    element.style.setProperty(
                        `--font-${face}`,
                        font ? `"${font.family}"` : pendingName(face),
                    );
                }
                styleWritten(element);
                return;
            }
            const lease = leaseFonts(key, selection);
            current.pending = lease.release;
            const prepared = await lease.ready;
            if (
                stopped ||
                current.revision !== revision ||
                !element.isConnected
            ) {
                lease.release();
                return;
            }
            activate(element, current, prepared, lease);
            current.selection = key;
            current.region = requestedRegion;
        })().catch(() => {
            if (current.revision !== revision) return;
            release(current);
            current.selection = undefined;
            // Allow a later visit/content update to retry, without a retry loop.
            current.signature = '';
        });
    };
    const restore = (element: HTMLElement, area: Area) => {
        area.revision++;
        release(area);
        element.style.fontFamily = area.family;
        faceKeys.forEach((face, index) => {
            if (area.variables[index])
                element.style.setProperty(
                    `--font-${face}`,
                    area.variables[index],
                );
            else element.style.removeProperty(`--font-${face}`);
        });
        styleWritten(element);
    };
    const scan = () => {
        scheduled = false;
        if (stopped || !doc.body) return;
        const boundaries = [
            doc.body,
            ...doc.body.querySelectorAll<HTMLElement>(boundarySelector),
        ];
        const live = new Set(boundaries);
        for (const [element, area] of areas)
            if (!live.has(element)) {
                restore(element, area);
                areas.delete(element);
            }
        for (const element of boundaries)
            if (allDirty || dirty.has(element) || !areas.has(element))
                refresh(element);
        allDirty = false;
        dirty.clear();
    };
    const schedule = () => {
        if (scheduled || stopped) return;
        scheduled = true;
        queueMicrotask(scan);
    };
    const observer = new MutationObserver((records) => {
        let changed = false;
        for (const record of records) {
            const element =
                record.target.nodeType === 1
                    ? (record.target as HTMLElement)
                    : record.target.parentElement;
            if (!element) continue;
            if (
                record.type === 'attributes' &&
                record.attributeName === 'style' &&
                ownStyles.get(element) === element.getAttribute('style')
            )
                continue;
            if (
                ['IMG', 'SVG', 'PATH', 'CANVAS'].includes(element.tagName) ||
                element.closest('.leaflet-tile-pane')
            )
                continue;
            const owner =
                element.closest<HTMLElement>(boundarySelector) || doc.body;
            if (owner) dirty.add(owner);
            for (const child of element.querySelectorAll<HTMLElement>(
                boundarySelector,
            ))
                dirty.add(child);
            changed = true;
        }
        if (changed) schedule();
    });
    observer.observe(doc.documentElement, {
        childList: true,
        characterData: true,
        attributes: true,
        subtree: true,
    });
    const onViewport = () => {
        if (!frame)
            frame = doc.defaultView!.requestAnimationFrame(() => {
                frame = 0;
                allDirty = true;
                schedule();
            });
    };
    const rescan = () => {
        allDirty = true;
        schedule();
    };
    doc.addEventListener('input', rescan, true);
    doc.addEventListener('scroll', onViewport, true);
    doc.defaultView!.addEventListener('resize', onViewport);
    // A lazy stylesheet/animation can reveal text without adding DOM nodes.
    doc.addEventListener('load', rescan, true);
    doc.addEventListener('transitionend', rescan, true);
    doc.addEventListener('animationend', rescan, true);
    schedule();
    return {
        setRegion(next: FontRegion) {
            if (next !== region) {
                region = next;
                allDirty = true;
                schedule();
            }
        },
        refresh: rescan,
        stop() {
            stopped = true;
            observer.disconnect();
            doc.removeEventListener('input', rescan, true);
            doc.removeEventListener('scroll', onViewport, true);
            doc.defaultView!.removeEventListener('resize', onViewport);
            doc.removeEventListener('load', rescan, true);
            doc.removeEventListener('transitionend', rescan, true);
            doc.removeEventListener('animationend', rescan, true);
            doc.defaultView!.cancelAnimationFrame(frame);
            for (const [element, area] of areas) restore(element, area);
            areas.clear();
        },
    };
};
