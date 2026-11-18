import * as THREE from 'three';

// Fit the shadow map to the walkable forest, rather than the surrounding mountain panorama.
export function createSunlight(group) {
  const fill = new THREE.HemisphereLight();
  const key = new THREE.DirectionalLight();
  const shadow = key.shadow;
  key.target.position.set(-6, 2, 2);
  key.castShadow = true;
  shadow.mapSize.set(1536, 1536);
  Object.assign(shadow.camera, { left: -54, right: 54, top: 45, bottom: -45, near: 1, far: 225 });
  shadow.camera.updateProjectionMatrix();
  shadow.bias = -0.00018;
  shadow.normalBias = 0.045;
  shadow.autoUpdate = false;
  shadow.needsUpdate = true;

  const cutouts = new Set();
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (!(material?.isMeshStandardMaterial || material?.isMeshLambertMaterial)) return;
    mesh.receiveShadow = true;
    const habitat = mesh.userData.habitat;
    // Fine grass, trail overlays and the ground itself need no silhouette pass.
    if (['ground', 'trail', 'grass', 'flowers'].includes(habitat) || material.depthWrite === false) return;
    mesh.castShadow = true;
    if (material.alphaTest > 0 && material.map) cutouts.add(material.map);
  });
  group.add(fill, key, key.target);

  const previous = new THREE.Vector3(0, -1, 0);
  const direction = new THREE.Vector3();
  let previousSeason, loaded = -1;
  function update(heading, season, daylight, cover) {
    direction.fromArray(heading);
    direction.y = Math.max(0.16, direction.y);
    direction.normalize();
    key.position.copy(key.target.position).addScaledVector(direction, 108);
    shadow.intensity = (0.88 - cover * 0.42) * (0.35 + 0.65 * daylight);
    const ready = [...cutouts].filter(texture => texture.image?.width > 0).length;
    if (direction.distanceToSquared(previous) > 0.00008 || previousSeason !== season || ready !== loaded) {
      // A still landscape reuses the same depth map between changes in sun, season or leaf textures.
      previous.copy(direction);
      previousSeason = season;
      loaded = ready;
      shadow.needsUpdate = true;
    }
  }
  return { fill, key, update, dispose: () => shadow.dispose() };
}
