import L from 'leaflet';
import 'leaflet.markercluster';
import { IMarkerData, IMarkerType } from '@/data/marker';
import { getItemIconUrl, getMarkerSubIconUrl } from '@/utils/resource';
import styles from './marker.module.scss';

const CLUSTER_MAIN_WHITELIST = new Set(['enemy', 'resource']); // manually maintained for now, may expand as a custom list determined by user settings

interface ClusterLayerDeps {
    map: L.Map;
    getMarkerDict: () => Record<string, L.Layer>;
    getMarkerDataDict: () => Record<string, IMarkerData>;
    getMarkerTypeMap: () => Record<string, string[]>;
    getLayerSubregionDict: () => Record<string, L.LayerGroup>;
}

export class ClusterLayer {
    private readonly clusterGroupsByType: Record<string, L.MarkerClusterGroup> = {};
    private enabled = false;
    private filterKeys: string[] = [];
    private activeSubregions = new Set<string>();

    constructor(private readonly deps: ClusterLayerDeps) {}

    registerType(type: IMarkerType) {
        if (!CLUSTER_MAIN_WHITELIST.has(type.category.main)) {
            return;
        }
        if (this.clusterGroupsByType[type.key]) {
            return;
        }
        const iconUrl = getItemIconUrl(type.key);
        const hasSubIcon = Boolean(type.subIcon);
        const subIconUrl = hasSubIcon && type.subIcon ? getMarkerSubIconUrl(type.subIcon) : '';

        this.clusterGroupsByType[type.key] = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 2,
            maxClusterRadius: 60,
            iconCreateFunction: (cluster) => {
                const count = cluster.getChildCount();

                if (type.noFrame) {
                    return L.divIcon({
                        html: `<div class="${styles.noFrameInner} ${styles.clusterMarker}">
                                  <img src="${iconUrl}" class="${styles.noFrameImage}" alt="${type.key}" />
                                  <span class="${styles.clusterCount}">${count}</span>
                               </div>`,
                        className: `${styles.noFrameMarkerIcon} marker-cluster-custom`,
                        iconSize: [50, 50],
                        iconAnchor: [25, 25],
                    });
                }

                if (hasSubIcon) {
                    return L.divIcon({
                        html: `<div class="${styles.markerInner} ${styles.clusterMarker}">
                                  <div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div>
                                  <div class="${styles.subIconContainer}">
                                      <div class="${styles.subIcon}" style="background-image: url(${subIconUrl})"></div>
                                  </div>
                                  <span class="${styles.clusterCount}">${count}</span>
                               </div>`,
                        className: `${styles.FrameMarkerIcon} marker-cluster-custom`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16],
                    });
                }

                return L.divIcon({
                    html: `<div class="${styles.markerInner} ${styles.clusterMarker}">
                              <div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div>
                              <span class="${styles.clusterCount}">${count}</span>
                           </div>`,
                    className: `${styles.FrameMarkerIcon} marker-cluster-custom`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16],
                });
            },
        });
    }

    setActiveSubregions(subregions: string[]) {
        this.activeSubregions = new Set(subregions);
        if (this.enabled) {
            this.refreshClusters();
        }
    }

    applyFilter(typeKeys: string[]) {
        this.filterKeys = typeKeys;
        if (this.enabled) {
            this.refreshClusters();
        } else {
            this.removeClustersFromMap();
        }
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.refreshClusters();
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.removeClustersFromMap();
    }

    notifyMarkersAdded(_: string[]) {
        if (!this.enabled) return;
        this.refreshClusters();
    }

    isEnabled() {
        return this.enabled;
    }

    isTypeManaged(typeKey: string) {
        return Boolean(this.clusterGroupsByType[typeKey]);
    }

    private refreshClusters() {
        const map = this.deps.map;
        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const markerTypeMap = this.deps.getMarkerTypeMap();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        // reset all cluster groups
        Object.values(this.clusterGroupsByType).forEach((clusterGroup) => {
            clusterGroup.clearLayers();
            if (map.hasLayer(clusterGroup)) {
                map.removeLayer(clusterGroup);
            }
        });

        if (!this.enabled || this.filterKeys.length === 0) {
            return;
        }

        const activeTypeKeys = this.filterKeys.filter((key) => this.clusterGroupsByType[key]);

        activeTypeKeys.forEach((typeKey) => {
            const clusterGroup = this.clusterGroupsByType[typeKey];
            if (!clusterGroup) return;

            const markerIds = markerTypeMap[typeKey] ?? [];
            markerIds.forEach((markerId) => {
                const marker = markerDict[markerId];
                const markerData = markerDataDict[markerId];
                if (!marker || !markerData) return;
                if (!this.activeSubregions.has(markerData.subregionId)) return;

                const parentGroup = layerSubregionDict[markerData.subregionId];
                if (parentGroup?.hasLayer(marker)) {
                    parentGroup.removeLayer(marker);
                }
                clusterGroup.addLayer(marker);
            });

            if (clusterGroup.getLayers().length > 0) {
                clusterGroup.addTo(map);
            }
        });
    }

    private removeClustersFromMap() {
        const map = this.deps.map;
        Object.values(this.clusterGroupsByType).forEach((clusterGroup) => {
            clusterGroup.clearLayers();
            if (map.hasLayer(clusterGroup)) {
                map.removeLayer(clusterGroup);
            }
        });
    }
}
