/**
 * A procedural "iridescent flower" clip drawn into a canvas, so the demo has a
 * moving source without shipping a video file. Any canvas works as a source.
 */
export function createDemoSource(width = 1280, height = 720) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const start = performance.now()
  let raf = 0

  const draw = (now: number) => {
    const t = (now - start) / 1000
    const cx = width * 0.5 + Math.sin(t * 0.35) * width * 0.015
    const cy = height * 0.42 + Math.cos(t * 0.27) * height * 0.01
    const R = height * 0.4 * (1 + 0.035 * Math.sin(t * 0.9))

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)

    drawStem(ctx, cx, cy, height, t)

    // 'screen' brightens overlaps without clipping everything to white.
    ctx.globalCompositeOperation = 'screen'
    const layers = [
      { n: 9, scale: 1, spin: t * 0.05, alpha: 0.42 },
      { n: 7, scale: 0.74, spin: -t * 0.08 + 0.45, alpha: 0.4 },
      { n: 6, scale: 0.48, spin: t * 0.11 + 0.2, alpha: 0.38 },
    ]
    for (const layer of layers) {
      for (let i = 0; i < layer.n; i++) {
        const angle = layer.spin + (i / layer.n) * Math.PI * 2
        const len = R * layer.scale * (0.86 + 0.14 * Math.sin(t * 1.1 + i * 1.7))
        const hue = 200 + 110 * (0.5 + 0.5 * Math.sin(angle * 2 + t * 0.6))
        petal(ctx, cx, cy, angle, len, len * 0.4, hue, layer.alpha)
      }
    }

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.26)
    core.addColorStop(0, 'rgba(255, 170, 240, 0.75)')
    core.addColorStop(0.4, 'rgba(255, 50, 190, 0.45)')
    core.addColorStop(1, 'rgba(120, 0, 255, 0)')
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.26, 0, Math.PI * 2)
    ctx.fill()

    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  return {
    canvas,
    stop: () => cancelAnimationFrame(raf),
  }
}

function petal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  len: number,
  w: number,
  hue: number,
  alpha: number,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const g = ctx.createLinearGradient(0, 0, len, 0)
  g.addColorStop(0, `hsla(${hue + 60}, 80%, 62%, ${alpha})`)
  g.addColorStop(0.55, `hsla(${hue}, 75%, 52%, ${alpha * 0.9})`)
  g.addColorStop(1, `hsla(${hue - 40}, 85%, 66%, ${alpha * 0.45})`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(len * 0.3, -w, len * 0.85, -w * 0.85, len, 0)
  ctx.bezierCurveTo(len * 0.85, w * 0.85, len * 0.3, w, 0, 0)
  ctx.fill()

  // A bright streak along the petal reads as an iridescent highlight.
  ctx.strokeStyle = `hsla(${hue + 120}, 90%, 80%, ${alpha * 0.55})`
  ctx.lineWidth = w * 0.12
  ctx.beginPath()
  ctx.moveTo(len * 0.15, 0)
  ctx.quadraticCurveTo(len * 0.5, -w * 0.25, len * 0.85, -w * 0.05)
  ctx.stroke()
  ctx.restore()
}

function drawStem(ctx: CanvasRenderingContext2D, cx: number, cy: number, height: number, t: number) {
  const sway = Math.sin(t * 0.6) * 12
  const g = ctx.createLinearGradient(cx, cy, cx, height)
  g.addColorStop(0, 'rgba(170, 90, 255, 0.9)')
  g.addColorStop(1, 'rgba(40, 60, 200, 0.6)')
  ctx.strokeStyle = g
  ctx.lineWidth = height * 0.018
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.quadraticCurveTo(cx + sway, cy + height * 0.3, cx - 20 + sway * 0.5, height + 20)
  ctx.stroke()

  const leaves = [
    { y: 0.74, dir: -1, len: 0.2, tilt: -0.55 },
    { y: 0.84, dir: 1, len: 0.17, tilt: 0.5 },
  ]
  ctx.globalCompositeOperation = 'screen'
  for (const leaf of leaves) {
    const x = cx + sway * 0.6 - 8
    const y = height * leaf.y
    const len = height * leaf.len
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((leaf.dir < 0 ? Math.PI : 0) + leaf.tilt * leaf.dir + Math.sin(t * 0.8 + leaf.y * 9) * 0.06)
    const lg = ctx.createLinearGradient(0, 0, len, 0)
    lg.addColorStop(0, 'rgba(60, 90, 255, 0.75)')
    lg.addColorStop(0.6, 'rgba(40, 220, 255, 0.8)')
    lg.addColorStop(1, 'rgba(160, 120, 255, 0.35)')
    ctx.fillStyle = lg
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(len * 0.3, -len * 0.38, len * 0.8, -len * 0.3, len, 0)
    ctx.bezierCurveTo(len * 0.8, len * 0.3, len * 0.3, len * 0.38, 0, 0)
    ctx.fill()
    ctx.restore()
  }
  ctx.globalCompositeOperation = 'source-over'
}
