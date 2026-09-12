/// <reference lib="es2021.weakref" />
import type { Sprite } from './canvasMarkerPaint';

interface Slot {
  x: number; y: number; width: number; height: number; page: number;
  refs: number; version: number; source: WeakRef<HTMLCanvasElement>;
}
interface Page { x: number; y: number; row: number }
export interface PaintRect { x: number; y: number; width: number; height: number }
const ATLAS_SIZE = 1024;
const MAX_PAGES = 64;
const STRIDE = 10;
const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec4 rect;
layout(location=1) in vec4 texRect;
layout(location=2) in vec2 meta;
uniform vec2 viewport;
uniform vec2 origin;
out vec2 uv;
out float opacity;
flat out float page;
void main(){
 vec2 corner=vec2(float(gl_VertexID & 1),float((gl_VertexID >> 1) & 1));
 vec2 position=rect.xy+corner*rect.zw-origin;
 gl_Position=vec4(position/viewport*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);
 uv=texRect.xy+corner*texRect.zw;opacity=meta.x;page=meta.y;
}`;
const fragmentSource = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray atlas;
in vec2 uv;
in float opacity;
flat in float page;
out vec4 color;
void main(){color=texture(atlas,vec3(uv,page))*opacity;if(color.a==0.0)discard;}`;

/** GPU quads reuse the exact Canvas raster sprites; typography and shadows have one source. */
export class CanvasSpriteBatch {
  private atlas!: WebGLTexture;
  private atlasDepth = 1;
  private pages: Page[] = [{ x: 0, y: 0, row: 0 }];
  private slots: Slot[] = [];
  private sources = new WeakMap<HTMLCanvasElement, Slot>();
  private bindings = new WeakMap<object, Slot>();
  private copyFramebuffer: WebGLFramebuffer;
  private uploadTexture: WebGLTexture;
  private uploadWidth = 0;
  private uploadHeight = 0;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private viewport: WebGLUniformLocation | null;
  private origin: WebGLUniformLocation | null;
  private source: HTMLCanvasElement;
  private paintX = 0;
  private paintY = 0;
  private skip = false;
  private data = new Float32Array(1024 * STRIDE);
  private bufferBytes = 0;
  private width = 0;
  private height = 0;
  private count = 0;
  private disposed = false;
  private valid = false;
  uploads = 0;
  drawCalls = 0;

