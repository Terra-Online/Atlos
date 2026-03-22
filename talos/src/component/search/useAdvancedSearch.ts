import { useEffect, useMemo, useRef, useState } from 'react';
import { create, insertMultiple, search as oramaSearch } from '@orama/orama';
import { MARKER_TYPE_DICT, REGION_TYPE_COUNT_MAP, SUBREGION_TYPE_COUNT_MAP, WORLD_MARKS } from '@/data/marker';
import { SUBREGION_DICT } from '@/data/map';
import { FULL_LANGS, UI_ONLY_LANGS, useTranslateGame } from '@/locale';
import useRegion from '@/store/region';

interface SearchDoc {
    docId: string;
    pointId: string;
    typeKey: string;
    typeMain: string;
    title: string;
    aliases: string;
    regionKey: string;
    subregionId: string;
    body: string;
    cjk: string;
}

type SearchDb = unknown;

interface OramaSearchParams {
    term: string;
    properties: string[];
    limit: number;
    tolerance: number;
}

interface OramaSearchHit<TDoc> {
    document: TDoc;
    score: number;
}

interface OramaSearchResult<TDoc> {
    hits: Array<OramaSearchHit<TDoc>>;
}

type CreateFn = (args: {
    schema: {
        docId: 'string';
        pointId: 'string';
        typeKey: 'string';
        typeMain: 'string';
        title: 'string';
        aliases: 'string';
        regionKey: 'string';
        subregionId: 'string';
        body: 'string';
        cjk: 'string';
    };
}) => Promise<SearchDb>;

type InsertMultipleFn<TDoc> = (db: SearchDb, docs: TDoc[], batchSize?: number) => Promise<unknown>;
type SearchFn<TDoc> = (db: SearchDb, params: OramaSearchParams) => Promise<OramaSearchResult<TDoc>>;

const createDb = create as unknown as CreateFn;
const insertDocs = insertMultiple as unknown as InsertMultipleFn<SearchDoc>;
const searchDocs = oramaSearch as unknown as SearchFn<SearchDoc>;

type SearchHitDoc = {
    pointId: string;
    typeKey: string;
    typeMain: string;
    title: string;
    regionKey: string;
    subregionId: string;
    body: string;
    score: number;
};

const buildHitKey = (doc: SearchHitDoc): string => `${doc.pointId}@@${doc.subregionId}@@${doc.typeKey}`;

const mergeHits = (primary: SearchHitDoc[], supplement: SearchHitDoc[], limit: number): SearchHitDoc[] => {
    const merged = new Map<string, SearchHitDoc>();

    primary.forEach((doc) => {
        merged.set(buildHitKey(doc), doc);
    });

    supplement.forEach((doc) => {
        const key = buildHitKey(doc);
        if (!merged.has(key)) {
            merged.set(key, doc);
        }
    });

    return Array.from(merged.values()).slice(0, limit);
};

interface WorkerSearchResponse {
    hits: SearchHitDoc[];
}

export interface SearchResultGroup {
    typeKey: string;
    typeMain: string;
    displayName: string;
    iconKey: string;
    worldTotal: number;
    mainTotal: number;
    subTotal: number;
    uniquePoint: SearchHitDoc | null;
    regions: string[];
    subregionNames: string[];
    subregionNamesByRegion: Record<string, string[]>;
    snippet: string;
    snippetMatched: boolean;
    topScore: number;
}

const DOC_LIMIT = 240;
const SEARCH_DEBOUNCE_MS = 180;
const BASE_URL = (import.meta.env.BASE_URL as string | undefined) || '/';
const PREBUILT_DOCS_BASE_PATH = `${BASE_URL.replace(/\/$/, '')}/search/docs`;

const REMOTE_SEARCH_ENDPOINT = (import.meta.env.VITE_SEARCH_ENDPOINT as string | undefined)?.trim() || '';

const supportedFullLocaleSet = new Set<string>(FULL_LANGS as readonly string[]);
const uiOnlyLocaleSet = new Set<string>(UI_ONLY_LANGS as readonly string[]);
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

const worldTypeCountMap: Record<string, number> = WORLD_MARKS.reduce((acc, marker) => {
    acc[marker.type] = (acc[marker.type] || 0) + 1;
    return acc;
}, {} as Record<string, number>);

