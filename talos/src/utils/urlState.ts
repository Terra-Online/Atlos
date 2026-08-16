// Compatibility facade for the legacy URL utility entry point.
// New code should import from './url/*' by responsibility.
export {
    applyUrlParams,
    shouldSuppressInitialAutoOverlays,
} from './url/apply';
export {
    buildPointShareToken,
    copyShareUrl,
    generatePointShareShortUrl,
    generatePointShareUrl,
    generateShareUrl,
    useShareUrl,
} from './url/share';
