export const POINT_TOKEN_PATTERN = /^[0-9a-zA-Z]{7}$/;

export const getPathPointToken = (pathname: string): string | null => {
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    return lastSegment && POINT_TOKEN_PATTERN.test(lastSegment) ? lastSegment : null;
};

export const stripPathPointToken = (pathname: string): string => {
    const segments = pathname.split('/').filter(Boolean);
    if (!segments.length || !POINT_TOKEN_PATTERN.test(segments[segments.length - 1])) {
        return pathname;
    }
    const keptSegments = segments.slice(0, -1);
    return keptSegments.length ? `/${keptSegments.join('/')}/` : '/';
};
