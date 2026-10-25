import { describe, expect, it, vi } from 'vitest';
import { MarkerPainter, type Sprite } from '@/services/map/core/canvas/canvasMarkerPaint';
import { MarkerMotionPool } from '@/services/map/core/canvas/canvasMarkerMotion';
const art = (i: number) => ({ image: '', subImage: '', noFrame: false, tier: `L${i}` });
const pose = () => { const pool = new MarkerMotionPool(); return pool.transition(pool.initial, 0, 0, false, false); };

describe('Shared immutable artwork', () => {
  it('promotes buffered art entering view without restarting its request or decode', async () => {
    const NativeImage = Image, images: HTMLImageElement[] = [];
    let deliver: () => void = () => {};
    const decode = vi.fn(() => new Promise<void>(resolve => { deliver = resolve; }));
    vi.stubGlobal('Image', class extends NativeImage {
      constructor() { super(); images.push(this); }
      override decode = decode;
    });
    const changed = vi.fn(), painter = new MarkerPainter(2, changed);
    try {
      painter.preload('/buffered.webp');
      const image = images[0];
      painter.preload('/buffered.webp', 'high');
      expect(images).toHaveLength(1);
      expect(image.fetchPriority).toBe('high');
      expect(image.getAttribute('src')).toBe('/buffered.webp');
      image.onload?.call(image, new Event('load'));
      painter.preload('/buffered.webp', 'high'); painter.preload('/buffered.webp');
      expect(decode).toHaveBeenCalledOnce();
      expect(painter.isReady('/buffered.webp')).toBe(false);
      deliver(); await Promise.resolve(); await Promise.resolve();
      expect(painter.isReady('/buffered.webp')).toBe(true);
      expect(changed).toHaveBeenCalledOnce();
    } finally { painter.dispose(); vi.unstubAllGlobals(); }
  });
  it('starts a warm cache decode without waiting for load, but never paints before its promise resolves', async () => {
    const NativeImage = Image;
    const images: HTMLImageElement[] = [];
    let deliver: () => void = () => {};
    const decode = vi.fn(() => new Promise<void>(resolve => { deliver = resolve; }));
    vi.stubGlobal('Image', class extends NativeImage {
      constructor() {
        super(); images.push(this);
        Object.defineProperties(this, { complete: { value: true }, naturalWidth: { value: 32 } });
      }
      override decode = decode;
    });
    const changed = vi.fn(), painter = new MarkerPainter(2, changed);
    try {
      painter.preload('/cached.webp');
      expect(decode).toHaveBeenCalledOnce();
      images[0].onload?.call(images[0], new Event('load'));
      expect(decode).toHaveBeenCalledOnce();
      expect(painter.isReady('/cached.webp')).toBe(false);
      expect(changed).not.toHaveBeenCalled();
      deliver(); await Promise.resolve(); await Promise.resolve();
      expect(painter.isReady('/cached.webp')).toBe(true);
      expect(changed).toHaveBeenCalledOnce();
    } finally { painter.dispose(); vi.unstubAllGlobals(); }
  });
  it.each([[40, 16, 32], [3, 1024, 2]])('bounds %s retired icons of side %s by object and decoded-pixel budgets', async (count, side, retained) => {
    const images: { onload: (() => void) | null }[] = [];
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror = null;
      naturalWidth = side;
      naturalHeight = side;
      decode = () => Promise.resolve();
      constructor() { images.push(this); }
    });
    const painter = new MarkerPainter(2, () => {});
    const ready = async (url: string) => {
      painter.preload(url); images.at(-1)!.onload?.();
      await Promise.resolve(); await Promise.resolve();
    };
    try {
      await ready('/active.webp');
      for (let i = 0; i < count; i++) await ready(`/idle-${i}.webp`);
      painter.retainAssets(new Set(['/active.webp']));
      expect(painter.isReady('/active.webp')).toBe(true);
      for (let i = 0; i < count; i++) expect(painter.isReady(`/idle-${i}.webp`)).toBe(i >= count - retained);
      const requests = images.length;
      painter.preload(`/idle-${count - 1}.webp`);
      expect(images).toHaveLength(requests);
    } finally { painter.dispose(); vi.unstubAllGlobals(); }
  });
  it('keeps pending and retired decoded art unavailable until its owner can use it', async () => {
    let resolve: () => void = () => {};
    const images: HTMLImageElement[] = [];
    const NativeImage = Image;
    const decode = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    vi.stubGlobal('Image', class extends NativeImage {
      constructor() { super(); images.push(this); }
      override decode = decode;
    });
    const changed = vi.fn(), painter = new MarkerPainter(2, changed);
    try {
      painter.preload('/pending.webp');
      images[0].onload?.call(images[0], new Event('load'));
      expect(decode).toHaveBeenCalledOnce();
      expect(painter.isReady('/pending.webp')).toBe(false);
      resolve(); await Promise.resolve(); await Promise.resolve();
      expect(painter.isReady('/pending.webp')).toBe(true);
      expect(changed).toHaveBeenCalledWith('/pending.webp');
      painter.preload('/retired.webp');
      images[1].onload?.call(images[1], new Event('load'));
      painter.dispose(); changed.mockClear();
      resolve(); await Promise.resolve(); await Promise.resolve();
      expect(changed).not.toHaveBeenCalled();
      expect(images).toHaveLength(2);
    } finally { painter.dispose(); vi.unstubAllGlobals(); }
  });
  it('waits for the non-CORS fallback decode before changing the renderer', async () => {
    const NativeImage = Image;
    const images: HTMLImageElement[] = [], pending: { resolve: () => void; reject: () => void }[] = [];
    vi.stubGlobal('Image', class extends NativeImage {
      constructor() { super(); images.push(this); }
      override decode = () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
    });
    const fallback = vi.fn(), painter = new MarkerPainter(2, () => {}, fallback);
    try {
      painter.preload('/external.webp');
      images[0].onload?.call(images[0], new Event('load'));
      pending[0].reject();
      images[0].onerror?.call(images[0], new Event('error'));
      images[1].onload?.call(images[1], new Event('load'));
      await Promise.resolve();
      await Promise.resolve();
      expect(painter.isReady('/external.webp')).toBe(false);
      expect(fallback).not.toHaveBeenCalled();
      pending[1].resolve(); await Promise.resolve(); await Promise.resolve();
      expect(painter.isReady('/external.webp')).toBe(true);
      expect(fallback).toHaveBeenCalledOnce();
    } finally { painter.dispose(); vi.unstubAllGlobals(); }
  });
  it('reuses 700 live sprites after strong-cache eviction without repainting', () => {
    const painter = new MarkerPainter(2, () => {}), motion = pose(), paint = vi.spyOn(painter, 'paint');
    try {
      const sprites = Array.from({ length: 700 }, (_, i) => painter.sprite(art(i), motion, 1000));
      for (let i = 0; i < 700; i++) expect(painter.sprite(art(i), motion, 1000)).toBe(sprites[i]);
      expect(paint).toHaveBeenCalledTimes(700);
    } finally { painter.dispose(); }
  });
  it('bounds both indexes while preserving pixels still owned by entries', () => {
    const painter = new MarkerPainter(2, () => {}), motion = pose();
    const indexes = painter as unknown as { sprites: Map<string, Sprite>; shared: Map<string, WeakRef<Sprite>> };
    try {
      const live = Array.from({ length: 2500 }, (_, i) => painter.sprite(art(i), motion, 1000));
      expect(indexes.sprites.size).toBe(512);
      expect(indexes.shared.size).toBeLessThanOrEqual(2048);
      expect(painter.sprite(art(2499), motion, 1000)).toBe(live[2499]);
      expect([live[0].canvas.width, live[0].canvas.height]).toEqual([120, 132]);
      painter.setRatio(3);
      expect(indexes.shared.size).toBe(0);
      const refreshed = painter.sprite(art(0), motion, 1000);
      expect(refreshed).not.toBe(live[0]);
      expect(refreshed.canvas.width).toBe(180);
    } finally { painter.dispose(); }
    expect(indexes.sprites.size).toBe(0); expect(indexes.shared.size).toBe(0);
  });
  it('reuses cluster bodies across counts and badges across icons, including whole-group fades', () => {
    const painter = new MarkerPainter(2, () => {}), pool = new MarkerMotionPool();
    const appearing = pool.transition(pool.initial, 64, 0, false, true);
    const first = { image: '/one.png', subImage: '', noFrame: false, tier: '', count: '2' };
    try {
      const a = painter.gpuSprite(first, appearing, 50);
      const b = painter.gpuSprite({ ...first, count: '3' }, appearing, 50);
      const c = painter.gpuSprite({ ...first, image: '/two.png' }, appearing, 50);
      expect(a.parts).toHaveLength(2);
      expect(a.parts![0]).toBe(b.parts![0]);
      expect(a.parts![1]).toBe(c.parts![1]);
      expect(b.parts![1]).not.toBe(a.parts![1]);
      const settled = pool.transition(appearing, 0, 200, false, true);
      expect(painter.gpuSprite(first, settled, 200)).toBe(a);
      expect(painter.sprite(first, settled, 200).parts).toBeUndefined();
      const draw = vi.fn(); a.canvas.getContext('2d')!.drawImage = draw;
      expect(painter.raster(a)).toBe(a); painter.raster(a);
      expect(draw).toHaveBeenCalledTimes(2);
    } finally { painter.dispose(); }
  });
  it('keeps reusable material when a region retains its assets and evicts retired material', () => {
    const painter = new MarkerPainter(2, () => {}), motion = pose();
    const keep = { ...art(1), image: '/keep.png' }, retire = { ...art(2), image: '/retire.png' };
    try {
      const kept = painter.sprite(keep, motion, 1000), retired = painter.sprite(retire, motion, 1000);
      painter.retainAssets(new Set(['/keep.png']));
      expect(painter.sprite(keep, motion, 1000)).toBe(kept);
      expect(painter.sprite(retire, motion, 1000)).not.toBe(retired);
    } finally { painter.dispose(); }
  });
  it('keeps vector and unknown assets on the authored whole-sprite path', () => {
    const painter = new MarkerPainter(2, () => {}), motion = pose();
    try {
      for (const image of ['/icon.svg?cached=.webp', 'data:image/svg+xml,<svg/>', 'blob:opaque']) {
        expect(painter.gpuSprite({ ...art(1), image, count: '2' }, motion, 1000).parts).toBeUndefined();
      }
    } finally { painter.dispose(); }
  });
  it('can still paint when weak references are unavailable', () => {
    vi.stubGlobal('WeakRef', undefined);
    const painter = new MarkerPainter(2, () => {});
    try { expect(painter.sprite(art(0), pose(), 1000).canvas.width).toBe(120); }
    finally { painter.dispose(); vi.unstubAllGlobals(); }
  });
});
