import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lerp } from '../core/util.js';
import { SPIDERS } from '../sim/world.js';
import { Figure } from './Figure.js';
import { HeroSpider, chitinMaterial } from './HeroSpider.js';
import { CAST_LAYER } from './KeyShadow.js';
import { additive, worldMaterial } from './worldMaterial.js';

const MAX_SPIDERS = 1600;
const MAX_RIPPLES = 96;

function tag(geo, leg, color, emis) {
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const legs = new Float32Array(n).fill(leg);
  const em = new Float32Array(n).fill(emis);
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = color[0];
    c[i * 3 + 1] = color[1];
    c[i * 3 + 2] = color[2];
  }
  geo.setAttribute('aLeg', new THREE.BufferAttribute(legs, 1));
  geo.setAttribute('aEmis', new THREE.BufferAttribute(em, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

function segment(a, b, r0, r1, leg) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return tag(g.toNonIndexed(), leg, [0.03, 0.03, 0.035], 0);
}

// Каракурт: чёрное брюшко с красными пятнами и восемь суставчатых лап.
function spiderGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.42, 12, 9);
  body.scale(1.2, 0.86, 1);
  body.translate(-0.42, 0.42, 0);
  parts.push(tag(body.toNonIndexed(), 0, [0.03, 0.03, 0.035], 0));
  const head = new THREE.SphereGeometry(0.24, 10, 7);
  head.translate(0.2, 0.32, 0);
  parts.push(tag(head.toNonIndexed(), 0, [0.04, 0.035, 0.04], 0));
  const spots = [[-0.42, 0.74, 0], [-0.72, 0.66, 0.1], [-0.72, 0.66, -0.1], [-0.2, 0.7, 0.13], [-0.2, 0.7, -0.13], [-0.52, 0.56, 0.3], [-0.52, 0.56, -0.3]];
  for (const [x, y, z] of spots) {
    const s = new THREE.SphereGeometry(0.058, 6, 5);
    s.translate(x, y, z);
    parts.push(tag(s.toNonIndexed(), 0, [0.8, 0.03, 0.02], 1.9));
  }
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 4; i++) {
      const leg = i + (side > 0 ? 1 : 5);
      const spread = -0.95 + i * 0.63;
      const ox = Math.sin(spread);
      const oz = Math.cos(spread) * side;
      const start = new THREE.Vector3(0.18 + ox * 0.16, 0.3, oz * 0.16);
      const knee = new THREE.Vector3(0.18 + ox * 0.62, 0.78, oz * 0.62);
      const tip = new THREE.Vector3(0.18 + ox * 1.25, 0.0, oz * 1.25);
      parts.push(segment(start, knee, 0.042, 0.03, leg));
      parts.push(segment(knee, tip, 0.03, 0.008, leg));
    }
  }
  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}

function rippleMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    vertexShader: /* glsl */ `
      attribute vec3 aRip;
      varying vec2 vUv;
      varying vec3 vRip;
      void main(){
        vUv = uv * 2. - 1.;
        vRip = aRip;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vRip;
      void main(){
        float d = length(vUv);
        float age = vRip.x;
        float ring = exp(-pow((d - age * .94) / (.035 + age * .03), 2.));
        float ring2 = exp(-pow((d - age * .62) / .03, 2.)) * .45;
        float a = (ring + ring2) * (1. - age) * (1. - age) * vRip.y * smoothstep(1., .9, d);
        vec3 c = mix(vec3(.5, .72, 1.), vec3(1., .22, .12), vRip.z);
        gl_FragColor = vec4(c, a);
      }
    `,
  });
}

// Всё, что движется: рой, люди, рябь вибрации, тапок, коконы.
export class Units {
  constructor(world, stage) {
    this.world = world;
    this.stage = stage;
    const scene = stage.scene;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const dummy = new THREE.Object3D();
    this.dummy = dummy;

    const geo = spiderGeometry();
    this.anim = new Float32Array(MAX_SPIDERS * 2);
    geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(this.anim, 2).setUsage(THREE.DynamicDrawUsage));
    this.spiders = new THREE.InstancedMesh(geo, chitinMaterial({ instanced: true }), MAX_SPIDERS);
    this.spiders.layers.enable(CAST_LAYER);
    this.spiders.frustumCulled = false;
    this.spiders.count = 0;
    this.group.add(this.spiders);

