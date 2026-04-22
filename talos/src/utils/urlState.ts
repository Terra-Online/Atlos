/**
 * URL State Utility
 * 
 * 用於生成分享鏈接和初始化時讀取URL參數
 * 不會自動更新瀏覽器地址欄，用戶需要手動複製分享鏈接
 */

import { useMarkerStore } from '@/store/marker';
import useRegion from '@/store/region';
import { setLocale, SUPPORTED_LANGS } from '@/locale';
import { MARKER_TYPE_DICT, WORLD_MARKS, type IMarkerData } from '@/data/marker';
import { REGION_DICT } from '@/data/map';
import { navigateToSharedPoint } from '@/utils/navigation';

type Lang = (typeof SUPPORTED_LANGS)[number];

// URL 參數名稱
const PARAM_LANG = 'l';
const PARAM_FILTER = 'f';
const PARAM_TYPE = 'type';
const PARAM_REGION = 'r';
const PARAM_SUBREGION = 's';
const PARAM_POINT = 'p';
const PARAM_POINT_TOKEN = 'x';
const AUTH_URL_PARAM_WHITELIST = new Set(['token', 'email', 'error', 'domain']);
const POINT_SHARE_SHORT_ORIGIN = 'https://oem.re';

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE62_CHAR_TO_VALUE = new Map<string, bigint>(
    BASE62_ALPHABET.split('').map((char, index) => [char, BigInt(index)]),
);
const BASE62_BASE = BigInt(BASE62_ALPHABET.length);

// 可逆置換：以 36-bit 空間做乘法置換，兼顧可逆與短碼長度。
const POINT_ID_PERMUTATION_MOD = 1n << 36n;
const POINT_ID_PERMUTATION_MULTIPLIER = 25214903917n;
const POINT_ID_PERMUTATION_OFFSET = 11n;
const POINT_ID_TOKEN_LENGTH = 7;

// f 參數壓縮格式：
// - 單個 type: ~<base36Index>
// - 多個 type: ~~<base64url(varint(count, firstIndex, deltaMinusOne...))>
const FILTER_SINGLE_PREFIX = '~';
const FILTER_MULTI_PREFIX = '~~';

// 語言代碼映射（雙向）
const LANG_CODE_MAP: Record<string, string> = {
    'en-US': 'en',
    'zh-CN': 'cn',
    'zh-HK': 'hk',
    'ja-JP': 'jp',
    'ko-KR': 'kr',
    'ru-RU': 'ru',
    'es-ES': 'es',
    'fr-FR': 'fr',
    'de-DE': 'de',
    'it-IT': 'it',
    'id-ID': 'id',
    'pt-BR': 'br',
    'ar-AE': 'ar',
    'ms-MY': 'my',
    'pl-PL': 'pl',
    'sv-SE': 'se',
    'th-TH': 'th',
    'vi-VN': 'vn',
};

const LANG_CODE_REVERSE: Record<string, string> = Object.fromEntries(
    Object.entries(LANG_CODE_MAP).map(([k, v]) => [v, k])
);

// 區域代碼映射
const REGION_CODE_MAP: Record<string, string> = {
    'Valley_4': 'VL',
    'Wuling': 'WL',
    'Dijiang': 'DJ',
    'Weekraid_1': 'ES',
};

const REGION_CODE_REVERSE: Record<string, string> = Object.fromEntries(
    Object.entries(REGION_CODE_MAP).map(([k, v]) => [v, k])
);

const SUBREGION_TO_REGION_MAP = Object.entries(REGION_DICT).reduce(
    (acc, [regionKey, region]) => {
        region.subregions.forEach((subregionKey) => {
            acc[subregionKey] = regionKey;
        });
        return acc;
    },
    {} as Record<string, string>,
);

const POINT_ID_MARKER_MAP = WORLD_MARKS.reduce((acc, marker) => {
    // 若出現重複 id，保留第一筆，避免後續覆寫造成不穩定。
    if (!acc.has(marker.id)) {
        acc.set(marker.id, marker);
    }
    return acc;
}, new Map<string, IMarkerData>());

