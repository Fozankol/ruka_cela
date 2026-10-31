// Ночная Земля для масштабов «Страна» и «Планета».
// Один шейдер планеты (океан, материки, облака, шёлк), оболочка атмосферы,
// точки огней городов и светящиеся нити-дуги. Без постобработки.
import * as THREE from 'three';
import { LAND } from '../content/land.js';
import { CITIES } from '../content/cities.js';

const DEG = Math.PI / 180;

/** Город по lat/lon в точку сферы радиуса r (lon 0 → +X, lon 90 → −Z, совпадает с UV SphereGeometry). */
export function latLonToVec3(lat, lon, r = 1, out = new THREE.Vector3()) {
  const la = lat * DEG, lo = lon * DEG;
  return out.set(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
}

// Маска материков в равнопромежуточной проекции: R — суша, G — линия берега, B — размытый шельф.
function makeLandTexture(W = 2048, H = 1024) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const path = new Path2D();
  for (const ring of LAND) {
    // Разворачиваем долготу, чтобы кольца через линию перемены дат не рвались.
    const pts = [];
    let prev = ring[0], shift = 0;
    for (let i = 0; i < ring.length; i += 2) {
      let lon = ring[i];
      if (i) {
        const d = lon + shift - prev;
        if (d > 180) shift -= 360; else if (d < -180) shift += 360;
      }
      lon += shift; prev = lon;
      pts.push(((lon + 180) / 360) * W, ((90 - ring[i + 1]) / 180) * H);
    }
    const n = pts.length;
    const wraps = Math.abs(pts[n - 2] - pts[0]) > W / 2; // кольцо вокруг полюса (Антарктида)
    for (const off of [-W, 0, W]) {
      path.moveTo(pts[0] + off, pts[1]);
      for (let i = 2; i < n; i += 2) path.lineTo(pts[i] + off, pts[i + 1]);
      if (wraps) {
        const pole = pts[1] > H / 2 ? H : 0;
        path.lineTo(pts[n - 2] + off, pole);
        path.lineTo(pts[0] + off, pole);
      }
      path.closePath();
    }
  }

  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgb(0,0,255)';
  ctx.fill(path, 'evenodd');
  ctx.filter = 'none';
  ctx.fillStyle = 'rgb(255,0,0)';
  ctx.fill(path, 'evenodd');
  ctx.strokeStyle = 'rgb(0,255,0)';
  ctx.lineWidth = 1.5;
  ctx.stroke(path);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

const NOISE = /* glsl */ `
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
`;

const EARTH_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vObj; varying vec3 vN; varying vec3 vV;
void main(){
  vUv = uv; vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const EARTH_FS = /* glsl */ `
uniform sampler2D uMap; uniform float uSilk; uniform float uTime; uniform vec3 uLight;
varying vec2 vUv; varying vec3 vObj; varying vec3 vN; varying vec3 vV;
${NOISE}
float fiber(vec3 p, vec3 d, float freq, float warp){
  float s = abs(sin(dot(p, d) * freq + warp));
  float w = fwidth(s) * 1.5 + 0.04;
  return 1.0 - smoothstep(0.0, w, s);
}
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  vec4 m = texture2D(uMap, vUv);
  float land = m.r, coast = m.g, shelf = m.b;
  float ndl = dot(N, normalize(uLight));
  float moon = 0.18 + 0.82 * smoothstep(-0.25, 1.0, ndl);
  float grain = fbm(vObj * 9.0);

  vec3 ocean = mix(vec3(0.004, 0.009, 0.022), vec3(0.010, 0.028, 0.055), shelf);
  vec3 ground = vec3(0.040, 0.036, 0.030) * (0.75 + 0.5 * grain);
  vec3 col = mix(ocean, ground, land) * moon;
  col += vec3(0.05, 0.09, 0.14) * coast * 0.5 * moon;

  // Облака: дрейфующий fbm по точке сферы, без отдельного слоя.
  float c = fbm(vObj * 2.6 + vec3(uTime * 0.012, 0.0, uTime * 0.004));
  float cloud = smoothstep(0.52, 0.78, c) * 0.55;
  col = mix(col, vec3(0.10, 0.11, 0.13) * moon, cloud);

  // Шёлк: покрытие пятнами растёт с uSilk, волокна в трёх направлениях.
  float spread = fbm(vObj * 1.7 + 3.0);
  float cover = smoothstep(spread - 0.08, spread + 0.08, uSilk * 1.3 - 0.15);
  float warp = fbm(vObj * 4.0) * 5.0;
  float f = fiber(vObj, normalize(vec3(0.8, 0.3, 0.5)), 70.0, warp)
          + fiber(vObj, normalize(vec3(-0.2, 0.9, 0.4)), 55.0, warp * 1.3)
          + fiber(vObj, normalize(vec3(0.3, -0.4, 0.9)), 90.0, warp * 0.7);
  float lambert = 0.32 + 0.68 * max(ndl, 0.0);
  vec3 silk = vec3(0.80, 0.79, 0.75) * (0.82 + 0.18 * grain) * (0.9 + 0.22 * min(f, 1.0)) * lambert;
  col = mix(col, silk, cover);

  // Тонкий край атмосферы на самой сфере.
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 atm = mix(vec3(0.25, 0.5, 1.0), vec3(0.75, 0.75, 0.72), uSilk);
  col += atm * rim * (0.35 + 0.25 * uSilk) * (0.4 + 0.6 * moon);
  gl_FragColor = vec4(col, 1.0);
}`;

const ATM_VS = /* glsl */ `
varying vec3 vN; varying vec3 vP;
void main(){
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const ATM_FS = /* glsl */ `
uniform float uSilk;
varying vec3 vN; varying vec3 vP;
void main(){
  // Задняя сторона оболочки: у края Земли dot ≈ 0.42, к внешнему краю падает до 0.
  float d = clamp(dot(normalize(vN), normalize(vP)), 0.0, 1.0);
  float i = pow(smoothstep(0.0, 0.45, d), 1.6) * 0.85;
  vec3 blue = vec3(0.30, 0.55, 1.0), gray = vec3(0.55, 0.56, 0.58), sick = vec3(0.92, 0.91, 0.84);
  vec3 c = mix(mix(blue, gray, smoothstep(0.0, 0.6, uSilk)), sick, smoothstep(0.5, 1.0, uSilk));
  gl_FragColor = vec4(c * i * (0.9 + 0.3 * uSilk), 1.0);
}`;

const CITY_VS = /* glsl */ `
attribute float aLight; attribute float aSize;
uniform float uScale; uniform float uSilk;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * position);
  float facing = smoothstep(-0.05, 0.25, dot(n, normalize(-mv.xyz)));
  vA = aLight * facing * (1.0 - 0.9 * uSilk);
  gl_PointSize = aSize * uScale / -mv.z * (0.4 + 0.6 * aLight);
  gl_Position = projectionMatrix * mv;
}`;

const CITY_FS = /* glsl */ `
varying float vA;
void main(){
  if (vA < 0.003) discard;
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float glow = exp(-d * d * 5.0) * (1.0 - smoothstep(0.8, 1.0, d));
  float core = exp(-d * d * 40.0);
  vec3 c = vec3(1.0, 0.66, 0.30) * glow + vec3(1.0, 0.93, 0.8) * core;
  gl_FragColor = vec4(c * vA, 1.0);
}`;

const THREAD_VS = /* glsl */ `
varying float vT;
void main(){ vT = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const THREAD_FS = /* glsl */ `
uniform float uProgress; uniform float uTime;
varying float vT;
void main(){
  if (vT > uProgress) discard;
  float pulse = 0.65 + 0.35 * sin(vT * 50.0 - uTime * 5.0);
  float head = exp(-pow((uProgress - vT) * 18.0, 2.0)) * step(uProgress, 0.999);
  vec3 c = vec3(0.82, 0.88, 1.0) * (0.55 * pulse + 1.4 * head);
  gl_FragColor = vec4(c, 1.0);
}`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

export class Globe {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.spin = 0.02; // рад/с
    this.silk = 0;

    this.group = new THREE.Group();
    this.group.rotation.z = 0.41; // наклон оси
    this.planet = new THREE.Group();
    this.group.add(this.planet);
    scene.add(this.group);

    this.landTex = makeLandTexture();
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VS,
      fragmentShader: EARTH_FS,
      uniforms: {
        uMap: { value: this.landTex },
        uSilk: { value: 0 },
        uTime: { value: 0 },
        uLight: { value: new THREE.Vector3(-0.6, 0.35, 0.75).normalize() },
      },
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.earthMat);
    this.planet.add(this.earth);

    this.atmMat = new THREE.ShaderMaterial({
      vertexShader: ATM_VS, fragmentShader: ATM_FS,
      uniforms: { uSilk: { value: 0 } },
      side: THREE.BackSide, ...additive,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 32), this.atmMat);
    this.group.add(this.atmosphere);

    // Огни городов.
    this.index = new Map();
    const n = CITIES.length;
    const pos = new Float32Array(n * 3), light = new Float32Array(n), size = new Float32Array(n);
    const v = new THREE.Vector3();
    CITIES.forEach((c, i) => {
      this.index.set(c.id, i);
      latLonToVec3(c.lat, c.lon, 1.004, v).toArray(pos, i * 3);
      light[i] = 1;
      size[i] = 7 + 15 * Math.sqrt(c.population / 37000000);
    });
    this.lightTarget = new Float32Array(light);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLight', new THREE.BufferAttribute(light, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.cityMat = new THREE.ShaderMaterial({
      vertexShader: CITY_VS, fragmentShader: CITY_FS,
      uniforms: { uScale: { value: 3 * Math.min(window.devicePixelRatio || 1, 2) }, uSilk: { value: 0 } },
      ...additive,
    });
    this.cities = new THREE.Points(geo, this.cityMat);
    this.cities.renderOrder = 2;
    this.planet.add(this.cities);

    this.threads = [];
  }

  /** Яркость огней города, 0..1. Меняется плавно в update(). */
  setCityLight(id, v) {
    const i = this.index.get(id);
    if (i === undefined) return false;
    this.lightTarget[i] = THREE.MathUtils.clamp(v, 0, 1);
    return true;
  }

  /** 0 — ночная Земля, 1 — матовый белый кокон и болезненно-белая атмосфера. */
  setSilk(v) {
    this.silk = THREE.MathUtils.clamp(v, 0, 1);
    this.earthMat.uniforms.uSilk.value = this.silk;
    this.atmMat.uniforms.uSilk.value = this.silk;
    this.cityMat.uniforms.uSilk.value = this.silk;
  }

  /** Светящаяся серебряная дуга между городами; растёт от fromId к toId. */
  addThread(fromId, toId) {
    const ia = this.index.get(fromId), ib = this.index.get(toId);
    if (ia === undefined || ib === undefined || ia === ib) return null;
    const a = latLonToVec3(CITIES[ia].lat, CITIES[ia].lon), b = latLonToVec3(CITIES[ib].lat, CITIES[ib].lon);
    const angle = a.angleTo(b);
    const pts = [];
    const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    qb.setFromUnitVectors(a, b);
    for (let k = 0; k <= 48; k++) {
      const t = k / 48;
      q.copy(qa).slerp(qb, t);
      const h = 1.005 + Math.sin(Math.PI * t) * (0.03 + 0.22 * angle / Math.PI);
      pts.push(a.clone().applyQuaternion(q).setLength(h));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.0035, 5, false);
    const mat = new THREE.ShaderMaterial({
      vertexShader: THREAD_VS, fragmentShader: THREAD_FS,
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      ...additive,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    this.planet.add(mesh);
    const thread = { mesh, speed: 0.6 / (0.3 + angle) };
    this.threads.push(thread);
    return thread;
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.planet.rotation.y += this.spin * dt;
    this.earthMat.uniforms.uTime.value = this.time;

    const attr = this.cities.geometry.attributes.aLight;
    const k = 1 - Math.exp(-dt * 2.5);
    let changed = false;
    for (let i = 0; i < attr.array.length; i++) {
      const d = this.lightTarget[i] - attr.array[i];
      if (Math.abs(d) > 0.001) { attr.array[i] += d * k; changed = true; }
      else if (d !== 0) { attr.array[i] = this.lightTarget[i]; changed = true; }
    }
    if (changed) attr.needsUpdate = true;

    for (const t of this.threads) {
      const u = t.mesh.material.uniforms;
      u.uTime.value = this.time;
      if (u.uProgress.value < 1) u.uProgress.value = Math.min(1, u.uProgress.value + t.speed * dt);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const t of this.threads) { t.mesh.geometry.dispose(); t.mesh.material.dispose(); }
    this.threads.length = 0;
    for (const m of [this.earth, this.atmosphere, this.cities]) { m.geometry.dispose(); m.material.dispose(); }
    this.landTex.dispose();
  }
}
