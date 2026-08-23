import { useEffect, useRef } from 'react';

type ParticleSpherePreviewProps = {
  className?: string;
  speaking?: boolean;
};

const vertexShader = `
  precision highp float;
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uBreath;
  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;
  varying float vEnergy;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vec3 point = position;
    float radiusNoise = snoise(point * 2.2 + uTime * 0.16 + aSeed) * 0.12;
    float swirl = snoise(point.zxy * 3.1 - uTime * 0.11 + aSeed * 2.0) * 0.06;
    vec3 warped = point + normalize(point) * radiusNoise + vec3(swirl, -swirl * 0.7, swirl * 0.45);
    warped *= mix(0.95, 1.15, uBreath);
    float pulse = 1.0 + 0.22 * sin(uTime * 1.4 + aSeed * 9.0);
    vEnergy = 0.55 + abs(radiusNoise) * 3.0;
    vec4 viewPosition = modelViewMatrix * vec4(warped, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = max(1.0, aSize * uPixelRatio * pulse * (280.0 / max(80.0, -viewPosition.z)));
  }
`;

const fragmentShader = `
  precision highp float;
  varying float vEnergy;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float distanceToCenter = length(uv);
    float soft = smoothstep(0.5, 0.04, distanceToCenter);
    float core = smoothstep(0.18, 0.0, distanceToCenter);
    vec3 cyan = vec3(0.08, 0.74, 1.0);
    vec3 white = vec3(0.65, 0.96, 1.0);
    gl_FragColor = vec4(mix(cyan, white, core) * (0.65 + vEnergy), soft * (0.55 + core * 0.45));
  }
`;

function makeSphere(count: number) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    positions[i * 3] = Math.cos(theta) * radius;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * radius;
    sizes[i] = 1 + (i % 7) * 0.22;
    seeds[i] = (i * 0.6180339887) % 1;
  }
  return { positions, sizes, seeds };
}

export function ParticleSpherePreview({ className = '', speaking = false }: ParticleSpherePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true });
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to create WebGL shader');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed';
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    };

    let vertex: WebGLShader | null = null;
    let fragment: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    try {
      vertex = compile(gl.VERTEX_SHADER, vertexShader);
      fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
      program = gl.createProgram();
      if (!program) return;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
      gl.useProgram(program);

      const timeLocation = gl.getUniformLocation(program, 'uTime');
      const pixelLocation = gl.getUniformLocation(program, 'uPixelRatio');
      const breathLocation = gl.getUniformLocation(program, 'uBreath');
      const projectionLocation = gl.getUniformLocation(program, 'projectionMatrix');
      const modelViewLocation = gl.getUniformLocation(program, 'modelViewMatrix');
      if (!timeLocation || !pixelLocation || !breathLocation || !projectionLocation || !modelViewLocation) return;

      const mobile = window.matchMedia('(max-width: 700px)').matches;
      const count = mobile ? 4200 : 14000;
      const sphere = makeSphere(count);
      const buffers: Array<{ name: string; data: Float32Array; size: number }> = [
        { name: 'position', data: sphere.positions, size: 3 },
        { name: 'aSize', data: sphere.sizes, size: 1 },
        { name: 'aSeed', data: sphere.seeds, size: 1 },
      ];
      const createdBuffers: WebGLBuffer[] = [];
      for (const item of buffers) {
        const buffer = gl.createBuffer();
        if (!buffer) continue;
        createdBuffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, item.data, gl.STATIC_DRAW);
        const location = gl.getAttribLocation(program, item.name);
        if (location >= 0) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, item.size, gl.FLOAT, false, 0, 0);
        }
      }

      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2.0);
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform1f(pixelLocation, ratio);
        const aspect = width / height;
        const fov = 1.05;
        const near = 0.1;
        const far = 100;
        const f = 1 / Math.tan(fov / 2);
        gl.uniformMatrix4fv(projectionLocation, false, new Float32Array([
          f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0,
          (far + near) / (near - far), -1, 0, 0,
          (2 * far * near) / (near - far), 0,
        ]));
      };
      resize();
      window.addEventListener('resize', resize);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.clearColor(0.01, 0.02, 0.05, 0);

      const started = performance.now();
      let frame = 0;
      const render = (now: number) => {
        const seconds = (now - started) / 1000;
        const breathing = speakingRef.current
          ? 0.5 + 0.5 * Math.sin(seconds * 1.25)
          : 0.5 + 0.5 * Math.sin(seconds * 0.72);
        const angle = seconds * 0.16;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform1f(timeLocation, seconds);
        gl.uniform1f(breathLocation, breathing);
        gl.uniformMatrix4fv(modelViewLocation, false, new Float32Array([
          c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, -3.1, 1,
        ]));
        gl.drawArrays(gl.POINTS, 0, count);
        frame = window.requestAnimationFrame(render);
      };
      frame = window.requestAnimationFrame(render);

      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener('resize', resize);
        for (const buffer of createdBuffers) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
      };
    } catch {
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return;
    }
  }, []);

  return <canvas ref={canvasRef} className={`h-full min-h-[260px] w-full ${className}`} aria-label="Animated cyan particle sphere preview" role="img" />;
}
