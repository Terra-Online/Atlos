export enum EMapMarkerCategory {
    COLLECTION = "collection",
    RESOURCE = "resource",
    ENEMY_SPAWNER = "enemySpawner",
    BOSS_FIGHT = "bossFight",
    POI = "poi",
    MISSIONS = "missions",
}

export interface IMapMarkerTypeData {
    key: string;
    name: string;
    category: EMapMarkerCategory;
    icon: {
        iconUrl: string,
        iconSize: [number, number],
        iconAnchor: [number, number],
        popupAnchor: [number, number],
        // TODO add leaflet shadow support
    }
} 