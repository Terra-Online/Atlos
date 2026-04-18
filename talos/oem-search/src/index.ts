import { create, insertMultiple, search } from '@orama/orama';

interface Env {
  INDEX_DOCS_URL: string;
  ALLOW_ORIGIN?: string;
}

interface SearchDoc {
  docId: string;
  pointId: string;
  typeKey: string;
  typeMain: string;
  title: string;
  aliases: string;
  binderTokens: string;
  binderDisplay: string;
  regionKey: string;
  subregionId: string;
  body: string;
  cjk: string;
}

interface SearchHit {
  pointId: string;
  typeKey: string;
  typeMain: string;
  title: string;
  aliases: string;
  binderTokens: string;
  binderDisplay: string;
  regionKey: string;
  subregionId: string;
  body: string;
  score: number;
}

const buildHitKey = (hit: SearchHit): string => `${hit.pointId}@@${hit.subregionId}@@${hit.typeKey}`;

const mergeHits = (primary: SearchHit[], supplement: SearchHit[], limit: number): SearchHit[] => {
  const merged = new Map<string, SearchHit>();
  primary.forEach((hit) => merged.set(buildHitKey(hit), hit));
  supplement.forEach((hit) => {
    const key = buildHitKey(hit);
    if (!merged.has(key)) merged.set(key, hit);
  });
  return Array.from(merged.values()).slice(0, limit);
};

type SearchDb = unknown;

type SearchResult = {
  hits: Array<{
    document: SearchDoc;
    score: number;
  }>;
};

type CreateFn = (args: {
  schema: {
    docId: 'string';
    pointId: 'string';
    typeKey: 'string';
    typeMain: 'string';
    title: 'string';
    aliases: 'string';
    binderTokens: 'string';
    binderDisplay: 'string';
    regionKey: 'string';
    subregionId: 'string';
    body: 'string';
    cjk: 'string';
  };
}) => Promise<SearchDb>;

type InsertMultipleFn = (db: SearchDb, docs: SearchDoc[], batchSize?: number) => Promise<unknown>;

type SearchFn = (db: SearchDb, params: {
  term: string;
  properties: string[];
  limit: number;
  tolerance: number;
}) => Promise<SearchResult>;

const createDb = create as unknown as CreateFn;
const insertDocs = insertMultiple as unknown as InsertMultipleFn;
const searchDocs = search as unknown as SearchFn;

let dbPromise: Promise<SearchDb> | null = null;
const dbPromiseByLocale = new Map<string, Promise<SearchDb>>();
const docsByLocale = new Map<string, SearchDoc[]>();

const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const hasCjk = (input: string): boolean => Array.from(input).some((ch) => CJK_RE.test(ch));
const FULL_LANGS = new Set([
  'de-DE',
  'en-US',
  'es-ES',
  'fr-FR',
  'id-ID',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'ru-RU',
  'th-TH',
  'tr-TR',
  'vi-VN',
  'zh-CN',
  'zh-HK',
  'zh-TW',
]);
const UI_ONLY_LANGS = new Set(['ar-AE', 'ms-MY', 'pl-PL', 'sv-SE']);

const CORS_HEADERS = (origin: string) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type,accept',
  'access-control-max-age': '86400',
});

const json = (data: unknown, status = 200, origin = '*'): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS(origin),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

const isSearchDocBaseArray = (value: unknown): value is Array<Omit<SearchDoc, 'binderTokens' | 'binderDisplay'> & Partial<Pick<SearchDoc, 'binderTokens' | 'binderDisplay'>>> => {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.docId === 'string' &&
      typeof row.pointId === 'string' &&
      typeof row.typeKey === 'string' &&
      typeof row.typeMain === 'string' &&
      typeof row.title === 'string' &&
      typeof row.aliases === 'string' &&
      typeof row.regionKey === 'string' &&
      typeof row.subregionId === 'string' &&
      typeof row.body === 'string' &&
      typeof row.cjk === 'string'
    );
  });
};

const normalizeDocsLocale = (locale: string | null): string => {
  if (!locale) return 'en-US';
  if (locale === 'zh-HK') return 'zh-TW';
  if (FULL_LANGS.has(locale)) return locale;
  if (UI_ONLY_LANGS.has(locale)) return 'en-US';
  return 'en-US';
};