  static create(canvas: HTMLCanvasElement, lost: () => void): CanvasSpriteBatch | undefined {
    if (typeof WebGL2RenderingContext === 'undefined' || typeof WeakRef === 'undefined') return undefined;
    const source = document.createElement('canvas');
    const gl = source.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return undefined;
    const output = canvas.getContext('2d');
    if (!output) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return undefined; }
    try { return new CanvasSpriteBatch(gl, output, lost); }
    catch { gl.getExtension('WEBGL_lose_context')?.loseContext(); return undefined; }
  }
  private constructor(private gl: WebGL2RenderingContext, private output: CanvasRenderingContext2D, private lost: () => void) {
    this.source = gl.canvas as HTMLCanvasElement;
    const shader = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Canvas shader compilation failed');
      return shader;
    };
    const vertex = shader(gl.VERTEX_SHADER, vertexSource), fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Canvas shader link failed');
    this.viewport = gl.getUniformLocation(this.program, 'viewport');
    this.origin = gl.getUniformLocation(this.program, 'origin');
    this.buffer = gl.createBuffer()!; this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (const [index, size, offset] of [[0, 4, 0], [1, 4, 4], [2, 2, 8]]) {
      gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, size, gl.FLOAT, false, STRIDE * 4, offset * 4); gl.vertexAttribDivisor(index, 1);
    }
    // Render only the damaged rectangle on the GPU. The visible 2D canvas retains
    // the complete image, so unchanged pixels need neither drawing nor copying.
    this.copyFramebuffer = gl.createFramebuffer()!;
    this.uploadTexture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.uploadTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.atlas = this.allocateAtlas(1);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.addEventListener('webglcontextlost', this.contextLost);
  }
  private contextLost = (event: Event): void => {
    if (this.disposed) return;
    event.preventDefault(); this.lost();
  };
  private allocateAtlas(depth: number): WebGLTexture {
    const gl = this.gl, texture = gl.createTexture();
    if (!texture) throw new Error('Canvas atlas allocation failed');
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, ATLAS_SIZE, ATLAS_SIZE, depth);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  private growAtlas(): void {
    if (this.atlasDepth >= Math.min(MAX_PAGES, this.gl.getParameter(this.gl.MAX_ARRAY_TEXTURE_LAYERS) as number)) throw new Error('Canvas atlas capacity reached');
    const gl = this.gl, old = this.atlas, next = this.allocateAtlas(this.atlasDepth * 2);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFramebuffer);
    for (let page = 0; page < this.atlasDepth; page++) {
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, old, 0, page);
      gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, page, 0, 0, ATLAS_SIZE, ATLAS_SIZE);
    }
    gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
    gl.deleteTexture(old); this.atlas = next; this.atlasDepth *= 2;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  private slot(sprite: Sprite): Slot {
    const source = sprite.canvas;
    let slot = this.sources.get(source);
    if (slot?.source.deref() !== source) slot = undefined;
    if (!slot) {
      const width = source.width, height = source.height;
      if (width + 2 > ATLAS_SIZE || height + 2 > ATLAS_SIZE) throw new Error('Canvas sprite exceeds atlas page');
      slot = this.slots.find(candidate => candidate.refs === 0 && candidate.width >= width && candidate.height >= height);
      if (slot) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, slot.x - 1, slot.y - 1, slot.page, slot.width + 2, slot.height + 2, 1,
          gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array((slot.width + 2) * (slot.height + 2) * 4));
        slot.source = new WeakRef(source); slot.version = -1;
      } else {
        let pageIndex = this.pages.length - 1, page = this.pages[pageIndex];
        if (page.x + width + 2 > ATLAS_SIZE) { page.x = 0; page.y += page.row; page.row = 0; }
        if (page.y + height + 2 > ATLAS_SIZE) {
          pageIndex++; if (pageIndex >= this.atlasDepth) this.growAtlas();
          page = { x: 0, y: 0, row: 0 }; this.pages.push(page);
        }
        slot = { x: page.x + 1, y: page.y + 1, width, height, page: pageIndex, refs: 0, version: -1, source: new WeakRef(source) };
        page.x += width + 2; page.row = Math.max(page.row, height + 2); this.slots.push(slot);
      }
      this.sources.set(source, slot);
    }
    if (slot.version !== (sprite.version ?? 0)) {
      const gl = this.gl;
      // DOM premultiplication is supported by 2D uploads. Copy into the array on the GPU,
      // avoiding CPU readback and preserving alpha-correct bilinear sampling at sprite edges.
      gl.bindTexture(gl.TEXTURE_2D, this.uploadTexture);
      if (source.width > this.uploadWidth || source.height > this.uploadHeight) {
        this.uploadWidth = Math.max(source.width, this.uploadWidth); this.uploadHeight = Math.max(source.height, this.uploadHeight);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.uploadWidth, this.uploadHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFramebuffer);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.uploadTexture, 0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
      gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, slot.x, slot.y, slot.page, 0, 0, source.width, source.height);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      slot.version = sprite.version ?? 0; this.uploads++;
    }
    return slot;
  }
  release(key: object): void {
    const slot = this.bindings.get(key);
    if (slot) { slot.refs--; this.bindings.delete(key); }
  }
  begin(width: number, height: number, ratio: number, expected: number, dirty?: PaintRect): void {
    const gl = this.gl;
    this.count = 0; this.uploads = 0; this.drawCalls = 0;
    if (this.data.length < expected * STRIDE) this.data = new Float32Array(2 ** Math.ceil(Math.log2(expected * STRIDE)));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.bufferBytes !== this.data.byteLength) { gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW); this.bufferBytes = this.data.byteLength; }
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height; this.valid = false;
    }
    const partial = dirty && this.valid;
    this.paintX = partial ? Math.max(0, Math.min(width, Math.floor(dirty.x * ratio))) : 0;
    this.paintY = partial ? Math.max(0, Math.min(height, Math.floor(dirty.y * ratio))) : 0;
    const right = partial ? Math.max(0, Math.min(width, Math.ceil((dirty.x + dirty.width) * ratio))) : width;
    const bottom = partial ? Math.max(0, Math.min(height, Math.ceil((dirty.y + dirty.height) * ratio))) : height;
    const paintWidth = right - this.paintX, paintHeight = bottom - this.paintY;
    this.skip = paintWidth <= 0 || paintHeight <= 0;
    if (this.skip) return;
    if (this.source.width !== paintWidth) this.source.width = paintWidth;
    if (this.source.height !== paintHeight) this.source.height = paintHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, paintWidth, paintHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program); gl.uniform2f(this.viewport, paintWidth / ratio, paintHeight / ratio);
    gl.uniform2f(this.origin, this.paintX / ratio, this.paintY / ratio);
    gl.bindVertexArray(this.vao);
  }
  add(key: object, sprite: Sprite, x: number, y: number, alpha: number): void {
    if (this.skip) return;
    if (this.count * STRIDE >= this.data.length) throw new Error('Canvas instance buffer overflow');
    const previous = this.bindings.get(key);
    if (previous && previous.source.deref() !== sprite.canvas) this.release(key);
    const slot = this.slot(sprite);
    if (this.bindings.get(key) !== slot) { slot.refs++; this.bindings.set(key, slot); }
    const offset = this.count++ * STRIDE, data = this.data;
    data[offset] = x + sprite.x; data[offset + 1] = y + sprite.y; data[offset + 2] = sprite.width; data[offset + 3] = sprite.height;
    data[offset + 4] = slot.x / ATLAS_SIZE; data[offset + 5] = slot.y / ATLAS_SIZE;
    data[offset + 6] = sprite.canvas.width / ATLAS_SIZE; data[offset + 7] = sprite.canvas.height / ATLAS_SIZE;
    data[offset + 8] = alpha; data[offset + 9] = slot.page;
  }
  end(): void {
    if (this.skip) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    if (this.count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.count * STRIDE));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count); this.drawCalls = 1;
    }
    gl.disable(gl.SCISSOR_TEST);
    if (gl.isContextLost()) throw new Error('Canvas graphics context lost');
    const ctx = this.output;
    // Copy replaces transparent pixels too. Clip is required: the copy composite
    // operation otherwise clears the rest of the canvas. Integer backing-pixel
    // coordinates avoid seams even on displays whose DPR is below our 2x floor.
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath();
    ctx.rect(this.paintX, this.paintY, this.source.width, this.source.height); ctx.clip();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.filter = 'none';
    ctx.drawImage(this.source, this.paintX, this.paintY); ctx.restore();
    this.valid = true;
  }
  readPixels(x: number, y: number, width: number, height: number): Uint8ClampedArray {
    return this.output.getImageData(x, y, width, height).data;
  }
  get stats() { return { backend: 'webgl2', instances: this.count, drawCalls: this.drawCalls, uploads: this.uploads,
    presentedPixels: this.skip ? 0 : this.source.width * this.source.height, viewportPixels: this.width * this.height,
    atlasPages: this.atlasDepth, atlasBytes: this.atlasDepth * ATLAS_SIZE * ATLAS_SIZE * 4, error: this.gl.getError() }; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl; gl.canvas.removeEventListener('webglcontextlost', this.contextLost);
    gl.deleteTexture(this.atlas); gl.deleteTexture(this.uploadTexture); gl.deleteBuffer(this.buffer); gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program); gl.deleteFramebuffer(this.copyFramebuffer);
    this.slots = []; this.pages = []; this.data = new Float32Array(); this.sources = new WeakMap(); this.bindings = new WeakMap();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
