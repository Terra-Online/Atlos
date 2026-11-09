import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import {
    NOTIFICATION_TEMPLATE_NAMES,
    type NotificationSubjectKind,
    type NotificationTemplateName,
} from '@/pages/notify/notificationMessage';
import { capitalizeMessageValue, formatIcuText } from '@/locale/messageFormat';

interface NotificationLocaleData {
    search: {
        results: string;
    };
    notification: {
        subject: Record<NotificationSubjectKind, string>;
        types: Record<NotificationTemplateName, string>;
    };
    sync: {
        syncing: string;
    };
}

const localeModules = import.meta.glob<{ default: NotificationLocaleData }>(
    '../../locale/data/ui/*.json',
    { eager: true },
);

const SUBJECT_KINDS: NotificationSubjectKind[] = [
    'image',
    'comment',
    'submission',
];

const localeEntries = Object.entries(localeModules).map(([path, module]) => ({
    locale: path.split('/').pop()?.replace('.json', '') ?? '',
    data: module.default,
}));

const pluralSamplesForLocale = (locale: string): number[] => {
    const rules = new Intl.PluralRules(locale);
    const candidates = [
        ...Array.from({ length: 201 }, (_, value) => value),
        0.1,
        1.1,
        2.1,
        5.1,
    ];
    return rules
        .resolvedOptions()
        .pluralCategories.map(
            (category) =>
                candidates.find((value) => rules.select(value) === category) ??
                2,
        );
};

const formatLocaleTemplate = (
    locale: string,
    data: NotificationLocaleData,
    templateName: NotificationTemplateName,
    kind: NotificationSubjectKind,
    count: number,
    point = '(Point)',
): { output: string; subjectTags: number; pointTags: number } => {
    let subjectTags = 0;
    let pointTags = 0;
    const subject = data.notification.subject[kind];
    const formatter = new IntlMessageFormat(
        data.notification.types[templateName],
        locale,
    );
    const output = formatter.format({
        kind,
        subject,
        subjectCap: capitalizeMessageValue(subject, locale),
        point,
        hasPoint: point ? 'yes' : 'no',
        count,
        subjectTag: (parts: string[]) => {
            subjectTags += 1;
            return parts.join('');
        },
        pointTag: (parts: string[]) => {
            pointTags += 1;
            return parts.join('');
        },
    });
    return {
        output: Array.isArray(output) ? output.join('') : String(output),
        subjectTags,
        pointTags,
    };
};

const getLocaleData = (locale: string): NotificationLocaleData => {
    const match = localeEntries.find((entry) => entry.locale === locale);
    if (!match) throw new Error(`Missing test locale: ${locale}`);
    return match.data;
};

const formatCountTemplate = (
    locale: string,
    template: string,
    count: number,
): string =>
    formatIcuText({
        template,
        locale,
        values: { count },
    });

const collectCountTemplates = (value: unknown): string[] => {
    if (typeof value === 'string')
        return value.includes('{count') ? [value] : [];
    if (!value || typeof value !== 'object') return [];
    return Object.values(value).flatMap(collectCountTemplates);
};

describe('notification locale contract', () => {
    it('keeps identical string keys across all UI locales', () => {
        expect(localeEntries).toHaveLength(22);
        const expectedSubjects = [...SUBJECT_KINDS].sort();
        const expectedTypes = [...NOTIFICATION_TEMPLATE_NAMES].sort();

        for (const { data } of localeEntries) {
            expect(Object.keys(data.notification.subject).sort()).toEqual(
                expectedSubjects,
            );
            expect(Object.keys(data.notification.types).sort()).toEqual(
                expectedTypes,
            );
            for (const value of Object.values(data.notification.subject)) {
                expect(typeof value).toBe('string');
                expect(value.length).toBeGreaterThan(0);
            }
            for (const value of Object.values(data.notification.types)) {
                expect(typeof value).toBe('string');
                expect(value.length).toBeGreaterThan(0);
            }
        }
    });

    it('compiles every kind and locale plural category with rich text tags', () => {
        for (const { locale, data } of localeEntries) {
            for (const templateName of NOTIFICATION_TEMPLATE_NAMES) {
                for (const kind of SUBJECT_KINDS) {
                    for (const count of pluralSamplesForLocale(locale)) {
                        const result = formatLocaleTemplate(
                            locale,
                            data,
                            templateName,
                            kind,
                            count,
                        );
                        expect(result.output).toContain('(Point)');
                        expect(result.output).not.toMatch(/[{}]|<\/?\w+>/);
                        expect(result.subjectTags).toBe(1);
                        expect(result.pointTags).toBe(1);
                    }
                }
            }
        }
    });

    it('compiles search and sync counts for every locale plural category', () => {
        for (const { locale, data } of localeEntries) {
            for (const template of [data.search.results, data.sync.syncing]) {
                for (const count of pluralSamplesForLocale(locale)) {
                    const output = new IntlMessageFormat(
                        template,
                        locale,
                    ).format({ count });
                    expect(String(output)).not.toMatch(/[{}]/);
                }
            }
        }
    });

    it('contains no parenthesized pseudo-plural suffixes', () => {
        const pseudoPlural = /\p{L}\([\p{L}-]{1,12}\)/u;
        for (const { data } of localeEntries) {
            for (const template of collectCountTemplates(data)) {
                expect(template).not.toMatch(pseudoPlural);
            }
        }
    });
});

