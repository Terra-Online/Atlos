import { getAuthBase } from '@/services/http/authRuntime';
import type { UGCImage } from '@/services/ugc/client';

export type { UGCImage } from '@/services/ugc/client';

type CacheEntry = {
    expiresAt: number;
    images: UGCImage[];
};

const UGC_API_BASE = `${getAuthBase()}/uploads/v1`;
const POSITIVE_TTL_MS = 30 * 1000;
const EMPTY_TTL_MS = 10 * 1000;
const imageCache = new Map<string, CacheEntry>();

export const peekRecordToolUGCImages = (markerId: string): UGCImage[] | null => {
    const cached = imageCache.get(markerId);
    if (!cached || cached.expiresAt <= Date.now()) return null;
    return cached.images;
};

export const listRecordToolUGCImages = async (markerId: string): Promise<UGCImage[]> => {
    const normalizedId = markerId.trim();
    if (!normalizedId) return [];

    const cached = peekRecordToolUGCImages(normalizedId);
    if (cached) return cached;

    const response = await fetch(
        `${UGC_API_BASE}/images?markerIds=${encodeURIComponent(normalizedId)}&limit=1&scope=prod&publicOnly=1&demoLocal=1`,
        { credentials: 'omit' },
    );
    if (!response.ok) throw new Error(`Record tool image request failed: ${response.status}`);

    const payload = await response.json() as { items?: UGCImage[] };
    const images = (payload.items ?? []).filter((image) => image.markerId === normalizedId);
    imageCache.set(normalizedId, {
        expiresAt: Date.now() + (images.length > 0 ? POSITIVE_TTL_MS : EMPTY_TTL_MS),
        images,
    });
    return images;
};
