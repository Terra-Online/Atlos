import { getMarkerIconUrl } from '../../utils/resource'
import markerTypeDict from './type.json'

const modules = import.meta.glob('./data/*.json', { eager: true });

const SUBREGION_MARKS_MAP = {};

for (const path in modules) {
  // 提取文件名作为键 (例如: './data/VL_1.json' -> 'VL_1')
  const key = path.replace('./data/', '').replace('.json', '');

  if (key !== 'type') {
    SUBREGION_MARKS_MAP[key] = modules[path].default || modules[path];
  }
}

export { SUBREGION_MARKS_MAP };

export const WORLD_MARKS = Object.values(SUBREGION_MARKS_MAP).reduce((acc, subregion) => {
    acc.push(...subregion)
    return acc
}, [])

export const MARKER_TYPE_DICT = markerTypeDict

export const MARKER_TYPE_TREE = Object.values(MARKER_TYPE_DICT).reduce((acc, type) => {
    acc[type.category.main] = acc[type.category.main] || {}
    acc[type.category.main][type.category.sub] = acc[type.category.main][type.category.sub] || []
    acc[type.category.main][type.category.sub].push(type)
    return acc
}, {})