import { encodePointIdToken } from '@/services/routing/pointToken';

/** World uses OEM's existing short token as its root-level point route. */
export function pointPath(id: string): string {
    const token = encodePointIdToken(id);
    if (!token)
        throw new Error('Point ID cannot be represented by an OEM short token');
    return `/${token}`;
}
