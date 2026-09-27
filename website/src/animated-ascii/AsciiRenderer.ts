import {
  BLIT_FS,
  BLUR_FS,
  COVER_FS,
  FULLSCREEN_VS,
  GLYPH_FS,
  GLYPH_VS,
  LEVELS_FS,
} from './shaders'
import { ANIM_PRESETS, DEFAULT_OPTIONS, type AsciiOptions, type AsciiSource } from './options'

interface Program {
  program: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}

interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

interface Atlas {
  key: string
  len: number
  cols: number
  slotW: number
  slotH: number
  pad: number
  w: number
  h: number
}

interface Taps {
  weights: Float32Array
  offsets: Float32Array
  count: number
}

const MAX_TAPS = 16
/** Blur passes run at reduced resolution so the kernel stays within this sigma (in texels). */
const MAX_TEXEL_SIGMA = 3
/** Glyph cell width relative to its height (Courier New advance). */
const CELL_ASPECT = 0.6
/** Default backdrop blur relative to font size, measured from the reference render. */
const AUTO_BLUR_RATIO = 0.36

type Rgba = [number, number, number, number]

export class AsciiRenderer {
  readonly canvas: HTMLCanvasElement
  /** False when WebGL2 is unavailable; the renderer then does nothing. */
  readonly supported: boolean
  /** Called with texture upload failures (typically a cross-origin source without CORS). */
  onerror: ((error: unknown) => void) | null = null

  private gl: WebGL2RenderingContext | null
  private opts: AsciiOptions
  private source: AsciiSource | null = null

  private programs!: {
    cover: Program
    blit: Program
    blur: Program
    levels: Program
    glyph: Program
  }
  private vao: WebGLVertexArrayObject | null = null
  private srcTex: WebGLTexture | null = null
  private atlasTex: WebGLTexture | null = null
  private levels: Target | null = null
  private bgA: Target | null = null
  private bgB: Target | null = null
  private glowA: Target | null = null
  private glowB: Target | null = null

  private atlas: Atlas | null = null
  private atlasCanvas: HTMLCanvasElement | null = null
  private fontEpoch = 0
  private requestedFonts = new Set<string>()

  private srcW = 0
  private srcH = 0
  private hasFrame = false
  private frameDirty = false
  private lastVideoTime = -1
  private rvfcHandle = 0
  private rvfcSeen = false
  private tainted = false
  private detachSource: (() => void) | null = null

  private cssW = 0
  private cssH = 0
  private dpr = 1
  private needsRedraw = true
  private visible = true
  private reducedMotion = false
  private lost = false
  private raf = 0
  private t0 = performance.now()
  private colorCache = new Map<string, Rgba>()
  private cleanups: (() => void)[] = []

