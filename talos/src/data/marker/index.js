import { getMarkerIconUrl } from '../../utils/resource'

import subregion1 from './data/subregion-1.json'
import subregion2 from './data/subregion-2.json'
import subregion3 from './data/subregion-3.json'
import subregion4 from './data/subregion-4.json'
import subregion5 from './data/subregion-5.json'
import subregion6 from './data/subregion-6.json'
import dijiang from './data/Dijiang.json'
import jinlong from './data/Jinlong.json'
import markerTypeDict from './type.json'

export const SUBREGION_MARKS_MAP = {
    'subregion-1': subregion1,
    'subregion-2': subregion2,
    'subregion-3': subregion3,
    'subregion-4': subregion4,
    'subregion-5': subregion5,
    'subregion-6': subregion6,
    'Dijiang': dijiang,
    'Jinlong': jinlong
}

export const MARKER_TYPE_DICT = markerTypeDict

export const MAEKER_TYPE_TREE = Object.values(MARKER_TYPE_DICT).reduce((acc, type) => {
    acc[type.category.main] = acc[type.category.main] || {}
    acc[type.category.main][type.category.sub] = acc[type.category.main][type.category.sub] || []
    acc[type.category.main][type.category.sub].push(type)
    return acc
}, {})
