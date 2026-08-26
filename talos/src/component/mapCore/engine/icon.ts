/**
 * Icon descriptors mirroring the Leaflet divIcon/icon options actually used
 * by this codebase. The overlay manager turns them into DOM elements with
 * Leaflet-compatible class names and anchor offsets.
 */
export interface DivIconOptions {
    html?: string;
    className?: string;
    iconSize?: [number, number];
    iconAnchor?: [number, number];
    popupAnchor?: [number, number];
    tooltipAnchor?: [number, number];
}

export class DivIcon {
    readonly options: DivIconOptions;

    constructor(options: DivIconOptions) {
        this.options = options;
    }
}

export interface ImageIconOptions {
    iconUrl: string;
    iconSize?: [number, number];
    iconAnchor?: [number, number];
    className?: string;
}

export class ImageIcon {
    readonly options: ImageIconOptions;

    constructor(options: ImageIconOptions) {
        this.options = options;
    }
}

export type CompatIcon = DivIcon | ImageIcon;

export const divIcon = (options: DivIconOptions): DivIcon =>
    new DivIcon(options);

export const icon = (options: ImageIconOptions): ImageIcon =>
    new ImageIcon(options);

/** Build the marker root element with Leaflet-compatible classes/offsets. */
export const createIconElement = (iconDef: CompatIcon): HTMLElement => {
    const element = document.createElement('div');
    element.classList.add('leaflet-marker-icon', 'leaflet-zoom-animated');
    element.style.pointerEvents = 'auto';

    if (iconDef instanceof DivIcon) {
        const { html, className, iconSize, iconAnchor } = iconDef.options;
        if (className) {
            className
                .split(/\s+/)
                .filter(Boolean)
                .forEach((name) => element.classList.add(name));
        }
        if (html !== undefined) {
            element.innerHTML = html;
        }
        if (iconSize) {
            element.style.width = `${iconSize[0]}px`;
            element.style.height = `${iconSize[1]}px`;
        }
        if (iconAnchor) {
            element.style.marginLeft = `${-iconAnchor[0]}px`;
            element.style.marginTop = `${-iconAnchor[1]}px`;
        }
    } else {
        const { iconUrl, iconSize, iconAnchor, className } = iconDef.options;
        const image = document.createElement('img');
        image.src = iconUrl;
        image.style.width = '100%';
        image.style.height = '100%';
        element.appendChild(image);
        if (className) {
            className
                .split(/\s+/)
                .filter(Boolean)
                .forEach((name) => element.classList.add(name));
        }
        if (iconSize) {
            element.style.width = `${iconSize[0]}px`;
            element.style.height = `${iconSize[1]}px`;
        }
        if (iconAnchor) {
            element.style.marginLeft = `${-iconAnchor[0]}px`;
            element.style.marginTop = `${-iconAnchor[1]}px`;
        }
    }

    return element;
};
