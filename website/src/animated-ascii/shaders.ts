// GLSL for the animated-ascii renderer (WebGL2 / GLSL ES 3.00).
//
// Screen-space conventions: full-screen passes use GL orientation (v = 0 at the
// bottom). Source textures are uploaded unflipped (v = 0 at the top of the
// image), so every source lookup flips v at the end.

/** Oversized triangle covering the viewport; no vertex buffers needed. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

/** Draws the source with cover/contain mapping. Outside the image is transparent. */
export const COVER_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_uvScale;
uniform float u_opacity;
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 uv = (v_uv - 0.5) * u_uvScale + 0.5;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec3 c = texture(u_src, vec2(clamp(uv.x, 0.0, 1.0), 1.0 - clamp(uv.y, 0.0, 1.0))).rgb;
  o = vec4(c, 1.0) * (inside * u_opacity);
}`

/** Copies a (premultiplied) render target, scaled by opacity. */
export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_opacity;
in vec2 v_uv;
out vec4 o;
void main() {
  o = texture(u_tex, v_uv) * u_opacity;
}`

/**
 * One direction of a separable gaussian, using the linear-sampling trick
 * (each tap reads two texels). Texels past the edge count as transparent,
 * which matches how a CSS/canvas blur darkens toward the frame edge.
 */
export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
#define MAX_TAPS 16
uniform sampler2D u_tex;
uniform vec2 u_dir;
uniform float u_weights[MAX_TAPS];
uniform float u_offsets[MAX_TAPS];
uniform int u_taps;
in vec2 v_uv;
out vec4 o;
vec4 tap(vec2 uv) {
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture(u_tex, uv) * inside;
}
void main() {
  vec4 sum = texture(u_tex, v_uv) * u_weights[0];
  for (int i = 1; i < MAX_TAPS; i++) {
    if (i >= u_taps) break;
    vec2 d = u_dir * u_offsets[i];
    sum += (tap(v_uv + d) + tap(v_uv - d)) * u_weights[i];
  }
  o = sum;
}`

/** Auto-levels: min/max luma over a 32x32 grid of the visible frame, into a 1x1 target. */
export const LEVELS_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_uvScale;
out vec4 o;
void main() {
  float lo = 1.0;
  float hi = 0.0;
  for (int j = 0; j < 32; j++) {
    for (int i = 0; i < 32; i++) {
      vec2 s = (vec2(float(i), float(j)) + 0.5) / 32.0;
      vec2 uv = (s - 0.5) * u_uvScale + 0.5;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
      float l = dot(textureLod(u_src, uv, 0.0).rgb, vec3(0.299, 0.587, 0.114));
      lo = min(lo, l);
      hi = max(hi, l);
    }
  }
  if (hi < lo) { lo = 0.0; hi = 1.0; }
  o = vec4(lo, hi, 0.0, 1.0);
}`

/**
 * One instance per grid cell. The vertex shader does all the per-cell work:
 * samples the source, picks a glyph from the ramp, and applies the animation
 * (opacity wave plus neighbour-glyph flicker in the wave's trough). Culled
 * cells collapse outside clip space.
 */
export const GLYPH_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_src;
uniform sampler2D u_levels;
uniform vec2 u_res;
uniform vec2 u_cell;
uniform vec2 u_origin;
uniform ivec2 u_grid;
uniform vec2 u_uvScale;
uniform vec2 u_slot;
uniform float u_pad;
uniform vec2 u_atlasSize;
uniform int u_atlasCols;
uniform int u_len;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_cutoff;
uniform float u_shift;
uniform float u_coverage;
uniform bool u_invert;
uniform bool u_autoLevels;
uniform float u_opacity;
uniform bool u_animated;
uniform int u_preset;
uniform float u_cycle;
uniform float u_tick;
uniform float u_intensity;
uniform float u_random;
uniform bool u_useColor;
uniform vec3 u_color;

out vec2 v_uv;
out vec4 v_col;

const float TAU = 6.283185307179586;

float cellHash(int c, int r) {
  uint uc = uint(c);
  uint ur = uint(r);
  return float((7919u * uc + 6271u * ur + uc * uc * 3571u) % 10000u) / 10000.0;
}

