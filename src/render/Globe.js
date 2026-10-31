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
uniform sampler2D uMap; uniform sampler2D uTerr; uniform sampler2D uTint; uniform sampler2D uIds; uniform float uSel; uniform float uHover; uniform float uSilk; uniform float uTime; uniform vec3 uLight;
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

  // Карта войны: у каждого блока людей свой цвет, у каждого региона свой оттенок.
  vec4 map = texture2D(uTerr, vUv);
  col = mix(col, texture2D(uTint, vUv).rgb * (0.55 + 0.45 * moon) * (0.9 + 0.2 * grain), land * 0.9);

  // Облака: дрейфующий fbm по точке сферы, без отдельного слоя.
  float c = fbm(vObj * 2.6 + vec3(uTime * 0.012, 0.0, uTime * 0.004));
  float cloud = smoothstep(0.52, 0.78, c) * 0.55;
  col = mix(col, vec3(0.10, 0.11, 0.13) * moon, cloud);

  // Шёлк: покрытие пятнами растёт с uSilk, волокна в трёх направлениях.
  float spread = fbm(vObj * 1.7 + 3.0);
  float cover = smoothstep(spread - 0.08, spread + 0.08, uSilk * 1.3 - 0.15);
  // Захваченная земля: шёлк лежит по границам регионов, край чуть неровный.
  cover = max(cover, smoothstep(0.34, 0.66, map.r + (spread - 0.5) * 0.3) * land);
  float warp = fbm(vObj * 4.0) * 5.0;
  float f = fiber(vObj, normalize(vec3(0.8, 0.3, 0.5)), 70.0, warp)
          + fiber(vObj, normalize(vec3(-0.2, 0.9, 0.4)), 55.0, warp * 1.3)
          + fiber(vObj, normalize(vec3(0.3, -0.4, 0.9)), 90.0, warp * 0.7);
  float lambert = 0.32 + 0.68 * max(ndl, 0.0);
  vec3 silk = vec3(0.80, 0.79, 0.75) * (0.82 + 0.18 * grain) * (0.9 + 0.22 * min(f, 1.0)) * lambert;
  col = mix(col, silk, cover);

  // Границы, линия фронта и подсветка региона под курсором.
  float id = texture2D(uIds, vUv).r * 255.0;
  float picked = max(step(abs(id - uSel), 0.5) * 0.17, step(abs(id - uHover), 0.5) * 0.1);
  col += vec3(1.0, 0.95, 0.8) * picked * land * lambert;
  col = mix(col, vec3(0.62, 0.66, 0.72) * lambert, min(map.g * 2.0, 1.0) * land * 0.5);
  float beat = 0.65 + 0.35 * sin(uTime * 4.0 + vObj.y * 26.0 + vObj.x * 19.0);
  col += vec3(2.2, 0.3, 0.16) * min(map.b * 1.7, 1.0) * land * beat;

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

const ARROW_FS = /* glsl */ `
uniform vec3 uColor; uniform float uTime;
varying float vT;
void main(){
  float dash = 0.55 + 0.45 * sin(vT * 34.0 - uTime * 7.0);
  gl_FragColor = vec4(uColor * dash, 1.0);
}`;

const SPARK_VS = /* glsl */ `
attribute float aLife;
varying float vL;
void main(){
  vL = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * position);
  vL *= step(0.05, dot(n, normalize(-mv.xyz)));
  gl_PointSize = (10.0 + (1.0 - aLife) * 26.0) * 3.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const SPARK_FS = /* glsl */ `
