# Ultra landing page

A calm, one-screen landing page for [Ultra](https://github.com/Ashref-dev/ultra-meet-notes), private AI meeting notes for macOS. Built with React, Vite and Motion.

The page is mostly dark. The only light is a slow, breathing orb (a custom WebGL shader with a thin voice waveform running through it), rendered as animated ASCII by the `animated-ascii` effect. It leans slightly toward the cursor. Next to it: one headline, one sentence, one download button, three quiet facts, and a single transcript line typing itself out under the orb.

Type is Geist and Geist Mono (self-hosted via Fontsource). Reduced-motion freezes the orb and the typing.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/, deploy anywhere
```

## Where things live

| Path | What |
| --- | --- |
| `src/data.ts` | Copy, facts and transcript lines. **Update `RELEASE` when a new version ships.** |
| `src/App.tsx` | The whole page. |
| `src/backdrop/OrbShader.ts` | The orb (GLSL): colours, flow, waveform. |
| `src/backdrop/Backdrop.tsx` | Orb placement per screen size and the ASCII look. |
| `src/animated-ascii/` | The ASCII effect, copied from the `animated-ascii-effect` project. |
| `src/styles.css` | All styles. |
