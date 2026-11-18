import * as THREE from 'three';

function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function limestone() {
  const random = randomSource(2917);
  const map = canvasTexture(384, 384, (ctx) => {
    const sample = ctx.createImageData(384, 384);
    const levels = [3, 7, 20, 40].map((size) => ({
      size, grid: Float32Array.from({ length: size * size }, random),
    }));
    function grain({ size, grid }, u, v) {
      const x = u * size, y = v * size;
      const ix = Math.floor(x), iy = Math.floor(y);
      const a = THREE.MathUtils.smoothstep(x - ix, 0, 1);
      const b = THREE.MathUtils.smoothstep(y - iy, 0, 1);
      const at = (i, j) => grid[(j % size) * size + (i % size)];
      return THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), a),
        THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), a), b,
      ) - .5;
    }
    for (let y = 0; y < 384; y++) {
      for (let x = 0; x < 384; x++) {
        const u = x / 384, v = y / 384;
        const m = grain(levels[0], u, v) * 25 + grain(levels[1], u, v) * 23;
        const n = m + grain(levels[2], u, v) * 12 + grain(levels[3], u, v) * 8 + (random() - .5) * 16;
        const offset = 4 * (y * 384 + x);
        sample.data.set([182 + n, 178 + n, 158 + n, 255], offset);
      }
    }
    ctx.putImageData(sample, 0, 0);
  });
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map, roughness: .95, bumpMap: map, bumpScale: .012 });
}

// The front stays planar for the recessed portrait. A curved bevel catches the side light.
function stoneGeometry() {
  const face = new THREE.Shape();
  face.moveTo(-.86, .03);
  face.bezierCurveTo(-.88, .3, -.8, .74, -.69, .97);
  face.bezierCurveTo(-.54, 1.2, -.22, 1.26, .11, 1.25);
  face.bezierCurveTo(.41, 1.24, .7, 1.11, .78, .86);
  face.bezierCurveTo(.86, .63, .91, .31, .88, .02);
  face.bezierCurveTo(.34, -.03, -.42, -.02, -.86, .03);
  const geometry = new THREE.ExtrudeGeometry(face, {
    depth: .36, bevelEnabled: true, bevelSegments: 4,
    bevelSize: .085, bevelThickness: .08, curveSegments: 8, steps: 1,
  });
  geometry.translate(0, 0, -.22);
  return geometry;
}

