export const parseDateLike = (value?: string): Date | null => {
    if (!value) return null;
    const raw = value.trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric)) return null;
        const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDateYYYYMMDD = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const formatDateTimeYYYYMMDDHHMMSS = (date: Date): string => {
    const dateLabel = formatDateYYYYMMDD(date);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${dateLabel} ${hours}:${minutes}:${seconds}`;
};

export const formatElapsedShort = (fromMs: number, nowMs: number): string => {
    const diffSec = Math.max(0, Math.floor((nowMs - fromMs) / 1000));

    if (diffSec < 60) {
        return `${diffSec}s`;
    }

    if (diffSec < 60 * 60) {
        const minutes = Math.floor(diffSec / 60);
        return `${minutes}m`;
    }

    if (diffSec < 24 * 60 * 60) {
        const hours = Math.floor(diffSec / (60 * 60));
        return `${hours}hr`;
    }

    const days = Math.floor(diffSec / (24 * 60 * 60));
    return `${days}d`;
};
