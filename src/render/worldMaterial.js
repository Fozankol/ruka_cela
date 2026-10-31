import * as THREE from 'three';
import { MAT, MAT_GLOSS, MAT_SCALE } from './textures.js';

export const MAX_LIGHTS = 4;
export const FAR = 60;

// Общие параметры мира. Один шейдер рисует свет, тени, материалы, шёлк и туман на всех масштабах.
export const shared = {
  uMap: { value: null },
  uMapXform: { value: new THREE.Vector4(1, 1, 0, 0) },
  uAO: { value: null },
  uTex: { value: null },
  uTime: { value: 0 },
  uMoon: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
  uWebScale: { value: 7 },
  uCam: { value: new THREE.Vector3() },
  uFog: { value: 0.05 },
  uL: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 1)) },
  uLC: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
  uLD: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -1, 0, -2)) },
  uShadowMap: { value: null },
  uShadowMat: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uMatScale: { value: MAT_SCALE },
  uMatGloss: { value: MAT_GLOSS },
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

// Освещение от ближайших ламп с тенью от главной. Подключается и к пауку.
export const lightGLSL = /* glsl */ `
  uniform vec4 uL[${MAX_LIGHTS}];
  uniform vec4 uLC[${MAX_LIGHTS}];
  uniform vec4 uLD[${MAX_LIGHTS}];
  uniform sampler2D uShadowMap;
  uniform mat4 uShadowMat;
  uniform float uShadowOn;
  const vec2 POISSON[8] = vec2[8](
    vec2(-.326, -.406), vec2(-.84, -.074), vec2(-.696, .457), vec2(-.203, .621),
    vec2(.962, -.195), vec2(.473, -.48), vec2(.519, .767), vec2(.185, -.893)
  );
  float keyShadow(vec3 p, vec3 N, vec2 frag){
    if (uShadowOn < .5) return 1.;
    vec4 c = uShadowMat * vec4(p + N * .018, 1.);
    if (c.w <= 0.) return 1.;
    vec3 s = c.xyz / c.w * .5 + .5;
    if (s.x < 0. || s.y < 0. || s.x > 1. || s.y > 1.) return 1.;
    float a = fract(sin(dot(frag, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    float sum = 0.;
    for (int i = 0; i < 8; i++) {
      float d = texture2D(uShadowMap, s.xy + r * POISSON[i] * .0032).r;
      sum += s.z - .00035 < d ? 1. : 0.;
    }
    return sum / 8.;
  }
  // Возвращает диффузный свет, в spec кладёт блик.
  vec3 gather(vec3 P, vec3 N, vec3 V, vec4 m, float gloss, vec2 frag, out vec3 spec){
    vec3 sum = vec3(0.);
    spec = vec3(0.);
    float sharp = mix(10., 120., gloss);
    float gateW = smoothstep(.0, .05, m.r);
    float gateC = smoothstep(.09, .16, m.b);
    float shadow = keyShadow(P, N, frag);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (uL[i].w <= 0.) continue;
      vec3 Lv = uL[i].xyz - P;
      float d = length(Lv);
      vec3 L = Lv / d;
      float att = clamp(1. - d / uL[i].w, 0., 1.);
      att *= att;
      float cone = 1.;
      if (uLD[i].w > -1.5) cone = smoothstep(uLD[i].w - .1, uLD[i].w + .14, dot(-L, uLD[i].xyz));
      float gate = uLC[i].a > .5 ? gateW : gateC;
      float vis = att * cone * gate * (i == 0 ? shadow : 1.);
      float ndl = clamp((dot(N, L) + .2) / 1.2, 0., 1.);
      sum += uLC[i].rgb * ndl * vis;
      vec3 H = normalize(L + V);
      spec += uLC[i].rgb * pow(max(dot(N, H), 0.), sharp) * vis * gloss * max(dot(N, L), 0.) * 1.6;
    }
    return sum;
  }
`;

