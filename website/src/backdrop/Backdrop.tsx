import { useEffect, useState } from 'react'
import { AnimatedAscii } from '../animated-ascii'
import { OrbShader } from './OrbShader'

/** The orb, rendered as animated ASCII over a faint glow of itself. */
export function Backdrop({ reducedMotion }: { reducedMotion: boolean }) {
  const [orb] = useState(() => new OrbShader())
  const [fontSize, setFontSize] = useState(12)

  useEffect(() => {
    const fit = () => {
      // Beside the copy on wide screens, below it on narrow ones.
      const w = innerWidth
      if (w < 820) orb.layout(w, innerHeight, innerHeight < 740 ? [0.5, 0.18] : [0.5, 0.21], innerHeight < 740 ? 0.155 : 0.2)
      else if (w < 1200) orb.layout(w, innerHeight, [0.76, 0.48], 0.3)
      else orb.layout(w, innerHeight, [0.7, 0.5], 0.38)
      setFontSize(innerWidth < 700 ? 10 : 12)
    }
    // Mouse only; touch drags would yank the orb around on phones.
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') orb.setPointer(e.clientX / innerWidth, e.clientY / innerHeight)
    }
    // Phones: follow the gyroscope. Tilt is measured from the angle the phone is held at.
    let rest: [number, number] | null = null
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return
      rest ??= [e.gamma, e.beta]
      const clamp = (v: number) => Math.max(-1, Math.min(1, v))
      orb.setTilt(clamp((e.gamma - rest[0]) / 25), clamp(-(e.beta - rest[1]) / 25))
    }
    // iOS asks for motion permission, and only from a user gesture.
    type Orientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
    const askPermission = () => {
      const DOE = window.DeviceOrientationEvent as Orientation | undefined
      DOE?.requestPermission?.().catch(() => {})
    }
    fit()
    orb.start()
    // Let the entrance animation settle before the orb starts following.
    const intro = window.setTimeout(() => orb.enableFollow(), 1400)
    addEventListener('resize', fit)
    addEventListener('pointermove', onPointer, { passive: true })
    addEventListener('deviceorientation', onTilt)
    addEventListener('touchend', askPermission, { once: true })
    return () => {
      orb.stop()
      window.clearTimeout(intro)
      removeEventListener('resize', fit)
      removeEventListener('pointermove', onPointer)
      removeEventListener('deviceorientation', onTilt)
      removeEventListener('touchend', askPermission)
    }
  }, [orb])

  useEffect(() => orb.setSpeed(reducedMotion ? 0 : 1), [orb, reducedMotion])

  return (
    <div className="backdrop" aria-hidden="true">
      <AnimatedAscii
        source={orb.canvas}
        className="backdrop__ascii"
        fontSize={fontSize}
        fontFamily='"Geist Mono Variable", ui-monospace, monospace'
        charset="@%#*+=-:. "
        bgColor="#060607"
        bgOpacity={60}
        contrast={60}
        brightness={6}
        darkThreshold={40}
        coverage={90}
        weight={0}
        animIntensity={40}
        animRandomness={60}
        glow={22}
        maxDpr={1.5}
      />
    </div>
  )
}
