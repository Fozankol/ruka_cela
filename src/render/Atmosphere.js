import * as THREE from 'three';
import { noiseGLSL, additive, shared } from './worldMaterial.js';

const DUST = 420;

function dustMaterial() {
  return new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uMap: shared.uMap, uMapXform: shared.uMapXform, uTime: shared.uTime, uCenter: { value: new THREE.Vector3() }, uBox: { value: 3 } },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      uniform sampler2D uMap;
      uniform vec4 uMapXform;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform float uBox;
      varying float vA;
      varying vec3 vC;
      void main(){
        vec3 s = aSeed;
        vec3 p = vec3(
          s.x + sin(uTime * .13 + s.y * 7.) * .05,
          s.y + uTime * .012 * (.5 + s.z) + sin(uTime * .2 + s.x * 9.) * .03,
          s.z + cos(uTime * .11 + s.y * 5.) * .05
        );
        p = mod(p, 1.) - .5;
        vec3 wp = uCenter + p * vec3(uBox, uBox * .7, uBox);
        wp.y = abs(wp.y - uCenter.y + uBox * .35) + .03;
        vec4 m = texture2D(uMap, (wp.xz - uMapXform.zw) * uMapXform.xy);
        vC = vec3(1., .72, .42) * m.r + vec3(.6, .76, 1.1) * m.b;
        vA = min(1., (m.r + m.b) * 2.2);
        vec4 mv = viewMatrix * vec4(wp, 1.);
        gl_PointSize = clamp(9. / -mv.z, 1., 7.);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying vec3 vC;
      void main(){
        float d = length(gl_PointCoord - .5) * 2.;
        float a = (1. - smoothstep(.2, 1., d)) * vA * .34;
        gl_FragColor = vec4(vC * 2.2, a);
      }
    `,
  });
}

function beamMaterial(color, strength) {
  return new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.);
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      varying vec3 vPos;
      ${noiseGLSL}
      void main(){
        float edge = smoothstep(0., .22, vUv.x) * (1. - smoothstep(.78, 1., vUv.x));
        float along = pow(clamp(1. - vUv.y, 0., 1.), 1.5);
        float n = fbm(vPos.xz * 2.2 + vec2(uTime * .05, vPos.y * 1.3)) * .7 + .4;
        gl_FragColor = vec4(uColor, edge * along * n * uStrength);
      }
    `,
  });
}

// Лунные столбы из окон.
function moonShaft(win, floorX, floorZ, matCache) {
  const top = 1.05;
  const low = 0.52;
  const g = new THREE.BufferGeometry();
  const wx0 = win.x;
  const wx1 = win.x + win.w;
  const wz = win.z + win.d / 2;
  const pos = [
    wx0, top, wz,
    wx1, top, wz,
    wx0 + floorX, 0.01, wz + floorZ,
    wx1 + floorX, 0.01, wz + floorZ,
    wx0, low, wz,
    wx1, low, wz,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1, 0, 0.2, 1, 0.2], 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  return new THREE.Mesh(g, matCache);
}

function torchCone() {
  const g = new THREE.ConeGeometry(0.95, 2.6, 24, 1, true);
  g.translate(0, -1.3, 0);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0);
  const m = new THREE.ShaderMaterial({
    ...additive,
    side: THREE.DoubleSide,
    uniforms: { uCam: shared.uCam, uTime: shared.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vPos;
      varying float vL;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.);
        vPos = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vL = clamp(-position.z / 2.6, 0., 1.);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCam;
      varying vec3 vN;
      varying vec3 vPos;
      varying float vL;
      void main(){
        vec3 V = normalize(uCam - vPos);
        float facing = pow(abs(dot(normalize(vN), V)), 3.2);
        float a = facing * pow(clamp(1. - vL, 0., 1.), 2.4) * .13;
        gl_FragColor = vec4(.75, .86, 1.15, a);
      }
    `,
  });
  return new THREE.Mesh(g, m);
}

// Воздух комнаты: пыль в свете, лунные столбы и конусы фонарей.
export class Atmosphere {
  constructor(world, stage) {
    this.world = world;
    this.stage = stage;
    this.group = new THREE.Group();
    stage.scene.add(this.group);

    const seeds = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST * 3; i++) seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.dust = new THREE.Points(g, dustMaterial());
    this.dust.frustumCulled = false;
    this.group.add(this.dust);

    const moonMat = beamMaterial(0x7fa4ff, 0.09);
    for (const w of world.level.windows) {
      const south = w.z > world.level.worldD / 2;
      const shaft = moonShaft(w, 0.5, south ? -1.5 : 1.7, moonMat);
      shaft.frustumCulled = false;
      this.group.add(shaft);
    }

    this.cones = new Map();
    this.coneDir = new THREE.Vector3();
  }

  update() {
    const r = this.stage.rig;
    const u = this.dust.material.uniforms;
    u.uCenter.value.set(r.target.x, 0.9, r.target.z);
    u.uBox.value = Math.min(9, 2 + r.dist * 0.9);
    const torches = this.world.lights.filter((l) => l.dynamic && l.on);
    for (const [light, mesh] of this.cones) {
      if (!torches.includes(light)) {
        this.group.remove(mesh);
        this.cones.delete(light);
      }
    }
    for (const t of torches) {
      let c = this.cones.get(t);
      if (!c) {
        c = torchCone();
        c.frustumCulled = false;
        this.cones.set(t, c);
        this.group.add(c);
      }
      c.position.set(t.x + Math.cos(t.dir) * 0.3, 1.2, t.z + Math.sin(t.dir) * 0.3);
      this.coneDir.set(t.x + Math.cos(t.dir) * 4, 0.2, t.z + Math.sin(t.dir) * 4);
      c.lookAt(this.coneDir);
      c.rotateY(Math.PI);
    }
  }
}