function addDaisies(marker) {
  const random = randomSource(9181);
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  function triangle(a, b, c, hex) {
    positions.push(...a, ...b, ...c);
    color.setHex(hex);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  }
  // A single vertex-colored batch holds the thin stems, leaves and individual petals.
  for (let i = 0; i < 27; i++) {
    const clump = i < 18 ? 1 : -1;
    const x = clump * (.53 + random() * .46), z = .16 + random() * .35;
    const h = .15 + random() * .26;
    const bend = (random() - .5) * .1;
    const flowerX = x + bend;
    const flowerSize = .025 + random() * .021;
    triangle([x, .015, z], [x + .007, .015, z], [flowerX + .004, h, z], 0x667843);
    triangle([x, .015, z], [flowerX + .004, h, z], [flowerX - .002, h, z], 0x667843);
    for (const side of [-1, 1]) {
      triangle([x, h * .3, z], [x + side * .052, h * .6, z + .012], [x + side * .008, h * .54, z], 0x738147);
    }
    const petals = 9, phase = random() * 6.28;
    for (let j = 0; j < petals; j++) {
      const angle = j / petals * 2 * Math.PI + phase;
      const axis = Math.cos(angle), cross = Math.sin(angle);
      const pt = (r, w, rise) => [flowerX + r * axis - w * cross, h + rise + r * cross * .3, z + r * cross + w * axis];
      const base = pt(.003, 0, 0), tip = pt(flowerSize, 0, .008);
      const left = pt(flowerSize * .72, .0068, .006), right = pt(flowerSize * .72, -.0068, .006);
      const white = j % 3 === 0 ? 0xe4e2c6 : 0xfff9dd;
      triangle(base, left, tip, white);
      triangle(base, tip, right, white);
      const next = angle + 2 * Math.PI / petals;
      triangle([flowerX, h + .01, z], pt(.009, 0, .005),
        [flowerX + Math.cos(next) * .009, h + .005 + Math.sin(next) * .0027, z + Math.sin(next) * .009], 0xe4ad45);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const spray = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  marker.add(spray);
}

export function addMemorial(group, heightAt) {
  const x = -12, z = 6;
  const marker = new THREE.Group();
  marker.name = '河湾纪念石';
  marker.position.set(x, heightAt(x, z) - .04, z);
  marker.rotation.y = Math.atan2(2, 3);
  group.add(marker);

  const stone = stoneGeometry(), surface = limestone();
  const monument = new THREE.Mesh(stone, surface);
  monument.castShadow = monument.receiveShadow = true;
  marker.add(monument);

  const w = .54, h = .675, portraitY = .79;
  const frameGeometry = new THREE.BoxGeometry(.58, .725, .042);
  const frame = new THREE.Mesh(frameGeometry, new THREE.MeshStandardMaterial({
    color: 0x79654d, metalness: .23, roughness: .62,
  }));
  frame.position.set(0, portraitY, .235);
  marker.add(frame);
  const photo = new THREE.TextureLoader().load('/pet.webp', (texture) => {
    const aspect = texture.image.width / texture.image.height;
    const crop = aspect / (w / h);
    texture.repeat.set(Math.min(1, 1 / crop), Math.min(1, crop));
    texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
  });
  photo.colorSpace = THREE.SRGBColorSpace;
  const portrait = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: photo, toneMapped: false }));
  portrait.position.set(0, portraitY, .258);
  marker.add(portrait);

  const inscription = canvasTexture(768, 192, (ctx) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 79px "Noto Serif CJK SC","Songti SC",serif';
    ctx.fillStyle = '#e6ddc7';
    ctx.fillText('永远想念你', 385, 89);
    ctx.fillStyle = '#45453b';
    ctx.fillText('永远想念你', 384, 86);
  });
  const lettering = new THREE.Mesh(new THREE.PlaneGeometry(1.03, .258),
    new THREE.MeshBasicMaterial({ map: inscription, transparent: true, depthWrite: false }));
  lettering.position.set(0, .28, .223);
  marker.add(lettering);
  addDaisies(marker);

  const pebbleGeometry = new THREE.IcosahedronGeometry(1, 1);
  const pebbles = new THREE.InstancedMesh(pebbleGeometry,
    new THREE.MeshStandardMaterial({ roughness: .97 }), 42);
  const random = randomSource(1026), dummy = new THREE.Object3D(), tint = new THREE.Color();
  for (let i = 0; i < pebbles.count; i++) {
    const theta = random() * 2 * Math.PI, r = .83 + random() * .55;
    const px = Math.cos(theta) * r, pz = Math.sin(theta) * r * .61;
    const worldX = x + Math.cos(marker.rotation.y) * px + Math.sin(marker.rotation.y) * pz;
    const worldZ = z - Math.sin(marker.rotation.y) * px + Math.cos(marker.rotation.y) * pz;
    const radius = .035 + random() * .14;
    dummy.position.set(px, heightAt(worldX, worldZ) - marker.position.y + .014, pz);
    dummy.scale.set(radius * 1.26, radius * .39, radius * .73);
    dummy.rotation.set((random() - .5) * .23, random() * 6.28, 0);
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);
    tint.setHSL(.10 + random() * .06, .05 + random() * .09, .34 + random() * .23);
    pebbles.setColorAt(i, tint);
  }
  pebbles.receiveShadow = true;
  marker.add(pebbles);

  // The path remains open: these markers form small groups on the meadow's outer slopes.
  const clearings = [[-28, 24], [-32, 21], [-33, 25], [-23, 13], [-27, 11], [-26, 15]];
  const distant = new THREE.InstancedMesh(stone, surface, clearings.length);
  clearings.forEach(([px, pz], i) => {
    dummy.position.set(px, heightAt(px, pz) - .065, pz);
    const scale = .33 + random() * .19;
    dummy.scale.set(scale, scale * (.86 + random() * .14), scale);
    dummy.rotation.set(0, .4 + random() * .8, (random() - .5) * .05);
    dummy.updateMatrix();
    distant.setMatrixAt(i, dummy.matrix);
  });
  distant.receiveShadow = distant.castShadow = true;
  group.add(distant);
}
