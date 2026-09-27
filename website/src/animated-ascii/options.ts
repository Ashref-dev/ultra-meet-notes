export const ANIM_PRESETS = [
  'wave',
  'ripple-in',
  'vortex',
  'spiral',
  'twinkle',
  'pulse',
  'cascade-lr',
  'cascade-rl',
  'cascade-tb',
  'cascade-bt',
  'diagonal',
  'diagonal-alt',
  'reveal',
  'serpentine',
  'scan-h',
  'scan-v',
  'checker',
] as const

export type AnimPreset = (typeof ANIM_PRESETS)[number]

/**
 * - `blur`: blurred copy of the source behind the glyphs (the signature glow)
 * - `original`: the sharp source behind the glyphs
 * - `solid`: `bgColor` only
 * - `none`: transparent canvas, glyphs only
 */
export type BackgroundMode = 'blur' | 'original' | 'solid' | 'none'

export type FitMode = 'cover' | 'contain'

export type AsciiSource =
  | HTMLVideoElement
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap

export interface AsciiOptions {
  /** Glyph cell height in CSS px. Cell width is 0.6 of this. */
  fontSize: number
  /** Fixed number of rows; overrides `fontSize` so density stays constant at any size. */
  rows?: number
  /** Character ramp, brightest first. Spaces render as empty cells. */
  charset: string
  fontFamily: string
  /** 0–100 extra stroke weight added to the glyphs (0 = the font's own weight). */
  weight: number
  /** Glyph colour override (any CSS colour). Default: the source colour under each glyph. */
  glyphColor?: string
  /** 0–100 */
  charOpacity: number
  /** Contrast applied to glyph colours (not the backdrop): 0 = neutral. Range -100..250. */
  contrast: number
  /** -100..100 */
  brightness: number
  /**
   * 0–100. Raising it lets glyphs reach further into dark areas and shifts every cell toward
   * denser glyphs. Cells below luma 0.3 × (1 − darkThreshold/100) stay empty.
   */
  darkThreshold: number
  /** 0–100: share of cells allowed to hold a glyph; the rest stay empty in a fixed scatter. */
  coverage: number
  /** Map bright areas to sparse glyphs instead of dense ones. */
  invert: boolean
  /** Stretch the frame's luma range to 0–1 before picking glyphs. */
  autoLevels: boolean

  background: BackgroundMode
  /** Backdrop blur radius in CSS px. Default: 0.36 × font size. */
  bgBlur?: number
  /** 0–100 */
  bgOpacity: number
  bgColor: string

  animated: boolean
  animPreset: AnimPreset
  /** Milliseconds per wave cycle. */
  animSpeed: number
  /** 0–100: how deep the opacity wave goes; above 20 the glyphs also flicker. */
  animIntensity: number
  /** 0–100: 0 = clean preset pattern, 100 = fully per-cell random. */
  animRandomness: number
  /** Glyph swaps per second while flickering. */
  flickerRate: number
  /** 0–100 bloom on the glyphs. */
  glow: number
  /** Turn the animation off when the OS asks for reduced motion. */
  respectReducedMotion: boolean

  fit: FitMode
  /** Upper bound on the canvas pixel ratio. */
  maxDpr: number
}

/**
 * Defaults are fitted to ascii-magic.com's "Animated ASCII" demo render
 * (glyph ramp mapping, cutoff, dropout, stroke weight, colour punch, blur).
 */
export const DEFAULT_OPTIONS: AsciiOptions = {
  fontSize: 14,
  charset: '@#S08Xx+=-;:. ',
  fontFamily: '"Courier New", Courier, monospace',
  weight: 15,
  charOpacity: 100,
  contrast: 125,
  brightness: 0,
  darkThreshold: 48,
  coverage: 80,
  invert: false,
  autoLevels: true,

  background: 'blur',
  bgOpacity: 100,
  bgColor: '#000000',

  animated: true,
  animPreset: 'wave',
  animSpeed: 3000,
  animIntensity: 30,
  animRandomness: 50,
  flickerRate: 10,
  glow: 0,
  respectReducedMotion: true,

  fit: 'cover',
  maxDpr: 2,
}
