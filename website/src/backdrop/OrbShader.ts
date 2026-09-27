/**
 * The landing's only visual: a slow, breathing orb of light with a thin voice waveform
 * running through it, alone in the dark. Rendered small into its own canvas; the ASCII
 * renderer re-samples it every frame.
 */

const VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_center;
uniform float u_radius;
out vec4 o;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (uv - u_center) * vec2(aspect, 1.0) / u_radius;
  float r = length(p);
  float t = u_time;

  // Domain-warped flow gives the orb its slow, liquid movement.
  vec2 q = p * 1.35;
  vec2 w = vec2(fbm(q + vec2(0.0, t * 0.07)), fbm(q + vec2(5.2, 1.3) - t * 0.06));
  float n = fbm(q + 1.9 * w + vec2(t * 0.03, 0.0));

  float breathe = 1.0 + 0.035 * sin(t * 0.45);
  float edge = r / breathe + (n - 0.5) * 0.42;
  float body = smoothstep(1.0, 0.1, edge);

  vec3 lilac = vec3(0.50, 0.42, 1.00);
  vec3 ice = vec3(0.38, 0.78, 1.00);
  vec3 peach = vec3(1.00, 0.52, 0.40);
  vec3 col = mix(lilac, ice, smoothstep(0.3, 0.7, w.x));
  col = mix(col, peach, smoothstep(0.52, 0.78, n) * 0.75);
  col *= body * (0.25 + 1.05 * n);

  // Warm core and a faint halo into the dark.
  col += peach * exp(-r * 4.2) * 0.25;
  col += mix(lilac, ice, 0.5 + 0.5 * sin(t * 0.2)) * exp(-r * 1.6) * 0.14;

  // A thin voice waveform crossing the orb.
  float env = exp(-p.x * p.x * 1.6) * (0.55 + 0.45 * sin(t * 0.6));
  float wave = (sin(p.x * 9.0 + t * 1.4) * 0.6 + sin(p.x * 17.0 - t * 1.1) * 0.4) * 0.09 * env;
  float line = exp(-abs(p.y - wave) * 55.0) * exp(-p.x * p.x * 0.9);
  col += vec3(0.95, 0.93, 1.0) * line * 0.55;

  o = vec4(col, 1.0);
}`

export class OrbShader {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext | null
  private u: Record<string, WebGLUniformLocation | null> = {}
  private raf = 0
  private last = 0
  private time = 30
  private speed = 1
  private center = [0.7, 0.5]
  private target = [0.7, 0.5]
  private home = [0.7, 0.5]
  private radius = 0.36
  private follow = false

  constructor(private scale = 0.4) {
    this.canvas = document.createElement('canvas')
    // preserveDrawingBuffer keeps the frame readable by the ASCII renderer's context.
    this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false })
    const gl = this.gl
    if (!gl) return
    const program = gl.createProgram()!
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, FS],
    ] as const) {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`OrbShader: ${gl.getShaderInfoLog(shader)}`)
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    gl.useProgram(program)
    for (const name of ['u_res', 'u_time', 'u_center', 'u_radius']) this.u[name] = gl.getUniformLocation(program, name)
    gl.bindVertexArray(gl.createVertexArray())
  }

  /** Size the canvas to the viewport and place the orb (center in 0–1, y up; radius as a share of height). */
  layout(cssWidth: number, cssHeight: number, center: [number, number], radius: number) {
    const w = Math.max(64, Math.min(900, Math.round(cssWidth * this.scale)))
    const h = Math.max(36, Math.round((w * cssHeight) / Math.max(1, cssWidth)))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.home = center
    this.target = [...center]
    this.radius = radius
  }

  /** Drift loosely toward the pointer (0–1 viewport coords, y down). Ignored until `follow`. */
  setPointer(x: number, y: number) {
    if (!this.follow) return
    const reach = 0.28
    this.target = [
      this.home[0] + (x - this.home[0]) * reach,
      this.home[1] + (1 - y - this.home[1]) * reach,
    ]
  }

  /** Drift with device tilt, each axis in -1..1. */
  setTilt(x: number, y: number) {
    if (!this.follow) return
    this.target = [this.home[0] + x * 0.12, this.home[1] + y * 0.07]
  }

  /** Start reacting to pointer/tilt (after the intro has played). */
  enableFollow() {
    this.follow = true
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  start() {
    if (!this.gl || this.raf) return
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - this.last) / 1000)
      this.last = now
      this.time += dt * this.speed
      const k = 1 - Math.exp(-dt * 0.9)
      this.center[0] += (this.target[0] - this.center[0]) * k
      this.center[1] += (this.target[1] - this.center[1]) * k
      this.draw()
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private draw() {
    const gl = this.gl!
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.uniform2f(this.u.u_res, this.canvas.width, this.canvas.height)
    gl.uniform1f(this.u.u_time, this.time)
    gl.uniform2f(this.u.u_center, this.center[0], this.center[1])
    gl.uniform1f(this.u.u_radius, this.radius)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
