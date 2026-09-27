# animated-ascii

A React + Vite clone of the **"Animated ASCII"** style from [ascii-magic.com](https://www.ascii-magic.com/). It turns any video, image or canvas into a field of flickering, source-coloured glyphs laid over a blurred glow of the original. It runs in real time on WebGL2.

The defaults were fitted against the site's own before/after demo render: the glyph ramp mapping, dark cutoff, cell dropout, stroke weight, colour contrast, backdrop blur, and the wave + flicker animation.

## Run the demo

```bash
npm install
npm run dev
```

The demo has a before/after slider, looks, live controls, drag-and-drop for your own video or image, and a **Record** button that exports WebM. It also generates a JSX snippet that matches your current settings. Add `?src=<url>` to load a remote file (it needs CORS headers).

## Use it on your site

Copy [`src/animated-ascii/`](src/animated-ascii/) into your project. It depends only on React 18+.

```tsx
import { AnimatedAscii } from './animated-ascii'

export function Hero() {
  return (
    <AnimatedAscii src="/hero.mp4" style={{ width: '100%', height: '100vh' }}>
      <h1>Your hero copy</h1>
    </AnimatedAscii>
  )
}
```

- **`src`** takes a video or image URL. The type is guessed from the extension; override it with `type="video" | "image"`. Videos autoplay muted, looped and inline.
- **`source`** takes an element you already have (`<video>`, `<img>`, `<canvas>`, `OffscreenCanvas`, `ImageBitmap`) instead of `src`.
- **Children** are layered above the effect, so the component works as a section background.
- Size it like any block element. The canvas fills the box and the media is fitted with `fit="cover"` (or `"contain"`).

### Without React

```ts
import { AsciiRenderer } from './animated-ascii'

const renderer = new AsciiRenderer(canvas, { fontSize: 14 })
renderer.setSource(videoElement)
renderer.start() // renderer.setOptions({...}) at any time; renderer.dispose() when done
```

## Options

All options are optional props on `<AnimatedAscii>`. Percent values run from 0 to 100.

| Option | Default | What it does |
| --- | --- | --- |
| `fontSize` | `14` | Glyph cell height in CSS px (cell width is 0.6×). |
| `rows` | – | Fixed row count. Overrides `fontSize` so density stays the same at any size. |
| `charset` | `@#S08Xx+=-;:. ` | Glyph ramp, brightest first. Spaces are empty cells. |
| `fontFamily` | `"Courier New", Courier, monospace` | Any loaded font; web fonts are picked up once they load. |
| `weight` | `15` | Extra stroke weight on the glyphs. |
| `glyphColor` | – | Solid glyph colour. Omit it to use the source colour under each glyph. |
| `contrast` | `125` | Contrast on glyph colours (0 = neutral). |
| `brightness` | `0` | -100..100 on glyph colours. |
| `darkThreshold` | `48` | Higher lets glyphs reach darker areas and biases toward denser glyphs. |
| `coverage` | `80` | Share of cells that can hold a glyph; the rest stay empty in a fixed scatter. |
| `charOpacity` | `100` | Glyph opacity. |
| `invert` | `false` | Bright areas get sparse glyphs. |
| `autoLevels` | `true` | Stretch each frame's luma range before mapping glyphs. |
| `background` | `blur` | `blur`, `original`, `solid` or `none` (transparent). |
| `bgBlur` | 0.36 × `fontSize` | Backdrop blur radius in CSS px. |
| `bgOpacity` / `bgColor` | `100` / `#000000` | Backdrop strength and base colour. |
| `animated` | `true` | Toggle the animation. |
| `animPreset` | `wave` | `wave`, `ripple-in`, `vortex`, `spiral`, `twinkle`, `pulse`, `cascade-*`, `diagonal`, `reveal`, `serpentine`, `scan-h/v`, `checker`. |
| `animSpeed` | `3000` | Milliseconds per wave cycle. |
| `animIntensity` | `30` | Depth of the opacity wave. Above 20, glyphs also flicker to neighbouring ramp characters in the wave's trough. |
| `animRandomness` | `50` | Blend from the clean preset pattern (0) to per-cell random (100). |
| `flickerRate` | `10` | Glyph swaps per second while flickering. |
| `glow` | `0` | Bloom on the glyphs. |
| `respectReducedMotion` | `true` | Stops the animation when the OS asks for reduced motion (the video still plays). |
| `fit` | `cover` | `cover` or `contain`. |
| `maxDpr` | `2` | Cap on the canvas pixel ratio. |

Other props: `type`, `poster`, `autoPlay`, `loop`, `muted`, `crossOrigin`, `className`, `style`, `label` (accessible name), `onReady(renderer)`, `onError(error)`. A `ref` exposes `{ renderer, canvas, media }`.

## How it works

Each frame runs entirely on the GPU:

1. The current video frame is uploaded once per new frame (via `requestVideoFrameCallback` where available).
2. A 1×1 pass finds the frame's min/max luma for auto-levels.
3. The backdrop is the source, downsampled and blurred with a separable gaussian, drawn over `bgColor`.
4. One instanced quad per grid cell. The vertex shader samples the source at the cell centre and picks a glyph from the ramp. It then applies the animation: a per-cell phase (preset pattern mixed with a hash) drives a sine opacity wave, and in the wave's trough the glyph flickers to a neighbouring ramp character. Glyphs come from a canvas-rendered atlas.
5. Optional glow blurs the glyph layer and adds it back.

Rendering pauses while the canvas is offscreen or the tab is hidden. If WebGL2 is unavailable, the original media is shown instead.

## Notes

- **Cross-origin media** must send CORS headers (`crossOrigin="anonymous"` is set by default). Otherwise WebGL can't read the pixels and `onError` fires.
- **Autoplay** needs `muted` (the default). If the browser still refuses, playback starts on the first tap or click.