describe('notification grammar', () => {
    it('applies Italian gender agreement', () => {
        const data = getLocaleData('it-IT');
        expect(
            formatLocaleTemplate('it-IT', data, 'approved', 'image', 1).output,
        ).toBe('La tua immagine (Point) è ora pubblica.');
        expect(
            formatLocaleTemplate('it-IT', data, 'approved', 'comment', 1)
                .output,
        ).toBe('Il tuo commento (Point) è ora pubblico.');
    });

    it('uses Russian case forms at their template sites', () => {
        const data = getLocaleData('ru-RU');
        expect(
            formatLocaleTemplate('ru-RU', data, 'reply', 'image', 1).output,
        ).toContain('К вашему изображению');
        expect(
            formatLocaleTemplate('ru-RU', data, 'multiple', 'comment', 5)
                .output,
        ).toContain('связанных обновлений');
        expect(
            formatLocaleTemplate('ru-RU', data, 'multiple', 'comment', 2)
                .output,
        ).toContain('связанных обновления');
    });

    it('selects Korean particles without parenthesized alternatives', () => {
        const data = getLocaleData('ko-KR');
        expect(
            formatLocaleTemplate('ko-KR', data, 'approved', 'image', 1, '')
                .output,
        ).toBe('이미지가 공개되었습니다.');
        expect(
            formatLocaleTemplate('ko-KR', data, 'approved', 'comment', 1, '')
                .output,
        ).toBe('댓글이 공개되었습니다.');
    });

    it('keeps the Japanese point name after the keyword subject', () => {
        const data = getLocaleData('ja-JP');
        expect(
            formatLocaleTemplate(
                'ja-JP',
                data,
                'approved',
                'image',
                1,
                '「地点」',
            ).output,
        ).toBe('画像「地点」が公開されました。');
        expect(
            formatLocaleTemplate(
                'ja-JP',
                data,
                'reply',
                'comment',
                1,
                '「地点」',
            ).output,
        ).toBe('コメント「地点」に新しい返信があります。');
    });

    it('selects English singular and plural count forms', () => {
        const data = getLocaleData('en-US');
        expect(
            formatLocaleTemplate('en-US', data, 'vote', 'comment', 1).output,
        ).toContain('1 like');
        expect(
            formatLocaleTemplate('en-US', data, 'vote', 'comment', 2).output,
        ).toContain('2 likes');
    });

    it('formats search and sync counts with locale plural rules', () => {
        const english = getLocaleData('en-US');
        expect(formatCountTemplate('en-US', english.search.results, 1)).toBe(
            '1 result',
        );
        expect(formatCountTemplate('en-US', english.search.results, 2)).toBe(
            '2 results',
        );

        const russian = getLocaleData('ru-RU');
        expect(formatCountTemplate('ru-RU', russian.search.results, 1)).toBe(
            '1 результат',
        );
        expect(formatCountTemplate('ru-RU', russian.search.results, 2)).toBe(
            '2 результата',
        );
        expect(formatCountTemplate('ru-RU', russian.search.results, 5)).toBe(
            '5 результатов',
        );

        const arabic = getLocaleData('ar-SA');
        expect(formatCountTemplate('ar-SA', arabic.search.results, 0)).toBe(
            'لا نتائج',
        );
        expect(formatCountTemplate('ar-SA', arabic.search.results, 2)).toBe(
            'نتيجتان',
        );
    });
});