const normalizeText = (value: string): string => value.trim().toLowerCase();
const hasCjk = (input: string): boolean => CJK_RE.test(input);

const normalizeDocsLocale = (locale: string): string => {
    if (supportedFullLocaleSet.has(locale)) return locale;
    if (uiOnlyLocaleSet.has(locale)) return 'en-US';
    return 'en-US';
};

const buildDocsPath = (locale: string): string => `${PREBUILT_DOCS_BASE_PATH}/${locale}.json`;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const parseWorkerSearchResponse = (value: unknown): WorkerSearchResponse | null => {
    if (!isObjectRecord(value)) return null;
    const hitsRaw = value.hits;
    if (!Array.isArray(hitsRaw)) return null;

    const hits: SearchHitDoc[] = [];
    hitsRaw.forEach((item) => {
        if (!isObjectRecord(item)) return;
        const pointId = item.pointId;
        const typeKey = item.typeKey;
        const typeMain = item.typeMain;
        const title = item.title;
        const regionKey = item.regionKey;
        const subregionId = item.subregionId;
        const body = item.body;
        const score = item.score;

        if (
            typeof pointId !== 'string' ||
            typeof typeKey !== 'string' ||
            typeof typeMain !== 'string' ||
            typeof regionKey !== 'string' ||
            typeof subregionId !== 'string' ||
            typeof body !== 'string' ||
            typeof score !== 'number'
        ) {
            return;
        }

        hits.push({
            pointId,
            typeKey,
            typeMain,
            title: typeof title === 'string' ? title : '',
            regionKey,
            subregionId,
            body,
            score,
        });
    });

    return { hits };
};

const isSearchDoc = (value: unknown): value is SearchDoc => {
    if (!isObjectRecord(value)) return false;
    return (
        typeof value.docId === 'string' &&
        typeof value.pointId === 'string' &&
        typeof value.typeKey === 'string' &&
        typeof value.typeMain === 'string' &&
        typeof value.title === 'string' &&
        typeof value.aliases === 'string' &&
        typeof value.regionKey === 'string' &&
        typeof value.subregionId === 'string' &&
        typeof value.body === 'string' &&
        typeof value.cjk === 'string'
    );
};

const parsePrebuiltDocs = (value: unknown): SearchDoc[] => {
    if (!Array.isArray(value)) return [];
    return value.filter(isSearchDoc);
};

const sortByKeywordCenter = (items: SearchDoc[], rawQuery: string): SearchDoc[] => {
    const q = normalizeText(rawQuery);
    if (!q) return items;

    return [...items].sort((a, b) => {
        const aText = `${a.title}\n${a.aliases}\n${a.body}\n${a.typeKey}`.toLowerCase();
        const bText = `${b.title}\n${b.aliases}\n${b.body}\n${b.typeKey}`.toLowerCase();
        const aIdx = aText.indexOf(q);
        const bIdx = bText.indexOf(q);
        if (aIdx === bIdx) return 0;
        if (aIdx < 0) return 1;
        if (bIdx < 0) return -1;
        return aIdx - bIdx;
    });
};

const fallbackSubstringSearch = (docs: SearchDoc[], rawQuery: string, limit: number): SearchHitDoc[] => {
    const q = normalizeText(rawQuery);
    if (!q) return [];

    const matched = docs.filter((doc) => {
        const haystack = `${doc.typeKey}\n${doc.title}\n${doc.aliases}\n${doc.body}`.toLowerCase();
        return haystack.includes(q);
    });

    return sortByKeywordCenter(matched, q)
        .slice(0, limit)
        .map((doc) => ({
            pointId: String(doc.pointId),
            typeKey: String(doc.typeKey),
            typeMain: String(doc.typeMain),
            title: String(doc.title || ''),
            regionKey: String(doc.regionKey),
            subregionId: String(doc.subregionId),
            body: String(doc.body || ''),
            score: 0,
        }));
};

