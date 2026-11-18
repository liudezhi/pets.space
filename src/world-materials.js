import * as THREE from 'three';

// Each scene owns its sampler. Mirrored wrapping softens the tile boundary, and mipmaps
// keep close-up photographic grains from sparkling at grazing angles on mobile.
export function surfaceTexture(name, repeat = 1) {
  const texture = new THREE.TextureLoader().load('/surfaces/' + name + '.webp');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}