  constructor(canvas: HTMLCanvasElement, options: Partial<AsciiOptions> = {}) {
    this.canvas = canvas
    this.opts = { ...DEFAULT_OPTIONS, ...stripUndefined(options) }
    this.gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })
    this.supported = !!this.gl
    if (!this.gl) return

    this.initResources()
    this.observe()
  }

  /** Merge new options. Omitted keys keep their current value; `undefined` restores the default. */
  setOptions(options: Partial<AsciiOptions>) {
    let changed = false
    for (const key of Object.keys(options) as (keyof AsciiOptions)[]) {
      const next = options[key] === undefined ? DEFAULT_OPTIONS[key] : options[key]
      if (this.opts[key] !== next) {
        ;(this.opts as unknown as Record<string, unknown>)[key] = next
        changed = true
      }
    }
    if (changed) this.needsRedraw = true
  }

  getOptions(): Readonly<AsciiOptions> {
    return this.opts
  }

  setSource(source: AsciiSource | null) {
    if (source === this.source) return
    this.detachSource?.()
    this.detachSource = null
    this.source = source
    this.hasFrame = false
    this.tainted = false
    this.frameDirty = true
    this.lastVideoTime = -1
    this.rvfcSeen = false
    this.needsRedraw = true
    if (!source) return

    const markDirty = () => {
      this.frameDirty = true
    }
    if (source instanceof HTMLVideoElement) {
      const events = ['loadeddata', 'seeked', 'resize', 'playing']
      events.forEach((e) => source.addEventListener(e, markDirty))
      const rvfc = (source as VideoWithRvfc).requestVideoFrameCallback
      if (typeof rvfc === 'function') {
        const onFrame = () => {
          this.rvfcSeen = true
          this.frameDirty = true
          this.rvfcHandle = (source as VideoWithRvfc).requestVideoFrameCallback(onFrame)
        }
        this.rvfcHandle = (source as VideoWithRvfc).requestVideoFrameCallback(onFrame)
      }
      this.detachSource = () => {
        events.forEach((e) => source.removeEventListener(e, markDirty))
        if (this.rvfcHandle) (source as VideoWithRvfc).cancelVideoFrameCallback?.(this.rvfcHandle)
        this.rvfcHandle = 0
      }
    } else if (source instanceof HTMLImageElement) {
      source.addEventListener('load', markDirty)
      this.detachSource = () => source.removeEventListener('load', markDirty)
    }
  }

  start() {
    if (!this.gl || this.raf) return
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      if (!this.visible || document.hidden) return
      this.render(now)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  /** Render one frame. Called by the loop from `start()`; call it directly to drive your own loop. */
  render(now = performance.now()) {
    const gl = this.gl
    if (!gl || this.lost) return
    this.syncSize()
    const W = this.canvas.width
    const H = this.canvas.height
    if (!this.cssW || !this.cssH) return

    const o = this.opts
    const animated = o.animated && !(o.respectReducedMotion && this.reducedMotion)
    const uploaded = this.pollSource()
    if (!uploaded && !animated && !this.needsRedraw) return
    this.needsRedraw = false

    const fontCss = o.rows ? this.cssH / Math.max(1, o.rows) : o.fontSize
    const cellH = Math.max(2, fontCss * this.dpr)
    const cellW = cellH * CELL_ASPECT
    this.ensureAtlas(cellH)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    const [r, g, b, a] = o.background === 'none' ? [0, 0, 0, 0] : this.color(o.bgColor)
    gl.clearColor(r * a, g * a, b * a, a)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!this.hasFrame) return

    gl.bindVertexArray(this.vao)
    const uvScale = this.uvScale(W, H)

    if (o.autoLevels) this.computeLevels(uvScale)
    if (o.background === 'blur' || o.background === 'original') {
      this.drawBackdrop(W, H, uvScale, (o.bgBlur ?? fontCss * AUTO_BLUR_RATIO) * this.dpr)
    }

    const time = now - this.t0
    // Earlier passes leave their own targets bound (e.g. levels when there's no backdrop).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    this.drawGlyphs(W, H, cellW, cellH, uvScale, animated, time)
    if (o.glow > 0) this.drawGlow(W, H, cellW, cellH, uvScale, animated, time)
    gl.bindVertexArray(null)
  }

  dispose() {
    this.stop()
    this.detachSource?.()
    this.detachSource = null
    this.source = null
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
    this.deleteResources()
  }

  // ---------------------------------------------------------------- setup

  private initResources() {
    const gl = this.gl!
    this.programs = {
      cover: this.program(FULLSCREEN_VS, COVER_FS, ['u_src', 'u_uvScale', 'u_opacity']),
      blit: this.program(FULLSCREEN_VS, BLIT_FS, ['u_tex', 'u_opacity']),
      blur: this.program(FULLSCREEN_VS, BLUR_FS, ['u_tex', 'u_dir', 'u_weights', 'u_offsets', 'u_taps']),
      levels: this.program(FULLSCREEN_VS, LEVELS_FS, ['u_src', 'u_uvScale']),
      glyph: this.program(GLYPH_VS, GLYPH_FS, [
        'u_src', 'u_levels', 'u_atlas', 'u_res', 'u_cell', 'u_origin', 'u_grid', 'u_uvScale',
        'u_slot', 'u_pad', 'u_atlasSize', 'u_atlasCols', 'u_len', 'u_contrast', 'u_brightness',
        'u_cutoff', 'u_shift', 'u_coverage', 'u_invert', 'u_autoLevels', 'u_opacity', 'u_animated', 'u_preset',
        'u_cycle', 'u_tick', 'u_intensity', 'u_random', 'u_useColor', 'u_color',
      ]),
    }
    this.vao = gl.createVertexArray()
    this.srcTex = this.texture(gl.LINEAR_MIPMAP_LINEAR)
    this.atlasTex = this.texture(gl.LINEAR)
    this.levels = this.ensureTarget(null, 1, 1, gl.NEAREST)
    this.atlas = null
    this.srcW = this.srcH = 0
    this.hasFrame = false
    this.frameDirty = true
    this.needsRedraw = true
  }

  private deleteResources() {
    const gl = this.gl
    if (!gl || gl.isContextLost()) return
    Object.values(this.programs ?? {}).forEach((p) => gl.deleteProgram(p.program))
    gl.deleteVertexArray(this.vao)
    gl.deleteTexture(this.srcTex)
    gl.deleteTexture(this.atlasTex)
    for (const t of [this.levels, this.bgA, this.bgB, this.glowA, this.glowB]) {
      if (t) this.deleteTarget(t)
    }
    this.levels = this.bgA = this.bgB = this.glowA = this.glowB = null
  }

  private observe() {
    const canvas = this.canvas
    const on = (target: EventTarget, type: string, fn: (e: Event) => void) => {
      target.addEventListener(type, fn)
      this.cleanups.push(() => target.removeEventListener(type, fn))
    }

    const rect = canvas.getBoundingClientRect()
    this.cssW = rect.width
    this.cssH = rect.height
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect
      this.cssW = box.width
      this.cssH = box.height
      this.needsRedraw = true
    })
    ro.observe(canvas)
    this.cleanups.push(() => ro.disconnect())

    const io = new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1].isIntersecting
    })
    io.observe(canvas)
    this.cleanups.push(() => io.disconnect())

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.reducedMotion = motion.matches
    on(motion, 'change', () => {
      this.reducedMotion = motion.matches
      this.needsRedraw = true
    })
    on(window, 'resize', () => (this.needsRedraw = true))
    if (document.fonts) {
      on(document.fonts, 'loadingdone', () => {
        this.fontEpoch++
        this.needsRedraw = true
      })
    }

    on(canvas, 'webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    on(canvas, 'webglcontextrestored', () => {
      this.lost = false
      this.bgA = this.bgB = this.glowA = this.glowB = null
      this.initResources()
    })
  }

  private program(vsSrc: string, fsSrc: string, uniforms: string[]): Program {
    const gl = this.gl!
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`animated-ascii: shader compile failed\n${gl.getShaderInfoLog(shader)}`)
      }
      return shader
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc)
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`animated-ascii: program link failed\n${gl.getProgramInfoLog(program)}`)
    }
    const u: Program['u'] = {}
    for (const name of uniforms) u[name] = gl.getUniformLocation(program, name)
    return { program, u }
  }

  private texture(minFilter: number, magFilter: number = this.gl!.LINEAR) {
    const gl = this.gl!
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    return tex
  }

  private ensureTarget(
    target: Target | null,
    w: number,
    h: number,
    filter: number = this.gl!.LINEAR,
  ): Target {
    if (target && target.w === w && target.h === h) return target
    if (target) this.deleteTarget(target)
    const gl = this.gl!
    const tex = this.texture(filter, filter)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fbo, w, h }
  }

  private deleteTarget(t: Target) {
    this.gl!.deleteTexture(t.tex)
    this.gl!.deleteFramebuffer(t.fbo)
  }

  // --------------------------------------------------------------- source

  /** Upload the current source frame if it changed. Returns true when a new frame was uploaded. */
  private pollSource(): boolean {
    const s = this.source
    if (!s || this.tainted) return false
    if (s instanceof HTMLVideoElement) {
      if (s.readyState < 2) return false
      // Trust requestVideoFrameCallback once it has fired; some browsers never
      // fire it for videos that aren't painted, so fall back to polling time.
      const moved = !this.rvfcSeen && s.currentTime !== this.lastVideoTime
      if (!this.frameDirty && !moved && this.hasFrame) return false
      this.lastVideoTime = s.currentTime
    } else if (s instanceof HTMLImageElement || s instanceof ImageBitmap) {
      if (!this.frameDirty && this.hasFrame) return false
    }
    // Canvases can change at any time, so they upload every frame.
    this.frameDirty = false
    return this.upload(s)
  }

  private upload(s: AsciiSource): boolean {
    const size = sourceSize(s)
    if (!size) return false
    const gl = this.gl!
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    try {
      if (size.w !== this.srcW || size.h !== this.srcH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s)
        this.srcW = size.w
        this.srcH = size.h
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, s)
      }
    } catch (error) {
      this.tainted = true
      this.onerror?.(error)
      return false
    }
    gl.generateMipmap(gl.TEXTURE_2D)
    this.hasFrame = true
    return true
  }

  // --------------------------------------------------------------- passes

  private syncSize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, Math.max(0.25, this.opts.maxDpr))
    const w = Math.max(1, Math.round(this.cssW * this.dpr))
    const h = Math.max(1, Math.round(this.cssH * this.dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.needsRedraw = true
    }
  }

  /** Scale from screen UV to source UV for cover/contain fitting (centred). */
  private uvScale(W: number, H: number): [number, number] {
    const fit = this.opts.fit === 'contain' ? Math.min : Math.max
    const scale = fit(W / this.srcW, H / this.srcH)
    return [W / (this.srcW * scale), H / (this.srcH * scale)]
  }

  private computeLevels(uvScale: [number, number]) {
    const gl = this.gl!
    const p = this.programs.levels
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.levels!.fbo)
    gl.viewport(0, 0, 1, 1)
    gl.disable(gl.BLEND)
    gl.useProgram(p.program)
    this.bindTexture(0, this.srcTex, p.u.u_src)
    gl.uniform2f(p.u.u_uvScale, uvScale[0], uvScale[1])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private drawBackdrop(W: number, H: number, uvScale: [number, number], sigma: number) {
    const gl = this.gl!
    const opacity = clamp01(this.opts.bgOpacity / 100)
    const cover = this.programs.cover

    if (this.opts.background === 'original' || sigma < 0.5) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, W, H)
      this.blend(true)
      gl.useProgram(cover.program)
      this.bindTexture(0, this.srcTex, cover.u.u_src)
      gl.uniform2f(cover.u.u_uvScale, uvScale[0], uvScale[1])
      gl.uniform1f(cover.u.u_opacity, opacity)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      return
    }

    const ds = Math.max(1, sigma / MAX_TEXEL_SIGMA)
    const bw = Math.max(1, Math.round(W / ds))
    const bh = Math.max(1, Math.round(H / ds))
    this.bgA = this.ensureTarget(this.bgA, bw, bh)
    this.bgB = this.ensureTarget(this.bgB, bw, bh)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgA.fbo)
    gl.viewport(0, 0, bw, bh)
    gl.disable(gl.BLEND)
    gl.useProgram(cover.program)
    this.bindTexture(0, this.srcTex, cover.u.u_src)
    gl.uniform2f(cover.u.u_uvScale, uvScale[0], uvScale[1])
    gl.uniform1f(cover.u.u_opacity, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    this.blur(this.bgA, this.bgB, sigma * (bw / W), sigma * (bh / H))
    this.composite(this.bgA, W, H, opacity, false)
  }

  private drawGlyphs(
    W: number,
    H: number,
    cellW: number,
    cellH: number,
    uvScale: [number, number],
    animated: boolean,
    time: number,
  ) {
    const gl = this.gl!
    const o = this.opts
    const atlas = this.atlas!
    const cols = Math.floor(W / cellW)
    const rows = Math.floor(H / cellH)
    if (cols < 1 || rows < 1) return

    const p = this.programs.glyph
    const u = p.u
    this.blend(true)
    gl.useProgram(p.program)
    this.bindTexture(0, this.srcTex, u.u_src)
    this.bindTexture(1, this.levels!.tex, u.u_levels)
    this.bindTexture(2, this.atlasTex, u.u_atlas)

    gl.uniform2f(u.u_res, W, H)
    gl.uniform2f(u.u_cell, cellW, cellH)
    gl.uniform2f(u.u_origin, (W - cols * cellW) / 2, (H - rows * cellH) / 2)
    gl.uniform2i(u.u_grid, cols, rows)
    gl.uniform2f(u.u_uvScale, uvScale[0], uvScale[1])
    gl.uniform2f(u.u_slot, atlas.slotW, atlas.slotH)
    gl.uniform1f(u.u_pad, atlas.pad)
    gl.uniform2f(u.u_atlasSize, atlas.w, atlas.h)
    gl.uniform1i(u.u_atlasCols, atlas.cols)
    gl.uniform1i(u.u_len, atlas.len)

    const c = Math.max(-255, Math.min(254, o.contrast))
    gl.uniform1f(u.u_contrast, (259 * (c + 255)) / (255 * (259 - c)))
    gl.uniform1f(u.u_brightness, o.brightness / 100)
    gl.uniform1f(u.u_cutoff, 0.3 * (1 - clamp01(o.darkThreshold / 100)))
    gl.uniform1f(u.u_shift, (o.darkThreshold - 30) / 100)
    gl.uniform1f(u.u_coverage, clamp01(o.coverage / 100))
    gl.uniform1i(u.u_invert, o.invert ? 1 : 0)
    gl.uniform1i(u.u_autoLevels, o.autoLevels ? 1 : 0)
    gl.uniform1f(u.u_opacity, clamp01(o.charOpacity / 100))

    const speed = Math.max(1, o.animSpeed)
    gl.uniform1i(u.u_animated, animated ? 1 : 0)
    gl.uniform1i(u.u_preset, Math.max(0, ANIM_PRESETS.indexOf(o.animPreset)))
    // Reduce the clock on the CPU in float64 so the shader never loses precision.
    gl.uniform1f(u.u_cycle, (time / speed) % 1)
    gl.uniform1f(u.u_tick, ((time / 1000) * Math.max(0, o.flickerRate)) % 3000)
    gl.uniform1f(u.u_intensity, clamp01(o.animIntensity / 100))
    gl.uniform1f(u.u_random, clamp01(o.animRandomness / 100))
    gl.uniform1i(u.u_useColor, o.glyphColor ? 1 : 0)
    const [r, g, b] = o.glyphColor ? this.color(o.glyphColor) : [1, 1, 1]
    gl.uniform3f(u.u_color, r, g, b)

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows)
  }

  /**
   * Bloom: draw the glyphs again straight into a low-resolution target, blur it and add
   * it over the screen. Far cheaper than blurring a full-resolution glyph layer.
   */
  private drawGlow(
    W: number,
    H: number,
    cellW: number,
    cellH: number,
    uvScale: [number, number],
    animated: boolean,
    time: number,
  ) {
    const gl = this.gl!
    const sigma = cellH * 0.55
    const ds = Math.max(1, sigma / MAX_TEXEL_SIGMA)
    const gw = Math.max(1, Math.round(W / ds))
    const gh = Math.max(1, Math.round(H / ds))
    this.glowA = this.ensureTarget(this.glowA, gw, gh)
    this.glowB = this.ensureTarget(this.glowB, gw, gh)

    // Clip space is resolution independent, so the same glyph pass lands scaled down.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowA.fbo)
    gl.viewport(0, 0, gw, gh)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.drawGlyphs(W, H, cellW, cellH, uvScale, animated, time)
    this.blur(this.glowA, this.glowB, sigma * (gw / W), sigma * (gh / H))
    this.composite(this.glowA, W, H, (this.opts.glow / 100) * 1.6, true)
  }

  /** Separable gaussian: a → b horizontally, then b → a vertically. */
  private blur(a: Target, b: Target, sigmaX: number, sigmaY: number) {
    const gl = this.gl!
    const p = this.programs.blur
    gl.disable(gl.BLEND)
    gl.useProgram(p.program)
    const pass = (from: Target, to: Target, dx: number, dy: number, taps: Taps) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo)
      gl.viewport(0, 0, to.w, to.h)
      this.bindTexture(0, from.tex, p.u.u_tex)
      gl.uniform2f(p.u.u_dir, dx, dy)
      gl.uniform1fv(p.u.u_weights, taps.weights)
      gl.uniform1fv(p.u.u_offsets, taps.offsets)
      gl.uniform1i(p.u.u_taps, taps.count)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    pass(a, b, 1 / a.w, 0, gaussianTaps(sigmaX))
    pass(b, a, 0, 1 / a.h, gaussianTaps(sigmaY))
  }

  private composite(t: Target, W: number, H: number, opacity: number, additive: boolean) {
    const gl = this.gl!
    const p = this.programs.blit
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    this.blend(true, additive)
    gl.useProgram(p.program)
    this.bindTexture(0, t.tex, p.u.u_tex)
    gl.uniform1f(p.u.u_opacity, opacity)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // --------------------------------------------------------------- glyphs

  private ensureAtlas(cellH: number) {
    const o = this.opts
    const key = [o.charset, o.fontFamily, o.weight, cellH.toFixed(3), this.fontEpoch].join('\n')
    if (this.atlas?.key === key) return

    const chars = Array.from(o.charset || ' ')
    const pad = Math.ceil(cellH * 0.25)
    const slotW = Math.ceil(cellH * CELL_ASPECT) + 2 * pad
    const slotH = Math.ceil(cellH) + 2 * pad
    const cols = Math.max(1, Math.min(chars.length, Math.floor(4096 / slotW)))
    const rows = Math.ceil(chars.length / cols)

    const canvas = (this.atlasCanvas ??= document.createElement('canvas'))
    canvas.width = cols * slotW
    canvas.height = rows * slotH
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = `${cellH}px ${o.fontFamily}`
    ctx.textBaseline = 'top'
    ctx.fillStyle = ctx.strokeStyle = '#fff'
    ctx.lineJoin = 'round'
    // Stroking the outline thickens hairline monospace fonts toward the reference's heavier strokes.
    // (Canvas ignores lineWidth = 0, so skip the stroke explicitly.)
    const lineWidth = cellH * 0.09 * Math.max(0, o.weight / 100)
    if (lineWidth > 0) ctx.lineWidth = lineWidth
    chars.forEach((ch, i) => {
      const x = (i % cols) * slotW + pad
      const y = Math.floor(i / cols) * slotH + pad
      ctx.fillText(ch, x, y)
      if (lineWidth > 0) ctx.strokeText(ch, x, y)
    })

    const gl = this.gl!
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    this.atlas = { key, len: chars.length, cols, slotW, slotH, pad, w: canvas.width, h: canvas.height }

    // Web fonts may not be ready yet; rebuild once they are.
    const font = ctx.font
    if (document.fonts && !this.requestedFonts.has(font) && !document.fonts.check(font)) {
      this.requestedFonts.add(font)
      document.fonts.load(font).then(() => {
        this.fontEpoch++
        this.needsRedraw = true
      }, () => {})
    }
  }

  // -------------------------------------------------------------- helpers

  private bindTexture(unit: number, tex: WebGLTexture | null, loc: WebGLUniformLocation | null) {
    const gl = this.gl!
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(loc, unit)
  }

  private blend(on: boolean, additive = false) {
    const gl = this.gl!
    if (!on) return gl.disable(gl.BLEND)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA)
  }

  /** Parse any CSS colour to straight RGBA in 0–1. */
  private color(css: string): Rgba {
    let rgba = this.colorCache.get(css)
    if (rgba) return rgba
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#000'
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    rgba = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255]
    this.colorCache.set(css, rgba)
    return rgba
  }
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback(cb: () => void): number
  cancelVideoFrameCallback?(handle: number): void
}

