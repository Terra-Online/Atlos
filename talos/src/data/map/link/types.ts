// Link rectangle bounds in region maxZoom pixel space: [[x1, y1], [x2, y2]]
// Note: Links are always square (1:1 aspect ratio), coordinates rounded to 3 decimal places
export type LinkBounds = [[number, number], [number, number]];

// Stable, language-agnostic ID (e.g. "VL/link_0")
export type LinkId = string;

// Link target configuration (used globally for all link areas)
export interface LinkTarget {
    // i18n key for the link title (e.g. "links.wiki")
    titleKey: string;
    // External URL to navigate to
    url: string;
}

// Individual link area on the map
export interface MapLink {
    id: LinkId;
    // Region code (e.g. "VL", "WL")
    region: string;
    // Bounds of the clickable square [[x1, y1], [x2, y2]] (3 decimal places)
    bounds: LinkBounds;
}

// Global link configuration - shared by all link areas
export interface GlobalLinkConfig {
    // Left tooltip link
    leftLink: LinkTarget;
    // Right tooltip link
    rightLink: LinkTarget;
}

export interface LinkDataV1 {
    version: 1;
    // Global link configuration (same for all areas)
    config: GlobalLinkConfig;
    // Per-region link areas
    regions: Record<
        string,
        {
            // map of link.id -> link
            links: Record<string, MapLink>;
        }
    >;
}