varying float vL;
void main(){
  if (vL < 0.01) discard;
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 6.0) * vL;
  gl_FragColor = vec4(vec3(3.0, 1.3, 0.4) * a, 1.0);
}`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

/** Стрелка по точкам: бегущая полоса и наконечник на конце. */
export function arrowMeshes(pts, color, radius, headR) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const mat = new THREE.ShaderMaterial({
    vertexShader: THREAD_VS,
    fragmentShader: ARROW_FS,
    uniforms: { uColor: { value: new THREE.Color(...color) }, uTime: { value: 0 } },
    ...additive,
  });
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, radius, 6, false), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headR * 2.7, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), ...additive }));
  head.position.copy(pts[pts.length - 1]);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1));
  return { mesh, head };
}

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
        uTerr: { value: null },
        uTint: { value: null },
        uIds: { value: null },
        uSel: { value: -1 },
        uHover: { value: -1 },
        uSilk: { value: 0 },
        uTime: { value: 0 },
        uLight: { value: new THREE.Vector3(-0.6, 0.35, 0.75).normalize() },
      },
    });
    this.makeMapTextures();
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
    this.arrows = [];

    const SPARKS = 48;
    const sparkPos = new Float32Array(SPARKS * 3);
    const sparkLife = new Float32Array(SPARKS);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    sparkGeo.setAttribute('aLife', new THREE.BufferAttribute(sparkLife, 1));
    this.sparks = new THREE.Points(sparkGeo, new THREE.ShaderMaterial({ vertexShader: SPARK_VS, fragmentShader: SPARK_FS, ...additive }));
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 5;
    this.planet.add(this.sparks);
    this.sparkData = { pos: sparkPos, life: sparkLife, geo: sparkGeo, next: 0 };
  }

  makeMapTextures() {
    const W = 2048;
    const H = 1024;
    this.mapW = W;
    this.mapH = H;
    const tex = (data, format, nearest) => {
      const t = new THREE.DataTexture(data, W, H, format, THREE.UnsignedByteType);
      t.wrapS = THREE.RepeatWrapping;
      t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = !nearest;
      t.needsUpdate = true;
      return t;
    };
    this.terrData = new Uint8Array(W * H * 4);
    this.tintData = new Uint8Array(W * H * 4);
    this.ids = new Uint8Array(W * H);
    this.idData = new Uint8Array(W * H * 4);
    this.terrTex = tex(this.terrData, THREE.RGBAFormat);
    this.tintTex = tex(this.tintData, THREE.RGBAFormat);
    this.idTex = tex(this.idData, THREE.RGBAFormat, true);
    const u = this.earthMat.uniforms;
    u.uTerr.value = this.terrTex;
    u.uTint.value = this.tintTex;
    u.uIds.value = this.idTex;
  }

  /** Делит сферу на регионы: каждая точка принадлежит ближайшему центру. */
  initMap(regions, tints) {
    const W = this.mapW;
    const H = this.mapH;
    const n = regions.length;
    const cx = new Float64Array(n);
    const cy = new Float64Array(n);
    const cz = new Float64Array(n);
    regions.forEach((r, i) => {
      const c = latLonToVec3(r.lat, r.lon);
      cx[i] = c.x;
      cy[i] = c.y;
      cz[i] = c.z;
    });
    const cosLon = new Float64Array(W);
    const sinLon = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      const lo = (-180 + ((x + 0.5) / W) * 360) * DEG;
      cosLon[x] = Math.cos(lo);
      sinLon[x] = Math.sin(lo);
    }
    let o = 0;
    for (let y = 0; y < H; y++) {
      const la = (-90 + ((y + 0.5) / H) * 180) * DEG;
      const cosLat = Math.cos(la);
      const sinLat = Math.sin(la);
      for (let x = 0; x < W; x++) {
        const vx = cosLat * cosLon[x];
        const vz = -cosLat * sinLon[x];
        let best = 0;
        let bestD = -2;
        for (let i = 0; i < n; i++) {
          const d = vx * cx[i] + sinLat * cy[i] + vz * cz[i];
          if (d > bestD) {
            bestD = d;
            best = i;
          }
        }
        this.ids[o] = best;
        this.idData[o * 4] = best;
        this.idData[o * 4 + 3] = 255;
        const c = tints[best];
        this.tintData[o * 4] = c[0];
        this.tintData[o * 4 + 1] = c[1];
        this.tintData[o * 4 + 2] = c[2];
        this.tintData[o * 4 + 3] = 255;
        o++;
      }
    }
    this.idTex.needsUpdate = true;
    this.tintTex.needsUpdate = true;
  }

  /** Перерисовывает владельцев: R шёлк, G границы регионов, B линия фронта. */
  repaintMap(owned) {
    const W = this.mapW;
    const H = this.mapH;
    const { ids, terrData: d } = this;
    d.fill(0);
    const front = [];
    for (let y = 0; y < H; y++) {
      const y2 = Math.min(H - 1, y + 1);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const a = ids[i];
        const right = ids[y * W + ((x + 1) % W)];
        const down = ids[y2 * W + x];
        const o = i * 4;
        d[o] = owned[a] ? 255 : 0;
        d[o + 3] = 255;
        if (a !== right || a !== down) d[o + 1] = 255;
        if (owned[a] !== owned[right] || owned[a] !== owned[down]) front.push(x, y);
      }
    }
    for (let k = 0; k < front.length; k += 2) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = front[k + 1] + dy;
          if (y < 0 || y >= H) continue;
          d[(y * W + ((front[k] + dx + W) % W)) * 4 + 2] = 255;
        }
      }
    }
    this.terrTex.needsUpdate = true;
  }

  /** Сразу выставляет огням целевую яркость, без плавного перехода. */
  snapLights() {
    const attr = this.cities.geometry.attributes.aLight;
    attr.array.set(this.lightTarget);
    attr.needsUpdate = true;
  }

  setPicked(sel, hover) {
    this.earthMat.uniforms.uSel.value = sel;
    this.earthMat.uniforms.uHover.value = hover;
  }

  /** Индекс региона под лучом мыши или -1. */
  pickRegion(ray) {
    const hit = ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
    if (!hit) return -1;
    this.planet.worldToLocal(hit).normalize();
    const lat = Math.asin(hit.y) / DEG;
    const lon = Math.atan2(-hit.z, hit.x) / DEG;
    const x = Math.floor(((lon + 180) / 360) * this.mapW) % this.mapW;
    const y = Math.min(this.mapH - 1, Math.floor(((lat + 90) / 180) * this.mapH));
    return this.ids[y * this.mapW + x];
  }

  /** Стрелка удара: бегущая полоса вдоль дуги и наконечник. */
  addArrow(a, b, color) {
    const va = latLonToVec3(a.lat, a.lon);
    const vb = latLonToVec3(b.lat, b.lon);
    const angle = va.angleTo(vb);
    const qb = new THREE.Quaternion().setFromUnitVectors(va, vb);
    const q = new THREE.Quaternion();
    const qa = new THREE.Quaternion();
    const pts = [];
    for (let k = 0; k <= 32; k++) {
      const t = k / 32;
      q.copy(qa).slerp(qb, t);
      pts.push(va.clone().applyQuaternion(q).setLength(1.008 + Math.sin(Math.PI * t) * (0.02 + 0.12 * angle)));
    }
    const arrow = arrowMeshes(pts, color, 0.0075, 0.03);
    arrow.mesh.renderOrder = 4;
    arrow.head.renderOrder = 4;
    this.planet.add(arrow.mesh, arrow.head);
    this.arrows.push(arrow);
    return arrow;
  }

  removeArrow(arrow) {
    this.planet.remove(arrow.mesh, arrow.head);
    arrow.mesh.geometry.dispose();
    arrow.mesh.material.dispose();
    arrow.head.geometry.dispose();
    arrow.head.material.dispose();
    this.arrows = this.arrows.filter((x) => x !== arrow);
  }

  /** Вспышка боя на поверхности. */
  spark(lat, lon) {
    const s = this.sparkData;
    const i = s.next;
    s.next = (i + 1) % s.life.length;
    latLonToVec3(lat, lon, 1.006).toArray(s.pos, i * 3);
    s.life[i] = 1;
    s.geo.attributes.position.needsUpdate = true;
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

    for (const a of this.arrows) a.mesh.material.uniforms.uTime.value = this.time;
    const s = this.sparkData;
    for (let i = 0; i < s.life.length; i++) s.life[i] = Math.max(0, s.life[i] - dt * 2);
    s.geo.attributes.aLife.needsUpdate = true;

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
    for (const a of [...this.arrows]) this.removeArrow(a);
    for (const m of [this.earth, this.atmosphere, this.cities, this.sparks]) { m.geometry.dispose(); m.material.dispose(); }
    this.landTex.dispose();
    for (const t of [this.terrTex, this.tintTex, this.idTex]) t.dispose();
  }
}
