import L from 'leaflet';
import { canvasSurface, existingCanvasSurface } from './canvasMarkerSurface';

const nativeMarker = L.Marker.prototype as unknown as { _initIcon(): void };
let iconTemplate: HTMLElement | undefined;
function cloneIcon(this: L.DivIcon, oldIcon?: HTMLElement): HTMLElement {
  const template = iconTemplate!;
  const icon = oldIcon?.tagName === 'DIV' ? oldIcon : template.cloneNode(true) as HTMLElement;
  if (icon === oldIcon) icon.replaceChildren(...Array.from(template.childNodes, node => node.cloneNode(true)));
  if (this.options.bgPos) { const point = L.point(this.options.bgPos); icon.style.backgroundPosition = `${-point.x}px ${-point.y}px`; }
  (this as unknown as { _setIconStyles(element: HTMLElement, name: string): void })._setIconStyles(icon, 'icon');
  return icon;
}

// Joint implementation: keep identical to Atlos/mapCore/canvas/markerViewport.ts.
// Leaflet owns logical membership and semantic nodes; the instance scene paints all points.
export class ViewportMarker extends L.Marker {
  override getPane(name?: string): HTMLElement | undefined {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (map && (!name || name === 'markerPane')) return canvasSurface(map).getSemanticPane();
    return super.getPane(name);
  }
  _initIcon(): void {
    const map = (this as unknown as { _map?: L.Map })._map, icon = this.options.icon;
    if (map && icon instanceof L.DivIcon && typeof icon.options.html === 'string' && icon.createIcon === L.DivIcon.prototype.createIcon) {
      // The standard Leaflet call is synchronous. Restore the shared icon immediately afterward.
      const template = canvasSurface(map).getIconTemplate(icon, icon.options.html), previous = iconTemplate;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const create = icon.createIcon;
      iconTemplate = template; icon.createIcon = cloneIcon;
      try { nativeMarker._initIcon.call(this); }
      finally { icon.createIcon = create; iconTemplate = previous; }
    } else nativeMarker._initIcon.call(this);
  }
  override getEvents(): { [name: string]: L.LeafletEventHandlerFn } { return {}; }
  override onAdd(map: L.Map): this {
    this.options.autoPanOnFocus = false;
    (this as unknown as { _zoomAnimated: boolean })._zoomAnimated = false;
    canvasSurface(map);
    try { return super.onAdd(map); }
    catch (error) { existingCanvasSurface(map)?.remove(this); throw error; }
  }
  override onRemove(map: L.Map): this {
    existingCanvasSurface(map)?.remove(this);
    return super.onRemove(map);
  }
  update(): this {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (map && this.getElement()) canvasSurface(map).place(this);
    return this;
  }
  _setPos(point: L.Point): void {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (map) canvasSurface(map).place(this, point);
  }
}
