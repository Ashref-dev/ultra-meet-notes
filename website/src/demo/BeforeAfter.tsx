import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react'
import { AnimatedAscii, type AnimatedAsciiHandle, type AsciiOptions } from '../animated-ascii'

type MediaEl = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement

interface Props {
  media: MediaEl | null
  options: Partial<AsciiOptions>
  asciiRef?: Ref<AnimatedAsciiHandle>
  onError?: (error: unknown) => void
}

/** Drag-to-compare view: the original media on the left, the effect on the right. */
export function BeforeAfter({ media, options, asciiRef, onError }: Props) {
  const [split, setSplit] = useState(50)
  const stageRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  // The media element is owned by the parent; show it in the "before" pane.
  useEffect(() => {
    const pane = paneRef.current
    if (!pane || !media) return
    media.classList.add('media-fill')
    pane.appendChild(media)
    return () => {
      if (media.parentNode === pane) pane.removeChild(media)
    }
  }, [media])

  const moveTo = (clientX: number) => {
    const rect = stageRef.current!.getBoundingClientRect()
    setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    moveTo(e.clientX)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) moveTo(e.clientX)
  }
  const onPointerUp = () => {
    dragging.current = false
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0, s - step))
    else if (e.key === 'ArrowRight') setSplit((s) => Math.min(100, s + step))
    else if (e.key === 'Home') setSplit(0)
    else if (e.key === 'End') setSplit(100)
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={stageRef}
      className="compare"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setSplit(50)}
    >
      <div ref={paneRef} className="compare__pane" />
      <div className="compare__pane" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
        <AnimatedAscii
          ref={asciiRef}
          source={media}
          {...options}
          onError={onError}
          label="Animated ASCII rendering of the source"
          style={{ position: 'absolute', inset: 0 }}
        />
      </div>

      <span className="compare__tag compare__tag--left" style={{ opacity: split > 12 ? 1 : 0 }}>
        Before
      </span>
      <span className="compare__tag compare__tag--right" style={{ opacity: split < 88 ? 1 : 0 }}>
        After
      </span>

      <div className="compare__divider" style={{ left: `${split}%` }}>
        <div
          className="compare__handle"
          role="slider"
          tabIndex={0}
          aria-label="Before and after split"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split)}
          onKeyDown={onKeyDown}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  )
}
