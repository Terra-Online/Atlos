/**
 * URL State Utility
 * 
 * 用於生成分享鏈接和初始化時讀取URL參數
 * 不會自動更新瀏覽器地址欄，用戶需要手動複製分享鏈接
 */

import { useMarkerStore } from '@/store/marker';
import useRegion from '@/store/region';
import { setLocale, SUPPORTED_LANGS } from '@/locale';
import { MARKER_TYPE_DICT } from '@/data/marker';

type Lang = (typeof SUPPORTED_LANGS)[number];

// URL 參數名稱（簡短版）
const PARAM_LANG = 'l';
const PARAM_FILTER = 'f';
const PARAM_REGION = 'r';
const PARAM_SUBREGION = 's';

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
};

const REGION_CODE_REVERSE: Record<string, string> = Object.fromEntries(
    Object.entries(REGION_CODE_MAP).map(([k, v]) => [v, k])
);

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
 * 為 type key 計算穩定的哈希值（0-2047範圍）
 * 使用簡單的字符串哈希算法，確保同一個key永遠得到相同的值
 */
const hashTypeKey = (key: string): number => {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 65536; // 映射到 0-65535
};

/**
 * 壓縮filter數組為base64字符串（使用基於哈希的位置編碼）
 * 每個type根據其key的哈希值獲得固定的位置，不受types.json順序影響
 */
const compressFilter = (keys: string[]): string => {
    try {
        if (keys.length === 0) return '';
        
        // 計算每個key的哈希位置並排序
        const positions = keys
            .map(key => hashTypeKey(key))
            .sort((a, b) => a - b); // 排序以便壓縮
        
        // 使用變長編碼：第一個位置用完整11bits，後續用差值
        const bits: number[] = [];
        
        // 編碼第一個位置（11 bits）
        bits.push(...numberToBits(positions[0], 11));
        
        // 編碼後續位置的差值（最多11 bits，實際可能更少）
        for (let i = 1; i < positions.length; i++) {
            const delta = positions[i] - positions[i - 1];
            bits.push(...encodeVariableInt(delta));
        }
        
        // 轉換為字節數組
        const byteCount = Math.ceil(bits.length / 8);
        const bytes = new Uint8Array(byteCount);
        for (let i = 0; i < bits.length; i++) {
            if (bits[i]) {
                bytes[Math.floor(i / 8)] |= (1 << (i % 8));
            }
        }
        
        // Base64 編碼
        let binary = '';
        bytes.forEach(byte => binary += String.fromCharCode(byte));
        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    } catch {
        return '';
    }
};

// 將數字轉換為指定位數的bit數組
const numberToBits = (num: number, bitCount: number): number[] => {
    const bits: number[] = [];
    for (let i = 0; i < bitCount; i++) {
        bits.push((num >> i) & 1);
    }
    return bits;
};

// 變長整數編碼（用於壓縮差值）
const encodeVariableInt = (num: number): number[] => {
    const bits: number[] = [];
    // 使用 4 bits 表示長度，然後是實際值
    const bitLength = Math.ceil(Math.log2(num + 1));
    bits.push(...numberToBits(bitLength, 4));
    bits.push(...numberToBits(num, bitLength));
    return bits;
};

/**
 * 解壓base64字符串為filter數組（基於哈希的位置解碼）
 */
const decompressFilter = (encoded: string): string[] => {
    try {
        // 還原base64
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const binary = atob(padded);
        
        // 轉換為bit數組
        const bits: number[] = [];
        for (let i = 0; i < binary.length; i++) {
            const byte = binary.charCodeAt(i);
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

// 將bit數組轉換為數字
const bitsToNumber = (bits: number[]): number => {
    let num = 0;
    for (let i = 0; i < bits.length; i++) {
        if (bits[i]) num |= (1 << i);
    }
    return num;
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
    if (filter.length > 0) {
        // 驗證所有key都存在於MARKER_TYPE_DICT中
        const validKeys = filter.filter(key => MARKER_TYPE_DICT[key]);
        if (validKeys.length > 0) {
            const compressed = compressFilter(validKeys);
            if (compressed) {
                params.set(PARAM_FILTER, compressed);
            }
        }
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
 */
export const applyUrlParams = async (): Promise<void> => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);

    // 應用語言參數
    const langParam = params.get(PARAM_LANG);
    if (langParam) {
        // 嘗試從短代碼還原完整locale
        const fullLocale = LANG_CODE_REVERSE[langParam] || langParam;
        if ((SUPPORTED_LANGS as readonly string[]).includes(fullLocale)) {
            await setLocale(fullLocale as Lang);
        }
    }

    // 應用篩選器參數（支持壓縮和原始格式）
    const filterParam = params.get(PARAM_FILTER);
    if (filterParam) {
        let keys: string[] = [];
        
        // 嘗試解壓（base64格式）
        if (!filterParam.includes(',')) {
            keys = decompressFilter(filterParam);
        }
        
        // 如果解壓失敗或包含逗號，當作原始格式處理（兼容wiki/蓝图站）
        if (keys.length === 0) {
            keys = filterParam
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        }
        
        // 驗證key有效性
        const validKeys = keys.filter(key => MARKER_TYPE_DICT[key]);
        
        if (validKeys.length > 0) {
            useMarkerStore.getState().setFilter(validKeys);
        }
    }

    // 應用區域參數（從縮寫還原）
    const regionParam = params.get(PARAM_REGION);
    if (regionParam) {
        const fullRegion = REGION_CODE_REVERSE[regionParam] || regionParam;
        useRegion.getState().setCurrentRegion(fullRegion);
    }

    // 應用子區域參數
    const subregionParam = params.get(PARAM_SUBREGION);
    if (subregionParam) {
        useRegion.getState().setCurrentSubregion(subregionParam);
    }

    // 清除URL參數，保持地址欄乾淨
    if (params.toString()) {
        window.history.replaceState({}, '', window.location.pathname);
    }
};

// React hook: 獲取生成分享鏈接的函數
export const useShareUrl = () => {
    return { generateShareUrl, copyShareUrl };
};