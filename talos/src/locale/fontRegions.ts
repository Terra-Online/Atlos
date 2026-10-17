import {
    faceKeys,
    loadManifest,
    prepareFonts,
    selectRuns,
    type Prepared,
    type Selection,
    type TextRun,
    type Face,
    type Manifest,
} from './fontShards';
import type { FontRegion } from '@/lib/i18n/lang';

let nextAreaId = 0;
const pendingName = (face: Face) => `"Atlos-pending-${face}"`;
type Parts = Partial<Record<Face, string[]>>;
const selectParts = (
    manifest: Manifest,
    url: string,
    parts: Parts,
): Selection[] =>
    Object.entries(parts).flatMap(([face, keys]) =>
        (keys || []).flatMap((key) => {
            const part = manifest.faces[face as Face]?.[key];
            return part
                ? [
                      {
                          face: face as Face,
                          url: new URL(part.file, url).href,
                          range: manifest.maps[part.range],
                          bytes: part.bytes,
                      },
                  ]
                : [];
        }),
    );

/** Explicit component ownership: no DOM traversal, geometry reads or viewport listeners. */
export const createFontRegions = (doc: Document, initialRegion: FontRegion) => {
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
    let region = initialRegion;
    let stopped = false;
    const areas = new Set<{ refresh: () => void; stop: () => void }>();
    const register = (
        element: HTMLElement,
        initialRuns: TextRun[] | null = null,
    ) => {
        const originalOwner = element.getAttribute('data-font-owner');
        element.setAttribute('data-font-owner', '');
        let runs = initialRuns;
        let revision = 0;
        let disposed = false;
        let signature = '';
        let release: (() => void) | undefined;
        const original = faceKeys.map((face) =>
            element.style.getPropertyValue(`--font-${face}`),
        );
        const fallback = () => {
            for (const face of faceKeys)
                element.style.setProperty(`--font-${face}`, pendingName(face));
        };
        const changed = () =>
            element.dispatchEvent(
                new Event('fontregionchange', { bubbles: true }),
            );
        const refresh = () => {
            if (disposed || stopped) return;
            const nextSignature = JSON.stringify([region, runs]);
            if (signature === nextSignature) return;
            signature = nextSignature;
            const request = ++revision;
            fallback();
            release?.();
            release = undefined;
            changed();
            if (!region) return;
            const requestedRegion = region;
            void (async () => {
                const { manifest, url } = await loadManifest(requestedRegion);
                if (disposed || request !== revision) return;
                const preset =
                    typeof __FONT_REQUIREMENTS__ === 'undefined'
                        ? undefined
                        : __FONT_REQUIREMENTS__[requestedRegion];
                const staticParts =
                    runs === null
                        ? preset?.shell || {}
                        : Object.fromEntries(
                              [
                                  ...new Set(
                                      runs.flatMap(
                                          (run) =>
                                              run.faces.find(
                                                  (face) =>
                                                      manifest.faces[face],
                                              ) || [],
                                      ),
                                  ),
                              ].map((face) => [face, preset?.ui[face] || []]),
                          );
                const selected = [
                    ...selectParts(manifest, url, staticParts),
                    ...selectRuns(manifest, url, runs || []),
                ];
                const selection = [
                    ...new Map(
                        selected.map((part) => [
                            `${part.face}:${part.url}`,
                            part,
                        ]),
                    ).values(),
                ].sort((a, b) => a.url.localeCompare(b.url));
                const key = JSON.stringify(
                    selection.map((part) => [part.face, part.url]),
                );
                const lease = leaseFonts(key, selection);
                release = lease.release;
                const prepared = await lease.ready;
                if (disposed || request !== revision) {
                    lease.release();
                    return;
                }
                lease.activate(prepared);
                // All faces are loaded before any alias is made visible.
                for (const face of faceKeys)
                    element.style.setProperty(
                        `--font-${face}`,
                        prepared.families[face]
                            ? `"${prepared.families[face]}"`
                            : pendingName(face),
                    );
                changed();
            })().catch(() => {
                if (disposed || request !== revision) return;
                release?.();
                release = undefined;
                signature = ''; // The next explicit update/visit may retry.
            });
        };
        const area = {
            refresh,
            update(next: TextRun[]) {
                runs = next;
                refresh();
            },
            stop() {
                if (disposed) return;
                disposed = true;
                revision++;
                release?.();
                faceKeys.forEach((face, index) => {
                    if (original[index])
                        element.style.setProperty(
                            `--font-${face}`,
                            original[index],
                        );
                    else element.style.removeProperty(`--font-${face}`);
                });
                if (originalOwner === null)
                    element.removeAttribute('data-font-owner');
                else element.setAttribute('data-font-owner', originalOwner);
                areas.delete(area);
            },
        };
        areas.add(area);
        refresh();
        return area;
    };
    return {
        register,
        setRegion(next: FontRegion) {
            if (next === region) return;
            region = next;
            for (const area of areas) area.refresh();
        },
        stop() {
            stopped = true;
            for (const area of [...areas]) area.stop();
        },
    };
};