const vert = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vTint;
  varying float vEmis;
  varying float vMat;
  #ifdef HAS_EMIS
    attribute float aEmis;
    attribute float aMat;
  #endif
  uniform float uMatId;
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
      vMat = aMat;
    #else
      vEmis = 0.;
      vMat = uMatId;
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uAO;
  uniform sampler2DArray uTex;
  uniform vec4 uMapXform;
  uniform vec3 uMoon;
  uniform vec3 uTint;
  uniform vec3 uCam;
  uniform float uWebScale;
  uniform float uFade;
  uniform float uSelfGlow;
  uniform float uSkin;
  uniform float uTime;
  uniform float uFog;
  uniform float uMatScale[8];
  uniform float uMatGloss[8];
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vTint;
  varying float vEmis;
  varying float vMat;
  ${noiseGLSL}
  ${lightGLSL}
  float bayer(vec2 p){
    vec2 q = mod(floor(p), 4.);
    return fract((q.x + q.y * 4.) * 0.618034);
  }
  vec3 bump(vec3 N, float h, float k){
    vec3 dx = dFdx(vPos), dy = dFdy(vPos);
    float hx = dFdx(h), hy = dFdy(h);
    vec3 r1 = cross(dy, N), r2 = cross(N, dx);
    float det = dot(dx, r1);
    vec3 g = sign(det) * (hx * r1 + hy * r2);
    vec3 r = abs(det) * N - k * g;
    float l = length(r);
    return l > 1e-6 ? r / l : N;
  }
  void main(){
    if (uFade < 0.995 && uFade < bayer(gl_FragCoord.xy)) discard;
    vec2 uv = (vPos.xz - uMapXform.zw) * uMapXform.xy;
    vec4 m = texture2D(uMap, uv);
    float aoTex = texture2D(uAO, uv).r;
    float nl = length(vNormalW);
    vec3 N0 = nl > .001 ? vNormalW / nl : vec3(0., 1., 0.);

    int id = int(vMat + .5);
    vec3 an = abs(N0);
    vec2 tuv = an.y > .7 ? vPos.xz : (an.x > an.z ? vPos.zy : vPos.xy);
    vec4 tx = texture(uTex, vec3(tuv / uMatScale[id], float(id)));
    float gloss = uMatGloss[id];
    float dist = length(uCam - vPos);
    vec3 N = bump(N0, tx.a, (id == 0 ? .012 : id == 3 ? .004 : .03) * clamp(1.5 / dist, .12, 1.));

    vec3 V = normalize(uCam - vPos);
    float up = N.y * .5 + .5;
    float moon = clamp((dot(N, uMoon) + .1) / 1.1, 0., 1.);
    vec3 amb = mix(vec3(.032, .04, .068), vec3(.07, .09, .155), up) + vec3(.08, .11, .21) * moon;

    // Углы и низ стен темнее: так предметы садятся на пол.
    float low = N0.y > .6 ? 1. : smoothstep(0., .34, vPos.y) * .65 + .35;
    float ao = mix(.34, 1., aoTex) * low;

    vec3 albedo = uTint * vTint * tx.rgb * 2.05;
    vec3 spec;
    vec3 direct = gather(vPos, N, V, m, gloss, gl_FragCoord.xy, spec);
    vec3 fill = (vec3(1.2, .78, .44) * m.r + vec3(.6, .78, 1.2) * m.b) * .17;

    vec3 Hm = normalize(uMoon + V);
    vec3 moonSpec = vec3(.3, .42, .75) * pow(max(dot(N, Hm), 0.), mix(8., 70., gloss)) * gloss * .22;

    vec3 col = albedo * ((amb + fill) * ao + direct) + (spec + moonSpec) * mix(.5, 1., ao);

    if (uSkin > .5) {
      float rim = pow(1. - clamp(dot(N, V), 0., 1.), 3.);
      col += albedo * rim * (direct * .5 + vec3(.2, .24, .36));
      col += vec3(.9, .22, .12) * albedo * pow(clamp(dot(N, -V) * .5 + .5, 0., 1.), 3.) * (fill + direct * .2);
    }

    if (m.g > .012) {
      vec2 p = (vPos.xz + vPos.y * vec2(.7, .5)) * uWebScale;
      float wob = fbm(vPos.xz * 2.6);
      float g = clamp(m.g * 1.25 - wob * .35, 0., 1.);
      float e = vedge(p);
      float e2 = vedge(p * 2.7 + 3.1);
      float lines = max(1. - smoothstep(.0, .03, e), (1. - smoothstep(.0, .045, e2)) * .5);
      float sheet = smoothstep(.55, 1., g) * (.62 + .38 * wob);
      float w = max(lines * smoothstep(.04, .4, g), sheet);
      vec3 silk = vec3(.74, .78, .84) * ((amb + fill) * 2.1 + direct * .85 + vec3(.04, .045, .06)) + spec * .4;
      col = mix(col, silk, w);
    }

    col *= mix(.1, 1., m.a);
    col += albedo * vEmis;
    col += uTint * uSelfGlow;

    float fog = 1. - exp(-dist * uFog);
    vec3 fogCol = vec3(.009, .012, .024) + (vec3(1., .62, .33) * m.r + vec3(.5, .66, 1.) * m.b) * .05;
    col = mix(col, fogCol, fog);

    // В альфу пишем глубину для размытия.
    gl_FragColor = vec4(col, clamp(dist / ${FAR.toFixed(1)}, 0., 1.));
  }
`;

export function worldMaterial({ color = 0xffffff, vertexColors = false, emissive = false, glow = 0, fade = 1, side = THREE.FrontSide, mat = MAT.PLAIN, skin = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    vertexColors,
    side,
    defines: emissive ? { HAS_EMIS: 1 } : {},
    uniforms: {
      uMap: shared.uMap,
      uMapXform: shared.uMapXform,
      uAO: shared.uAO,
      uTex: shared.uTex,
      uMoon: shared.uMoon,
      uWebScale: shared.uWebScale,
      uTime: shared.uTime,
      uCam: shared.uCam,
      uFog: shared.uFog,
      uL: shared.uL,
      uLC: shared.uLC,
      uLD: shared.uLD,
      uShadowMap: shared.uShadowMap,
      uShadowMat: shared.uShadowMat,
      uShadowOn: shared.uShadowOn,
      uMatScale: shared.uMatScale,
      uMatGloss: shared.uMatGloss,
      uTint: { value: new THREE.Color(color) },
      uFade: { value: fade },
      uSelfGlow: { value: glow },
      uMatId: { value: mat },
      uSkin: { value: skin ? 1 : 0 },
    },
  });
}

// Смешивание, которое добавляет свет и не портит глубину в альфа-канале.
export const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};
