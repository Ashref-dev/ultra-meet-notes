import type { CSSProperties, ReactNode } from 'react'
import { ANIM_PRESETS, type AsciiOptions, type BackgroundMode } from '../animated-ascii'

type Opts = AsciiOptions
type Patch = (patch: Partial<Opts>) => void

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
  extra?: ReactNode
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange, extra }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="ctl">
      <span className="ctl__row">
        <span className="ctl__label">{label}</span>
        <span className="ctl__value">
          {extra}
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(1)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ctl ctl--inline">
      <span className="ctl__label">{label}</span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend className="group__title">{title}</legend>
      {children}
    </fieldset>
  )
}

export function Controls({ opts, onChange }: { opts: Opts; onChange: Patch }) {
  const autoBlur = opts.bgBlur === undefined
  const blur = opts.bgBlur ?? Math.round(opts.fontSize * 0.36 * 10) / 10

  return (
    <div className="controls">
      <Group title="Glyphs">
        <Slider label="Font size" value={opts.fontSize} min={6} max={40} unit="px" onChange={(fontSize) => onChange({ fontSize })} />
        <Slider label="Weight" value={opts.weight} min={0} max={100} onChange={(weight) => onChange({ weight })} />
        <Slider label="Contrast" value={opts.contrast} min={-50} max={220} onChange={(contrast) => onChange({ contrast })} />
        <Slider label="Brightness" value={opts.brightness} min={-50} max={50} onChange={(brightness) => onChange({ brightness })} />
        <Slider label="Dark threshold" value={opts.darkThreshold} min={0} max={100} onChange={(darkThreshold) => onChange({ darkThreshold })} />
        <Slider label="Coverage" value={opts.coverage} min={5} max={100} unit="%" onChange={(coverage) => onChange({ coverage })} />
        <Slider label="Opacity" value={opts.charOpacity} min={0} max={100} unit="%" onChange={(charOpacity) => onChange({ charOpacity })} />
        <label className="ctl">
          <span className="ctl__row">
            <span className="ctl__label">Characters</span>
            <span className="ctl__hint">bright → dark</span>
          </span>
          <input
            className="text"
            value={opts.charset}
            spellCheck={false}
            onChange={(e) => onChange({ charset: e.target.value })}
          />
        </label>
        <label className="ctl ctl--inline">
          <span className="ctl__label">Colour</span>
          <span className="ctl__pair">
            <select
              className="select"
              value={opts.glyphColor ? 'solid' : 'source'}
              onChange={(e) => onChange({ glyphColor: e.target.value === 'solid' ? '#ffffff' : undefined })}
            >
              <option value="source">From source</option>
              <option value="solid">Solid</option>
            </select>
            {opts.glyphColor && (
              <input
                type="color"
                className="swatch"
                value={opts.glyphColor}
                onChange={(e) => onChange({ glyphColor: e.target.value })}
              />
            )}
          </span>
        </label>
        <Toggle label="Invert" checked={opts.invert} onChange={(invert) => onChange({ invert })} />
      </Group>

      <Group title="Animation">
        <Toggle label="Animated" checked={opts.animated} onChange={(animated) => onChange({ animated })} />
        <label className="ctl ctl--inline">
          <span className="ctl__label">Pattern</span>
          <select
            className="select"
            value={opts.animPreset}
            onChange={(e) => onChange({ animPreset: e.target.value as Opts['animPreset'] })}
          >
            {ANIM_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <Slider label="Cycle" value={opts.animSpeed} min={400} max={8000} step={100} unit="ms" onChange={(animSpeed) => onChange({ animSpeed })} />
        <Slider label="Intensity" value={opts.animIntensity} min={0} max={100} onChange={(animIntensity) => onChange({ animIntensity })} />
        <Slider label="Randomness" value={opts.animRandomness} min={0} max={100} onChange={(animRandomness) => onChange({ animRandomness })} />
        <Slider label="Flicker" value={opts.flickerRate} min={0} max={30} unit="/s" onChange={(flickerRate) => onChange({ flickerRate })} />
      </Group>

      <Group title="Backdrop">
        <label className="ctl ctl--inline">
          <span className="ctl__label">Mode</span>
          <select
            className="select"
            value={opts.background}
            onChange={(e) => onChange({ background: e.target.value as BackgroundMode })}
          >
            <option value="blur">Blurred source</option>
            <option value="original">Sharp source</option>
            <option value="solid">Solid colour</option>
            <option value="none">Transparent</option>
          </select>
        </label>
        <Slider
          label="Blur"
          value={blur}
          min={0}
          max={30}
          step={0.5}
          unit="px"
          onChange={(bgBlur) => onChange({ bgBlur })}
          extra={
            autoBlur ? (
              <span className="chip">auto</span>
            ) : (
              <button type="button" className="chip chip--btn" onClick={() => onChange({ bgBlur: undefined })}>
                auto
              </button>
            )
          }
        />
        <Slider label="Opacity" value={opts.bgOpacity} min={0} max={100} unit="%" onChange={(bgOpacity) => onChange({ bgOpacity })} />
        <label className="ctl ctl--inline">
          <span className="ctl__label">Colour</span>
          <input type="color" className="swatch" value={opts.bgColor} onChange={(e) => onChange({ bgColor: e.target.value })} />
        </label>
        <Slider label="Glyph glow" value={opts.glow} min={0} max={100} onChange={(glow) => onChange({ glow })} />
      </Group>
    </div>
  )
}
