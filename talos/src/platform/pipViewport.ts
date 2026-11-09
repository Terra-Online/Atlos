export const PIP_WIDTH = 800;
export const PIP_HEIGHT = 600;
export const PIP_MIN_HEIGHT = 320;
export const PIP_MOBILE_WIDTH = 500;
export const PIP_MOBILE_HEIGHT = 400;
export const PIP_COMPACT_UI_EDGE = 360;
export const PIP_UI_MINIMUM_EDGE = 240;

export interface AppViewport {
    width: number;
    height: number;
    minEdge: number;
    inPictureInPicture: boolean;
    isPipMobile: boolean;
    isPipCompact: boolean;
    isPipUiTooSmall: boolean;
}

export const createAppViewport = (
    width: number,
    height: number,
    inPictureInPicture: boolean,
): AppViewport => {
    const minEdge = Math.min(width, height);
    const isPipMobile = inPictureInPicture
        && (width <= PIP_MOBILE_WIDTH || height < PIP_MOBILE_HEIGHT);

    return {
        width,
        height,
        minEdge,
        inPictureInPicture,
        isPipMobile,
        isPipCompact: inPictureInPicture && minEdge < PIP_COMPACT_UI_EDGE,
        isPipUiTooSmall: inPictureInPicture && minEdge < PIP_UI_MINIMUM_EDGE,
    };
};
