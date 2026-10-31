import * as THREE from 'three';
import { shared } from './worldMaterial.js';

export const CAST_LAYER = 1;
const SIZE = 1536;

// Тень от одного главного источника: лампы рядом с камерой или фонаря в руке человека.
export class KeyShadow {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rt.depthTexture = new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType);
    this.rt.depthTexture.minFilter = THREE.NearestFilter;
    this.rt.depthTexture.magFilter = THREE.NearestFilter;
    this.cam = new THREE.PerspectiveCamera(150, 1, 0.04, 18);
    this.cam.layers.set(CAST_LAYER);
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    shared.uShadowMap.value = this.rt.depthTexture;
    this.target = new THREE.Vector3();
  }

  render(light) {
    if (!light) {
      shared.uShadowOn.value = 0;
      return;
    }
    const c = this.cam;
    c.position.set(light.px, light.py, light.pz);
    if (light.dir) {
      c.fov = 86;
      this.target.set(light.px + light.dir.x, light.py + light.dir.y, light.pz + light.dir.z);
      c.up.set(0, 1, 0);
    } else {
      c.fov = 152;
      this.target.set(light.px, 0, light.pz);
      c.up.set(0, 0, 1);
    }
    c.lookAt(this.target);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();

    const r = this.renderer;
    const scene = this.scene;
    const bg = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.depthMat;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, c);
    r.setRenderTarget(null);
    scene.overrideMaterial = null;
    scene.background = bg;

    shared.uShadowMat.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    shared.uShadowOn.value = 1;
  }
}
