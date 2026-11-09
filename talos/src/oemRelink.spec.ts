import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import worker from '../oem-relink/src/index';

const buildToken = (payload: unknown): string => {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `OEA-0-${compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
};

const buildMaeToken = (payload: unknown): string => {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `MAE-0-${compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
};

const fetchWorker = (path: string, headers?: HeadersInit, host = 'oem.re'): Promise<Response> => (
  worker.fetch(new Request(`https://${host}${path}`, { headers }))
);

describe('oem-relink Intel imports', () => {
  it('routes the short import path to Intel', async () => {
    const response = await fetchWorker('/i/OEA-0-abc');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://opendfieldmap.org/intel?import=OEA-0-abc');
  });

  it('routes the MAE source prefix to Intel', async () => {
    const response = await fetchWorker('/i/MAE-0-abc');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://opendfieldmap.org/intel?import=MAE-0-abc');
  });

  it('returns JSON for the debug suffix instead of forwarding', async () => {
    const response = await fetchWorker('/i/OEA-0-abc/_debug');
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({ ok: false, worker: 'oem-relink' });
  });

  it('returns the decoded JSON for a valid debug payload', async () => {
    const token = buildToken({
      majorVersion: 7,
      minorVersion: 3,
      data: {
        oeaVersion: 'future.version',
        prtsAllItems: { collected: ['nar_325'], notCollected: [] },
      },
    });
    const response = await fetchWorker(`/i/${token}/_debug`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      payload: {
        majorVersion: 7,
        minorVersion: 3,
        data: { oeaVersion: 'future.version' },
      },
    });
  });

  it('decodes a valid MAE debug payload', async () => {
    const token = buildMaeToken({
      majorVersion: 0,
      minorVersion: 0,
      data: {
        oeaVersion: '0.1.0',
        prtsAllItems: { collected: ['nar_325'], notCollected: [] },
      },
    });
    const response = await fetchWorker(`/i/${token}/_debug`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, payload: { data: { oeaVersion: '0.1.0' } } });
  });

  it('accepts a trailing slash on debug paths but ignores unknown suffixes', async () => {
    const debugResponse = await fetchWorker('/i/OEA-0-abc/_debug/');
    expect(debugResponse.status).toBe(400);
    expect(debugResponse.headers.get('content-type')).toContain('application/json');

    const ordinaryResponse = await fetchWorker('/i/OEA-0-abc/other');
    expect(ordinaryResponse.headers.get('location')).toBe('https://opendfieldmap.org/i/OEA-0-abc/other');
  });

  it('keeps ordinary map short links on their original path', async () => {
    const response = await fetchWorker('/i/ABC1234');
    expect(response.headers.get('location')).toBe('https://opendfieldmap.org/i/ABC1234');
  });

  it('supports the legacy query import form', async () => {
    const response = await fetchWorker('/i/?import=OEA-0-abc');
    expect(response.headers.get('location')).toBe('https://opendfieldmap.org/intel?import=OEA-0-abc');
  });

  it('keeps geo and beta host selection for imports', async () => {
    const cnResponse = await fetchWorker('/i/OEA-0-abc', { 'cf-ipcountry': 'CN' });
    expect(cnResponse.headers.get('location')).toBe('https://opendfieldmap.cn/intel?import=OEA-0-abc');

    const betaResponse = await fetchWorker('/i/OEA-0-abc', undefined, 'beta.oem.re');
    expect(betaResponse.headers.get('location')).toBe('https://beta.opendfieldmap.org/intel?import=OEA-0-abc');
  });
});
