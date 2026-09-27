import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { DEFAULT_OPTIONS, type AnimatedAsciiHandle, type AsciiOptions } from '../animated-ascii'
import { BeforeAfter } from './BeforeAfter'
import { Controls } from './Controls'
import { createDemoSource } from './demoSource'
import { LOOKS } from './presets'

type MediaSpec =
  | { kind: 'demo' }
  | { kind: 'video' | 'image'; url: string; name: string }

type MediaEl = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i

function initialSpec(): MediaSpec {
  const src = new URLSearchParams(location.search).get('src')
  if (!src) return { kind: 'demo' }
  return { kind: IMAGE_EXT.test(src) ? 'image' : 'video', url: src, name: src.split('/').pop() || src }
}

export function App() {
  const [spec, setSpec] = useState<MediaSpec>(initialSpec)
  const [media, setMedia] = useState<MediaEl | null>(null)
  const [aspect, setAspect] = useState(16 / 9)
  const [paused, setPaused] = useState(false)
  const [look, setLook] = useState(0)
  const [opts, setOpts] = useState<AsciiOptions>(DEFAULT_OPTIONS)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [recording, setRecording] = useState(false)
  const [copied, setCopied] = useState(false)
  const asciiRef = useRef<AnimatedAsciiHandle>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setError(null)
    setPaused(false)
    if (spec.kind === 'demo') {
      const demo = createDemoSource()
      setMedia(demo.canvas)
      setAspect(16 / 9)
      return demo.stop
    }

    const remote = !spec.url.startsWith('blob:')
    const release = () => {
      if (!remote) URL.revokeObjectURL(spec.url)
    }
    if (spec.kind === 'image') {
      const img = new Image()
      if (remote) img.crossOrigin = 'anonymous'
      img.onload = () => setAspect(img.naturalWidth / img.naturalHeight)
      img.onerror = () => setError(`Couldn't load ${spec.name}.`)
      img.src = spec.url
      setMedia(img)
      return release
    }

    const video = document.createElement('video')
    if (remote) video.crossOrigin = 'anonymous'
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('loadedmetadata', () => setAspect(video.videoWidth / video.videoHeight))
    video.addEventListener('error', () => setError(`Couldn't play ${spec.name}. Try an MP4 (H.264) or WebM file.`))
    video.src = spec.url
    video.play().catch(() => setPaused(true))
    setMedia(video)
    return () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
      release()
    }
  }, [spec])

  const loadFile = (file: File | undefined) => {
    if (!file) return
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null
    if (!kind) return setError('Drop a video or an image file.')
    setSpec({ kind, url: URL.createObjectURL(file), name: file.name })
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    loadFile(e.dataTransfer.files[0])
  }

  const applyLook = (i: number) => {
    setLook(i)
    setOpts({ ...DEFAULT_OPTIONS, ...LOOKS[i].options })
  }

  const togglePlay = () => {
    if (!(media instanceof HTMLVideoElement)) return
    if (media.paused) media.play().then(() => setPaused(false), () => {})
    else {
      media.pause()
      setPaused(true)
    }
  }

  const toggleRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.stop()
      return
    }
    const canvas = asciiRef.current?.canvas
    if (!canvas || typeof MediaRecorder === 'undefined') return setError('Recording is not supported in this browser.')
    // VP8 first: some VP9 encoders silently emit empty files at high bitrates.
    const type = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(canvas.captureStream(30), {
      mimeType: type,
      videoBitsPerSecond: 8_000_000,
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.onstop = () => {
      recorderRef.current = null
      setRecording(false)
      const blob = new Blob(chunks, { type: recorder.mimeType })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `animated-ascii.${recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    recorder.start()
    recorderRef.current = recorder
    setRecording(true)
  }

  const snippet = useMemo(() => toJsx(opts, spec), [opts, spec])

  const copySnippet = async () => {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const stageAspect = Math.min(21 / 9, Math.max(4 / 5, aspect))
  const isVideo = media instanceof HTMLVideoElement
  const sourceName = spec.kind === 'demo' ? 'Procedural demo clip' : spec.name

  return (
    <div
      className="page"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <header className="nav">
        <div className="nav__inner">
          <span className="brand">
            <span className="brand__mark" aria-hidden="true">@</span>
            animated-ascii
          </span>
          <a className="nav__link" href="#usage">
            Usage
          </a>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero__intro">
            <h1 className="hero__title">
              Animated <span className="hero__accent">{'{ASCII}'}</span>
            </h1>
            <p className="hero__sub">
              Any video or image, rebuilt as a shimmering field of glyphs over its own glow. Real-time WebGL2, one React
              component.
            </p>
          </div>

          <div className="stage" style={{ aspectRatio: String(stageAspect), width: `min(100%, calc(76vh * ${stageAspect}))` }}>
            <BeforeAfter
              media={media}
              options={opts}
              asciiRef={asciiRef}
              onError={() => setError('This source is cross-origin without CORS headers, so WebGL can’t read it.')}
            />
          </div>

          <div className="looks" role="group" aria-label="Looks">
            {LOOKS.map((l, i) => (
              <button
                key={l.name}
                type="button"
                className={i === look ? 'look look--on' : 'look'}
                aria-pressed={i === look}
                onClick={() => applyLook(i)}
              >
                {l.name}
              </button>
            ))}
          </div>
        </section>

        <section className="bench">
          <div className="sourcebar">
            <div className="sourcebar__info">
              <span className="eyebrow">Source</span>
              <span className="sourcebar__name" title={sourceName}>
                {sourceName}
              </span>
            </div>
            <div className="sourcebar__actions">
              <button type="button" className="btn btn--primary" onClick={() => fileRef.current?.click()}>
                Upload video or image
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="video/*,image/*"
                hidden
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  loadFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              {spec.kind !== 'demo' && (
                <button type="button" className="btn" onClick={() => setSpec({ kind: 'demo' })}>
                  Demo clip
                </button>
              )}
              {isVideo && (
                <button type="button" className="btn" onClick={togglePlay}>
                  {paused ? 'Play' : 'Pause'}
                </button>
              )}
              <button type="button" className={recording ? 'btn btn--rec' : 'btn'} onClick={toggleRecording}>
                <span className="dot" aria-hidden="true" />
                {recording ? 'Stop & save' : 'Record'}
              </button>
              <button type="button" className="btn" onClick={() => applyLook(look)}>
                Reset
              </button>
            </div>
            {error && (
              <p className="sourcebar__error" role="alert">
                {error}
              </p>
            )}
            <p className="sourcebar__hint">Tip: drop a file anywhere on the page. Double-click the slider to centre it.</p>
          </div>

          <Controls opts={opts} onChange={(patch) => setOpts((o) => ({ ...o, ...patch }))} />
        </section>

        <section id="usage" className="usage">
          <div className="usage__text">
            <h2 className="usage__title">Use it on your site</h2>
            <p>
              Copy <code>src/animated-ascii/</code> into your Vite + React project. It has no dependencies besides React.
              The snippet below mirrors your current settings.
            </p>
            <ul className="usage__list">
              <li>
                <code>src</code> takes a video or image URL; cross-origin files need CORS headers.
              </li>
              <li>
                Pass <code>source</code> instead to render a <code>&lt;video&gt;</code>, image or canvas you already have.
              </li>
              <li>Children are layered on top, so it works as a hero background.</li>
            </ul>
          </div>
          <div className="code">
            <button type="button" className="code__copy" onClick={copySnippet}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <pre>
              <code>{snippet}</code>
            </pre>
          </div>
        </section>
      </main>

      {dragOver && (
        <div className="dropzone" aria-hidden="true">
          <span>Drop to convert</span>
        </div>
      )}
    </div>
  )
}

function toJsx(opts: AsciiOptions, spec: MediaSpec) {
  const src = spec.kind === 'demo' ? '/hero.mp4' : spec.kind === 'image' ? '/hero.jpg' : '/hero.mp4'
  const lines = [`  src="${src}"`]
  for (const key of Object.keys(opts) as (keyof AsciiOptions)[]) {
    const value = opts[key]
    if (value === undefined || value === DEFAULT_OPTIONS[key]) continue
    const plain = typeof value === 'string' && !value.includes('"')
    lines.push(plain ? `  ${key}="${value}"` : `  ${key}={${JSON.stringify(value)}}`)
  }
  lines.push(`  style={{ width: '100%', height: '100vh' }}`)
  return [
    `import { AnimatedAscii } from './animated-ascii'`,
    '',
    `<AnimatedAscii`,
    ...lines,
    `>`,
    `  <h1>Your hero copy</h1>`,
    `</AnimatedAscii>`,
  ].join('\n')
}