const UNIQUE_ARCHIVE_TYPE_MARKER_MAP = WORLD_MARKS.reduce((acc, marker) => {
    const markerType = MARKER_TYPE_DICT[marker.type];
    if (markerType?.category?.main !== 'files') return acc;

    if (!acc.has(marker.type)) {
        acc.set(marker.type, marker);
        return acc;
    }

    const existing = acc.get(marker.type);
    if (existing && existing.id !== marker.id) {
        acc.set(marker.type, null);
    }
    return acc;
}, new Map<string, IMarkerData | null>());

const SORTED_MARKER_TYPE_KEYS = Object.keys(MARKER_TYPE_DICT).sort();
const MARKER_TYPE_INDEX_MAP = new Map<string, number>(
    SORTED_MARKER_TYPE_KEYS.map((key, index) => [key, index])
);

const modInverse = (a: bigint, mod: bigint): bigint => {
    let t = 0n;
    let newT = 1n;
    let r = mod;
    let newR = ((a % mod) + mod) % mod;

    while (newR !== 0n) {
        const quotient = r / newR;
        [t, newT] = [newT, t - quotient * newT];
        [r, newR] = [newR, r - quotient * newR];
    }

    if (r !== 1n) {
        throw new Error('Permutation multiplier is not invertible under modulus');
    }

    return ((t % mod) + mod) % mod;
};

const POINT_ID_PERMUTATION_INVERSE = modInverse(
    POINT_ID_PERMUTATION_MULTIPLIER,
    POINT_ID_PERMUTATION_MOD,
);

const encodeBase62 = (value: bigint): string => {
    if (value === 0n) return '0';

    let num = value;
    let encoded = '';
    while (num > 0n) {
        const remainder = Number(num % BASE62_BASE);
        encoded = BASE62_ALPHABET[remainder] + encoded;
        num /= BASE62_BASE;
    }
    return encoded;
};

const decodeBase62 = (encoded: string, maxLength: number = Number.POSITIVE_INFINITY): bigint | null => {
    if (!encoded) return null;
    if (encoded.length > maxLength) return null;

    let value = 0n;
    for (const ch of encoded) {
        const digit = BASE62_CHAR_TO_VALUE.get(ch);
        if (digit === undefined) return null;
        value = value * BASE62_BASE + digit;
    }
    return value;
};

const encodePointIdToken = (pointId: string): string | null => {
    if (!/^\d+$/.test(pointId)) return null;

    const id = BigInt(pointId);
    if (id < 0n || id >= POINT_ID_PERMUTATION_MOD) return null;

    const obfuscated = (id * POINT_ID_PERMUTATION_MULTIPLIER + POINT_ID_PERMUTATION_OFFSET) % POINT_ID_PERMUTATION_MOD;
    return encodeBase62(obfuscated).padStart(POINT_ID_TOKEN_LENGTH, '0');
};

const decodePointIdToken = (token: string): string | null => {
    if (token.length !== POINT_ID_TOKEN_LENGTH) return null;

    const encoded = token.replace(/^0+/, '') || '0';
    const obfuscated = decodeBase62(encoded, POINT_ID_TOKEN_LENGTH);
    if (obfuscated === null || obfuscated < 0n || obfuscated >= POINT_ID_PERMUTATION_MOD) {
        return null;
    }

    const decoded = ((obfuscated - POINT_ID_PERMUTATION_OFFSET + POINT_ID_PERMUTATION_MOD) % POINT_ID_PERMUTATION_MOD);
    const id = (decoded * POINT_ID_PERMUTATION_INVERSE) % POINT_ID_PERMUTATION_MOD;
    return id.toString();
};

const mergeFilterKeys = (keys: string[]) => {
    const validKeys = keys.filter((key) => MARKER_TYPE_DICT[key]);
    if (validKeys.length === 0) return;
    const currentFilter = useMarkerStore.getState().filter;
    const mergedFilter = Array.from(new Set([...currentFilter, ...validKeys]));
    useMarkerStore.getState().setFilter(mergedFilter);
};

const resolvePointShareTarget = (pointId: string): { point: IMarkerData; regionKey: string } | null => {
    const normalizedPointId = String(pointId);
    const point = POINT_ID_MARKER_MAP.get(normalizedPointId);
    if (!point) return null;

    const regionKey = SUBREGION_TO_REGION_MAP[point.subregId];
    if (!regionKey) return null;

    return { point, regionKey };
};