const resolveDocsUrl = (base: string, locale: string): string => {
  if (base.includes('{locale}')) {
    return base.replaceAll('{locale}', locale);
  }

  // Auto-switch locale for URLs that already point to one locale file.
  const localeFilePattern = /\/(de-DE|en-US|es-ES|fr-FR|id-ID|it-IT|ja-JP|ko-KR|pt-BR|ru-RU|th-TH|tr-TR|vi-VN|zh-CN|zh-HK|zh-TW)\.json$/;
  if (localeFilePattern.test(base)) {
    return base.replace(localeFilePattern, `/${locale}.json`);
  }

  if (base.endsWith('.json')) {
    return base;
  }

  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalizedBase}/${locale}.json`;
};

const loadDocsFromLocale = async (env: Env, locale: string): Promise<SearchDoc[] | null> => {
  const docsUrl = resolveDocsUrl(env.INDEX_DOCS_URL, locale);
  const res = await fetch(docsUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as unknown;
  if (!isSearchDocBaseArray(data) || data.length === 0) return null;
  return data.map((row) => ({
    ...row,
    binderTokens: typeof row.binderTokens === 'string' ? row.binderTokens : '',
    binderDisplay: typeof row.binderDisplay === 'string' ? row.binderDisplay : '',
  }));
};

const loadDocs = async (env: Env, locale: string): Promise<SearchDoc[]> => {
  if (!env.INDEX_DOCS_URL) {
    throw new Error('Missing INDEX_DOCS_URL');
  }

  const localized = await loadDocsFromLocale(env, locale);
  if (localized) return localized;

  if (locale !== 'en-US') {
    const enDocs = await loadDocsFromLocale(env, 'en-US');
    if (enDocs) return enDocs;
  }

  throw new Error(`Failed to load docs for locale ${locale} and fallback en-US`);
};

const fallbackSubstringSearch = (docs: SearchDoc[], rawQuery: string, limit: number): SearchHit[] => {
  const q = normalizeForMatch(rawQuery);
  if (!q) return [];

  return docs
    .filter((doc) => {
      const haystack = normalizeForMatch(`${doc.typeKey}\n${doc.title}\n${doc.aliases}\n${doc.binderTokens}\n${doc.body}`);
      return haystack.includes(q);
    })
    .slice(0, limit)
    .map((doc) => ({
      pointId: doc.pointId,
      typeKey: doc.typeKey,
      typeMain: doc.typeMain,
      title: doc.title,
      aliases: doc.aliases,
      binderTokens: doc.binderTokens,
      binderDisplay: doc.binderDisplay,
      regionKey: doc.regionKey,
      subregionId: doc.subregionId,
      body: doc.body,
      score: 0,
    }));
};

const binderFocusedSupplementSearch = (docs: SearchDoc[], rawQuery: string, limit: number): SearchHit[] => {
  const q = normalizeForMatch(rawQuery);
  if (!q) return [];

  return docs
    .filter((doc) => {
      const binderHaystack = normalizeForMatch(`${doc.binderTokens}\n${doc.aliases}`);
      return binderHaystack.includes(q);
    })
    .sort((a, b) => {
      const aFile = a.typeMain === 'files' ? 0 : 1;
      const bFile = b.typeMain === 'files' ? 0 : 1;
      if (aFile !== bFile) return aFile - bFile;

      const aText = normalizeForMatch(`${a.binderTokens}\n${a.aliases}`);
      const bText = normalizeForMatch(`${b.binderTokens}\n${b.aliases}`);
      const aIdx = aText.indexOf(q);
      const bIdx = bText.indexOf(q);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return 0;
    })
    .slice(0, limit)
    .map((doc) => ({
      pointId: doc.pointId,
      typeKey: doc.typeKey,
      typeMain: doc.typeMain,
      title: doc.title,
      aliases: doc.aliases,
      binderTokens: doc.binderTokens,
      binderDisplay: doc.binderDisplay,
      regionKey: doc.regionKey,
      subregionId: doc.subregionId,
      body: doc.body,
      score: doc.typeMain === 'files' ? 1_000_000 : 500_000,
    }));
};

const getDb = async (env: Env, docsLocale: string): Promise<SearchDb> => {
  const existing = dbPromiseByLocale.get(docsLocale);
  if (existing) return existing;

  const promise = (async () => {
    const docs = await loadDocs(env, docsLocale);
    docsByLocale.set(docsLocale, docs);
    const db = await createDb({
      schema: {
        docId: 'string',
        pointId: 'string',
        typeKey: 'string',
        typeMain: 'string',
        title: 'string',
        aliases: 'string',
        binderTokens: 'string',
        binderDisplay: 'string',
        regionKey: 'string',
        subregionId: 'string',
        body: 'string',
        cjk: 'string',
      },
    });

    await insertDocs(db, docs, 300);
    return db;
  })();

  dbPromiseByLocale.set(docsLocale, promise);
  return promise;
};

const getLegacySingleDb = async (env: Env): Promise<SearchDb> => {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const docs = await loadDocs(env, 'en-US');
    docsByLocale.set('en-US', docs);
    const db = await createDb({
      schema: {
        docId: 'string',
        pointId: 'string',
        typeKey: 'string',
        typeMain: 'string',
        title: 'string',
        aliases: 'string',
        binderTokens: 'string',
        binderDisplay: 'string',
        regionKey: 'string',
        subregionId: 'string',
        body: 'string',
        cjk: 'string',
      },
    });

    await insertDocs(db, docs, 300);
    return db;
  })();

  return dbPromise;
};

const parseLimit = (raw: string | null): number => {
  if (!raw) return 240;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 240;
  return Math.max(1, Math.min(500, Math.floor(n)));
};

const asHit = (row: { document: SearchDoc; score: number }): SearchHit => ({
  pointId: row.document.pointId,
  typeKey: row.document.typeKey,
  typeMain: row.document.typeMain,
  title: row.document.title,
  aliases: row.document.aliases,
  binderTokens: row.document.binderTokens,
  binderDisplay: row.document.binderDisplay,
  regionKey: row.document.regionKey,
  subregionId: row.document.subregionId,
  body: row.document.body,
  score: row.score,
});

const normalizeText = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const normalizeForMatch = (value: string): string =>
  normalizeText(value)
    .replace(/['"]/g, '')
    .replace(/[^\p{L}\p{N}\u3400-\u9FFF]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const matchTier = (hit: SearchHit, q: string): number => {
  const nq = normalizeForMatch(q);
  if (!nq) return 0;
  if (normalizeForMatch(hit.binderTokens).includes(nq)) return 4;

  const titleMatched = normalizeForMatch(hit.title).includes(nq);
  const bodyMatched = normalizeForMatch(hit.body).includes(nq);
  const aliasesMatched = normalizeForMatch(hit.aliases).includes(nq);
  if (titleMatched && bodyMatched) return 3;
  if (titleMatched) return 2;
  if (aliasesMatched) return 2;
  if (bodyMatched) return 1;
  return 0;
};

const rankHits = (hits: SearchHit[], q: string): SearchHit[] => {
  return [...hits].sort((a, b) => {
    const tierDiff = matchTier(b, q) - matchTier(a, q);
    if (tierDiff !== 0) return tierDiff;
    return b.score - a.score;
  });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOW_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS(origin) });
    }

    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'oem-search' }, 200, origin);
    }

    if (url.pathname !== '/search') {
      return json({ error: 'Not found' }, 404, origin);
    }

    const qRaw = (url.searchParams.get('q') || '').trim();
    const q = normalizeText(qRaw);
    if (!q) return json({ hits: [] }, 200, origin);

    const limit = parseLimit(url.searchParams.get('limit'));
    const docsLocale = normalizeDocsLocale(url.searchParams.get('locale'));

    try {
      const useLegacySingle = env.INDEX_DOCS_URL.endsWith('.json') && !env.INDEX_DOCS_URL.includes('{locale}');
      const db = useLegacySingle ? await getLegacySingleDb(env) : await getDb(env, docsLocale);
      const cjkMode = hasCjk(q);
      const term = q;
      const candidateLimit = Math.min(1200, Math.max(limit * 8, limit));
      const result = await searchDocs(db, {
        term,
        properties: ['typeKey', 'title', 'aliases', 'binderTokens', 'body', 'cjk'],
        limit: candidateLimit,
        tolerance: cjkMode ? 0 : 1,
      });

      const filtered = cjkMode
        ? result.hits.filter((row) => {
            const haystack = `${row.document.title}\n${row.document.aliases}\n${row.document.binderTokens}\n${row.document.body}`;
            return haystack.includes(q);
          })
        : result.hits;

      const hits = filtered.map(asHit);
      const docsForSupplement = docsByLocale.get(docsLocale) ?? docsByLocale.get('en-US') ?? [];
      const binderSupplement = binderFocusedSupplementSearch(docsForSupplement, qRaw, limit);
      if (hits.length > 0) {
        if (!cjkMode) {
          const merged = mergeHits(rankHits(binderSupplement, qRaw), rankHits(hits, qRaw), limit);
          return json({ hits: rankHits(merged, qRaw) }, 200, origin);
        }

        const supplement = fallbackSubstringSearch(docsForSupplement, qRaw, limit);
        const mergedPrimary = mergeHits(rankHits(binderSupplement, qRaw), rankHits(hits, qRaw), limit);
        const merged = mergeHits(mergedPrimary, supplement, limit);
        return json({ hits: rankHits(merged, qRaw) }, 200, origin);
      }

      const fallbackDocs = docsByLocale.get(docsLocale) ?? docsByLocale.get('en-US') ?? [];
      const fallback = fallbackSubstringSearch(fallbackDocs, qRaw, limit);
      const merged = mergeHits(rankHits(binderSupplement, qRaw), fallback, limit);
      return json({ hits: rankHits(merged, qRaw) }, 200, origin);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'search failed';
      return json({ error: message }, 500, origin);
    }
  },
};
