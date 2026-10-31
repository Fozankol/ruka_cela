import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clamp, lerp } from '../core/util.js';
import { T } from '../sim/grid.js';
import { KeyShadow } from './KeyShadow.js';
import { buildMaterialAtlas } from './textures.js';
import { FAR, MAX_LIGHTS, shared } from './worldMaterial.js';

const DofShader = {
  uniforms: { tDiffuse: { value: null }, uFocus: { value: 2 }, uRange: { value: 1 }, uMax: { value: 0.01 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uFocus;
    uniform float uRange;
    uniform float uMax;
    uniform float uAspect;
    varying vec2 vUv;
    float coc(float d){ return clamp(abs(d - uFocus) / uRange - .12, 0., 1.) * uMax; }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // Этот проход работает всегда: одна ошибочная точка иначе растеклась бы по кадру через свечение.
      if (!(c.r == c.r && c.g == c.g && c.b == c.b && c.a == c.a) || c.r + c.g + c.b > 3000.) c = vec4(0., 0., 0., 1.);
      c.rgb = min(c.rgb, vec3(40.));
      float d = c.a * ${FAR.toFixed(1)};
      float r0 = coc(d);
      vec3 sum = c.rgb;
      float total = 1.;
      float rot = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
      if (r0 < .0003) { gl_FragColor = c; return; }
      for (int i = 1; i <= 12; i++) {
        float t = float(i) / 12.;
        float a = float(i) * 2.39996 + rot;
        vec2 o = vec2(cos(a), sin(a) * uAspect) * sqrt(t) * r0;
        vec4 s = texture2D(tDiffuse, vUv + o);
        if (!(s.r == s.r && s.g == s.g && s.b == s.b && s.a == s.a) || s.r + s.g + s.b > 3000.) continue;
        s.rgb = min(s.rgb, vec3(40.));
        float sd = s.a * ${FAR.toFixed(1)};
        float rs = coc(sd);
        // Резкий передний план не расплывается на фоне, а размытый заходит на резкий.
        float w = sd < d ? step(length(o * vec2(1., 1. / uAspect)), rs + .0006) : (r0 > .0002 ? 1. : 0.);
        sum += s.rgb * w;
        total += w;
      }
      gl_FragColor = vec4(sum / total, c.a);
    }
  `,
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDread: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDread;
    varying vec2 vUv;
    float rand(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - .5;
      float r2 = dot(c, c);
      float ab = (.0014 + uDread * .002) * r2 * 4.;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;
      // Тени уходят в синий, света остаются тёплыми.
      float l = dot(col, vec3(.3, .59, .11));
      col = mix(col, col * vec3(.82, .96, 1.32), (1. - smoothstep(.0, .35, l)) * .55);
      col = mix(vec3(l), col, 1.16);
      col *= 1. - smoothstep(.12, .68, r2) * .72;
      col += (rand(vUv * 913. + fract(uTime) * 37.) - .5) * .014;
      gl_FragColor = vec4(max(col, 0.), 1.);
    }
  `,
};

function makeStars(scene) {
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.randomDirection().multiplyScalar(180);
    v.y = Math.abs(v.y);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = Math.pow(Math.random(), 3) * 1.6 + 0.2;
    col.set([b * 0.8, b * 0.86, b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }));
  stars.frustumCulled = false;
  scene.add(stars);

  // Восемь звёзд расположены как глаза паука и растут вместе с игрой.
  const eyes = new THREE.Group();
  const layout = [[-1.5, 0.15, 0.8], [-0.55, 0.45, 1.25], [0.55, 0.45, 1.25], [1.5, 0.15, 0.8], [-1.0, -0.55, 0.62], [-0.33, -0.3, 0.72], [0.33, -0.3, 0.72], [1.0, -0.55, 0.62]];
  const tex = glowTexture();
  for (const [x, y, s] of layout) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(3.6, 1.8, 1.4), depthWrite: false, blending: THREE.AdditiveBlending, transparent: true, fog: false }));
    sp.position.set(x, y, 0);
    sp.userData.base = s;
    sp.scale.setScalar(s);
    eyes.add(sp);
  }
  eyes.position.set(-90, 26, -120);
  eyes.lookAt(0, 0, 0);
  eyes.scale.setScalar(2.4);
  scene.add(eyes);
  return { stars, eyes };
}