// Per-cell phase offset for each animation preset, blended toward a per-cell
// hash by the randomness setting. x = phase, y = small extra jitter.
vec2 animPhase(int c, int r) {
  float fc = float(c);
  float fr = float(r);
  float cols = float(u_grid.x);
  float rows = float(u_grid.y);
  float jitter = float((1301 * c + 9377 * r) % 1000) * u_random / 1000.0 * 0.3;
  float sx = (fc + 0.5) / cols - 0.5;
  float sy = (fr + 0.5) / rows - 0.5;
  float h = sqrt(sx * sx + sy * sy);
  float ang = atan(sy, sx) / TAU + 0.5;
  float n;
  switch (u_preset) {
    case 1: n = 0.72 - h; break;                                      // ripple-in
    case 2: n = ang; break;                                           // vortex
    case 3: n = fract(ang + 2.0 * h); break;                          // spiral
    case 4: n = float((15731u * uint(c) + 789221u * uint(r) + 12345u) % 10000u) / 10000.0; break; // twinkle
    case 5: n = 0.0; break;                                           // pulse
    case 6: n = 1.0 - fc / cols; break;                               // cascade-lr
    case 7: n = fc / cols; break;                                     // cascade-rl
    case 8: n = fr / rows; break;                                     // cascade-tb
    case 9: n = 1.0 - fr / rows; break;                               // cascade-bt
    case 10: n = (fc + fr) / (cols + rows); break;                    // diagonal
    case 11: n = (fc + (rows - fr)) / (cols + rows); break;           // diagonal-alt
    case 12: n = fract((fr * cols + fc) * 0.05); break;               // reveal
    case 13: n = fract((fr * cols + ((r & 1) == 1 ? cols - 1.0 - fc : fc)) * 0.05); break; // serpentine
    case 14: n = fract(0.2 * fr); break;                              // scan-h
    case 15: n = fract(0.2 * fc); break;                              // scan-v
    case 16: n = float((c + r) & 1) * 0.5; break;                     // checker
    default: n = h;                                                   // wave
  }
  return vec2(n * (1.0 - u_random) + cellHash(c, r) * u_random, jitter);
}

void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  v_uv = vec2(0.0);
  v_col = vec4(0.0);
}

void main() {
  int c = gl_InstanceID % u_grid.x;
  int r = gl_InstanceID / u_grid.x;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));

  vec2 center = u_origin + (vec2(float(c), float(r)) + 0.5) * u_cell;
  vec2 uv = (vec2(center.x / u_res.x, 1.0 - center.y / u_res.y) - 0.5) * u_uvScale + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { cull(); return; }
  vec3 rgb = textureLod(u_src, vec2(uv.x, 1.0 - uv.y), 0.0).rgb;

  float m = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec2 lv = u_autoLevels ? texelFetch(u_levels, ivec2(0), 0).rg : vec2(0.0, 1.0);
  float y = clamp((m - lv.x) / max(lv.y - lv.x, 1.0 / 255.0), 0.0, 1.0);
  if (u_invert) y = 1.0 - y;
  if (y < u_cutoff) { cull(); return; }
  // Static per-cell dropout leaves a fixed scatter of empty cells.
  if (((73856093u * uint(c)) ^ (19349663u * uint(r))) % 1000u >= uint(u_coverage * 1000.0)) { cull(); return; }

  float lum = clamp(y + u_shift, 0.0, 1.0);
  int glyph = min(u_len - 1, int(floor((1.0 - lum) * float(u_len))));

  vec3 col = u_useColor
    ? u_color
    : clamp(u_contrast * (rgb - 0.50196) + 0.50196 + u_brightness, 0.0, 1.0);

  float alpha = u_opacity;
  if (u_animated) {
    vec2 pj = animPhase(c, r);
    float wave = sin(TAU * fract(u_cycle + pj.x + pj.y));
    alpha *= (1.0 - u_intensity) + u_intensity * (0.5 + 0.5 * wave);
    if (u_intensity > 0.2 && u_len > 1 && wave < -0.3 + 0.5 * u_random) {
      int off = int(mod(floor(100.0 * cellHash(c, r) + u_tick), 3.0)) - 1;
      glyph = clamp(glyph + off, 0, u_len - 1);
    }
  }
  if (alpha <= 0.002) { cull(); return; }

  vec2 topLeft = floor(u_origin + vec2(float(c), float(r)) * u_cell + 0.5) - u_pad;
  vec2 p = topLeft + corner * u_slot;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);

  vec2 slot = vec2(float(glyph % u_atlasCols), float(glyph / u_atlasCols)) * u_slot;
  v_uv = (slot + corner * u_slot) / u_atlasSize;
  v_col = vec4(col, alpha);
}`

export const GLYPH_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_uv;
in vec4 v_col;
out vec4 o;
void main() {
  float a = texture(u_atlas, v_uv).a * v_col.a;
  o = vec4(v_col.rgb * a, a);
}`