function sourceSize(s: AsciiSource): { w: number; h: number } | null {
  if (s instanceof HTMLVideoElement) {
    return s.readyState >= 2 && s.videoWidth ? { w: s.videoWidth, h: s.videoHeight } : null
  }
  if (s instanceof HTMLImageElement) {
    return s.complete && s.naturalWidth ? { w: s.naturalWidth, h: s.naturalHeight } : null
  }
  return s.width && s.height ? { w: s.width, h: s.height } : null
}

/** Gaussian weights folded into linear-filtered taps (two texels per tap). */
function gaussianTaps(sigma: number): Taps {
  const s = Math.max(0.01, sigma)
  const radius = Math.min(2 * (MAX_TAPS - 1), Math.max(1, Math.ceil(s * 3)))
  const k: number[] = []
  let sum = 0
  for (let i = 0; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * s * s))
    k.push(v)
    sum += i ? 2 * v : v
  }
  const weights = new Float32Array(MAX_TAPS)
  const offsets = new Float32Array(MAX_TAPS)
  weights[0] = k[0] / sum
  let count = 1
  for (let i = 1; i <= radius && count < MAX_TAPS; i += 2) {
    const a = k[i] / sum
    const b = i + 1 <= radius ? k[i + 1] / sum : 0
    weights[count] = a + b
    offsets[count] = a + b > 0 ? (i * a + (i + 1) * b) / (a + b) : i
    count++
  }
  return { weights, offsets, count }
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key]
  }
  return out
}
