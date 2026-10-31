import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { lerp } from '../core/util.js';
import { CAST_LAYER } from './KeyShadow.js';
import { MAT } from './textures.js';
import { worldMaterial } from './worldMaterial.js';

// Тело вращения по профилю. Профиль задаётся сверху вниз, ось Y вверх.
function lathe(profile, s, flat = 1, seg = 14) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r * s, y * s)).reverse();
  const g = new THREE.LatheGeometry(pts, seg);
  g.scale(1, 1, flat);
  g.computeVertexNormals();
  return g;
}

const UPPER_ARM = [[0.001, 0.02], [0.05, 0.01], [0.056, -0.05], [0.05, -0.16], [0.042, -0.27], [0.04, -0.3], [0.001, -0.32]];
const FOREARM = [[0.001, 0.02], [0.04, 0.01], [0.043, -0.07], [0.036, -0.17], [0.027, -0.26], [0.026, -0.28], [0.001, -0.3]];
const THIGH = [[0.001, 0.05], [0.085, 0.03], [0.092, -0.08], [0.076, -0.26], [0.058, -0.38], [0.055, -0.41], [0.001, -0.43]];
const CALF = [[0.001, 0.02], [0.055, 0.01], [0.064, -0.09], [0.054, -0.2], [0.037, -0.34], [0.036, -0.37], [0.001, -0.39]];
const TORSO = [[0.001, 0.8], [0.13, 0.82], [0.168, 0.91], [0.158, 1.0], [0.138, 1.09], [0.152, 1.2], [0.188, 1.33], [0.198, 1.39], [0.158, 1.45], [0.075, 1.49], [0.056, 1.53], [0.001, 1.55]];

export class Figure {
  constructor(h, scene) {
    this.h = h;
    this.root = new THREE.Group();
    scene.add(this.root);
    const s = h.height / 1.8;
    this.s = s;
    this.mat = worldMaterial({ color: h.tint, mat: MAT.FABRIC });
    this.pants = worldMaterial({ color: h.pants ?? 0x33384a, mat: MAT.FABRIC });
    this.skin = worldMaterial({ color: h.skin ?? 0xb98a70, skin: true });
    this.hair = worldMaterial({ color: h.hair ?? 0x1c1612 });

    const m = (geo, mat, parent = this.root) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.layers.enable(CAST_LAYER);
      parent.add(mesh);
      return mesh;
    };

    m(lathe(TORSO, s, 0.64, 18), this.mat);

    const head = new THREE.Group();
    head.position.y = 1.64 * s;
    this.root.add(head);
    this.head = head;
    const skull = new THREE.SphereGeometry(0.105 * s, 22, 16);
    skull.scale(0.88, 1.12, 1);
    m(skull, this.skin, head);
    const jaw = new THREE.SphereGeometry(0.07 * s, 16, 12);
    jaw.scale(0.86, 0.72, 0.94);
    m(jaw, this.skin, head).position.set(0, -0.075 * s, 0.022 * s);
    const nose = new THREE.ConeGeometry(0.016 * s, 0.05 * s, 8);
    m(nose, this.skin, head).position.set(0, -0.01 * s, 0.105 * s);
    head.children[head.children.length - 1].rotation.x = 1.2;
    for (const k of [-1, 1]) {
      const ear = new THREE.SphereGeometry(0.024 * s, 10, 8);
      ear.scale(0.5, 1.1, 0.8);
      m(ear, this.skin, head).position.set(k * 0.094 * s, -0.005 * s, -0.005 * s);
    }
    const cap = new THREE.SphereGeometry(0.113 * s, 22, 14, 0, Math.PI * 2, 0, 1.75);
    cap.scale(0.9, 1.1, 1.02);
    m(cap, this.hair, head).position.set(0, 0.012 * s, -0.012 * s);
    if (h.longHair) {
      const back = new THREE.SphereGeometry(0.11 * s, 16, 12);
      back.scale(0.95, 1.7, 0.6);
      m(back, this.hair, head).position.set(0, -0.14 * s, -0.08 * s);
    }

    const leg = (x) => {
      const hip = new THREE.Group();
      hip.position.set(x * s, 0.87 * s, 0);
      this.root.add(hip);
      m(lathe(THIGH, s), this.pants, hip);
      const knee = new THREE.Group();
      knee.position.y = -0.41 * s;
      hip.add(knee);
      m(lathe(CALF, s), this.pants, knee);
      const foot = new RoundedBoxGeometry(0.09 * s, 0.06 * s, 0.25 * s, 3, 0.028 * s);
      m(foot, this.skin, knee).position.set(0, -0.39 * s, 0.07 * s);
      return { hip, knee };
    };
    const L = leg(0.095);
    const R = leg(-0.095);
    this.hipL = L.hip;
    this.kneeL = L.knee;
    this.hipR = R.hip;
    this.kneeR = R.knee;

