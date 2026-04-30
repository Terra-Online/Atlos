export type PositionResponse = {
    code: number;
    message: string;
    timestamp: string;
    data: {
        pos: {
            x: number;
            y: number;
            z: number;
        };
        levelId: string;
        isOnline: boolean;
        mapId: string;
    };
};
