import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { AsciiRenderer } from './AsciiRenderer'
import { DEFAULT_OPTIONS, type AsciiOptions, type AsciiSource } from './options'

export interface AnimatedAsciiHandle {
  readonly renderer: AsciiRenderer | null
  readonly canvas: HTMLCanvasElement | null
  /** The internal media element created for `src` (null when using `source`). */
  readonly media: HTMLVideoElement | HTMLImageElement | null
}

export interface AnimatedAsciiProps extends Partial<AsciiOptions> {
  /** Video or image URL. Cross-origin URLs need CORS headers. */
  src?: string
  /** Media type for `src`; guessed from the file extension when omitted. */
  type?: 'video' | 'image'
  /** Render an element you already own (video, image, canvas…) instead of `src`. */
  source?: AsciiSource | null
  poster?: string
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  crossOrigin?: '' | 'anonymous' | 'use-credentials'
  className?: string
  style?: CSSProperties
  /** Content layered above the effect, e.g. hero copy. */
  children?: ReactNode
  /** Accessible label; without it the canvas is hidden from assistive tech. */
  label?: string
  onReady?: (renderer: AsciiRenderer) => void
  /** Media load failures and WebGL upload failures (e.g. a cross-origin file without CORS). */
  onError?: (error: unknown) => void
}

const OPTION_KEYS = [
  ...Object.keys(DEFAULT_OPTIONS),
  'rows',
  'bgBlur',
  'glyphColor',
] as (keyof AsciiOptions)[]

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i

const fill: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
}

// forwardRef keeps the component usable on React 18 as well as 19.
export const AnimatedAscii = forwardRef<AnimatedAsciiHandle, AnimatedAsciiProps>(function AnimatedAscii(props, ref) {
  const {
    src,
    type,
    source,
    poster,
    autoPlay = true,
    loop = true,
    muted = true,
    crossOrigin = 'anonymous',
    className,
    style,
    children,
    label,
    onReady,
    onError,
    ...rest
  } = props

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const rendererRef = useRef<AsciiRenderer | null>(null)
  const callbacks = useRef({ onReady, onError })
  callbacks.current = { onReady, onError }
  const [supported, setSupported] = useState(true)

  // Every option key is always passed so a removed prop falls back to its default.
  const options: Partial<AsciiOptions> = {}
  const restOptions = rest as Partial<AsciiOptions>
  for (const key of OPTION_KEYS) {
    ;(options as Record<string, unknown>)[key] = restOptions[key]
  }

  const mediaType = source ? null : src ? (type ?? (IMAGE_EXT.test(src) ? 'image' : 'video')) : null

  useEffect(() => {
    const renderer = new AsciiRenderer(canvasRef.current!, options)
    if (!renderer.supported) {
      setSupported(false)
      return
    }
    rendererRef.current = renderer
    renderer.onerror = (error) => callbacks.current.onError?.(error)
    renderer.start()
    callbacks.current.onReady?.(renderer)
    return () => {
      renderer.dispose()
      rendererRef.current = null
    }
    // Options are synced by the effect below; the renderer lives for the component's lifetime.
  }, [])

  useEffect(() => {
    rendererRef.current?.setOptions(options)
  })

  useEffect(() => {
    rendererRef.current?.setSource(source ?? videoRef.current ?? imageRef.current ?? null)
  }, [source, src, mediaType])

  useEffect(() => {
    const video = videoRef.current
    if (mediaType !== 'video' || !video || !autoPlay) return
    video.muted = muted
    const play = () => video.play().catch(() => {})
    // Autoplay can be refused (e.g. low-power mode); retry on the first interaction.
    video.play().catch(() => {
      document.addEventListener('pointerdown', play, { once: true })
    })
    return () => document.removeEventListener('pointerdown', play)
  }, [src, mediaType, autoPlay, muted])

  useImperativeHandle(
    ref,
    () => ({
      get renderer() {
        return rendererRef.current
      },
      get canvas() {
        return canvasRef.current
      },
      get media() {
        return videoRef.current ?? imageRef.current
      },
    }),
    [],
  )

  const fit = options.fit ?? DEFAULT_OPTIONS.fit
  // The media element stays in the layout (hidden under the canvas) so browsers keep
  // decoding it; it becomes the visible fallback when WebGL2 is unavailable.
  const mediaStyle: CSSProperties = {
    ...fill,
    objectFit: fit,
    opacity: supported ? 0 : 1,
    pointerEvents: 'none',
  }

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: options.background === 'none' ? undefined : (options.bgColor ?? DEFAULT_OPTIONS.bgColor),
        ...style,
      }}
    >
      {mediaType === 'video' && (
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          loop={loop}
          muted={muted}
          playsInline
          preload="auto"
          crossOrigin={crossOrigin}
          style={mediaStyle}
          onError={() => callbacks.current.onError?.(new Error(`animated-ascii: failed to load ${src}`))}
          aria-hidden
        />
      )}
      {mediaType === 'image' && (
        <img
          ref={imageRef}
          src={src}
          crossOrigin={crossOrigin}
          alt=""
          style={mediaStyle}
          onError={() => callbacks.current.onError?.(new Error(`animated-ascii: failed to load ${src}`))}
          aria-hidden
        />
      )}
      <canvas
        ref={canvasRef}
        style={{ ...fill, visibility: supported ? 'visible' : 'hidden' }}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      />
      {children !== undefined && <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>}
    </div>
  )
})
