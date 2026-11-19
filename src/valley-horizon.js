import * as THREE from 'three';
import { surfaceTexture } from './world-materials.js';

export const distantRidge = Object.freeze({ radius: 235, height: 94, bottom: -13, yaw: 1.6, repeats: 2 });

// A distant limestone watershed and a separate wooded foothill subtend different angles
// as the visitor crosses the garden. The saddles leave narrow openings onto the far range.
export function mountainRanges(group) {
  const rock = surfaceTexture('ridges');
  const woodland = surfaceTexture('foothills');
  for (const [map, radius, height, bottom, yaw, repeats, haze] of [
    [rock, distantRidge.radius, distantRidge.height, distantRidge.bottom, distantRidge.yaw, distantRidge.repeats, .27],
    [woodland, 115, 63, -12, -.34, 3, .095],
  ]) {
    map.repeat.set(repeats, 1);
    map.wrapT = THREE.ClampToEdgeWrapping;
    const material = new THREE.MeshBasicMaterial({
      map, side: THREE.BackSide, alphaTest: .30, fog: false,
    });
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 112, 1, true), material);
    ridge.position.y = bottom + height / 2;
    ridge.rotation.y = yaw;
    ridge.name = '远山';
    ridge.userData.habitat = 'ridge';
    ridge.userData.air = haze;
    ridge.userData.forest = map === woodland;
    ridge.renderOrder = map === woodland ? 3 : 4;
    group.add(ridge);
  }
  return rock;
}
