import * as THREE from 'three';
import { lerp } from '../core/util.js';
import { worldMaterial } from './worldMaterial.js';

function limb(mat, r, len) {
  const g = new THREE.CapsuleGeometry(r, len, 3, 8);
  g.translate(0, -len / 2, 0);
  return new THREE.Mesh(g, mat);
}

// Человек из капсул. В темноте важнее силуэт и движение, чем детали.
export class Figure {
  constructor(h, scene) {
    this.h = h;
    this.root = new THREE.Group();
    scene.add(this.root);
    const s = h.height / 1.8;
    this.s = s;
    this.mat = worldMaterial({ color: h.tint });
    this.skin = worldMaterial({ color: 0xc2967c });
    const add = (m, parent = this.root) => {
      parent.add(m);
      return m;
    };

    const torsoGeo = new THREE.CapsuleGeometry(0.17 * s, 0.46 * s, 4, 10);
    torsoGeo.scale(1.1, 1, 0.72);
    const torso = add(new THREE.Mesh(torsoGeo, this.mat));
    torso.position.y = 1.13 * s;
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.115 * s, 14, 10), this.skin));
    head.position.y = 1.62 * s;
    head.scale.set(0.92, 1.08, 1);
    this.head = head;

    this.hipL = add(new THREE.Group());
    this.hipR = add(new THREE.Group());
    this.hipL.position.set(0.1 * s, 0.86 * s, 0);
    this.hipR.position.set(-0.1 * s, 0.86 * s, 0);
    this.legL = limb(this.mat, 0.075 * s, 0.38 * s);
    this.legR = limb(this.mat, 0.075 * s, 0.38 * s);
    this.hipL.add(this.legL);
    this.hipR.add(this.legR);
    this.kneeL = new THREE.Group();
    this.kneeR = new THREE.Group();
    this.kneeL.position.y = -0.4 * s;
    this.kneeR.position.y = -0.4 * s;
    this.hipL.add(this.kneeL);
    this.hipR.add(this.kneeR);
    this.kneeL.add(limb(this.mat, 0.065 * s, 0.36 * s));
    this.kneeR.add(limb(this.mat, 0.065 * s, 0.36 * s));

    this.shoL = add(new THREE.Group());
    this.shoR = add(new THREE.Group());
    this.shoL.position.set(0.24 * s, 1.42 * s, 0);
    this.shoR.position.set(-0.24 * s, 1.42 * s, 0);
    this.shoL.add(limb(this.mat, 0.055 * s, 0.26 * s));
    this.shoR.add(limb(this.mat, 0.055 * s, 0.26 * s));
    this.elbL = new THREE.Group();
    this.elbR = new THREE.Group();
    this.elbL.position.y = -0.3 * s;
    this.elbR.position.y = -0.3 * s;
    this.shoL.add(this.elbL);
    this.shoR.add(this.elbR);
    this.elbL.add(limb(this.skin, 0.045 * s, 0.25 * s));
    this.elbR.add(limb(this.skin, 0.045 * s, 0.25 * s));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s, 10, 8), this.skin);
    hand.position.y = -0.3 * s;
    hand.scale.set(1, 1.3, 0.6);
    this.elbL.add(hand);
    this.handL = hand;
    const handR = hand.clone();
    this.elbR.add(handR);
    // Пальцы заметны только вблизи, но в первой сцене камера стоит вплотную к руке.
    for (const [ox, len] of [[-0.036, 0.075], [-0.012, 0.09], [0.012, 0.085], [0.034, 0.066]]) {
      const f = limb(this.skin, 0.0105 * s, len * s);
      f.position.set(ox * s, -0.36 * s, 0);
      f.rotation.x = 0.35;
      this.elbL.add(f);
    }
    const thumb = limb(this.skin, 0.012 * s, 0.05 * s);
    thumb.position.set(0.055 * s, -0.31 * s, 0.01);
    thumb.rotation.z = 0.7;
    this.elbL.add(thumb);

    this.phase = 0;
  }

  update(dt, alpha) {
    const h = this.h;
    const x = lerp(h.px, h.x, alpha);
    const z = lerp(h.pz, h.z, alpha);
    const lie = h.lie * h.lie * (3 - 2 * h.lie);

    this.root.visible = h.fade > 0.01 && h.state !== 'cocoon' && h.state !== 'gone';
    this.mat.uniforms.uFade.value = h.fade;
    this.skin.uniforms.uFade.value = h.fade;

    this.root.position.set(x, lerp(0, h.bedY ?? 0, lie), z);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.x = -Math.PI / 2 * lie;
    this.root.rotation.y = (Math.PI / 2 - h.dir) * (1 - lie);

    if (h.moving) this.phase += dt * h.speed * 6.5;
    const sw = h.moving ? Math.sin(this.phase) * 0.62 : 0;
    const lift = (1 - lie);
    this.hipL.rotation.x = lerp(this.hipL.rotation.x, sw * lift, 0.3);
    this.hipR.rotation.x = lerp(this.hipR.rotation.x, -sw * lift, 0.3);
    this.kneeL.rotation.x = Math.max(0, -sw) * 0.9 * lift;
    this.kneeR.rotation.x = Math.max(0, sw) * 0.9 * lift;

    const breathe = Math.sin(performance.now() * 0.0012 + h.x) * 0.012;
    this.head.position.y = 1.62 * this.s + breathe * lie;

    this.shoL.rotation.set(-sw * 0.6 * lift, 0, 0.1 * lift);
    this.shoR.rotation.set(sw * 0.6 * lift - h.swing * 2.4, 0, -0.1 * lift);
    this.elbL.rotation.x = -0.25 * lift;
    this.elbR.rotation.x = -0.25 * lift - h.swing * 0.5;

    // Рука отца свисает с кровати. Ради неё всё и началось.
    if (h.danglingArm && lie > 0.02) {
      const jerk = h.jerk;
      this.shoL.rotation.x = lerp(this.shoL.rotation.x, Math.PI / 2 - jerk * 1.4, lie);
      this.shoL.rotation.z = lerp(this.shoL.rotation.z, 0.04 + jerk * 0.5, lie);
      this.elbL.rotation.x = lerp(this.elbL.rotation.x, -0.42 + Math.sin(performance.now() * 0.0009) * 0.03, lie);
    }
  }

  dispose(scene) {
    scene.remove(this.root);
    this.root.traverse((o) => o.geometry?.dispose());
    this.mat.dispose();
    this.skin.dispose();
  }
}