export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.14, 'rgba(255,255,255,.8)');
  g.addColorStop(0.3, 'rgba(255,255,255,.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Камера, постобработка и текстуры, через которые шейдер видит симуляцию.
export class Stage {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer = renderer;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    renderer.setPixelRatio(this.pixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02030a);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.03, 900);

    shared.uTex.value = buildMaterialAtlas();
    this.shadow = new KeyShadow(renderer, this.scene);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.dof = new ShaderPass(DofShader);
    this.composer.addPass(this.dof);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.42, 0.6, 0.95);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    const sky = makeStars(this.scene);
    this.eyes = sky.eyes;

    this.rig = {
      target: new THREE.Vector3(),
      goal: new THREE.Vector3(),
      dist: 6,
      goalDist: 6,
      pitch: 1,
      goalPitch: 1,
      yaw: 1.57,
      goalYaw: 1.57,
      follow: null,
      soft: 3,
      lift: 0,
    };
    this.shake = 0;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.keyLight = { px: 0, py: 0, pz: 0, dir: null };
    this.keyDir = new THREE.Vector3();

    this.quality = 0;
    this.qT = 0;
    this.qN = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Слабая видеокарта не должна портить игру: качество снижается само.
  setQuality(q) {
    this.quality = q;
    const base = Math.min(window.devicePixelRatio || 1, 1.25);
    const pr = q === 0 ? base : q < 3 ? Math.min(base, 1) : 0.8;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.bloom.enabled = q < 3;
    this.resize();
  }

  watchQuality(dt) {
    if (document.visibilityState !== 'visible' || dt > 0.25) return;
    this.qT += dt;
    this.qN++;
    if (this.qT < 3) return;
    const fps = this.qN / this.qT;
    this.qT = 0;
    this.qN = 0;
    if (fps < 38 && this.quality < 3) this.setQuality(this.quality + 1);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dof.uniforms.uAspect.value = w / h;
  }

  bindMap(grid) {
    this.grid = grid;
    const n = grid.n;
    this.mapData = new Uint8Array(n * 4);
    this.dispW = new Float32Array(n);
    this.dispC = new Float32Array(n);
    this.dispWeb = new Float32Array(n);
    this.dispSense = new Float32Array(grid.sense);
    if (this.mapTex) this.mapTex.dispose();
    const tex = new THREE.DataTexture(this.mapData, grid.w, grid.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    this.mapTex = tex;
    shared.uMap.value = tex;
    shared.uAO.value = this.bakeAO(grid);
    shared.uMapXform.value.set(1 / (grid.w * grid.cell), 1 / (grid.h * grid.cell), 0, 0);
  }

  // Мягкое затемнение пола у стен и мебели, посчитано один раз по сетке.
  bakeAO(g) {
    const R = 7;
    const d = new Uint8Array(g.n).fill(255);
    const q = [];
    for (let i = 0; i < g.n; i++) {
      if (g.type[i] === T.WALL || g.type[i] === T.FURN) {
        d[i] = 0;
        q.push(i);
      }
    }
    for (let head = 0; head < q.length; head++) {
      const i = q[head];
      if (d[i] >= R) continue;
      const cx = i % g.w;
      const cz = (i - cx) / g.w;
      for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
        if (!g.inb(nx, nz)) continue;
        const ni = g.idx(nx, nz);
        if (d[ni] === 255) {
          d[ni] = d[i] + 1;
          q.push(ni);
        }
      }
    }
    const data = new Uint8Array(g.n);
    for (let i = 0; i < g.n; i++) data[i] = 255 * Math.pow(Math.min(1, d[i] / R), 0.75);
    const tex = new THREE.DataTexture(data, g.w, g.h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  updateMap(dt) {
    const g = this.grid;
    const k = 1 - Math.exp(-dt * 11);
    const ks = 1 - Math.exp(-dt * 6);
    const d = this.mapData;
    const { dispW, dispC, dispWeb, dispSense } = this;
    const { lightW, lightC, web, sense } = g;
    for (let i = 0; i < g.n; i++) {
      dispW[i] += (lightW[i] - dispW[i]) * k;
      dispC[i] += (lightC[i] - dispC[i]) * k;
      dispWeb[i] += (web[i] - dispWeb[i]) * ks;
      dispSense[i] += (sense[i] - dispSense[i]) * ks;
      const o = i * 4;
      d[o] = Math.min(255, dispW[i] * 170);
      d[o + 1] = dispWeb[i] * 255;
      d[o + 2] = Math.min(255, dispC[i] * 170);
      d[o + 3] = dispSense[i] * 255;
    }
    this.mapTex.needsUpdate = true;
  }

  // Свободен ли путь от цели до камеры при таком наклоне.
  viewClear(pitch) {
    const r = this.rig;
    const g = this.grid;
    const cp = Math.cos(pitch) * r.dist;
    const dx = Math.cos(r.yaw) * cp;
    const dz = Math.sin(r.yaw) * cp;
    const dy = Math.sin(pitch) * r.dist;
    for (let t = 0.2; t <= 1.081; t += 0.09) {
      const h = g.height[g.at(r.target.x + dx * t, r.target.z + dz * t)];
      if (r.target.y + dy * t < h + 0.07) return false;
    }
    return true;
  }

  // Камера поднимается над мебелью и стенами, а не заезжает внутрь них.
  clearPitch() {
    const r = this.rig;
    if (!this.grid || r.pitch > 0.95) return 0;
    for (let lift = 0; lift < 0.95; lift += 0.1) {
      if (this.viewClear(r.pitch + lift)) return lift;
    }
    return 0.95;
  }

  // Ближайшие к камере источники попадают в шейдер, первый из них отбрасывает тень.
  updateLights(world) {
    const c = this.rig.target;
    const list = [];
    for (const l of world.lights) {
      if (!l.on || l.moon) continue;
      const d = Math.hypot(l.x - c.x, l.z - c.z) - (l.dynamic ? 2 : l.warm ? 1.5 : 0);
      list.push({ l, d });
    }
    list.sort((a, b) => a.d - b.d);
    const { uL, uLC, uLD } = shared;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const e = list[i];
      if (!e) {
        uL.value[i].w = 0;
        continue;
      }
      const l = e.l;
      const y = l.dynamic ? 1.2 : l.bulb ? l.bulb[1] : l.y ?? 2.1;
      uL.value[i].set(l.x, y, l.z, l.radius * 1.12);
      if (l.warm) uLC.value[i].set(1.75, 1.06, 0.5, 1).multiplyScalar(1);
      else uLC.value[i].set(1.1, 1.45, 2.2, 0);
      const p = l.power;
      uLC.value[i].x *= p;
      uLC.value[i].y *= p;
      uLC.value[i].z *= p;
      if (l.dynamic) {
        this.keyDir.set(Math.cos(l.dir), -0.32, Math.sin(l.dir)).normalize();
        uLD.value[i].set(this.keyDir.x, this.keyDir.y, this.keyDir.z, Math.cos(l.cone));
      } else {
        uLD.value[i].set(0, -1, 0, -2);
      }
    }
    const key = list[0];
    if (!key) {
      this.keyOn = false;
      return;
    }
    this.keyOn = true;
    const v = uL.value[0];
    this.keyLight.px = v.x;
    this.keyLight.py = v.y;
    this.keyLight.pz = v.z;
    this.keyLight.dir = key.l.dynamic ? new THREE.Vector3(uLD.value[0].x, uLD.value[0].y, uLD.value[0].z) : null;
  }

  setCamera({ target, dist, pitch, yaw, soft = 3 }, snap = false) {
    const r = this.rig;
    if (target) r.goal.set(target.x, target.y ?? 0, target.z);
    if (dist !== undefined) r.goalDist = dist;
    if (pitch !== undefined) r.goalPitch = pitch;
    if (yaw !== undefined) r.goalYaw = yaw;
    r.soft = soft;
    if (snap) {
      r.target.copy(r.goal);
      r.dist = r.goalDist;
      r.pitch = r.goalPitch;
      r.yaw = r.goalYaw;
    }
  }

  pick(clientX, clientY) {
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, this.hit) ? { x: this.hit.x, z: this.hit.z } : null;
  }

  update(dt) {
    this.watchQuality(dt);
    const r = this.rig;
    if (r.follow) {
      const f = r.follow();
      r.goal.set(f.x, r.goal.y, f.z);
    }
    const k = 1 - Math.exp(-dt * r.soft);
    r.target.lerp(r.goal, k);
    r.dist = lerp(r.dist, r.goalDist, k);
    r.pitch = lerp(r.pitch, r.goalPitch, k);
    r.yaw = lerp(r.yaw, r.goalYaw, k);
    const need = this.clearPitch();
    r.lift = lerp(r.lift, need, 1 - Math.exp(-dt * (need > r.lift ? 20 : 2.5)));
    const pitch = r.pitch + r.lift;
    const cp = Math.cos(pitch);
    const c = this.camera;
    c.position.set(r.target.x + Math.cos(r.yaw) * cp * r.dist, r.target.y + Math.sin(pitch) * r.dist, r.target.z + Math.sin(r.yaw) * cp * r.dist);
    this.shake = Math.max(0, this.shake - dt * 2.6);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.05 * clamp(r.dist / 2, 0.5, 3);
      c.position.x += (Math.random() - 0.5) * s;
      c.position.y += (Math.random() - 0.5) * s;
      c.position.z += (Math.random() - 0.5) * s;
    }
    c.lookAt(r.target);
    shared.uCam.value.copy(c.position);
    shared.uTime.value += dt;
    shared.uFog.value = 0.11 / Math.max(1, r.dist * 0.6);
    this.grade.uniforms.uTime.value = shared.uTime.value;

    // Вблизи размытие как в макросъёмке, издали лёгкий эффект миниатюры.
    const u = this.dof.uniforms;
    u.uFocus.value = r.dist;
    u.uRange.value = Math.max(0.5, r.dist * 0.75);
    u.uMax.value = this.quality < 2 ? clamp(0.016 - r.dist * 0.0009, 0.0035, 0.016) : 0;
  }

  render(world) {
    this.updateLights(world);
    this.shadow.render(this.keyOn && this.quality < 3 ? this.keyLight : null);
    this.composer.render();
  }
}
