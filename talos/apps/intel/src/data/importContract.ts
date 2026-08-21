export const INTEL_IMPORT_PREFIX = 'OEA-0-';

const MAX_TOKEN_LENGTH = 64 * 1024;
const MAX_DECOMPRESSED_BYTES = 1024 * 1024;

export type IntelImportPayload = {
  majorVersion: number;
  minorVersion: number;
  oeaVersion: string;
  collected: string[];
  notCollected: string[];
};

export type DecodedIntelImport = {
  payload: IntelImportPayload;
  raw: unknown;
};

export type IntelImportErrorCode =
  | 'invalid-token'
  | 'unsupported-browser'
  | 'invalid-payload';

export class IntelImportError extends Error {
  readonly code: IntelImportErrorCode;

  constructor(code: IntelImportErrorCode, message: string) {
    super(message);
    this.name = 'IntelImportError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const fail = (code: IntelImportErrorCode, message: string): never => {
  throw new IntelImportError(code, message);
};

const INTEL_IMPORT_PATH_PATTERN = /\/i\/(OEA-0-[A-Za-z0-9_-]+)(?:\/(_debug))?\/?$/;

export const getIntelImportToken = (location: Pick<Location, 'pathname' | 'search'>): string | null => {
  const value = new URLSearchParams(location.search).get('import')?.trim() ?? '';
  if (value) return value;
  return location.pathname.match(INTEL_IMPORT_PATH_PATTERN)?.[1] ?? null;
};

export const isIntelImportDebugLocation = (location: Pick<Location, 'pathname' | 'search'>): boolean => (
  new URLSearchParams(location.search).get('importDebug') === '1'
  || Boolean(location.pathname.match(INTEL_IMPORT_PATH_PATTERN)?.[2])
);

const decodeBase64Url = (value: string): Uint8Array => {
  if (!value || value.includes('=') || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail('invalid-token', 'The import token is not valid base64url.');
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary = '';
  try {
    binary = atob(padded);
  } catch {
    fail('invalid-token', 'The import token could not be decoded.');
  }

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const gunzip = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') {
    fail('unsupported-browser', 'Gzip decompression is not supported by this browser.');
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_DECOMPRESSED_BYTES) {
        await reader.cancel();
        fail('invalid-payload', 'The decompressed import is too large.');
      }
      chunks.push(result.value);
    }

    const output = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return output;
  } catch (error) {
    if (error instanceof IntelImportError) throw error;
    return fail('invalid-token', 'The import payload is not valid gzip data.');
  }
};

const readStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    fail('invalid-payload', `${field} must be an array of non-empty strings.`);
  }
  return [...new Set((value as string[]).map((item) => item.trim()))];
};

const validatePayload = (
  value: unknown,
  knownArchiveIds: ReadonlySet<string>,
): IntelImportPayload => {
  if (!isRecord(value)) fail('invalid-payload', 'The import payload must be an object.');
  const record = value as Record<string, unknown>;
  if (!Number.isInteger(record.majorVersion) || Number(record.majorVersion) < 0
    || !Number.isInteger(record.minorVersion) || Number(record.minorVersion) < 0) {
    fail('invalid-payload', 'The import payload version fields must be non-negative integers.');
  }

  const data = record.data;
  if (!isRecord(data) || typeof data.oeaVersion !== 'string' || !data.oeaVersion.trim()
    || !isRecord(data.prtsAllItems)) {
    fail('invalid-payload', 'The import payload has an unsupported shape.');
  }

  const dataRecord = data as Record<string, unknown>;
  const prtsAllItems = dataRecord.prtsAllItems as Record<string, unknown>;
  const oeaVersion = dataRecord.oeaVersion as string;
  const collected = readStringArray(prtsAllItems.collected, 'collected');
  const notCollected = readStringArray(prtsAllItems.notCollected, 'notCollected');
  const knownCollected = collected.filter((archiveId) => knownArchiveIds.has(archiveId));
  const knownNotCollected = notCollected.filter((archiveId) => knownArchiveIds.has(archiveId));
  const collectedSet = new Set(knownCollected);

  if (knownNotCollected.some((archiveId) => collectedSet.has(archiveId))) {
    fail('invalid-payload', 'An archive cannot be both collected and not collected.');
  }

  return {
    majorVersion: record.majorVersion as number,
    minorVersion: record.minorVersion as number,
    oeaVersion,
    collected: knownCollected,
    notCollected: knownNotCollected,
  };
};

export const decodeIntelImportToken = async (
  token: string,
  knownArchiveIds: ReadonlySet<string>,
): Promise<DecodedIntelImport> => {
  if (!token.startsWith(INTEL_IMPORT_PREFIX)) {
    fail('invalid-token', 'The import token has an invalid prefix.');
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    fail('invalid-token', 'The import token is too large.');
  }

  const bytes = decodeBase64Url(token.slice(INTEL_IMPORT_PREFIX.length));
  const jsonBytes = await gunzip(bytes);
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    fail('invalid-payload', 'The import payload is not valid JSON.');
  }

  return {
    payload: validatePayload(decoded, knownArchiveIds),
    raw: decoded,
  };
};
