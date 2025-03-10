export const MAP_CONFIGS = {
  'Valley_4': {
    dimensions: [8000, 10000],
    maxZoom: 3,
    tileSize: 200,
    initialOffset: {
      x: 750,// minor for left
      y: 250// minor for up
    },
    initialZoom: 2
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