const buildFallbackDocs = (): SearchDoc[] => {
    const docs: SearchDoc[] = [];
    WORLD_MARKS.forEach((marker) => {
        if (typeof marker.type !== 'string' || !marker.type.trim()) return;
        const typeKey = marker.type.trim();
        const markerType = MARKER_TYPE_DICT[typeKey];
        docs.push({
            docId: `${String(marker.id)}@@${String(marker.subregId)}`,
            pointId: String(marker.id),
            typeKey,
            typeMain: markerType?.category?.main || '',
            title: typeKey,
            aliases: typeKey,
            regionKey: 'Valley_4',
            subregionId: String(marker.subregId),
            body: '',
            cjk: '',
        });
    });
    return docs;
};

const createSearchDb = async (docs: SearchDoc[]): Promise<SearchDb> => {
    const db = await createDb({
        schema: {
            docId: 'string',
            pointId: 'string',
            typeKey: 'string',
            typeMain: 'string',
            title: 'string',
            aliases: 'string',
            regionKey: 'string',
            subregionId: 'string',
            body: 'string',
            cjk: 'string',
        },
    });

    await insertDocs(db, docs, DOC_LIMIT);
    return db;
};

const prebuiltDbPromiseByLocale = new Map<string, Promise<SearchDb>>();
const prebuiltDocsByLocale = new Map<string, SearchDoc[]>();

const loadPrebuiltDocs = async (docsLocale: string): Promise<SearchDoc[] | null> => {
    try {
        const res = await fetch(buildDocsPath(docsLocale), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'force-cache',
        });
        if (!res.ok) return null;
        const docs = parsePrebuiltDocs(await res.json());
        return docs.length > 0 ? docs : null;
    } catch {
        return null;
    }
};

const getPrebuiltDb = (docsLocale: string): Promise<SearchDb> => {
    const existing = prebuiltDbPromiseByLocale.get(docsLocale);
    if (existing) return existing;

    const promise = (async () => {
        const requestedDocs = await loadPrebuiltDocs(docsLocale);
        if (requestedDocs) {
            prebuiltDocsByLocale.set(docsLocale, requestedDocs);
            return createSearchDb(requestedDocs);
        }

        if (docsLocale !== 'en-US') {
            const enDocs = await loadPrebuiltDocs('en-US');
            if (enDocs) {
                prebuiltDocsByLocale.set(docsLocale, enDocs);
                prebuiltDocsByLocale.set('en-US', enDocs);
                return createSearchDb(enDocs);
            }
        }

        return createSearchDb(buildFallbackDocs());
    })();

    prebuiltDbPromiseByLocale.set(docsLocale, promise);
    return promise;
};

const buildSnippet = (text: string, query: string): string => {
    const clean = text.trim();
    if (!clean) return '';

    const q = normalizeText(query);
    if (!q) return '';

    const radius = hasCjk(q) ? 6 : 24;
    const paragraphs = clean
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean);

    const targetParagraph = paragraphs.find((p) => p.toLowerCase().includes(q));
    if (!targetParagraph) return '';

    const lower = targetParagraph.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx < 0) return '';

    const start = Math.max(0, idx - radius);
    const end = Math.min(targetParagraph.length, idx + q.length + radius);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < targetParagraph.length ? '...' : '';
    return `${prefix}${targetParagraph.slice(start, end)}${suffix}`;
};

const stripTitlePrefixFromBody = (body: string, title: string): string => {
    const bodyTrimmed = body.trim();
    if (!bodyTrimmed) return '';

    const titleTrimmed = title.trim();
    if (!titleTrimmed) return bodyTrimmed;

    const lowerBody = bodyTrimmed.toLowerCase();
    const lowerTitle = titleTrimmed.toLowerCase();
    if (!lowerBody.startsWith(lowerTitle)) return bodyTrimmed;

    return bodyTrimmed.slice(titleTrimmed.length).replace(/^[\s\n:：\-—]+/, '').trim();
};

const getSubregionDisplayName = (
    subregionId: string,
    regionKey: string,
    tGame: (k: string) => unknown,
): string => {
    const regionCodeMap: Record<string, string> = {
        Valley_4: 'VL',
        Wuling: 'WL',
        Dijiang: 'DJ',
        Weekraid_1: 'ES',
    };
    const code = regionCodeMap[regionKey] ?? regionKey;
    const subKey = SUBREGION_DICT[subregionId]?.name;
    if (subKey) {
        const localized = tGame(`region.${code}.sub.${subKey}.name`);
        if (typeof localized === 'string' && localized.trim()) return localized;
    }
    return subregionId;
};

