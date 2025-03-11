export enum EMapMarkerCategory {
    COLLECTION = "collection",
    RESOURCE = "resource",
    ENEMY_SPAWNER = "enemySpawner",
    BOSS_FIGHT = "bossFight",
    POI = "poi",
    MISSIONS = "missions",
    OTHERS = "others"
}

export interface IMapMarkerTypeData {
    key: string;
    /**
     * i18n key
     */
    name: string;
    category: EMapMarkerCategory;
    icon: {
        iconUrl: string,
        iconSize: [number, number],
        iconAnchor: [number, number],
        popupAnchor: [number, number],
        // TODO add leaflet shadow support
    }
    schema: Record<string, string>
}

export interface IMapMarkerData {
    /**
     * type key string
     */
    type: string
    /**
     * map key string, declare which map this marker is in
     */
    mapKey: string
    /**
     * map latlng used in leaflet
     */
    pos: [number, number]
    /**
     * TODO implement metadata for mark point
     * example: boss info / treasure box info ...
     */
    metadata?: any
}