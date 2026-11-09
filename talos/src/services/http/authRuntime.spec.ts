import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthBase, getAuthHeaders } from './authRuntime';

afterEach(() => vi.unstubAllEnvs());

describe('build-specific production API origin', () => {
    it.each([
        ['https://api.opendfieldmap.cn/', 'https://api.opendfieldmap.cn'],
        ['https://api.opendfieldmap.org', 'https://api.opendfieldmap.org'],
    ])('uses the explicit production override %s', (override, expected) => {
        vi.stubEnv('PROD', true);
        vi.stubEnv('VITE_AUTH_BASE', override);
        expect(getAuthBase()).toBe(expected);
        expect(getAuthHeaders()).toEqual({});
    });

    it('falls back to api.opendfieldmap.org in production', () => {
        vi.stubEnv('PROD', true);
        vi.stubEnv('VITE_AUTH_BASE', '');
        expect(getAuthBase()).toBe('https://api.opendfieldmap.org');
    });

    it('preserves local development overrides', () => {
        vi.stubEnv('PROD', false);
        vi.stubEnv('VITE_AUTH_BASE', 'http://localhost:8787/');
        expect(getAuthBase()).toBe('http://localhost:8787');
    });
});
