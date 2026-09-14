// jsdom has no raster backend. Browser regressions exercise the real Canvas implementation.
if (typeof HTMLCanvasElement !== 'undefined') {
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value(this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null;
    let context = contexts.get(this);
    if (!context) {
      context = new Proxy({ canvas: this,
        measureText: (text: string) => ({ width: text.length * 6, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }),
      } as unknown as CanvasRenderingContext2D, { get(target, key) { return Reflect.get(target, key) ?? (() => {}); } });
      contexts.set(this, context);
    }
    return context;
  } });
  const computedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = element => computedStyle(element);
}