const toGroups = (
    docs: SearchHitDoc[],
    queryForMatch: string,
    currentRegion: string,
    currentSubregion: string | null,
    tGame: (k: string) => unknown,
): SearchResultGroup[] => {
    const normalizedNeedle = normalizeText(queryForMatch);
    const getMatchTier = (doc: SearchHitDoc): number => {
        if (!normalizedNeedle) return 0;
        const titleMatched = normalizeText(doc.title).includes(normalizedNeedle);
        const bodyMatched = normalizeText(doc.body).includes(normalizedNeedle);
        if (titleMatched && bodyMatched) return 3;
        if (titleMatched) return 2;
        if (bodyMatched) return 1;
        return 0;
    };

    const grouped = new Map<string, { docs: SearchHitDoc[]; topScore: number }>();

    docs.forEach((doc) => {
        const current = grouped.get(doc.typeKey);
        if (!current) {
            grouped.set(doc.typeKey, { docs: [doc], topScore: doc.score });
            return;
        }
        current.docs.push(doc);
        if (doc.score > current.topScore) {
            current.topScore = doc.score;
        }
    });

    return Array.from(grouped.entries())
        .map(([typeKey, group]) => {
            const typeInfo = MARKER_TYPE_DICT[typeKey];
            const displayRaw = tGame(`markerType.key.${typeKey}`);
            const displayName = typeof displayRaw === 'string' && displayRaw.trim() ? displayRaw : typeKey;
            const iconKey = typeInfo?.icon ?? typeKey;
            const uniquePoint = group.docs.length === 1 ? group.docs[0] : null;
            const bestMatchTier = group.docs.reduce((best, doc) => Math.max(best, getMatchTier(doc)), 0);

            const regions = Array.from(new Set(group.docs.map((d) => d.regionKey)));
            const shownRegions = regions.filter((regionKey) => regionKey !== 'Weekraid_1');
            const subregionNameSetByRegion = new Map<string, Set<string>>();
            group.docs.forEach((doc) => {
                const nextName = getSubregionDisplayName(doc.subregionId, doc.regionKey, tGame);
                const currentSet = subregionNameSetByRegion.get(doc.regionKey) ?? new Set<string>();
                currentSet.add(nextName);
                subregionNameSetByRegion.set(doc.regionKey, currentSet);
            });
            const subregionNamesByRegion = Object.fromEntries(
                Array.from(subregionNameSetByRegion.entries()).map(([regionKey, nameSet]) => [regionKey, Array.from(nameSet)]),
            ) as Record<string, string[]>;
            const subregionNames = Array.from(
                new Set(
                    group.docs.map((doc) =>
                        getSubregionDisplayName(doc.subregionId, doc.regionKey, tGame),
                    ),
                ),
            );

            const bestDoc = uniquePoint ?? group.docs[0];
            const snippetDoc = group.docs.find((doc) => {
                const bodyWithoutTitle = stripTitlePrefixFromBody(doc.body, doc.title);
                return normalizeText(bodyWithoutTitle).includes(normalizeText(queryForMatch));
            }
            ) ?? bestDoc;
            const snippetSource = snippetDoc ? stripTitlePrefixFromBody(snippetDoc.body, snippetDoc.title) : '';
            const snippet = buildSnippet(snippetSource, queryForMatch);
            const snippetMatched = !!snippetSource && normalizeText(snippetSource).includes(normalizeText(queryForMatch));

            const isSelector = !uniquePoint;
            const sortRank =
                (isSelector ? 0 : 1000) +
                bestMatchTier * 100 +
                Math.max(0, group.topScore);

            return {
                group: {
                    typeKey,
                    typeMain: typeInfo?.category?.main || '',
                    displayName,
                    iconKey,
                    worldTotal: worldTypeCountMap[typeKey] ?? 0,
                    mainTotal: REGION_TYPE_COUNT_MAP[currentRegion]?.[typeKey] ?? 0,
                    subTotal: currentSubregion ? (SUBREGION_TYPE_COUNT_MAP[currentSubregion]?.[typeKey] ?? 0) : 0,
                    uniquePoint,
                    regions: shownRegions,
                    subregionNames,
                    subregionNamesByRegion,
                    snippet,
                    snippetMatched,
                    topScore: group.topScore,
                },
                sortRank,
                topScore: group.topScore,
            };
        })
        .sort((a, b) => {
            if (a.sortRank !== b.sortRank) return b.sortRank - a.sortRank;
            return b.topScore - a.topScore;
        })
        .map((entry) => entry.group);
};

