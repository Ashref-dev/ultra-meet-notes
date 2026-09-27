import type { AsciiOptions } from '../animated-ascii'

export interface Look {
  name: string
  options: Partial<AsciiOptions>
}

/** Starting points for the demo. Each one is applied on top of the defaults. */
export const LOOKS: Look[] = [
  { name: 'Animated ASCII', options: {} },
  {
    name: 'Neon Glow',
    options: { glow: 55, contrast: 150, weight: 25, animIntensity: 45, bgOpacity: 70 },
  },
  {
    name: 'Ripple',
    options: { animPreset: 'ripple-in', animIntensity: 65, animRandomness: 20, animSpeed: 2200 },
  },
  {
    name: 'Matrix',
    options: {
      charset: '01',
      glyphColor: '#3dff7a',
      background: 'solid',
      animPreset: 'cascade-tb',
      animIntensity: 80,
      animRandomness: 25,
      animSpeed: 1800,
      glow: 45,
      coverage: 100,
      darkThreshold: 60,
    },
  },
  {
    name: 'Mono',
    options: { glyphColor: '#f4f1e8', background: 'solid', bgColor: '#0b0b0d', coverage: 100, weight: 5 },
  },
  {
    name: 'Dense',
    options: { fontSize: 9, coverage: 100, animPreset: 'twinkle', animIntensity: 55, bgBlur: 2 },
  },
]
