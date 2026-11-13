import { decodePointIdToken } from '@/services/routing/pointToken';
import { REGION_DICT } from '@/data/map';

export interface Launch {
    catalog: string;
    point: string;
    region: string;
    subregion: string;
}

/** Public links describe a destination; the build owns its immutable data catalog. */
export function readLaunch(url: URL, catalog: string | undefined): Launch {
    if (!catalog) throw new Error('World data release is not configured');
    const source = new URL(catalog, url);
    if (
        source.protocol !== 'https:' &&
        !(
            source.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(source.hostname)
        )
    )
        throw new Error('Invalid World data URL');
    const token = url.pathname === '/' ? null : url.pathname.slice(1);
    const decoded = token === null ? null : decodePointIdToken(token);
    if (token !== null && decoded === null)
        throw new Error('Invalid point token');
    const point = decoded ?? '';
    const subregion =
        url.searchParams.get('region') || REGION_DICT.Valley_4.subregions[0];
    const region = Object.entries(REGION_DICT).find(([, value]) =>
        value.subregions.includes(subregion),
    )?.[0];
    if (!point && !region) throw new Error('Unknown World region');
    return { catalog: source.href, point, region: region || '', subregion };
}
