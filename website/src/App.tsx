import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Backdrop } from './backdrop/Backdrop'
import { FACTS, LINES, RELEASE, REPO } from './data'
import { AppleLogo, ArrowUpRight, UltraMark } from './icons'

const ease = [0.22, 1, 0.36, 1] as const
const rise = (delay: number) => ({
  initial: { opacity: 0, y: 12, filter: 'blur(8px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.9, delay, ease },
})

export function App() {
  const reducedMotion = !!useReducedMotion()

  return (
    <div className="shell">
      <Backdrop reducedMotion={reducedMotion} />
      <div className="vignette" aria-hidden="true" />

      <motion.header className="nav" {...rise(0)}>
        <a className="logo" href={REPO} aria-label="Ultra">
          <UltraMark />
          <span>ultra</span>
        </a>
        <nav className="nav__links">
          <a className="nav__link" href={REPO}>
            GitHub
          </a>
          <a className="btn btn--sm" href={RELEASE.dmg}>
            Download
          </a>
        </nav>
      </motion.header>

      <main className="hero">
        <motion.p className="kicker" {...rise(0.15)}>
          Meeting notes for macOS
        </motion.p>
        <motion.h1 className="title" {...rise(0.25)}>
          Private meeting notes.
          <span>Nothing leaves your Mac.</span>
        </motion.h1>
        <motion.p className="lede" {...rise(0.4)}>
          Ultra records your calls, transcribes them on-device with Whisper, and writes the notes. No bot joins the
          meeting.
        </motion.p>
        <motion.div className="actions" {...rise(0.5)}>
          <a className="btn" href={RELEASE.dmg}>
            <AppleLogo /> Download for Mac
          </a>
          <a className="link" href={REPO}>
            View source <ArrowUpRight />
          </a>
        </motion.div>
        <motion.p className="meta" {...rise(0.6)}>
          v{RELEASE.version} · Apple Silicon · Free and open source
        </motion.p>
      </main>

      <motion.footer className="foot" {...rise(0.8)}>
        <ul className="facts">
          {FACTS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <Whisper paused={reducedMotion} />
      </motion.footer>
    </div>
  )
}

/** One transcript line at a time, typed out under the orb. */
function Whisper({ paused }: { paused: boolean }) {
  const [index, setIndex] = useState(0)
  const [chars, setChars] = useState(paused ? LINES[0].length : 0)
  const line = LINES[index]

  useEffect(() => {
    if (paused) return
    if (chars < line.length) {
      const id = setTimeout(() => setChars((c) => c + 1), 38)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => {
      setIndex((i) => (i + 1) % LINES.length)
      setChars(0)
    }, 2600)
    return () => clearTimeout(id)
  }, [chars, line, paused])

  return (
    <div className="whisper" aria-hidden="true">
      <span className="whisper__label">
        <i /> transcribing locally
      </span>
      <AnimatePresence mode="wait">
        <motion.p
          key={index}
          className="whisper__line"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(4px)' }}
          transition={{ duration: 0.4 }}
        >
          {line.slice(0, chars)}
          <span className="caret" />
        </motion.p>
      </AnimatePresence>
    </div>
  )
}
