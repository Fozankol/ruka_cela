import * as THREE from 'three';
import { lerp } from '../core/util.js';
import { SPIDERS } from '../sim/world.js';
import { Figure } from './Figure.js';
import { HeroSpider } from './HeroSpider.js';
import { CAST_LAYER } from './KeyShadow.js';
import { additive, worldMaterial } from './worldMaterial.js';

const MAX_RIPPLES = 96;

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
        float e1 = (d - age * .94) / (.035 + age * .03);
        float e2 = (d - age * .62) / .03;
        float ring = exp(-e1 * e1);
        float ring2 = exp(-e2 * e2) * .45;
        float a = (ring + ring2) * (1. - age) * (1. - age) * vRip.y * (1. - smoothstep(.9, 1., d));
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
    const raw = world.bus;
    this.subs = [];
    const bus = { on: (n, f) => this.subs.push(raw.on(n, f)) };
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const dummy = new THREE.Object3D();
    this.dummy = dummy;

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
        fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float d = length(vUv); gl_FragColor = vec4(.0, .0, .0, uA * (1. - smoothstep(.55, 1., d)) * .92); }',
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
    this.flies = new THREE.Points(this.flyGeo, new THREE.PointsMaterial({ color: new THREE.Color(1.3, 1.25, 0.8), size: 0.03, sizeAttenuation: true }));
    this.flies.frustumCulled = false;
    this.group.add(this.flies);

    this.figures = world.humans.map((h) => new Figure(h, this.group));
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

    bus.on('ripple', (r) => this.addRipple(r));
    bus.on('slipper', (e) => this.onSlipper(e));
    bus.on('human', (e) => e.event === 'cocoon' && this.addCocoon(e.h));
    bus.on('nest', (n) => this.addNest(n));
    bus.on('nestGone', (n) => {
      const e = this.nestMeshes.find((x) => x.nest === n);
      if (!e) return;
      this.group.remove(e.m);
      this.nestMeshes = this.nestMeshes.filter((x) => x !== e);
    });
    this.slipper.scale.setScalar(world.unitK);
    bus.on('mark', (m) => this.showMark(m, false));
    bus.on('order', (o) => this.showMark(o, o.attack));
    this.treatGeo = new THREE.SphereGeometry(0.075, 14, 10);
    this.treatRing = new THREE.RingGeometry(0.2, 0.235, 32);
    this.treatRing.rotateX(-Math.PI / 2);
    this.treatMeshes = new Map();
    bus.on('treat', (t) => this.addTreat(t));
    bus.on('treatGone', (t) => this.removeTreat(t));
    this.shelterRings = world.level.shelters.map((c) => {
      const m = new THREE.Mesh(this.treatRing, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.7, 0.7), ...additive, depthTest: false }));
      m.position.set(c.x, 0.03, c.z);
      m.scale.setScalar(1.5 * world.unitK);
      m.renderOrder = 6;
      m.visible = false;
      this.group.add(m);
      return m;
    });
    this.alarmRings = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(this.treatRing, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.25, 0.15), ...additive, depthTest: false }));
      m.position.y = 0.04;
      m.renderOrder = 8;
      m.visible = false;
      this.group.add(m);
      return m;
    });
    this.targetRings = Array.from({ length: 22 }, () => {
      const m = new THREE.Mesh(this.treatRing, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.5), ...additive, depthTest: false }));
      m.position.y = 0.04;
      m.renderOrder = 7;
      m.visible = false;
      this.group.add(m);
      return m;
    });
    const circle = new THREE.RingGeometry(0.965, 1, 72);
    circle.rotateX(-Math.PI / 2);
    this.circleRings = Array.from({ length: 6 }, () => {
      const m = new THREE.Mesh(circle, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), ...additive, depthTest: false }));
      m.position.y = 0.05;
      m.renderOrder = 7;
      m.visible = false;
      this.group.add(m);
      return m;
    });
    const cloudGeo = new THREE.CircleGeometry(1, 32);
    cloudGeo.rotateX(-Math.PI / 2);
    this.cloudDiscs = Array.from({ length: 3 }, () => {
      const m = new THREE.Mesh(
        cloudGeo,
        new THREE.ShaderMaterial({
          ...additive,
          depthTest: false,
          uniforms: { uT: { value: 0 } },
          vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
          fragmentShader: 'uniform float uT; varying vec2 vP; void main(){ float d = length(vP); float n = .75 + .25 * sin(vP.x * 9. + uT * 2.) * sin(vP.y * 8. - uT * 1.6); float a = (1. - smoothstep(.2, 1., d)) * n; gl_FragColor = vec4(vec3(.45, 1.5, .4) * a * .55, 1.); }',
        }),
      );
      m.position.y = 0.06;
      m.renderOrder = 6;
      m.visible = false;
      this.group.add(m);
      return m;
    });
    this.dogMat = worldMaterial({ color: 0x7a5c44 });
    this.dogs = new Map();
    this.rigs = new Map();
    bus.on('spiderDead', (s) => {
      this.rigs.get(s)?.dispose();
      this.rigs.delete(s);
    });
  }

  addDog(d) {
    const k = this.world.unitK * 0.55;
    const root = new THREE.Group();
    const part = (w, h, l, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * k, h * k, l * k), this.dogMat);
      m.position.set(x * k, y * k, 0);
      m.layers.enable(CAST_LAYER);
      root.add(m);
      return m;
    };
    part(1, 0.42, 0.34, 0, 0.62);
    part(0.34, 0.34, 0.3, 0.6, 0.86);
    part(0.3, 0.14, 0.2, 0.84, 0.8);
    part(0.42, 0.08, 0.08, -0.66, 0.84);
    const legs = [
      [0.36, 0.12],
      [0.36, -0.12],
      [-0.36, 0.12],
      [-0.36, -0.12],
    ].map(([x, z]) => {
      const m = part(0.11, 0.46, 0.11, x, 0.23);
      m.position.z = z * k;
      return m;
    });
    this.group.add(root);
    const e = { root, legs };
    this.dogs.set(d, e);
    return e;
  }

  addTreat(t) {
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.userData.k = this.world.unitK;
    const ball = new THREE.Mesh(this.treatGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...t.color) }));
    ball.position.y = 0.1;
    const ring = new THREE.Mesh(this.treatRing, new THREE.MeshBasicMaterial({ color: new THREE.Color(...t.color), ...additive, depthTest: false, opacity: 0.8 }));
    ring.position.y = 0.03;
    ring.renderOrder = 6;
    g.add(ball, ring);
    this.group.add(g);
    this.treatMeshes.set(t, { g, ball, ring, born: performance.now() });
  }

  removeTreat(t) {
    const m = this.treatMeshes.get(t);
    if (!m) return;
    this.group.remove(m.g);
    m.ball.material.dispose();
    m.ring.material.dispose();
    this.treatMeshes.delete(t);
  }

  showMark(m, attack) {
    this.markRing.position.x = m.x;
    this.markRing.position.z = m.z;
    this.markRing.visible = true;
    this.markRing.material.color.setRGB(attack ? 3 : 1.2, attack ? 0.3 : 1.7, attack ? 0.2 : 1.2);
    this.markLife = 1;
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
      const w = (0.27 * h.height) / 1.8;
      m.position.set(h.x, h.height * 0.46, h.z);
      m.scale.set(w, h.height * 0.52, w);
    }
    this.group.add(m);
    this.cocoonMeshes.push(m);
    this.addRipple({ x: h.x, z: h.z, power: 1, kind: 'bite' });
  }

  addNest(nest) {
    const m = new THREE.Mesh(this.cocoonGeo, this.nestMat);
    m.position.set(nest.x, 0.05, nest.z);
    m.layers.enable(CAST_LAYER);
    this.group.add(m);
    this.nestMeshes.push({ m, nest });
  }

  update(dt, alpha) {
    const w = this.world;
    const d = this.dummy;
    for (const s of w.spiders) {
      let rig = this.rigs.get(s);
      if (!rig) {
        rig = new HeroSpider(this.group, SPIDERS[s.kind].scale * w.unitK, s.kind);
        this.rigs.set(s, rig);
      }
      rig.update(s, dt, alpha);
    }

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
        this.shadow.scale.setScalar((1.7 - k * 0.7) * w.unitK);
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

    for (const { m, nest } of this.nestMeshes) {
      const k = (0.7 + (Math.min(w.food, 100) / 100) * 0.7) * w.unitK;
      const beat = nest.queue.length ? 1 + Math.sin(performance.now() * 0.006) * 0.05 : 1;
      m.scale.set(0.2 * k * beat, 0.11 * k * beat, 0.16 * k * beat);
    }

    const now = performance.now();
    for (const [t, m] of this.treatMeshes) {
      const grow = Math.min(1, (now - m.born) / 300);
      const busy = t.worker || t.queued;
      m.ball.position.y = 0.1 + Math.sin(now * 0.004 + t.x) * 0.025;
      m.g.scale.setScalar(grow * m.g.userData.k);
      m.ring.scale.setScalar(busy ? 0.75 : 1 + Math.sin(now * 0.005 + t.z) * 0.1);
      if (busy) m.ring.material.color.setRGB(0.3, 1.8, 0.7);
      else m.ring.material.color.setRGB(...t.color);
      m.ring.visible = !w.alarmOn && !t.locked;
      if (t.locked) m.ball.material.color.setRGB(0.05, 0.05, 0.07);
      else m.ball.material.color.setRGB(...t.color);
    }

    const targets = w.script?.targets?.() ?? [];
    this.targetRings.forEach((r, i) => {
      const t = targets[i];
      r.visible = !!t;
      if (!t) return;
      r.position.x = t.x;
      r.position.z = t.z;
      r.material.color.setRGB(...(t.small ? [3.6, 0.9, 0.5] : t.hot ? [4, 0.3, 0.2] : t.busy ? [0.3, 1.8, 0.7] : [3, 2.2, 0.5]));
      r.scale.setScalar((t.small ? 0.9 : t.hot ? 3.4 : 1.7 + Math.sin(now * 0.005 + i) * 0.2) * w.unitK);
    });
    const circles = w.script?.circles?.() ?? [];
    this.circleRings.forEach((r, i) => {
      const c = circles[i];
      r.visible = !!c;
      if (!c) return;
      r.position.x = c.x;
      r.position.z = c.z;
      r.scale.setScalar(c.r);
      r.material.color.setRGB(...(c.hot ? [2.4, 0.25, 0.16] : [0.5, 0.5, 0.4]));
    });
    const clouds = w.script?.clouds?.() ?? [];
    this.cloudDiscs.forEach((m, i) => {
      const c = clouds[i];
      m.visible = !!c;
      if (!c) return;
      m.position.x = c.x;
      m.position.z = c.z;
      m.scale.setScalar(c.r);
      m.material.uniforms.uT.value = now * 0.001;
    });
    for (const d of w.dogs) {
      const e = this.dogs.get(d) ?? this.addDog(d);
      e.root.visible = !d.down;
      e.root.position.set(d.x, 0, d.z);
      e.root.rotation.y = -d.dir;
      e.legs.forEach((m, i) => {
        m.rotation.z = d.moving ? Math.sin(now * 0.016 + i * 2.1) * 0.5 : 0;
      });
    }
    for (const r of this.shelterRings) r.visible = w.alarmOn;
    const marks = w.alarmOn ? w.exposedMarks() : [];
    this.alarmRings.forEach((r, i) => {
      const m = marks[i];
      r.visible = !!m;
      if (!m) return;
      r.position.x = m.x;
      r.position.z = m.z;
      r.scale.setScalar((2.1 + Math.sin(now * 0.016) * 0.5) * w.unitK);
    });

    for (const f of this.figures) f.update(dt, alpha);
  }

  dispose() {
    for (const off of this.subs) off();
    this.scene.remove(this.group);
  }
}
