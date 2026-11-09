import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {
  ROOT, SEO_STATE_VERSION, hasExplicitPointScope, SEO_POINTS_ROOT_DIR, POINT_HTML_FILE_PATTERN,
} from './config.mjs';
import { safeReaddir } from './io.mjs';

const fileFingerprintCache = new Map();

export async function fileFingerprint(file) {
  if (!file) return 'missing';
  if (!fileFingerprintCache.has(file)) {
    fileFingerprintCache.set(file, (async () => {
      const relativePath = path.relative(ROOT, file);
      try {
        const contents = await fs.readFile(file);
        const digest = crypto.createHash('sha256').update(contents).digest('hex');
        return `${relativePath}:sha256:${digest}`;
      } catch {
        return `${relativePath}:missing`;
      }
    })());
  }
  return fileFingerprintCache.get(file);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableJson(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableJson(value[key]);
      return acc;
    }, {});
  }
  return value;
}

export function hashSignature(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableJson(value))).digest('hex');
}

export async function collectFingerprints(files) {
  const entries = await Promise.all(files.map(async (file) => [path.relative(ROOT, file), await fileFingerprint(file)]));
  return Object.fromEntries(entries);
}

export async function loadBuildState(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SEO_STATE_VERSION || typeof parsed.entries !== 'object') return { version: SEO_STATE_VERSION, entries: {} };
    return parsed;
  } catch {
    return { version: SEO_STATE_VERSION, entries: {} };
  }
}

export async function writeBuildState(file, state) {
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporaryFile, contents);
    await fs.rename(temporaryFile, file);
  } finally {
    await fs.rm(temporaryFile, { force: true });
  }
}

export function mergeScopedBuildState(previousState, nextState, activeTokens) {
  if (!hasExplicitPointScope) return nextState;
  const retainedEntries = Object.fromEntries(
    Object.entries(previousState.entries ?? {})
      .filter(([token]) => activeTokens.has(token)),
  );
  return {
    ...nextState,
    entries: {
      ...retainedEntries,
      ...nextState.entries,
    },
  };
}

export async function pruneStaleFiles(dir, extension, activeTokens, previousTokens) {
  const staleTokens = [...previousTokens].filter((token) => !activeTokens.has(token));
  await Promise.all(staleTokens.map(async (token) => {
    const file = path.resolve(dir, `${token}${extension}`);
    try {
      await fs.rm(file, { force: true });
    } catch {
      // ignore
    }
  }));
}

export async function removeLegacyFlatPointFiles() {
  const files = await safeReaddir(SEO_POINTS_ROOT_DIR);
  await Promise.all(files
    .filter((file) => POINT_HTML_FILE_PATTERN.test(file))
    .map((file) => fs.rm(path.resolve(SEO_POINTS_ROOT_DIR, file), { force: true })));
}
