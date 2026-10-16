import { getCurrentLocale } from '@hub/locale';
import { parseTimestamp, formatAbsoluteTime } from '@main/lib/format/time';

export const formatDate = (
    value?: string,
    locale = getCurrentLocale(),
): string => {
    const date = parseTimestamp(value);
    return date ? formatAbsoluteTime(date, { locale }) : '-';
};
