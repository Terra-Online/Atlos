export type LabelType = 'sub' | 'site';

// Pixel coordinate in region maxZoom pixel space: [x, y]
export type LabelPoint = [number, number];

// Stable, language-agnostic ID.
// - sub:  "VL/HB"
// - site: "VL/OL/originium_passage"
export type LabelId = string;

export interface BaseLabel {
    id: LabelId;
    type: LabelType;
    // Region code used by locale region bundle, e.g. "VL" / "WL" / "DJ"
    region: string;
    // Subregion short code used by locale region bundle, e.g. "HB"
    sub: string;
    point: LabelPoint;
}

export interface SubLabel extends BaseLabel {
    type: 'sub';
}

export interface SiteLabel extends BaseLabel {
    type: 'site';
    site: string;
}

export type AnyLabel = SubLabel | SiteLabel;

export interface LabelDataV1 {
    version: 1;
    regions: Record<
        string,
        {
            // map of label.id -> label
            labels: Record<string, AnyLabel>;
        }
    >;
}
