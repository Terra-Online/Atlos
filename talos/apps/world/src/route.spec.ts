import { encodePointIdToken } from '@/services/routing/pointToken';
import { pointPath } from '@/services/noclip/route';
import { expect, it } from 'vitest';
import { readLaunch } from './route';
const catalog =
    'https://cdn.opendfieldmap.org/noclip/releases/fixed/index.json';
it('uses the configured release even when a share URL supplies deployment parameters', () => {
    const launch = readLaunch(
        new URL(
            'https://world.oem.re/' +
                encodePointIdToken('123') +
                '?release=old&oem=https://evil.test/data&session=old',
        ),
        catalog,
    );
    expect(launch.point).toBe('123');
    expect(launch.catalog).toBe(catalog);
});
it('opens an overview from the short region link or default entry', () => {
    expect(
        readLaunch(new URL('https://world.oem.re/?region=DJ_1'), catalog),
    ).toMatchObject({ region: 'Dijiang', subregion: 'DJ_1', point: '' });
    expect(readLaunch(new URL('https://world.oem.re/'), catalog).region).toBe(
        'Valley_4',
    );
    expect(() =>
        readLaunch(new URL('https://world.oem.re/?region=invalid'), catalog),
    ).toThrow('Unknown World region');
    expect(() =>
        readLaunch(new URL('https://world.oem.re/'), undefined),
    ).toThrow('not configured');
});

it('round-trips OEM short tokens and rejects invalid tokens instead of selecting a different point', () => {
    const id = '9800000001';
    const url = new URL(pointPath(id), 'https://world.oem.re');
    expect(url.pathname).toBe('/' + encodePointIdToken(id));
    expect(url.search).toBe('');
    expect(readLaunch(url, catalog).point).toBe(id);
    expect(() =>
        readLaunch(new URL('https://world.oem.re/invalid!'), catalog),
    ).toThrow('Invalid point token');
});
