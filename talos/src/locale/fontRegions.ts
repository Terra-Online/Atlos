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
const pendingName = (face: Face) => `"Atlos-pending-${face}"`;
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
            parts: Set<string>;
            prepared?: Prepared;
        }
    >();
    const leaseFonts = (key: string, selection: Selection[]) => {
        let batch = batches.get(key);
        if (!batch) {
            // A later-mounted region can reuse a fully loaded shell collection.
            // Pending collections are excluded so extra shards cannot delay it.
            for (const [candidateKey, candidate] of batches) {
                if (
                    candidate.registered &&
                    selection.every((part) =>
                        candidate.parts.has(`${part.face}:${part.url}`),
                    )
                ) {
                    key = candidateKey;
                    batch = candidate;
                    break;
                }
            }
        }
        if (!batch) {
            batch = {
                ready: prepareFonts(selection, `area${++nextAreaId}-0`),
                refs: 0,
                registered: false,
                parts: new Set(
                    selection.map((part) => `${part.face}:${part.url}`),
                ),
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
                : Object.fromEntries(
                      [
                          ...new Set(
                              runs.flatMap(
                                  (run) =>
                                      // A present primary face can still have
                                      // cmap holes; prepare its declared UI fallbacks too.
                                      run.faces.filter(
                                          (face) => manifest.faces[face],
                                      ),
                              ),
                          ),
                      ].map((face) => [
                          face,
                          [
                              ...new Set([
                                  ...(preset?.ui[face] || []),
                                  ...(preset?.shell[face] || []),
                                  ...(runs.some(
                                      (run) =>
                                          run.localized === 'game' &&
                                          run.faces.includes(face),
                                  )
                                      ? preset?.catalog[face] || []
                                      : []),
                              ]),
                          ],
                      ]),
                  );
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
    ) => {
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
            const lease = leaseFonts(plan.key, selection);
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
            fallback();
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
            const results = await Promise.allSettled(
                [...areas].map((area) => area.prepare(next)),
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
                const snapshot = [...areas];
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
                if (
                    snapshot.length !== areas.size ||
                    snapshot.some(
                        (area, index) =>
                            !areas.has(area) ||
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
                return;
            }
        },
        stop() {
            stopped = true;
            generation++;
            releaseWarm();
            for (const area of [...areas]) area.stop();
        },
    };
};
