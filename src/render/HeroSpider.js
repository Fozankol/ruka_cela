import * as THREE from 'three';
import { lerp } from '../core/util.js';
import { CAST_LAYER } from './KeyShadow.js';
import { FAR, lightGLSL, noiseGLSL, shared } from './worldMaterial.js';

const UP = new THREE.Vector3(0, 1, 0);
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();

// Блестящий хитин с тонким ворсом и красными пятнами.
export function chitinMaterial({ red = false, base = 0x050505 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: shared.uMap,
      uMapXform: shared.uMapXform,
      uTime: shared.uTime,
      uCam: shared.uCam,
      uL: shared.uL,
      uLC: shared.uLC,
      uLD: shared.uLD,
      uShadowMap: shared.uShadowMap,
      uShadowMat: shared.uShadowMat,
      uShadowOn: shared.uShadowOn,
      uRed: { value: red ? 1 : 0 },
      uBase: { value: new THREE.Color(base) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vN;
      void main(){
        mat4 m = modelMatrix;
        vec4 wp = m * vec4(position, 1.);
        vPos = wp.xyz;
        vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec4 uMapXform;
      uniform vec3 uCam;
      uniform float uRed;
      uniform vec3 uBase;
      varying vec3 vPos;
      varying vec3 vN;
      ${noiseGLSL}
      ${lightGLSL}
      void main(){
        vec4 m = texture2D(uMap, (vPos.xz - uMapXform.zw) * uMapXform.xy);
        vec3 N = normalize(vN);
        N = normalize(N + (vec3(vnoise(vPos.xz * 220.), vnoise(vPos.zy * 220.), vnoise(vPos.xy * 220.)) - .5) * .035);
        vec3 V = normalize(uCam - vPos);
        float rim = pow(1. - clamp(dot(N, V), 0., 1.), 2.4);
        vec3 spec;
        vec3 direct = gather(vPos, N, V, m, .85, gl_FragCoord.xy, spec);
        vec3 H = normalize(V + vec3(-.4, .8, .4));
        float moonSpec = pow(max(dot(N, H), 0.), 110.);
        vec3 col = uBase * (vec3(.2, .24, .36) + direct * 1.6);
        col += rim * (vec3(.045, .06, .12) + direct * .3);
        col += spec * 1.5 + moonSpec * vec3(.3, .4, .7);
        if (uRed > .5) col = vec3(.5, .012, .008) * (.5 + direct * .9) + vec3(.34, .01, .006) + spec * .6;
        gl_FragColor = vec4(col, clamp(length(uCam - vPos) / ${FAR.toFixed(1)}, 0., 1.));
      }
    `,
  });
}

// Цилиндр длиной 1, который каждый кадр растягивается между двумя точками.
function boneGeo(r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 7, 1);
  g.translate(0, 0.5, 0);
  return g;
}

function place(mesh, a, b) {
  mesh.position.copy(a);
  C.subVectors(b, a);
  const len = Math.max(C.length(), 1e-5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, C.divideScalar(len));
}

// Бойцы чёрные с красным, носильщики светлее: их легко отличить с первого взгляда.
const LOOKS = {
  hero: { base: 0x050505, spots: 10, fang: 1 },
  fighter: { base: 0x060505, spots: 5, fang: 1.5 },
  carrier: { base: 0x6b4a22, spots: 0, fang: 0.6 },
  gnawer: { base: 0x2a1c30, spots: 3, fang: 2.2 },
  widow: { base: 0x040404, spots: 12, fang: 1.8 },
};

const LEGS = [
  { side: 1, ang: 0.68, reach: 1.5, group: 0 },
  { side: 1, ang: 1.22, reach: 1.42, group: 1 },
  { side: 1, ang: 1.86, reach: 1.42, group: 0 },
  { side: 1, ang: 2.42, reach: 1.62, group: 1 },
  { side: -1, ang: 0.68, reach: 1.5, group: 1 },
  { side: -1, ang: 1.22, reach: 1.42, group: 0 },
  { side: -1, ang: 1.86, reach: 1.42, group: 1 },
  { side: -1, ang: 2.42, reach: 1.62, group: 0 },
];

// Главный паук: лапы ставятся на пол по-настоящему и шагают попеременно.
export class HeroSpider {
  constructor(scene, size, kind = 'hero') {
    this.S = size;
    this.kind = kind;
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const look = LOOKS[kind];
    const mat = look.mat ?? (look.mat = chitinMaterial({ base: look.base }));
    const red = look.spot ?? (look.spot = chitinMaterial({ red: true }));
    const S = size;

    const cast = (m) => {
      m.layers.enable(CAST_LAYER);
      return m;
    };

    this.body = new THREE.Group();
    this.root.add(this.body);

    const belly = new THREE.SphereGeometry(1, 30, 22);
    const bp = belly.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const k = 1 + x * -0.14;
      bp.setXYZ(i, x * 0.56 * S, bp.getY(i) * 0.5 * k * S, bp.getZ(i) * 0.47 * k * S);
    }
    belly.computeVertexNormals();
    this.belly = cast(new THREE.Mesh(belly, mat));
    this.belly.position.set(-0.56 * S, 0.08 * S, 0);
    this.body.add(this.belly);

    const spots = [[0.08, 0.47, 0, 0.09], [-0.14, 0.46, 0.09, 0.075], [-0.14, 0.46, -0.09, 0.075], [-0.32, 0.38, 0, 0.1], [0.24, 0.42, 0.09, 0.06], [0.24, 0.42, -0.09, 0.06], [-0.02, 0.34, 0.3, 0.06], [-0.02, 0.34, -0.3, 0.06], [-0.26, 0.28, 0.28, 0.055], [-0.26, 0.28, -0.28, 0.055]];
    for (const [x, y, z, r] of spots.slice(0, look.spots)) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r * S, 10, 8), red);
      s.scale.y = 0.45;
      s.position.set(x * S, y * S, z * S);
      this.belly.add(s);
    }

    const head = new THREE.SphereGeometry(1, 20, 14);
    head.scale(0.3 * S, 0.21 * S, 0.25 * S);
    this.head = cast(new THREE.Mesh(head, mat));
    this.head.position.set(0, 0, 0);
    this.body.add(this.head);

    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const fang = cast(new THREE.Mesh(new THREE.ConeGeometry(0.05 * S * look.fang, 0.2 * S * look.fang, 7), mat));
      fang.position.set(0.3 * S, -0.1 * S, side * 0.07 * S);
      fang.rotation.z = 2.5;
      this.body.add(fang);
    }

    if (kind === 'carrier') {
      const sac = new THREE.SphereGeometry(0.42 * S, 14, 10);
      this.sac = new THREE.Mesh(sac, look.sac ?? (look.sac = chitinMaterial({ base: 0xd8c690 })));
      this.sac.position.set(-0.5 * S, 0.62 * S, 0);
      this.sac.layers.enable(CAST_LAYER);
      this.sac.visible = false;
      this.body.add(this.sac);
    }

    this.legs = LEGS.map((def) => {
      const hip = new THREE.Vector3();
      const foot = new THREE.Vector3();
      const femur = cast(new THREE.Mesh(boneGeo(0.042 * S, 0.034 * S), mat));
      const tibia = cast(new THREE.Mesh(boneGeo(0.034 * S, 0.024 * S), mat));
      const tarsus = cast(new THREE.Mesh(boneGeo(0.024 * S, 0.006 * S), mat));
      this.root.add(femur, tibia, tarsus);
      return { ...def, hip, foot, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, femur, tibia, tarsus, ready: false };
    });

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.bob = 0;
    this.sway = 0;
    this.vx = 0;
    this.vz = 0;
    this.tap = 0;
    this.visible = false;
  }

  restPoint(leg, out) {
    const a = this.yaw + leg.ang * leg.side;
    const r = leg.reach * this.S;
    out.set(this.pos.x + Math.cos(a) * r, this.base, this.pos.z + Math.sin(a) * r);
    return out;
  }

  update(s, dt, alpha) {
    const show = !!s && !s.hidden;
    this.root.visible = show;
    if (!show) {
      this.visible = false;
      return;
    }
    const x = s.on ? s.x : lerp(s.px, s.x, alpha);
    const z = s.on ? s.z : lerp(s.pz, s.z, alpha);
    this.base = s.y;
    if (this.sac) this.sac.visible = s.load > 0;
    const moved = Math.hypot(x - this.pos.x, z - this.pos.z);
    const velX = dt > 0 ? (x - this.pos.x) / dt : 0;
    const velZ = dt > 0 ? (z - this.pos.z) / dt : 0;
    this.pos.set(x, 0, z);
    let da = (s.dir - this.yaw) % (Math.PI * 2);
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    this.yaw += da * Math.min(1, dt * 13);

    const S = this.S;
    const speedNow = moved / Math.max(dt, 0.001);
    this.sway = lerp(this.sway, da * 0.4, 0.1);
    this.bob += dt * (3 + speedNow * 16);
    const y = s.y + S * (0.5 + Math.sin(this.bob) * (speedNow > 0.1 ? 0.025 : 0.008));

    this.body.position.set(x, y, z);
    this.body.rotation.set(0, -this.yaw, 0);
    this.belly.rotation.y = -this.sway;
    this.belly.rotation.z = Math.sin(this.bob * 0.5) * 0.04;

    if (!this.visible) {
      for (const leg of this.legs) {
        this.restPoint(leg, leg.foot);
        leg.t = 1;
      }
      this.visible = true;
    }

    // Лапы переставляются двумя группами, как у настоящих пауков.
    this.vx = lerp(this.vx, velX, 0.25);
    this.vz = lerp(this.vz, velZ, 0.25);
    const speed = Math.min(1.5, Math.hypot(this.vx, this.vz));
    const stride = S * (0.26 + speed * 0.2);
    const stepTime = 0.1 - speed * 0.025;
    const lead = stepTime * 1.3;
    const busy = [false, false];
    for (const leg of this.legs) if (leg.t < 1) busy[leg.group] = true;
    for (const leg of this.legs) {
      this.restPoint(leg, A);
      A.x += this.vx * lead;
      A.z += this.vz * lead;
      if (leg.t < 1) {
        // Цель шага едет вместе с телом, поэтому лапа не отстаёт.
        leg.to.copy(A);
        leg.t = Math.min(1, leg.t + dt / stepTime);
        leg.foot.lerpVectors(leg.from, leg.to, leg.t);
        leg.foot.y = s.y + Math.sin(leg.t * Math.PI) * S * 0.28;
      } else {
        leg.foot.y = s.y;
        const off = Math.hypot(A.x - leg.foot.x, A.z - leg.foot.z);
        if (off > stride && (!busy[1 - leg.group] || off > stride * 1.6)) {
          leg.from.copy(leg.foot);
          leg.t = 0;
          busy[leg.group] = true;
        }
      }
      // Ступня никогда не уходит дальше длины лапы.
      const fx = leg.foot.x - x;
      const fz = leg.foot.z - z;
      const fd = Math.hypot(fx, fz);
      const maxReach = S * 1.72;
      if (fd > maxReach) {
        leg.foot.x = x + (fx / fd) * maxReach;
        leg.foot.z = z + (fz / fd) * maxReach;
      }
      this.placeLeg(leg, y);
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => o.geometry?.dispose());
  }

  placeLeg(leg, y) {
    const S = this.S;
    const a = this.yaw + leg.ang * leg.side;
    leg.hip.set(this.pos.x + Math.cos(this.yaw) * 0.08 * S + Math.cos(a) * 0.18 * S, y + 0.02 * S, this.pos.z + Math.sin(this.yaw) * 0.08 * S + Math.sin(a) * 0.18 * S);
    const ankle = new THREE.Vector3(leg.foot.x - Math.cos(a) * 0.14 * S, leg.foot.y + 0.3 * S, leg.foot.z - Math.sin(a) * 0.14 * S);
    const L1 = 0.8 * S;
    const L2 = 0.7 * S;
    const dir = new THREE.Vector3().subVectors(ankle, leg.hip);
    const full = Math.max(0.001, dir.length());
    dir.divideScalar(full);
    const d = Math.min(full, L1 + L2 - 0.001);
    if (d < full) ankle.copy(leg.hip).addScaledVector(dir, d);
    const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const lift = Math.sqrt(Math.max(L1 * L1 - along * along, 0));
    const side = B.copy(UP).addScaledVector(dir, -UP.dot(dir)).normalize();
    const knee = new THREE.Vector3().copy(leg.hip).addScaledVector(dir, along).addScaledVector(side, lift);
    place(leg.femur, leg.hip, knee);
    place(leg.tibia, knee, ankle);
    place(leg.tarsus, ankle, leg.foot);
  }
}
