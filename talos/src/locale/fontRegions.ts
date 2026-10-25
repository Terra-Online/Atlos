import {
    faceKeys,
    type Region,
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
import { manifests, requirements, type Parts } from './fontConfig';

let nextAreaId = 0;
const pendingName = (face: Face) => `"OEM-pending-${face}"`;
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
                          range: manifest.maps[part.range ?? part.map],
                          bytes: part.bytes,
                      },
                  ]
                : [];
        }),
    );

/** Retain recently used shards, rather than duplicate overlapping collections. */
const MAX_IDLE_PARTS = 24;

export type FontScope = 'critical' | 'background';

export interface FontRegionOptions {
    scope?: FontScope;
}

/** Component ownership is explicit; loading never inspects layout or DOM
 * geometry to decide which font collection a region needs. */
export const createFontRegions = (doc: Document, initialRegion: FontRegion) => {
    let usageTick = 0;
    const alias = `area${++nextAreaId}`;
    const parts = new Map<
        string,
        {
            ready: Promise<Prepared>;
            refs: number;
            prepared?: Prepared;
            lastUsed: number;
        }
    >();
    const evictIdle = () => {
        const idle = [...parts.entries()]
            .filter(([, entry]) => entry.refs === 0)
            .sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
        while (idle.length > MAX_IDLE_PARTS) {
            const [key, entry] = idle.shift()!;
            for (const font of entry.prepared?.fonts || [])
                doc.fonts.delete(font);
            if (parts.get(key) === entry) parts.delete(key);
        }
    };
    const leaseFonts = (selection: Selection[], next: Region) => {
        // One native face per document/locale/shard. Different owners can share
        // overlapping selections without decoding the same WOFF2 repeatedly.
        const entries = selection.map((part) => {
            const key = `${next}:${part.face}:${part.url}`;
            let entry = parts.get(key);
            if (!entry) {
                entry = {
                    ready: prepareFonts([part], `${alias}-${next}`),
                    refs: 0,
                    lastUsed: ++usageTick,
                };
                parts.set(key, entry);
                const current = entry;
                void entry.ready.catch(() => {
                    if (parts.get(key) === current) parts.delete(key);
                });
            }
            entry.lastUsed = ++usageTick;
            entry.refs++;
            return entry;
        });
        const ready = Promise.all(entries.map((entry) => entry.ready)).then(
            (prepared): Prepared => ({
                fonts: prepared.flatMap((part) => part.fonts),
                families: Object.assign(
                    {},
                    ...prepared.map((part) => part.families),
                ) as Prepared['families'],
            }),
        );
        let released = false;
        return {
            ready,
            activate(prepared: Prepared) {
                if (released) return;
                const added: FontFace[] = [];
                try {
                    for (const font of prepared.fonts) {
                        if (doc.fonts.has(font)) continue;
                        doc.fonts.add(font);
                        added.push(font);
                    }
                } catch (error) {
                    for (const font of added) doc.fonts.delete(font);
                    throw error;
                }
                entries.forEach((entry, index) => {
                    entry.prepared = {
                        fonts: [prepared.fonts[index]],
                        families: prepared.families,
                    };
                    entry.lastUsed = ++usageTick;
                });
            },
            release: () => {
                if (released) return;
                released = true;
                for (const entry of entries) {
                    if (--entry.refs === 0) entry.lastUsed = ++usageTick;
                }
                evictIdle();
            },
        };
    };
    type Lease = ReturnType<typeof leaseFonts>;
    let warmRegion: Region | null = null;
    let warmLeases: Lease[] = [];
    const releaseWarm = () => {
        warmLeases.forEach((lease) => lease.release());
        warmLeases = [];
        warmRegion = null;
    };
    interface Plan {
        revision: number;
        region: FontRegion;
        key: string;
        selection: Selection[];
        lease?: Lease;
        prepared?: Prepared;
    }
    interface Owner {
        readonly revision: number;
        readonly ready: Promise<void>;
        /** Visible shell/UI owners keep the language transaction atomic. */
        isCritical(): boolean;
        /** The body shell receives a second pass for deferred labels. */
        isShell(): boolean;
        prepare(next: FontRegion): Promise<Plan>;
        retry(): void;
        commit(plan: Plan): boolean;
        notify(): void;
        stop(): void;
    }
    let region = initialRegion;
    let requested = initialRegion;
    let generation = 0;
    let stopped = false;
    const areas = new Set<Owner>();
    const known = new Map<Region, Awaited<ReturnType<typeof loadManifest>>>();
    const source = async (next: Region) => {
        const result = known.get(next) || (await loadManifest(next));
        known.set(next, result);
        return result;
    };
    const select = (
        next: Region,
        { manifest, url }: Awaited<ReturnType<typeof loadManifest>>,
        runs: TextRun[] | null,
        changingLanguage = false,
    ) => {
        const preset = requirements[next];
        const staticParts =
            runs === null
                ? preset?.shell || {}
                : (Object.fromEntries(
                      [...new Set(runs.flatMap((run) => run.faces))].map(
                          (face) => [face, preset?.ui[face] || []],
                      ),
                  ) as Parts);
        return [
            ...new Map(
                [
                    ...selectParts(manifest, url, staticParts),
                    ...selectRuns(
                        manifest,
                        url,
                        (runs || []).map((run) =>
                            changingLanguage && run.localized
                                ? { ...run, text: '' }
                                : run,
                        ),
                    ),
                ].map((part) => [`${part.face}:${part.url}`, part]),
            ).values(),
        ].sort((a, b) => a.url.localeCompare(b.url));
    };
    const keyFor = (selection: Selection[]) =>
        JSON.stringify(selection.map((part) => [part.face, part.url]));
    const register = (
        element: HTMLElement,
        initialRuns: TextRun[] | null = null,
        options: FontRegionOptions = {},
    ) => {
        const isCritical = () => options.scope !== 'background';
        const isShell = () => initialRuns === null;
        const originalOwner = element.getAttribute('data-font-owner');
        element.setAttribute('data-font-owner', '');
        let runs = initialRuns;
        let revision = 0;
        let work = 0;
        let disposed = false;
        let signature = JSON.stringify(runs);
        let active: Plan | undefined;
        let ready = Promise.resolve();
        let inFallback = false;
        let failed = false;
        const original = faceKeys.map((face) =>
            element.style.getPropertyValue(`--font-${face}`),
        );
        const fallback = () => {
            if (inFallback) return;
            for (const face of faceKeys)
                element.style.setProperty(`--font-${face}`, pendingName(face));
            inFallback = true;
            changed();
        };
        const changed = () =>
            element.dispatchEvent(
                new Event('fontregionchange', { bubbles: true }),
            );
        const prepare = async (next: FontRegion): Promise<Plan> => {
            const snapshot = runs;
            const version = revision;
            const changingLanguage = next !== region;
            const selection =
                next && manifests[next]
                    ? select(
                          next,
                          await source(next),
                          snapshot,
                          changingLanguage,
                      )
                    : [];
            const plan: Plan = {
                revision: version,
                region: next,
                key: keyFor(selection),
                selection,
            };
            if (
                disposed ||
                stopped ||
                version !== revision ||
                !selection.length
            )
                return plan;
            if (!next) return plan;
            const lease = leaseFonts(selection, next);
            try {
                plan.prepared = await lease.ready;
                plan.lease = lease;
                return plan;
            } catch (error) {
                lease.release();
                throw error;
            }
        };
        const bind = (plan: Plan) => {
            for (const face of faceKeys)
                element.style.setProperty(
                    `--font-${face}`,
                    plan.prepared?.families[face]
                        ? `"${plan.prepared.families[face]}"`
                        : pendingName(face),
                );
            inFallback = !plan.prepared;
        };
        const commit = (plan: Plan) => {
            if (disposed || stopped || plan.revision !== revision) {
                plan.lease?.release();
                return false;
            }
            work++;
            if (
                !inFallback &&
                active?.key === plan.key &&
                active.region === plan.region
            ) {
                plan.lease?.release();
                return false;
            }
            if (plan.prepared) plan.lease?.activate(plan.prepared);
            bind(plan);
            const previous = active;
            active = plan;
            previous?.lease?.release();
            return true;
        };
        const refresh = () => {
            failed = false;
            const request = ++work;
            const target = region;
            const cached = target ? known.get(target) : undefined;
            const selection =
                target && cached ? select(target, cached, runs) : [];
            if (active?.region === target && cached) {
                const existing = new Set(
                    active.selection.map((part) => `${part.face}:${part.url}`),
                );
                // Text changes that remain fully covered must not reset fonts.
                if (
                    selection.every((part) =>
                        existing.has(`${part.face}:${part.url}`),
                    )
                ) {
                    ready = Promise.resolve();
                    if (inFallback) {
                        bind(active);
                        changed();
                    }
                    return;
                }
            }
            // Keep the previous complete collection while new text is prepared.
            // Dropping its aliases here makes every existing glyph flash fallback.
            if (!active) fallback();
            ready = prepare(target)
                .then((plan) => {
                    if (
                        disposed ||
                        stopped ||
                        request !== work ||
                        target !== region
                    ) {
                        plan.lease?.release();
                        return;
                    }
                    if (commit(plan)) changed();
                })
                .catch((error: unknown) => {
                    if (!disposed && request === work) {
                        failed = true;
                        signature = '';
                        console.warn('Font region preparation failed:', error);
                    }
                });
        };
        const area = {
            get revision() {
                return revision;
            },
            get ready() {
                return ready;
            },
            isCritical,
            isShell,
            prepare,
            retry() {
                if (failed) refresh();
            },
            commit,
            notify: changed,
            update(next: TextRun[]) {
                const nextSignature = JSON.stringify(next);
                if (signature === nextSignature) return;
                signature = nextSignature;
                runs = next;
                revision++;
                refresh();
            },
            stop() {
                if (disposed) return;
                disposed = true;
                revision++;
                work++;
                active?.lease?.release();
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
        async preload(next: Region) {
            if (warmRegion === next && warmLeases.length) return;
            releaseWarm();
            const critical = [...areas].filter((area) => area.isCritical());
            const results = await Promise.allSettled(
                critical.map((area) => area.prepare(next)),
            );
            const leases = results.flatMap((result) =>
                result.status === 'fulfilled' && result.value.lease
                    ? [result.value.lease]
                    : [],
            );
            if (!leases.length) return;
            warmRegion = next;
            warmLeases = leases;
        },
        /** Warm only the static shell; content regions remain demand-driven. */
        async preloadShell(next: Region) {
            const { manifest, url } = await source(next);
            const selection = select(next, { manifest, url }, null);
            if (!selection.length) return;
            const lease = leaseFonts(selection, next);
            try {
                await lease.ready;
            } finally {
                lease.release();
            }
        },
        async preloadRuns(runs: TextRun[], next: FontRegion = region) {
            if (!next || stopped || !manifests[next]) return;
            const selection = select(next, await source(next), runs);
            if (!selection.length) return;
            const lease = leaseFonts(selection, next);
            try {
                const prepared = await lease.ready;
                if (!stopped) lease.activate(prepared);
            } finally {
                lease.release();
            }
        },
        async setRegion(next: FontRegion, isCurrent = () => true) {
            if (requested !== next) {
                requested = next;
                generation++;
            }
            const request = generation;
            if (next === region) {
                for (const area of areas) area.retry();
                await Promise.all([...areas].map((area) => area.ready));
                return;
            }
            while (!stopped && request === generation && isCurrent()) {
                // The language picker masks the page while this transaction
                // runs. Only visible shell/UI owners must be ready before the
                // first commit; detail and remote text can catch up behind it.
                const snapshot = [...areas].filter((area) => area.isCritical());
                const versions = snapshot.map((area) => area.revision);
                // Keep old aliases and native faces until the entire language
                // transaction is ready. A failed request leaves them intact.
                const results = await Promise.allSettled(
                    snapshot.map((area) => area.prepare(next)),
                );
                const plans = results.flatMap((result) =>
                    result.status === 'fulfilled' ? [result.value] : [],
                );
                const release = () =>
                    plans.forEach((plan) => plan.lease?.release());
                if (stopped || request !== generation || !isCurrent()) {
                    release();
                    return;
                }
                const failed = results.find(
                    (result) => result.status === 'rejected',
                );
                if (failed?.status === 'rejected') {
                    release();
                    throw failed.reason;
                }
                const currentCritical = [...areas].filter((area) =>
                    area.isCritical(),
                );
                if (
                    snapshot.length !== currentCritical.length ||
                    snapshot.some(
                        (area, index) =>
                            !currentCritical.includes(area) ||
                            area.revision !== versions[index],
                    )
                ) {
                    release();
                    continue;
                }
                try {
                    for (const plan of plans)
                        if (plan.prepared) plan.lease?.activate(plan.prepared);
                } catch (error) {
                    release();
                    throw error;
                }
                region = next;
                const changed = snapshot.filter((area, index) =>
                    area.commit(plans[index]),
                );
                for (const area of changed) area.notify();

                // Content owners use the new region after the visible commit.
                // Their work is intentionally detached from the language
                // picker so a long list or a large prose pack cannot extend
                // the masked UI switch. Generation checks prevent a stale
                // background result from changing a newer language.
                const background = [
                    ...new Set([
                        ...[...areas].filter(
                            (area) => !snapshot.includes(area),
                        ),
                        ...[...areas].filter((area) => area.isShell()),
                    ]),
                ];
                // Let the locale commit and the next paint happen first. This
                // prevents labels/content from competing with the faces needed
                // to complete the visible language switch.
                setTimeout(() => {
                    void Promise.all(
                        background.map(async (area) => {
                            const version = area.revision;
                            try {
                                const plan = await area.prepare(next);
                                if (
                                    stopped ||
                                    request !== generation ||
                                    !isCurrent() ||
                                    !areas.has(area) ||
                                    area.revision !== version
                                ) {
                                    plan.lease?.release();
                                    return;
                                }
                                if (area.commit(plan)) area.notify();
                            } catch (error) {
                                if (
                                    !stopped &&
                                    request === generation &&
                                    isCurrent()
                                )
                                    console.warn(
                                        'Background font region preparation failed:',
                                        error,
                                    );
                            }
                        }),
                    );
                }, 0);
                return;
            }
        },
        stop() {
            stopped = true;
            generation++;
            releaseWarm();
            for (const area of [...areas]) area.stop();
            for (const entry of parts.values())
                for (const font of entry.prepared?.fonts || [])
                    doc.fonts.delete(font);
            parts.clear();
        },
    };
};
