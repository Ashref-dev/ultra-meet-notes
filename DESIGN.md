# Ultra Brand System

## 1. Brand Essence

**App name:** Ultra  
**Subtitle:** meet notes

Ultra should feel like calm intelligence with warm clarity. The brand should suggest that messy thoughts are becoming organized in real time. It is smart, but never cold. It is warm, but never casual. It is soft, but never vague. There is also a slight dreamlike quality, as if ideas are flowing into place instead of being forced into structure.

The emotional balance is:

- **Smart**: AI capable, precise, trustworthy
- **Warm**: human, approachable, supportive
- **Soft**: no harsh tech energy, no aggressive contrast
- **Slightly dreamy**: fluid transitions, luminous color, a sense of ideas moving

When designing for Ultra, favor clarity over noise, softness over severity, and flow over rigid visual friction.

## 2. Signature Gradient, Core Identity

Ultra's signature identity is a warm, flowing diagonal gradient. It is the most recognizable visual cue in the system and should be treated as the brand's core expression.

- **Direction:** 135° diagonal
- **Stops:** Indigo `#5B4DCC` → Lavender `#8A6FD1` → Pink `#F06A8B` → Orange `#FF8A3D` → Gold `#FFD166`

```css
background: linear-gradient(135deg, #5B4DCC 0%, #8A6FD1 25%, #F06A8B 50%, #FF8A3D 75%, #FFD166 100%);
```

Use this gradient for brand moments, primary emphasis, highlighted active states, and identity surfaces. It should feel luminous and alive, never loud.

## 3. Color Palette

### Core Colors

These are the primary Ultra colors and should be used most often.

| Token | Hex | HSL | Meaning |
|------|-----|-----|---------|
| Ultra Indigo | `#5B4DCC` | `247 55% 55%` | intelligence, base |
| Ultra Purple | `#6A5ACF` | `247 50% 58%` | depth |
| Ultra Lavender | `#8A6FD1` | `260 46% 63%` | transitions |
| Ultra Pink | `#F06A8B` | `344 82% 68%` | flow, emotion |
| Ultra Orange | `#FF8A3D` | `22 100% 62%` | action, highlights |
| Ultra Gold | `#FFD166` | `43 100% 70%` | warmth, accents |

### Supporting Colors

Use these lightly to extend the palette without diluting the main identity.

| Token | Hex |
|------|-----|
| Soft Magenta | `#E96BA8` |
| Dusty Lavender | `#A88BD6` |
| Warm Peach | `#FFB38A` |
| Soft Yellow | `#FFE08A` |

### Atmosphere Overlays

These overlays create the soft, luminous mood of the brand.

| Token | Value | Use |
|------|-------|-----|
| Purple Fog | `rgba(106, 90, 207, 0.35)` | overlays, modal atmosphere, diffused depth |
| Warm Glow | `rgba(255, 138, 61, 0.25)` | highlights, focus areas, warmth |
| White Glow | `rgba(255, 255, 255, 0.15)` to `rgba(255, 255, 255, 0.3)` | soft bloom, layered light |

### Semantic Colors

Semantic status colors follow Apple HIG conventions for familiarity and trust.

| Token | Hex |
|------|-----|
| Accent Blue | `#007aff` |
| Danger Red | `#ff3b30` |
| Success Green | `#30d158` |
| Warning Orange | `#ff9f0a` |

### UI Surfaces, Dark Mode

| Surface | Value | Approx Hex |
|--------|-------|------------|
| Background | `hsl(240 14% 7%)` | `#0F0F14` |
| Card | `hsl(240 10% 11%)` | `#1A1A1F` |
| Border | `hsl(240 6% 19%)` | `#2F2F34` |
| Text Primary | `hsl(30 5% 98%)` | `#FBFAF9` |
| Text Muted | `hsl(0 1% 60%)` | `#999796` |

### UI Surfaces, Light Mode

| Surface | Value |
|--------|-------|
| Background | `hsl(250 20% 98%)` |
| Card | `hsl(250 20% 100%)` |

## 4. Typography

