import { LatLngBounds, Point, type TalosMap } from '@/component/mapCore/engine';

export const toMapBounds = (
    bounds: TalosMap['options']['maxBounds'],
): LatLngBounds | null => bounds ?? null;

/**
 * 直接读取引擎的橡皮筋过界偏移量（触控板视觉过界），
 * 替代 Leaflet 时代基于 _limitCenter 的私有接口检测。
 */
export const isMapOverdragged = (
    map: TalosMap,
    // 保留参数以维持调用签名；判定已改由引擎偏移量完成。
    _bounds: LatLngBounds,
): boolean => map.getOverdragOffset().distanceTo(new Point(0, 0)) > 1;
