import * as THREE from 'three';

// Общие параметры мира. Один шейдер рисует свет, шёлк и туман на всех масштабах.
export const shared = {
  uMap: { value: null },
  uMapXform: { value: new THREE.Vector4(1, 1, 0, 0) },
  uTime: { value: 0 },
  uMoon: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
  uWebScale: { value: 7 },
  uCam: { value: new THREE.Vector3() },
};

export const noiseGLSL = /* glsl */ `
  vec2 hash2(vec2 p){
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3. - 2. * f);
    float a = hash2(i).x, b = hash2(i + vec2(1, 0)).x;
    float c = hash2(i + vec2(0, 1)).x, d = hash2(i + vec2(1, 1)).x;
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0., a = .5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.03; a *= .5; }
    return v;
  }
  // Расстояние до границы ячейки Вороного: тонкие линии похожи на нити.
  float vedge(vec2 x){
    vec2 n = floor(x), f = fract(x), mg, mr;
    float md = 8.;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + hash2(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
    md = 8.;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + hash2(n + g) - f;
      if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(.5 * (mr + r), normalize(r - mr)));
    }
    return md;
  }
`;

const vert = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vTint;
  varying float vEmis;
  #ifdef HAS_EMIS
    attribute float aEmis;
  #endif
  void main(){
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
    #endif
    vec4 wp = m * vec4(position, 1.);
    vPos = wp.xyz;
    vNormalW = normalize(mat3(m) * normal);
    #ifdef USE_COLOR
      vTint = color;
    #else
      vTint = vec3(1.);
    #endif
    #ifdef HAS_EMIS
      vEmis = aEmis;
    #else
      vEmis = 0.;
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec4 uMapXform;
  uniform vec3 uMoon;
  uniform vec3 uTint;
  uniform float uWebScale;
  uniform float uFade;
  uniform float uSelfGlow;
  uniform float uTime;
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vTint;
  varying float vEmis;
  ${noiseGLSL}
  float bayer(vec2 p){
    vec2 q = mod(floor(p), 4.);
    float i = q.x + q.y * 4.;
    return fract(i * 0.618034);
  }
  void main(){
    if (uFade < 0.995 && uFade < bayer(gl_FragCoord.xy)) discard;
    vec2 uv = (vPos.xz - uMapXform.zw) * uMapXform.xy;
    vec4 m = texture2D(uMap, uv);
    vec3 N = normalize(vNormalW);
    float up = N.y * .5 + .5;
    float moon = max(dot(N, uMoon), 0.);
    vec3 amb = mix(vec3(.030, .036, .062), vec3(.058, .074, .125), up) + vec3(.07, .095, .17) * moon;
    float top = .42 + .58 * smoothstep(.2, 1., up);
    vec3 lamp = vec3(1.25, .82, .46) * m.r * .78 * top + vec3(.72, .9, 1.3) * m.b * .78 * top;
    float grain = .84 + .32 * fbm(vPos.xz * 3.1 + vPos.y * 2.);
    vec3 albedo = uTint * vTint * grain;
    vec3 col = albedo * (amb + lamp);
    if (m.g > .012) {
      vec2 p = (vPos.xz + vPos.y * vec2(.7, .5)) * uWebScale;
      float wob = fbm(vPos.xz * 2.6);
      float g = clamp(m.g * 1.25 - wob * .35, 0., 1.);
      float e = vedge(p);
      float e2 = vedge(p * 2.7 + 3.1);
      float lines = max(1. - smoothstep(.0, .035, e), (1. - smoothstep(.0, .05, e2)) * .55);
      float sheet = smoothstep(.55, 1., g) * (.72 + .28 * wob);
      float w = max(lines * smoothstep(.04, .4, g), sheet);
      vec3 silk = vec3(.74, .78, .84) * (amb * 2.4 + lamp * .9 + vec3(.05, .055, .07));
      col = mix(col, silk, w);
    }
    col *= mix(.1, 1., m.a);
    col += albedo * vEmis;
    col += uTint * uSelfGlow;
    gl_FragColor = vec4(col, 1.);
  }
`;

export function worldMaterial({ color = 0xffffff, vertexColors = false, emissive = false, glow = 0, fade = 1, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    vertexColors,
    side,
    defines: emissive ? { HAS_EMIS: 1 } : {},
    uniforms: {
      uMap: shared.uMap,
      uMapXform: shared.uMapXform,
      uMoon: shared.uMoon,
      uWebScale: shared.uWebScale,
      uTime: shared.uTime,
      uTint: { value: new THREE.Color(color) },
      uFade: { value: fade },
      uSelfGlow: { value: glow },
    },
  });
}