Typography should balance character with clarity. Ultra has a recognizable display voice, but the reading experience should stay effortless.

| Role | Font | Weight | CSS Variable |
|------|------|--------|-------------|
| Wordmark/Display | Share Tech | 400 | `--font-share-tech` |
| Body/UI | Inter | 400–700 | `--font-inter` |
| Code/Mono | JetBrains Mono | 400–700 | `--font-jetbrains-mono` |

### Tailwind Class Mapping

| Class | Font |
|------|------|
| `font-display` | Share Tech |
| `font-sans` | Inter |
| `font-mono` | JetBrains Mono |

### Type Scale

| Role | Size |
|------|------|
| Display | 32px |
| H1 | 24px |
| H2 | 18px |
| Body | 16px |
| Small | 14px |
| Caption | 12px |

Share Tech is reserved for the wordmark and display moments. Inter should carry the product UI and long reading. JetBrains Mono is only for code, technical values, and mono-specific interface moments.

## 5. Border Radius Scale

Ultra should feel boxy but slightly rounded. Corners should be controlled and modern, not soft or pill-like.

| Token | Value | Use |
|------|-------|-----|
| `rounded-sm` | 4px | fine elements, badges |
| `rounded` (default) | 6px | buttons, inputs, chips |
| `rounded-lg` | 8px | button groups, small cards |
| `rounded-xl` | 12px | dialogs, medium cards |
| `rounded-2xl` | 16px | large cards, panels |
| `rounded-3xl` | 20px | feature sections |
| `rounded-full` | 9999px | avatars, dots, circular indicators only |

**Principle:** Boxy but slightly rounded. Never pill-shaped except circular elements.

## 6. Component Patterns

### Buttons

Buttons should use `rounded-lg` with an 8px radius. The primary brand variant uses the signature gradient. Hover states should lift slightly with a subtle purple-tinted shadow.

```tsx
<Button variant="brand">Action</Button>
```

### Cards

Cards should use `rounded-xl` with a 12px radius. Use `bg-card` with `backdrop-blur-sm` to preserve softness and layered depth.

### Dialogs

Dialogs should use `sm:rounded-xl`. The overlay should feel atmospheric, using the purple fog treatment rather than a flat neutral dimmer.

### Inputs

Inputs should use `rounded-md` with a 6px radius. They should rely on `border-input` and background tokens rather than custom one-off colors.

## 7. Depth & Effects

Ultra uses gentle depth, not hard elevation. Shadows should feel colored, diffused, and atmospheric.

- Subtle shadows with purple tint: `shadow-[0_8px_24px_-12px_hsl(var(--brand-purple)/0.55)]`
- Brand grain overlay: `.brand-grain` adds a soft noise texture
- Glow effects should use radial gradients for focal points and ambient warmth
- Avoid harsh box shadows. Prefer colored, diffused shadows instead

Depth should support focus and emotion, not simulate heavy physical stacking.

## 8. Motion

Motion should reinforce clarity and flow. Transitions need to feel polished and quiet.

- Micro-interactions: `100ms` to `150ms`
- Layout shifts: `200ms` to `300ms`
- Page transitions: `300ms` to `500ms`
- Easing: `ease-out` for entrances, `ease-in` for exits
- Motion must respect `prefers-reduced-motion`
- Brand gradient animations: `.meeting-item-active-ring` uses the `gradient-shift` keyframe

Animation should suggest ideas moving into place. It should never feel flashy or mechanical.

## 9. Agent Prompt Guide

This section is a quick reference for AI agents working in the codebase.

- Brand gradient CSS class: `.brand-gradient-warm-linear`
- Brand gradient radial: `.brand-gradient-warm`
- Grain overlay: `.brand-grain`
- Brand Tailwind colors: `brand-indigo`, `brand-purple`, `brand-lavender`, `brand-pink`, `brand-orange`, `brand-gold`
- Wordmark font: `font-display`
- Background dark: `bg-background` maps to `#0F0F14`
- Buttons: always `rounded-lg`, never `rounded-full`
- Cards: `rounded-xl`
- Never use hardcoded hex for brand colors, use Tailwind `brand-*` tokens