    const arm = (x) => {
      const sho = new THREE.Group();
      sho.position.set(x * s, 1.4 * s, 0);
      this.root.add(sho);
      m(lathe(UPPER_ARM, s), this.mat, sho);
      const elb = new THREE.Group();
      elb.position.y = -0.3 * s;
      sho.add(elb);
      m(lathe(FOREARM, s), this.skin, elb);
      this.hand(elb, s, m);
      return { sho, elb };
    };
    const AL = arm(0.225);
    const AR = arm(-0.225);
    this.shoL = AL.sho;
    this.elbL = AL.elb;
    this.shoR = AR.sho;
    this.elbR = AR.elb;

    this.phase = 0;
  }

  // Ладонь и пальцы из двух фаланг. Рука отца снята крупным планом в первой сцене.
  hand(elb, s, m) {
    const base = new THREE.Group();
    base.position.y = -0.29 * s;
    elb.add(base);
    const palm = new RoundedBoxGeometry(0.082 * s, 0.095 * s, 0.03 * s, 3, 0.013 * s);
    m(palm, this.skin, base).position.y = -0.04 * s;
    const finger = (x, len) => {
      const a = new THREE.Group();
      a.position.set(x * s, -0.085 * s, 0);
      a.rotation.x = 0.32;
      base.add(a);
      m(new THREE.CapsuleGeometry(0.0098 * s, len * 0.52 * s, 3, 8), this.skin, a).position.y = -len * 0.3 * s;
      const b = new THREE.Group();
      b.position.y = -len * 0.58 * s;
      b.rotation.x = 0.38;
      a.add(b);
      m(new THREE.CapsuleGeometry(0.0088 * s, len * 0.38 * s, 3, 8), this.skin, b).position.y = -len * 0.22 * s;
    };
    finger(-0.03, 0.078);
    finger(-0.01, 0.092);
    finger(0.011, 0.086);
    finger(0.03, 0.066);
    const th = m(new THREE.CapsuleGeometry(0.0115 * s, 0.038 * s, 3, 8), this.skin, base);
    th.position.set(0.05 * s, -0.04 * s, 0.006 * s);
    th.rotation.z = 0.62;
  }

  update(dt, alpha) {
    const h = this.h;
    const x = lerp(h.px, h.x, alpha);
    const z = lerp(h.pz, h.z, alpha);
    const lie = h.lie * h.lie * (3 - 2 * h.lie);

    this.root.visible = h.fade > 0.01 && h.state !== 'cocoon' && h.state !== 'gone';
    for (const mat of [this.mat, this.pants, this.skin, this.hair]) mat.uniforms.uFade.value = h.fade;

    this.root.position.set(x, lerp(0, h.bedY ?? 0, lie), z);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.x = -Math.PI / 2 * lie;
    this.root.rotation.y = (Math.PI / 2 - h.dir) * (1 - lie);

    if (h.moving) this.phase += dt * h.speed * 6.5;
    const sw = h.moving ? Math.sin(this.phase) * 0.58 : 0;
    const lift = 1 - lie;
    this.hipL.rotation.x = lerp(this.hipL.rotation.x, sw * lift, 0.3);
    this.hipR.rotation.x = lerp(this.hipR.rotation.x, -sw * lift, 0.3);
    this.kneeL.rotation.x = Math.max(0, -sw) * 0.9 * lift;
    this.kneeR.rotation.x = Math.max(0, sw) * 0.9 * lift;

    const breathe = Math.sin(performance.now() * 0.0012 + h.x) * 0.006;
    this.head.position.y = 1.64 * this.s + breathe * lie;

    this.shoL.rotation.set(-sw * 0.5 * lift, 0, 0.1 * lift);
    this.shoR.rotation.set(sw * 0.5 * lift - h.swing * 2.4, 0, -0.1 * lift);
    this.elbL.rotation.x = -0.25 * lift;
    this.elbL.rotation.z = 0;
    this.elbR.rotation.x = -0.25 * lift - h.swing * 0.5;

    // Рука отца свисает с кровати. Ради неё всё и началось.
    if (h.danglingArm && lie > 0.02) {
      const jerk = h.jerk;
      this.shoL.rotation.x = lerp(this.shoL.rotation.x, Math.PI / 2 - jerk * 1.4, lie);
      this.shoL.rotation.z = lerp(this.shoL.rotation.z, 0.9 + jerk * 0.5, lie);
      this.elbL.rotation.x = lerp(this.elbL.rotation.x, -0.1 + Math.sin(performance.now() * 0.0009) * 0.03, lie);
      this.elbL.rotation.z = lerp(0, -0.1, lie);
    }
  }

  dispose(scene) {
    scene.remove(this.root);
    this.root.traverse((o) => o.geometry?.dispose());
    for (const mat of [this.mat, this.pants, this.skin, this.hair]) mat.dispose();
  }
}
