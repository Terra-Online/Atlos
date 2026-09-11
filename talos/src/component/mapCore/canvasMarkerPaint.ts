import { MarkerMotion, curves, ease } from './canvasMarkerMotion';

export interface MarkerArt {
  image: string; subImage: string; noFrame: boolean; tier: string; count?: string;
}
export interface Sprite { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number; version?: number }
export interface AnimatedSprite { render(now: number): Sprite }
interface Asset { image: HTMLImageElement; ready: boolean }
const WHITE = 'rgb(248,248,248)';
const accent = (value: number) => `rgb(${248 + 7 * value},${248 - 52 * value},${248 - 208 * value})`;
const tiers: Record<string, string> = {
  L1: '#fdff95', L2: '#ffe524', L3: '#ff8b38', B1: '#3262c9', B2: '#1d48bd', B3: '#3427bc', B4: '#431dbe',
};

/** Instance-owned assets. A state change never clears assets or another point's pixels. */
export class MarkerPainter {
  private assets = new Map<string, Asset>();
  private sprites = new Map<string, Sprite>();
  private versions = new Map<string, number>();
  private animated = new WeakMap<MarkerMotion, Map<string, AnimatedSprite>>();
  private artKeys = new WeakMap<MarkerArt, string>();
  private disposed = false;
  hoverDecoration = '';
  selectedDecoration = '';
  font = '700 11px sans-serif';
  fontVersion = 0;
  constructor(readonly ratio: number, private invalidate: (url: string) => void, private require2D?: () => void) {}
  private artKey(art: MarkerArt): string {
    let key = this.artKeys.get(art);
    if (!key) { key = JSON.stringify(art); this.artKeys.set(art, key); }
    return `${key}|${this.versions.get(art.image) ?? 0}|${this.versions.get(art.subImage) ?? 0}|${this.versions.get(this.hoverDecoration) ?? 0}|${this.versions.get(this.selectedDecoration) ?? 0}|${this.fontVersion}`;
  }
  private asset(url: string): HTMLImageElement | undefined {
    if (!url) return;
    let asset = this.assets.get(url);
    if (!asset) {
      const image = new Image();
      if (this.require2D) image.crossOrigin = 'anonymous';
      asset = { image, ready: false };
      this.assets.set(url, asset);
      image.onload = () => {
        if (this.disposed) return;
        asset!.ready = true;
        this.versions.set(url, (this.versions.get(url) ?? 0) + 1);
        this.invalidate(url);
      };
      image.onerror = () => {
        if (this.disposed || !this.require2D) return;
        // Preserve existing URL support when a host image does not grant CORS texture access.
        const fallback = new Image(); asset!.image = fallback;
        fallback.onload = () => {
          if (this.disposed) return;
          asset!.ready = true; this.versions.set(url, (this.versions.get(url) ?? 0) + 1);
          this.require2D?.(); this.invalidate(url);
        };
        fallback.src = url;
      };
      image.src = url;
      if (image.complete && image.naturalWidth) asset.ready = true;
    }
    return asset.ready ? asset.image : undefined;
  }
  private image(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, width: number, height: number, contain: boolean) {
    const image = this.asset(url);
    if (!image) return;
    const scale = (contain ? Math.min : Math.max)(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    if (!contain && (w > width || h > height)) {
      const sw = width / scale, sh = height / scale;
      ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, width, height);
    } else ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
  }
  private circle(ctx: CanvasRenderingContext2D, radius: number, fill?: string, stroke?: string) {
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }
  paint(ctx: CanvasRenderingContext2D, art: MarkerArt, motion: MarkerMotion, now: number): void {
    const state = motion.state!;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(0, art.noFrame ? motion.shift.value(now) : -16);
    if (!art.noFrame) {
      // Both official shadowed discs are retained, including their separate shadows.
      // Canvas shadows use backing pixels, unlike paths transformed by the DPR matrix.
      ctx.save(); ctx.shadowColor = '#000'; ctx.shadowBlur = 10 * this.ratio;
      this.circle(ctx, 14, WHITE);
      this.circle(ctx, 14, accent(motion.background.value(now)));
      ctx.restore();
      this.circle(ctx, 17, undefined, accent(motion.border.value(now)));
    }
    if (!art.noFrame || state.pulsing) {
      const pulse = ease(((now - motion.pulseStart) % 1150) / 1150, curves.easeOut);
      const alpha = state.pulsing ? 0.95 * (1 - pulse) : motion.ringAlpha.value(now);
      const radius = (art.noFrame ? 13 : 14) + 1 + (state.pulsing ? 4 + 10 * pulse : motion.ringOffset.value(now));
      if (alpha > 0) this.circle(ctx, radius, undefined, `rgba(248,248,248,${alpha})`);
    }
    ctx.save();
    const invert = motion.invert.value(now);
    const grayscale = motion.grayscale.value(now);
    ctx.filter = `${grayscale ? `grayscale(${grayscale})` : ''} ${art.noFrame && invert ? `invert(${invert})` : ''}`.trim() || 'none';
    ctx.globalAlpha *= art.noFrame ? motion.imageAlpha.value(now) : 1;
    const size = art.noFrame ? 50 : 32;
    this.image(ctx, art.image, -size / 2, -size / 2, size, size, art.noFrame);
    ctx.restore();
    if (!art.noFrame) {
      ctx.save();
      const selected = motion.arrow.value(now);
      if (art.subImage) ctx.rotate(-Math.PI / 2 * selected);
      const bottom = art.subImage ? 0 : 2 * selected;
      // CSS drop-shadow's blur is a Gaussian sigma; shadowBlur is twice that sigma.
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4 * this.ratio;
      ctx.beginPath(); ctx.moveTo(-5, 18 + bottom); ctx.lineTo(5, 18 + bottom); ctx.lineTo(0, 25 + bottom); ctx.closePath();
      ctx.fillStyle = accent(motion.border.value(now)); ctx.fill(); ctx.restore();
    }
    if (art.subImage) {
      ctx.save(); ctx.translate(36, 0); ctx.globalAlpha *= motion.subAlpha.value(now);
      const decoration = (url: string, size: number, scale: number, alpha: number) => {
        if (!alpha) return;
        ctx.save(); ctx.globalAlpha *= alpha;
        this.image(ctx, url, -size * scale / 2, -size * scale / 2, size * scale, size * scale, true); ctx.restore();
      };
      decoration(this.selectedDecoration, 25, motion.selectedScale.value(now), motion.selectedDecoration.value(now));
      decoration(this.hoverDecoration, 30, motion.hoverScale.value(now), motion.hoverDecoration.value(now));
      if (state.offLayer) ctx.filter = 'grayscale(1)';
      const size = 40 * motion.subScale.value(now);
      this.image(ctx, art.subImage, -size / 2, -size / 2, size, size, true); ctx.restore();
    }
    if (art.tier) {
      ctx.save(); ctx.font = this.font;
      const metrics = ctx.measureText(art.tier);
      const width = Math.max(16, metrics.width + 6);
      const x = art.noFrame ? -width / 2 : 23.2 - width, y = art.noFrame ? -25 : -23.2;
      ctx.beginPath(); ctx.roundRect(x, y, width, 16, 8);
      ctx.fillStyle = tiers[art.tier] ?? 'transparent'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4 * this.ratio; ctx.shadowOffsetY = this.ratio;
      ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = art.tier.startsWith('B') ? WHITE : '#333'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(art.tier, x + width / 2, y + (16 + metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2); ctx.restore();
    }
    if (art.count) {
      ctx.save(); ctx.font = this.font.replace(/\d+(?:\.\d+)?px/, '12px');
      const metrics = ctx.measureText(art.count);
      const width = Math.max(18, metrics.width + 8);
      const x = (art.noFrame ? 23 : 24) - width, y = art.noFrame ? -23 : -24;
      ctx.beginPath(); ctx.roundRect(x, y, width, 18, 9);
      ctx.fillStyle = art.noFrame ? 'rgba(255,196,40,0.9)' : '#ffc428';
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowOffsetX = -this.ratio; ctx.shadowOffsetY = this.ratio; ctx.shadowBlur = 2 * this.ratio;
      ctx.fill(); ctx.shadowColor = 'transparent'; ctx.fillStyle = '#333'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(art.count, x + width / 2, y + (18 + metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2); ctx.restore();
    }
    if (state.focus) { ctx.strokeStyle = '#f8f8f8'; ctx.lineWidth = 2; ctx.strokeRect(-size / 2 - 2, -size / 2 - 2, size + 4, size + 4); }
    ctx.restore();
  }
  sprite(art: MarkerArt, motion: MarkerMotion, now: number): Sprite {
    const state = motion.state!;
    const key = `${this.artKey(art)}|${+state.selected}${+state.checked}${+state.offLayer}${+state.hover}${+state.focus}${+state.disappearing}`;
    let sprite = this.sprites.get(key);
    if (sprite) return sprite;
    const x = art.noFrame ? -29 : -30, y = art.noFrame ? -34 : -46;
    const width = art.subImage ? 94 : art.noFrame ? 58 : 60, height = art.noFrame ? 64 : 66;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * this.ratio); canvas.height = Math.ceil(height * this.ratio);
    const ctx = canvas.getContext('2d')!; ctx.scale(this.ratio, this.ratio); ctx.translate(-x, -y);
    this.paint(ctx, art, motion, now);
    sprite = { canvas, x, y, width, height };
    // Bounded instance cache, independent of point count. Eviction never removes rendered pixels.
    if (this.sprites.size >= 512) this.sprites.delete(this.sprites.keys().next().value!);
    this.sprites.set(key, sprite); return sprite;
  }
  animation(art: MarkerArt, motion: MarkerMotion): AnimatedSprite {
    // A whole batch with the same motion and artwork paints once per frame, not once per point.
    let palette = this.animated.get(motion);
    if (!palette) this.animated.set(motion, palette = new Map<string, AnimatedSprite>());
    const key = this.artKey(art);
    let cached = palette.get(key);
    if (!cached) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(104 * this.ratio); canvas.height = Math.ceil(96 * this.ratio);
      const sprite: Sprite = { canvas, x: -38, y: -54, width: 104, height: 96, version: 0 };
      const ctx = canvas.getContext('2d')!;
      let at = NaN;
      cached = { render: now => {
        if (at === now) return sprite;
        at = now; sprite.version = (sprite.version ?? 0) + 1;
        ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
        ctx.clearRect(0, 0, sprite.width, sprite.height);
        ctx.translate(-sprite.x, -sprite.y); this.paint(ctx, art, motion, now);
        return sprite;
      } };
      palette.set(key, cached);
    }
    return cached;
  }
  dynamic(art: MarkerArt, motion: MarkerMotion, now: number): Sprite { return this.animation(art, motion).render(now); }
  preload(url: string) { this.asset(url); }
  snapshot(art: MarkerArt, motion: MarkerMotion, now: number): Sprite {
    // A disappearing representation may be mid-hover. Never cache that transient pose as rest.
    const source = this.dynamic(art, motion, now), canvas = document.createElement('canvas');
    canvas.width = source.canvas.width; canvas.height = source.canvas.height;
    canvas.getContext('2d')!.drawImage(source.canvas, 0, 0);
    return { ...source, canvas };
  }
  dispose(): void {
    this.disposed = true;
    for (const asset of this.assets.values()) asset.image.onload = asset.image.onerror = null;
    this.assets.clear(); this.sprites.clear(); this.versions.clear(); this.animated = new WeakMap(); this.artKeys = new WeakMap();
  }
}
