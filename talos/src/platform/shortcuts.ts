/**
 * Keyboard shortcut configuration — data-driven.
 *
 * Each shortcut entry defines:
 *   - `id`:       unique identifier (used as i18n key suffix)
 *   - `keys`:     array of key labels to render (supports per-platform via `mac`/`other`)
 *   - `hotkey`:   react-hotkeys-hook key string (platform prefix auto-resolved)
 *   - `group`:    visual grouping in Settings panel
 *
 * The display layer reads this config to render the Settings keyboard section;
 * the logic layer reads it to bind handlers via react-hotkeys-hook.
 */

import { isApplePlatform } from '@/platform/platform';
import type { KeyChip } from '@/component/shortcut';

// ─── Keyboard modifier helpers ───────────────────────────────

/** Modifier key symbol for the current platform (⌘ on Apple, Ctrl on others) */
export const modKey = (): string => (isApplePlatform() ? '⌘' : 'Ctrl');

/** react-hotkeys-hook modifier prefix (meta on Apple, ctrl on others) */
export const modPrefix = (): string => (isApplePlatform() ? 'meta' : 'ctrl');

/** Whether the platform modifier key (Cmd / Ctrl) is currently pressed */
export const isModKeyPressed = (e: MouseEvent | KeyboardEvent): boolean =>
    isApplePlatform() ? e.metaKey : e.ctrlKey;

export interface ShortcutEntry {
    /** Unique id, also used as i18n key `settings.shortcuts.<id>` */
    id: string;
    /** Key chips rendered in Settings */
    keys: KeyChip[];
    /** react-hotkeys-hook combo string (resolved at runtime) */
    hotkey: string;
    /** Grouping in the settings panel */
    group: 'data' | 'history' | 'map' | 'ui';
}

// ─── Helpers ─────────────────────────────────────────────────

const mod = modKey;                              // ⌘ | Ctrl
const pre = modPrefix;                           // meta | ctrl

// ─── Config factory (called once, memoises platform keys) ────

let _cache: ShortcutEntry[] | null = null;

export function getShortcutConfig(): ShortcutEntry[] {
    if (_cache) return _cache;

    const m = mod();
    const p = pre();

    _cache = [
        // ── UI ──
        {
            id: 'toggleUI',
            keys: [{ label: m, variant: 'mod' }, { label: 'H' }],
            hotkey: `${p}+h`,
            group: 'ui',
        },
        {
            id: 'quickSearch',
            keys: [{ label: m, variant: 'mod' }, { label: 'K' }],
            hotkey: `${p}+k`,
            group: 'ui',
        },

        // ── Data ──
        {
            id: 'exportData',
            keys: [{ label: m, variant: 'mod' }, { label: 'E' }],
            hotkey: `${p}+e`,
            group: 'data',
        },
        {
            id: 'importData',
            keys: [{ label: m, variant: 'mod' }, { label: 'I' }],
            hotkey: `${p}+i`,
            group: 'data',
        },

        // ── History ──
        {
            id: 'undo',
            keys: [{ label: m, variant: 'mod' }, { label: 'Z' }],
            hotkey: `${p}+z`,
            group: 'history',
        },
        {
            id: 'redo',
            keys: [{ label: '⇧', size: '1u' }, { label: m, variant: 'mod' }, { label: 'Z' }],
            hotkey: `shift+${p}+z`,
            group: 'history',
        },

        // ── Map ──
        {
            id: 'zoomIn',
            keys: [{ label: '⇧', size: '1u' }, { label: '+' }],
            hotkey: 'shift+=',
            group: 'map',
        },
        {
            id: 'zoomOut',
            keys: [{ label: '⇧', size: '1u' }, { label: '−' }],
            hotkey: 'shift+-',
            group: 'map',
        },
        {
            id: 'multiSelect',
            keys: [{ label: m, variant: 'mod' }, { label: 'Drag', size: '2u' }],
            hotkey: '', // not a simple hotkey — handled by pointer events
            group: 'map',
        },
        {
            id: 'multiDeselect',
            keys: [{ label: '⇧', size: '1u' }, { label: m, variant: 'mod' }, { label: 'Drag', size: '2u' }],
            hotkey: '', // handled by pointer events (shift+mod+drag)
            group: 'map',
        },
    ];

    return _cache;
}

/** Return shortcuts belonging to a specific group */
export function getShortcutsByGroup(group: ShortcutEntry['group']): ShortcutEntry[] {
    return getShortcutConfig().filter((s) => s.group === group);
}