const resolveArchiveTypeShareTarget = (typeKey: string): { point: IMarkerData; regionKey: string } | null => {
    const point = UNIQUE_ARCHIVE_TYPE_MARKER_MAP.get(typeKey);
    if (!point) return null;

    const regionKey = SUBREGION_TO_REGION_MAP[point.subregId];
    if (!regionKey) return null;

    return { point, regionKey };
};

// 從 localStorage 獲取當前語言
const getCurrentLocale = (): string | null => {
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('talos:locale');
        }
    } catch {
        // ignore
    }
    return null;
};

/**
 * Legacy: 舊版壓縮格式使用哈希位置編碼。
 * 新鏈接不再生成此格式，只保留解碼兼容。
 */
const hashTypeKey = (key: string): number => {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 65536; // 映射到 0-65535
};

const encodeVarUint = (num: number): number[] => {
    const bytes: number[] = [];
    let value = num >>> 0;
    while (value >= 0x80) {
        bytes.push((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    bytes.push(value);
    return bytes;
};

const decodeVarUint = (
    bytes: Uint8Array,
    startOffset: number,
): { value: number; nextOffset: number } | null => {
    let value = 0;
    let shift = 0;
    let offset = startOffset;

    while (offset < bytes.length && shift < 35) {
        const byte = bytes[offset++];
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) {
            return { value, nextOffset: offset };
        }
        shift += 7;
    }

    return null;
};

const toBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
};

const fromBase64Url = (encoded: string): Uint8Array | null => {
    try {
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch {
        return null;
    }
};

/**
 * 壓縮 filter 為短字串。
 * 新版使用無碰撞的 type 索引編碼，並移除舊算法的位數上限。
 */
const compressFilter = (keys: string[]): string => {
    if (keys.length === 0) return '';

    const indexes = Array.from(
        new Set(
            keys
                .map((key) => MARKER_TYPE_INDEX_MAP.get(key))
                .filter((idx): idx is number => idx !== undefined),
        ),
    ).sort((a, b) => a - b);

    if (indexes.length === 0) return '';

    // 單一 type 走最短路徑：~ + base36(index)
    if (indexes.length === 1) {
        return `${FILTER_SINGLE_PREFIX}${indexes[0].toString(36)}`;
    }

    // 多 type 使用 varint + base64url
    const bytes: number[] = [];
    bytes.push(...encodeVarUint(indexes.length));
    bytes.push(...encodeVarUint(indexes[0]));
    for (let i = 1; i < indexes.length; i++) {
        // 使用 delta-1 壓縮相鄰索引（最小值可為 0）
        bytes.push(...encodeVarUint(indexes[i] - indexes[i - 1] - 1));
    }

    return `${FILTER_MULTI_PREFIX}${toBase64Url(new Uint8Array(bytes))}`;
};

const decompressFilterV2 = (encoded: string): string[] => {
    // 單一 type：~<base36Index>
    if (encoded.startsWith(FILTER_SINGLE_PREFIX) && !encoded.startsWith(FILTER_MULTI_PREFIX)) {
        const index = Number.parseInt(encoded.slice(FILTER_SINGLE_PREFIX.length), 36);
        if (!Number.isInteger(index) || index < 0 || index >= SORTED_MARKER_TYPE_KEYS.length) {
            return [];
        }
        const key = SORTED_MARKER_TYPE_KEYS[index];
        return key ? [key] : [];
    }

    // 多 type：~~<base64url(varint...)>
    if (!encoded.startsWith(FILTER_MULTI_PREFIX)) {
        return [];
    }

    const payload = encoded.slice(FILTER_MULTI_PREFIX.length);
    const bytes = fromBase64Url(payload);
    if (!bytes || bytes.length === 0) {
        return [];
    }

    let offset = 0;
    const countDecoded = decodeVarUint(bytes, offset);
    if (!countDecoded) return [];
    const count = countDecoded.value;
    offset = countDecoded.nextOffset;
    if (count <= 1) return [];

    const firstDecoded = decodeVarUint(bytes, offset);
    if (!firstDecoded) return [];
    let currentIndex = firstDecoded.value;
    offset = firstDecoded.nextOffset;

    if (currentIndex < 0 || currentIndex >= SORTED_MARKER_TYPE_KEYS.length) {
        return [];
    }

    const indexes: number[] = [currentIndex];
    for (let i = 1; i < count; i++) {
        const deltaDecoded = decodeVarUint(bytes, offset);
        if (!deltaDecoded) return [];
        offset = deltaDecoded.nextOffset;
        currentIndex += deltaDecoded.value + 1;
        if (currentIndex < 0 || currentIndex >= SORTED_MARKER_TYPE_KEYS.length) {
            return [];
        }
        indexes.push(currentIndex);
    }

    // 嚴格要求完整消耗 payload，避免髒數據被誤解析。
    if (offset !== bytes.length) {
        return [];
    }

    return indexes.map((idx) => SORTED_MARKER_TYPE_KEYS[idx]).filter(Boolean);
};

/**
 * Legacy：解壓舊版 base64 哈希位置格式。
 */
const decompressLegacyFilter = (encoded: string): string[] => {
    try {
        const bytes = fromBase64Url(encoded);
        if (!bytes) return [];
        
        // 轉換為bit數組
        const bits: number[] = [];
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            for (let j = 0; j < 8; j++) {
                bits.push((byte >> j) & 1);
            }
        }
        
        // 構建哈希到key的映射
        const hashToKey = new Map<number, string>();
        Object.keys(MARKER_TYPE_DICT).forEach(key => {
            hashToKey.set(hashTypeKey(key), key);
        });
        
        const positions: number[] = [];
        let bitIndex = 0;
        
        // 解碼第一個位置
        if (bits.length < 11) return [];
        const firstPos = bitsToNumber(bits.slice(0, 11));
        positions.push(firstPos);
        bitIndex = 11;
        
        // 解碼後續位置
        while (bitIndex + 4 <= bits.length) {
            const bitLength = bitsToNumber(bits.slice(bitIndex, bitIndex + 4));
            bitIndex += 4;
            
            if (bitLength === 0 || bitIndex + bitLength > bits.length) break;
            
            const delta = bitsToNumber(bits.slice(bitIndex, bitIndex + bitLength));
            bitIndex += bitLength;
            
            positions.push(positions[positions.length - 1] + delta);
        }
        
        // 根據位置查找對應的key
        return positions
            .map(pos => hashToKey.get(pos))
            .filter((key): key is string => key !== undefined);
    } catch {
        return [];
    }
};

const decompressFilter = (encoded: string): string[] => {
    const v2 = decompressFilterV2(encoded);
    if (v2.length > 0) {
        return v2;
    }
    return decompressLegacyFilter(encoded);
};

// 將bit數組轉換為數字
const bitsToNumber = (bits: number[]): number => {
    let num = 0;
    for (let i = 0; i < bits.length; i++) {
        if (bits[i]) num |= (1 << i);
    }
    return num;
};

const getFilterParamValue = (keys: string[]): string => {
    if (keys.length === 0) return '';
    const validKeys = keys.filter((key) => MARKER_TYPE_DICT[key]);
    if (validKeys.length === 0) return '';
    return compressFilter(validKeys);
};

/**
 * 生成分享鏈接
 * @returns 完整的分享URL
 */
export const generateShareUrl = (): string => {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();

    // 語言（簡化為2字符代碼）
    const locale = getCurrentLocale();
    if (locale) {
        const shortCode = LANG_CODE_MAP[locale] || locale;
        params.set(PARAM_LANG, shortCode);
    }

    // 篩選器（壓縮後使用base64）
    const filter = useMarkerStore.getState().filter;
    const filterParam = getFilterParamValue(filter);
    if (filterParam) {
        params.set(PARAM_FILTER, filterParam);
    }

    // 區域（使用縮寫）
    const { currentRegionKey, currentSubregionKey } = useRegion.getState();
    if (currentRegionKey) {
        const shortRegion = REGION_CODE_MAP[currentRegionKey] || currentRegionKey;
        params.set(PARAM_REGION, shortRegion);
    }
    if (currentSubregionKey) {
        params.set(PARAM_SUBREGION, currentSubregionKey); // 子區域保持原樣
    }

    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
};

/**
 * 生成指定點位的分享鏈接。
 * 預設生成單一 query token（?x=...）。
 * 若 id 超出編碼範圍，降級為 legacy query 參數。
 */
const buildPointShareToken = (point: Pick<IMarkerData, 'id' | 'type' | 'subregId'>): string => {
    const token = encodePointIdToken(String(point.id));
    if (token) return token;

    // 非預期邊界：若 id 超出 36-bit 保留舊格式作為降級保底。
    const params = new URLSearchParams();
    const pointFilter = getFilterParamValue([point.type]);
    if (pointFilter) {
        params.set(PARAM_FILTER, pointFilter);
    }
    const fallbackRegion = SUBREGION_TO_REGION_MAP[point.subregId] || useRegion.getState().currentRegionKey;
    const shortRegion = REGION_CODE_MAP[fallbackRegion] || fallbackRegion;
    params.set(PARAM_REGION, shortRegion);
    params.set(PARAM_SUBREGION, point.subregId);
    params.set(PARAM_POINT, String(point.id));
    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
};

export const generatePointShareShortUrl = (point: Pick<IMarkerData, 'id' | 'type' | 'subregId'>): string => {
    const tokenOrFallback = buildPointShareToken(point);
    if (tokenOrFallback.startsWith('?')) {
        return tokenOrFallback;
    }
    const tokenParams = new URLSearchParams();
    tokenParams.set(PARAM_POINT_TOKEN, tokenOrFallback);
    return `?${tokenParams.toString()}`;
};

export const generatePointShareUrl = (point: Pick<IMarkerData, 'id' | 'type' | 'subregId'>): string => {
    const tokenOrFallback = buildPointShareToken(point);
    if (tokenOrFallback.startsWith('?')) {
        return `${POINT_SHARE_SHORT_ORIGIN}/${tokenOrFallback}`;
    }
    const tokenParams = new URLSearchParams();
    tokenParams.set(PARAM_POINT_TOKEN, tokenOrFallback);
    return `${POINT_SHARE_SHORT_ORIGIN}/?${tokenParams.toString()}`;
};

/**
 * 複製分享鏈接到剪貼板
 * @returns Promise<boolean> 是否成功複製
 */
export const copyShareUrl = async (): Promise<boolean> => {
    try {
        const url = generateShareUrl();
        await navigator.clipboard.writeText(url);
        return true;
    } catch (_err) {
        //console.error('Failed to copy share URL:', err);
        return false;
    }
};

/**
 * 從當前URL讀取參數並應用到stores
 * 應在應用初始化時調用一次
 * 
 * 合并策略：
 * - 篩選器（filter）：合并模式，URL中的类型添加到用户当前选中的类型中
 * - 語言和區域：以用户本地设置优先，只有本地无设置时才应用URL参数
 */
export const applyUrlParams = async (): Promise<void> => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);

    // 應用語言參數（以用户本地优先）
    const langParam = params.get(PARAM_LANG);
    if (langParam) {
        const currentLocale = getCurrentLocale();
        // 只有当本地没有设置语言时，才应用 URL 参数
        if (!currentLocale) {
            const fullLocale = LANG_CODE_REVERSE[langParam] || langParam;
            if ((SUPPORTED_LANGS as readonly string[]).includes(fullLocale)) {
                await setLocale(fullLocale as Lang);
            }
        }
    }

    // 應用篩選器參數（合并模式）
    const filterParam = params.get(PARAM_FILTER);
    if (filterParam) {
        let keys: string[] = [];
        
        // 優先嘗試原始格式（逗號分隔或單個key）
        // 如果包含逗號或者是有效的type key，當作原始格式處理
        const rawKeys = filterParam
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        
        // 檢查是否為原始格式：包含逗號 或 第一個值是有效的type key
        const isRawFormat = filterParam.includes(',') || 
                           (rawKeys.length > 0 && MARKER_TYPE_DICT[rawKeys[0]]);
        
        if (isRawFormat) {
            // 使用原始格式（兼容wiki/蓝图站）
            keys = rawKeys;
        } else {
            // 嘗試解壓base64格式
            keys = decompressFilter(filterParam);
        }
        
        // 驗證key有效性
        const validKeys = keys.filter(key => MARKER_TYPE_DICT[key]);
        
        mergeFilterKeys(validKeys);
    }

    // 應用區域參數（以用户本地优先）
    const regionParam = params.get(PARAM_REGION);
    const navRegion = regionParam ? (REGION_CODE_REVERSE[regionParam] || regionParam) : null;
    if (regionParam) {
        const { currentRegionKey } = useRegion.getState();
        // 检查是否为默认区域（Valley_4），如果是默认值则可以被URL参数覆盖
        const isDefaultRegion = !currentRegionKey || currentRegionKey === 'Valley_4';
        if (isDefaultRegion) {
            useRegion.getState().setCurrentRegion(navRegion || regionParam);
        }
    }

    // 應用子區域參數（以用户本地优先）
    const subregionParam = params.get(PARAM_SUBREGION);
    if (subregionParam) {
        const { currentSubregionKey } = useRegion.getState();
        // 只有当本地没有设置子区域时，才应用 URL 参数
        if (!currentSubregionKey) {
            useRegion.getState().setCurrentSubregion(subregionParam);
        }
    }

    const pointParam = params.get(PARAM_POINT);
    const typeParam = params.get(PARAM_TYPE)?.trim() || null;
    const pointTokenParam = params.get(PARAM_POINT_TOKEN)?.trim() || null;
    const pointIdFromToken = pointTokenParam ? decodePointIdToken(pointTokenParam) : null;
    const resolvedFromToken = pointIdFromToken ? resolvePointShareTarget(pointIdFromToken) : null;
    const resolvedFromType = typeParam ? resolveArchiveTypeShareTarget(typeParam) : null;

    if (resolvedFromToken) {
        mergeFilterKeys([resolvedFromToken.point.type]);
        navigateToSharedPoint({
            regionKey: resolvedFromToken.regionKey,
            subregionKey: resolvedFromToken.point.subregId,
            pointId: resolvedFromToken.point.id,
        });
    } else if (pointParam) {
        const resolvedFromQueryPoint = resolvePointShareTarget(pointParam);
        if (resolvedFromQueryPoint) {
            mergeFilterKeys([resolvedFromQueryPoint.point.type]);
            navigateToSharedPoint({
                regionKey: resolvedFromQueryPoint.regionKey,
                subregionKey: resolvedFromQueryPoint.point.subregId,
                pointId: resolvedFromQueryPoint.point.id,
            });
        } else if (filterParam) {
            // Legacy 後備：舊鏈接僅在提供 f 時才嘗試按 r/s 導航。
            const fallbackRegion = useRegion.getState().currentRegionKey;
            navigateToSharedPoint({
                regionKey: navRegion || fallbackRegion,
                subregionKey: subregionParam || undefined,
                pointId: pointParam,
            });
        }
    } else if (resolvedFromType) {
        mergeFilterKeys([resolvedFromType.point.type]);
        navigateToSharedPoint({
            regionKey: resolvedFromType.regionKey,
            subregionKey: resolvedFromType.point.subregId,
            pointId: resolvedFromType.point.id,
        });
    } else if (typeParam) {
        // ?type 找不到唯一點位時，退化為明文 f
        mergeFilterKeys([typeParam]);
    }

    // 清除地圖分享參數；僅保留認證流程必要參數，避免影響 reset password 流程。
    if (params.toString()) {
        const newParams = new URLSearchParams(window.location.search);
        newParams.delete(PARAM_LANG);
        newParams.delete(PARAM_FILTER);
        newParams.delete(PARAM_TYPE);
        newParams.delete(PARAM_REGION);
        newParams.delete(PARAM_SUBREGION);
        newParams.delete(PARAM_POINT);
        newParams.delete(PARAM_POINT_TOKEN);

        const preservedParams = new URLSearchParams();
        newParams.forEach((value, key) => {
            if (AUTH_URL_PARAM_WHITELIST.has(key)) {
                preservedParams.append(key, value);
            }
        });

        const queryString = preservedParams.toString();
        const newUrl = queryString
            ? `${window.location.pathname}?${queryString}`
            : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
    }
};

// React hook: 獲取生成分享鏈接的函數
export const useShareUrl = () => {
    return { generateShareUrl, generatePointShareShortUrl, generatePointShareUrl, copyShareUrl };
};