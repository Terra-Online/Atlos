import { describe, expect, it } from 'vitest';
import {
    formatAbsoluteTime,
    formatRelativeTime,
    parseTimestamp,
} from './time';

describe('parseTimestamp', () => {
    it('normalizes second and millisecond Unix timestamps', () => {
        expect(parseTimestamp(1_700_000_000)?.getTime()).toBe(
            1_700_000_000_000,
        );
        expect(parseTimestamp('1700000000000')?.getTime()).toBe(
            1_700_000_000_000,
        );
    });

    it('treats timezone-free date strings as UTC', () => {
        expect(parseTimestamp('2026-08-03 08:30:15')?.toISOString()).toBe(
            '2026-08-03T08:30:15.000Z',
        );
    });

    it('preserves explicit timezone offsets', () => {
        expect(parseTimestamp('2026-08-03T16:30:15+08:00')?.toISOString()).toBe(
            '2026-08-03T08:30:15.000Z',
        );
    });

    it('rejects empty and invalid values', () => {
        expect(parseTimestamp(null)).toBeNull();
        expect(parseTimestamp('not-a-date')).toBeNull();
        expect(parseTimestamp(Number.NaN)).toBeNull();
    });
});

describe('formatAbsoluteTime', () => {
    const date = new Date('2026-08-03T08:30:15Z');

    it('localizes date order with consistent separators and 24-hour time', () => {
        expect(
            formatAbsoluteTime(date, {
                locale: 'en-US',
                precision: 'dateTime',
                timeZone: 'UTC',
            }),
        ).toBe('08-03-2026 08:30:15');
        expect(
            formatAbsoluteTime(date, {
                locale: 'zh-CN',
                precision: 'dateTime',
                timeZone: 'UTC',
            }),
        ).toBe('2026-08-03 08:30:15');
    });

    it('uses Latin digits for Arabic dates', () => {
        expect(
            formatAbsoluteTime(date, {
                locale: 'ar-SA',
                precision: 'dateTime',
                timeZone: 'UTC',
            }),
        ).toBe('03-08-2026 08:30:15');
    });
});

describe('formatRelativeTime', () => {
    const nowMs = Date.parse('2026-08-03T08:35:15Z');

    it('keeps the existing second, minute, hour, and day thresholds', () => {
        expect(
            formatRelativeTime(new Date(nowMs - 59_000), {
                locale: 'en-US',
                nowMs,
            }),
        ).toBe('59 sec. ago');
        expect(
            formatRelativeTime(new Date(nowMs - 5 * 60_000), {
                locale: 'en-US',
                nowMs,
            }),
        ).toBe('5 min. ago');
        expect(
            formatRelativeTime(new Date(nowMs - 2 * 60 * 60_000), {
                locale: 'en-US',
                nowMs,
            }),
        ).toBe('2 hr. ago');
        expect(
            formatRelativeTime(new Date(nowMs - 3 * 24 * 60 * 60_000), {
                locale: 'en-US',
                nowMs,
            }),
        ).toBe('3 days ago');
    });

    it('uses locale-native relative grammar', () => {
        expect(
            formatRelativeTime(new Date(nowMs - 5 * 60_000), {
                locale: 'zh-CN',
                nowMs,
            }),
        ).toBe('5分钟前');
        expect(
            formatRelativeTime(new Date(nowMs - 111 * 24 * 60 * 60_000), {
                locale: 'ru-RU',
                nowMs,
            }),
        ).toBe('111 дн. назад');
        expect(
            formatRelativeTime(new Date(nowMs - 111 * 24 * 60 * 60_000), {
                locale: 'ar-SA',
                nowMs,
            }),
        ).toBe('قبل 111 يومًا');
    });

    it('keeps future timestamps clamped to zero seconds ago', () => {
        expect(
            formatRelativeTime(new Date(nowMs + 60_000), {
                locale: 'en-US',
                nowMs,
            }),
        ).toBe('0 sec. ago');
    });
});
