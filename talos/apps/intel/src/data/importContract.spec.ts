import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decodeIntelImportToken,
  getIntelImportToken,
  INTEL_IMPORT_PREFIXES,
  IntelImportError,
} from './importContract';

const knownArchiveIds = new Set(['nar_325', 'nar_326', 'nar_327']);

const encodePayload = (payload: unknown): string => {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const base64url = compressed.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${INTEL_IMPORT_PREFIXES[0]}${base64url}`;
};

const validPayload = () => ({
  majorVersion: 0,
  minorVersion: 0,
  data: {
    oeaVersion: '0.1.0',
    prtsAllItems: {
      collected: ['nar_325'],
      notCollected: ['nar_326', 'nar_327'],
    },
  },
});

describe('Intel import contract', () => {
  it('reads the import query parameter', () => {
    expect(getIntelImportToken({ pathname: '/intel/', search: '?foo=1&import=OEA-0-abc' })).toBe('OEA-0-abc');
    expect(getIntelImportToken({ pathname: '/intel/i/OEA-0-abc/_debug', search: '?foo=1' })).toBe('OEA-0-abc');
    expect(getIntelImportToken({ pathname: '/intel/', search: '?foo=1' })).toBeNull();
    expect(getIntelImportToken({ pathname: '/intel/i/MAE-0-abc/_debug', search: '?foo=1' })).toBe('MAE-0-abc');
  });

  it('decodes a gzip/base64url payload', async () => {
    await expect(decodeIntelImportToken(encodePayload(validPayload()), knownArchiveIds)).resolves.toMatchObject({
      payload: {
        majorVersion: 0,
        minorVersion: 0,
        oeaVersion: '0.1.0',
        collected: ['nar_325'],
        notCollected: ['nar_326', 'nar_327'],
      },
    });
  });

  it('decodes the MAE source prefix', async () => {
    const token = encodePayload(validPayload()).replace(INTEL_IMPORT_PREFIXES[0], INTEL_IMPORT_PREFIXES[1]);
    await expect(decodeIntelImportToken(token, knownArchiveIds)).resolves.toMatchObject({
      payload: { collected: ['nar_325'] },
    });
  });

  it('returns version fields from the decoded payload', async () => {
    const payload = validPayload();
    payload.majorVersion = 1;
    await expect(decodeIntelImportToken(encodePayload(payload), knownArchiveIds))
      .resolves.toMatchObject({ payload: { majorVersion: 1 } });
  });

  it('ignores unknown archive IDs and rejects known conflicts atomically', async () => {
    const unknown = validPayload();
    unknown.data.prtsAllItems.collected = ['nar_unknown'];
    await expect(decodeIntelImportToken(encodePayload(unknown), knownArchiveIds))
      .resolves.toMatchObject({ payload: { collected: [], notCollected: ['nar_326', 'nar_327'] } });

    unknown.data.prtsAllItems.notCollected = ['nar_unknown'];
    await expect(decodeIntelImportToken(encodePayload(unknown), knownArchiveIds))
      .resolves.toMatchObject({ payload: { collected: [], notCollected: [] } });

    const conflict = validPayload();
    conflict.data.prtsAllItems.notCollected = ['nar_325'];
    await expect(decodeIntelImportToken(encodePayload(conflict), knownArchiveIds))
      .rejects.toMatchObject({ code: 'invalid-payload' });
  });

  it('rejects a token with an invalid prefix or base64url body', async () => {
    await expect(decodeIntelImportToken('BAD-0-abc', knownArchiveIds))
      .rejects.toBeInstanceOf(IntelImportError);
    await expect(decodeIntelImportToken(`${INTEL_IMPORT_PREFIXES[0]}not*base64`, knownArchiveIds))
      .rejects.toMatchObject({ code: 'invalid-token' });
  });
});
