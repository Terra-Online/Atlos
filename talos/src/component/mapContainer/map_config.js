export const MAP_CONFIGS = {
  'Valley_4': {
    dimensions: [8000, 10000],
    maxZoom: 3,
    tileSize: 200,
    initialOffset: {
      x: 750,
      y: 250
    },
    initialZoom: 2
  },
  'Jinlong': {
    dimensions: [8000, 10000],
    maxZoom: 3,
    tileSize: 200,
    initialOffset: {
      x: 500,
      y: 300
    },
    initialZoom: 2
  },
  'Dijiang': {
    dimensions: [12000, 9000],
    maxZoom: 4,
    tileSize: 500,
    initialOffset: {
      x: 400,
      y: 400
    },
    initialZoom: 1
  },
};

export const DEFAULT_CONFIG = MAP_CONFIGS['Valley_4'];