import VA_Sub from './VA_Sub.json';

// Get subregions from json file
const getSubregionsFromJson = (regionId) => {
  if (regionId === 'Valley_4' && VA_Sub?.subregions?.subregions) {
    return VA_Sub.subregions.subregions;
  }
  return [];
};

export const MAP_CONFIGS = {
  'Valley_4': {
    dimensions: [8000, 10000],
    maxZoom: 3,
    tileSize: 200,
    initialOffset: {
      x: 750,// minor for left
      y: 250// minor for up
    },
    initialZoom: 2,
    get subregions() {
      return getSubregionsFromJson('Valley_4');
    }
  },
  'Jinlong': {
    dimensions: [8000, 10000],
    maxZoom: 3,
    tileSize: 200,
    initialOffset: {
      x: -2400,
      y: -1250
    },
    initialZoom: 2
  },
  'Dijiang': {
    dimensions: [4000, 5000],
    maxZoom: 2,
    tileSize: 200,
    initialOffset: {
      x: 0,
      y: -500
    },
    initialZoom: 0
  },
};

export const DEFAULT_CONFIG = MAP_CONFIGS['Valley_4'];

// Expose getRegionSubregions function as api
export const getRegionSubregions = (regionId) => {
  const config = MAP_CONFIGS[regionId];
  return config?.subregions || [];
};