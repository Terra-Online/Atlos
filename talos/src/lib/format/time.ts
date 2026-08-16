import { toBCP47 } from '@/lib/i18n/lang';

export type TimestampInput = Date | string | number | null | undefined;
export type DateTimePrecision = 'date' | 'dateTime';

interface AbsoluteTimeOptions {
    locale: string;
    precision?: DateTimePrecision;
    timeZone?: string;
}

interface RelativeTimeOptions {
    locale: string;
    nowMs?: number;
}

interface ElapsedTimeValue {
    unit: 'second' | 'minute' | 'hour' | 'day';
    value: number;
}

const absoluteFormatterCache = new Map<string, Intl.DateTimeFormat>();
const relativeFormatterCache = new Map<string, Intl.RelativeTimeFormat>();

const getNumberingLanguageTag = (languageTag: string): string =>
    `${languageTag}-u-nu-latn`;

const validDate = (date: Date): Date | null =>
    Number.isNaN(date.getTime()) ? null : date;

export const parseTimestamp = (value: TimestampInput): Date | null => {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date) return validDate(new Date(value.getTime()));

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        const ms = value < 1_000_000_000_000 ? value * 1000 : value;
        return validDate(new Date(ms));
    }

    const raw = value.trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric)) return null;
        const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
        return validDate(new Date(ms));
    }

    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
    return validDate(new Date(hasTimezone ? normalized : `${normalized}Z`));
};

const getAbsoluteFormatter = ({
    locale,
    precision = 'dateTime',
    timeZone,
}: AbsoluteTimeOptions): Intl.DateTimeFormat => {
    const languageTag = toBCP47(locale);
    const cacheKey = `${languageTag}:${precision}:${timeZone ?? 'local'}`;
    const cached = absoluteFormatterCache.get(cacheKey);
    if (cached) return cached;

    const formatter = new Intl.DateTimeFormat(languageTag, {
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(precision === 'dateTime'
            ? {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hourCycle: 'h23',
              }
            : {}),
        timeZone,
    });
    absoluteFormatterCache.set(cacheKey, formatter);
    return formatter;
};

const getRelativeFormatter = (locale: string): Intl.RelativeTimeFormat => {
    const languageTag = toBCP47(locale);
    const cached = relativeFormatterCache.get(languageTag);
    if (cached) return cached;

    const formatter = new Intl.RelativeTimeFormat(
        getNumberingLanguageTag(languageTag),
        {
            numeric: 'always',
            style: 'short',
        },
    );
    relativeFormatterCache.set(languageTag, formatter);
    return formatter;
};

export const formatAbsoluteTime = (
    date: Date,
    options: AbsoluteTimeOptions,
): string => {
    if (!validDate(date)) return '';

    const parts = getAbsoluteFormatter(options).formatToParts(date);
    const dateLabel = parts
        .filter(
            ({ type }) => type === 'year' || type === 'month' || type === 'day',
        )
        .map(({ value }) => value)
        .join('-');
    const timeLabel = parts
        .filter(
            ({ type }) =>
                type === 'hour' || type === 'minute' || type === 'second',
        )
        .map(({ value }) => value)
        .join(':');
    return timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;
};

const getElapsedTimeValue = (
    fromMs: number,
    nowMs: number,
): ElapsedTimeValue => {
    const diffSec = Math.max(0, Math.floor((nowMs - fromMs) / 1000));

    if (diffSec < 60) return { unit: 'second', value: diffSec };
    if (diffSec < 60 * 60)
        return { unit: 'minute', value: Math.floor(diffSec / 60) };
    if (diffSec < 24 * 60 * 60) {
        return { unit: 'hour', value: Math.floor(diffSec / (60 * 60)) };
    }
    return { unit: 'day', value: Math.floor(diffSec / (24 * 60 * 60)) };
};

export const formatElapsedShort = (fromMs: number, nowMs: number): string => {
    const { unit, value } = getElapsedTimeValue(fromMs, nowMs);
    const suffix = { second: 's', minute: 'm', hour: 'hr', day: 'd' }[unit];
    return `${value}${suffix}`;
};

export const formatRelativeTime = (
    date: Date,
    { locale, nowMs = Date.now() }: RelativeTimeOptions,
): string => {
    if (!validDate(date)) return '';

    const { unit, value } = getElapsedTimeValue(date.getTime(), nowMs);
    return getRelativeFormatter(locale).format(-value, unit);
};