    const ripGeo = new THREE.PlaneGeometry(1, 1);
    ripGeo.rotateX(-Math.PI / 2);
    this.ripData = new Float32Array(MAX_RIPPLES * 3);
    ripGeo.setAttribute('aRip', new THREE.InstancedBufferAttribute(this.ripData, 3).setUsage(THREE.DynamicDrawUsage));
    this.rippleMesh = new THREE.InstancedMesh(ripGeo, rippleMaterial(), MAX_RIPPLES);
    this.rippleMesh.frustumCulled = false;
    this.rippleMesh.count = 0;
    this.rippleMesh.renderOrder = 5;
    this.group.add(this.rippleMesh);
    this.ripples = [];

    this.beacon = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.3, 0.2), side: THREE.DoubleSide, ...additive }));
    this.beacon.rotation.x = -Math.PI / 2;
    this.beacon.position.y = 0.02;
    this.beacon.visible = false;
    this.group.add(this.beacon);

    this.markRing = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.9), side: THREE.DoubleSide, ...additive }));
    this.markRing.rotation.x = -Math.PI / 2;
    this.markRing.position.y = 0.018;
    this.markRing.visible = false;
    this.group.add(this.markRing);
    this.markLife = 0;

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 32),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uA: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float d = length(vUv); gl_FragColor = vec4(.0, .0, .0, uA * smoothstep(1., .55, d) * .92); }',
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.015;
    this.shadow.visible = false;
    this.group.add(this.shadow);

    const soleGeo = new THREE.BoxGeometry(0.34, 0.05, 0.13);
    soleGeo.translate(0, 0.025, 0);
    this.slipper = new THREE.Mesh(soleGeo, worldMaterial({ color: 0x5a3a2a }));
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.15), worldMaterial({ color: 0x7a5a42 }));
    strap.position.set(0.06, 0.07, 0);
    this.slipper.add(strap);
    this.slipper.visible = false;
    this.slipper.layers.enable(CAST_LAYER);
    strap.layers.enable(CAST_LAYER);
    this.group.add(this.slipper);
    this.stompFx = null;

    const flyPos = new Float32Array(32 * 3);
    this.flyGeo = new THREE.BufferGeometry();
    this.flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.flies = new THREE.Points(this.flyGeo, new THREE.PointsMaterial({ color: new THREE.Color(1.3, 1.25, 0.8), size: 0.018, sizeAttenuation: true }));
    this.flies.frustumCulled = false;
    this.group.add(this.flies);

    this.figures = world.humans.map((h) => new Figure(h, this.group));
    this.hero = new HeroSpider(this.group, SPIDERS.hero.scale);
    this.cocoonMeshes = [];
    this.cocoonMat = worldMaterial({ color: 0xdde2ea, glow: 0.018 });
    this.cocoonGeo = new THREE.SphereGeometry(1, 16, 12);
    const pos = this.cocoonGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const k = 1 + Math.sin(y * 16) * 0.05 + Math.sin(pos.getX(i) * 7 + y * 9) * 0.04;
      pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k);
    }
    this.cocoonGeo.computeVertexNormals();

    this.nestMat = worldMaterial({ color: 0xc8ccd4, glow: 0.012 });
    this.nestMeshes = [];

    world.bus.on('ripple', (r) => this.addRipple(r));
    world.bus.on('slipper', (e) => this.onSlipper(e));
    world.bus.on('human', (e) => e.event === 'cocoon' && this.addCocoon(e.h));
    world.bus.on('nest', (n) => this.addNest(n));
    world.bus.on('mark', (m) => {
      this.markRing.position.x = m.x;
      this.markRing.position.z = m.z;
      this.markRing.visible = true;
      this.markLife = 1;
    });
  }

  addRipple({ x, z, power = 1, kind = 'step' }) {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    const size = kind === 'stomp' ? 3.4 : kind === 'step' ? 1.7 : kind === 'bite' ? 1.2 : 0.9;
    const red = kind === 'bite' || kind === 'death' ? 1 : 0;
    this.ripples.push({ x, z, age: 0, life: kind === 'stomp' ? 1.1 : 0.95, power: Math.min(1, power), size, red });
  }

  onSlipper({ x, z, phase, life }) {
    if (phase === 'warn') {
      this.stompFx = { x, z, t: 0, life, hit: false, rot: Math.random() * 6 };
    } else if (this.stompFx) {
      this.stompFx.hit = true;
      this.stompFx.t = 0;
      this.stompFx.life = life + 0.6;
    }
  }

  addCocoon(h) {
    const m = new THREE.Mesh(this.cocoonGeo, this.cocoonMat);
    m.layers.enable(CAST_LAYER);
    if (h.lie > 0.5) {
      m.position.set(h.x, (h.bedY ?? 0.4) + 0.14, h.z - h.height * 0.46);
      m.scale.set(0.27, 0.24, h.height * 0.52);
    } else {
      m.position.set(h.x, h.height * 0.46, h.z);
      m.scale.set(0.27, h.height * 0.52, 0.27);
    }
    this.group.add(m);
    this.cocoonMeshes.push(m);
    this.addRipple({ x: h.x, z: h.z, power: 1, kind: 'bite' });
  }

  addNest({ x, z }) {
    const m = new THREE.Mesh(this.cocoonGeo, this.nestMat);
    m.position.set(x, 0.05, z);
    m.scale.set(0.16, 0.09, 0.13);
    this.group.add(m);
    this.nestMeshes.push(m);
  }

  update(dt, alpha) {
    const w = this.world;
    const d = this.dummy;
    let n = 0;
    // Вдали пауки чуть крупнее реального, иначе рой превратился бы в пыль.
    const far = 1 + Math.min(1.3, Math.max(0, (this.stage.rig.dist - 4) * 0.085));
    for (const s of w.spiders) {
      if (s.hidden || s.kind === 'hero' || n >= MAX_SPIDERS) continue;
      const def = SPIDERS[s.kind];
      const x = s.on ? s.x : lerp(s.px, s.x, alpha);
      const z = s.on ? s.z : lerp(s.pz, s.z, alpha);
      d.position.set(x, s.y, z);
      d.rotation.set(0, -s.dir, 0);
      d.scale.setScalar(def.scale * far);
      d.updateMatrix();
      this.spiders.setMatrixAt(n, d.matrix);
      this.anim[n * 2] = s.moveSeed;
      this.anim[n * 2 + 1] = s.moving ? 1 : 0.06;
      n++;
    }
    this.spiders.count = n;
    this.spiders.instanceMatrix.needsUpdate = true;
    this.spiders.geometry.attributes.aAnim.needsUpdate = true;

    let r = 0;
    this.ripples = this.ripples.filter((p) => (p.age += dt / p.life) < 1);
    for (const p of this.ripples) {
      d.position.set(p.x, 0.012, p.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(p.size);
      d.updateMatrix();
      this.rippleMesh.setMatrixAt(r, d.matrix);
      this.ripData[r * 3] = p.age;
      this.ripData[r * 3 + 1] = p.power;
      this.ripData[r * 3 + 2] = p.red;
      r++;
    }
    this.rippleMesh.count = r;
    this.rippleMesh.instanceMatrix.needsUpdate = true;
    this.rippleMesh.geometry.attributes.aRip.needsUpdate = true;

    const b = w.goal;
    this.beacon.visible = !!b;
    if (b) {
      const k = 1 + Math.sin(performance.now() * 0.005) * 0.14;
      this.beacon.position.x = b.x;
      this.beacon.position.z = b.z;
      this.beacon.scale.setScalar(k);
    }

    if (this.markRing.visible) {
      this.markLife -= dt * 1.8;
      this.markRing.material.opacity = Math.max(0, this.markLife);
      this.markRing.scale.setScalar(1 + (1 - this.markLife) * 0.7);
      if (this.markLife <= 0) this.markRing.visible = false;
    }

    const fx = this.stompFx;
    if (fx) {
      fx.t += dt;
      this.shadow.visible = true;
      this.slipper.visible = true;
      this.shadow.position.x = fx.x;
      this.shadow.position.z = fx.z;
      this.slipper.position.x = fx.x;
      this.slipper.position.z = fx.z;
      this.slipper.rotation.y = fx.rot;
      if (!fx.hit) {
        const k = Math.min(1, fx.t / fx.life);
        this.shadow.scale.setScalar(1.7 - k * 0.7);
        this.shadow.material.uniforms.uA.value = k;
        const e = k * k * k * k;
        this.slipper.position.y = lerp(1.9, 0.02, e);
      } else {
        this.slipper.position.y = 0.02;
        this.shadow.material.uniforms.uA.value = Math.max(0, 1 - fx.t / fx.life);
        if (fx.t > fx.life) {
          this.stompFx = null;
          this.shadow.visible = false;
          this.slipper.visible = false;
        }
      }
    }

    const fp = this.flyGeo.attributes.position;
    let fn = 0;
    for (const f of w.flies) {
      if (fn >= 32) break;
      fp.setXYZ(fn++, f.x, f.y, f.z);
    }
    this.flyGeo.setDrawRange(0, fn);
    fp.needsUpdate = true;

    for (const f of this.figures) f.update(dt, alpha);
    this.hero.update(w.hero, dt, alpha);
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