export const useAdvancedSearch = (query: string, locale: string) => {
    const tGame = useTranslateGame();
    const { currentRegionKey, currentSubregionKey } = useRegion();
    const [results, setResults] = useState<SearchResultGroup[]>([]);
    const [loading, setLoading] = useState(false);
    const activeTokenRef = useRef(0);

    const normalizedQuery = useMemo(() => normalizeText(query), [query]);
    const normalizedSearchQuery = normalizedQuery;

    useEffect(() => {
        let timeoutId = 0;
        const run = async () => {
            if (!normalizedSearchQuery) {
                setResults([]);
                setLoading(false);
                return;
            }

            setLoading(true);
            const token = activeTokenRef.current + 1;
            activeTokenRef.current = token;
            const docsLocale = normalizeDocsLocale(locale);

            if (REMOTE_SEARCH_ENDPOINT) {
                try {
                    const url = new URL(REMOTE_SEARCH_ENDPOINT, window.location.origin);
                    url.searchParams.set('q', normalizedSearchQuery);
                    url.searchParams.set('limit', String(DOC_LIMIT));
                    url.searchParams.set('locale', docsLocale);

                    const res = await fetch(url.toString(), {
                        method: 'GET',
                        headers: { Accept: 'application/json' },
                    });

                    if (activeTokenRef.current !== token) return;

                    if (res.ok) {
                        const payload = parseWorkerSearchResponse(await res.json());
                        if (payload && payload.hits.length > 0) {
                            setResults(toGroups(payload.hits, normalizedSearchQuery, currentRegionKey, currentSubregionKey, tGame));
                            setLoading(false);
                            return;
                        }
                    }
                } catch {
                    // Ignore remote failure and fallback to local prebuilt docs.
                }
            }

            const db = await getPrebuiltDb(docsLocale);
            if (activeTokenRef.current !== token) return;

            const cjkMode = hasCjk(normalizedSearchQuery);
            const result = await searchDocs(db, {
                term: normalizedSearchQuery,
                properties: ['typeKey', 'title', 'aliases', 'body'],
                limit: DOC_LIMIT,
                tolerance: cjkMode ? 0 : 1,
            });

            if (activeTokenRef.current !== token) return;

            const docs: SearchHitDoc[] = result.hits
                .filter((hit) => {
                    if (!cjkMode) return true;
                    const haystack = `${hit.document.title}\n${hit.document.aliases}\n${hit.document.body}`;
                    return haystack.includes(normalizedSearchQuery);
                })
                .map((hit) => ({
                    pointId: String(hit.document.pointId),
                    typeKey: String(hit.document.typeKey),
                    typeMain: String(hit.document.typeMain),
                    title: String(hit.document.title || ''),
                    regionKey: String(hit.document.regionKey),
                    subregionId: String(hit.document.subregionId),
                    body: String(hit.document.body || ''),
                    score: hit.score,
                }));

            const resolvedDocs = docs.length > 0
                ? docs
                : fallbackSubstringSearch(
                    prebuiltDocsByLocale.get(docsLocale) ?? buildFallbackDocs(),
                    normalizedSearchQuery,
                    DOC_LIMIT,
                );

            const cjkSupplement = cjkMode
                ? fallbackSubstringSearch(
                    prebuiltDocsByLocale.get(docsLocale) ?? buildFallbackDocs(),
                    normalizedSearchQuery,
                    DOC_LIMIT,
                )
                : [];

            const finalDocs = cjkMode ? mergeHits(resolvedDocs, cjkSupplement, DOC_LIMIT) : resolvedDocs;

            setResults(toGroups(finalDocs, normalizedSearchQuery, currentRegionKey, currentSubregionKey, tGame));
            setLoading(false);
        };

        timeoutId = window.setTimeout(() => {
            void run();
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [normalizedQuery, normalizedSearchQuery, locale, currentRegionKey, currentSubregionKey, tGame]);

    return {
        results,
        loading: normalizedQuery.length > 0 && loading,
        normalizedQuery,
    };
};
