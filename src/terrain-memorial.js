import * as THREE from 'three';

export const memorialPlots = {
  stone: { x: -12, z: 6, viewX: -10, viewZ: 9 },
  entrance: { x: -34.5, z: 23.5, viewX: -36.3, viewZ: 25.9 },
};

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

function addGiftBouquet(marker, count) {
  if (!(count > 0)) return;
  const positions = [], colors = [];
  const tint = new THREE.Color();
  function face(a, b, c, color) {
    positions.push(...a, ...b, ...c);
    tint.setHex(color);
    for (let i = 0; i < 3; i++) colors.push(tint.r, tint.g, tint.b);
  }
  function quad(a, b, c, d, color) {
    face(a, b, c, color);
    face(a, c, d, color);
  }

  // An uneven, open linen cone with a sage tie around its pinched waist.
  const tau = Math.PI * 2;
  const ring = (i, radius, y) => [radius * Math.cos(i * tau / 12), y, radius * Math.sin(i * tau / 12)];
  const lip = i => ring(i, i % 2 ? .143 : .127, .29 + .029 * Math.cos(i * tau / 3));
  for (let i = 0; i < 12; i++) {
    const next = i + 1;
    quad(ring(i, .05, 0), ring(next, .05, 0), ring(next, .032, .09), ring(i, .032, .09), 0xc4a783);
    quad(ring(i, .032, .09), ring(next, .032, .09), lip(next), lip(i), i % 2 ? 0xe0c9a7 : 0xd0b48d);
    quad(ring(i, .039, .083), ring(next, .039, .083), ring(next, .048, .113), ring(i, .048, .113), 0x667c66);
  }
  quad([.014,.103,.045], [.038,.105,.033], [.094,.049,.055], [.079,.053,.065], 0x7d9176);

  // Face the flower heads slightly toward the person standing at the stone.
  const flowers = [[0,.448,.012],[-.079,.387,.061],[.084,.387,.066],[-.097,.406,-.05],[.089,.424,-.049],[.006,.36,.115]];
  flowers.forEach(([x, y, z], index) => {
    quad([-.004,.1,0], [.004,.1,0], [x+.004,y,z], [x-.004,y,z], 0x678052);
    const leavesRight = index % 2 ? 1 : -1;
    face([x*.57,.256,z*.57], [x*.7+leavesRight*.033,.3,z*.8], [x+leavesRight*.07,.374,z], 0x719367);
    const purple = index === 3 || index === 4;
    const radius = purple ? .035 : .047;
    const petals = purple ? 5 : 10;
    for (let j = 0; j < petals; j++) {
      const angle = j * tau / petals + index * .87;
      function pt(r, width, lift = 0) {
        const dx = r * Math.cos(angle) - width * Math.sin(angle);
        const dz = r * Math.sin(angle) + width * Math.cos(angle);
        return [x+dx, y-.58*dz+lift, z+.82*dz];
      }
      const halfWidth = purple ? .012 : .008;
      quad(pt(.006,0), pt(radius*.67,-halfWidth), pt(radius,0,.004), pt(radius*.67,halfWidth), purple ? 0xd5bde1 : 0xfffae8);
      const next = angle + tau / petals;
      face([x,y+.005,z], pt(.008,0,.001), [x+.008*Math.cos(next),y+.001-.00464*Math.sin(next),z+.00656*Math.sin(next)], 0xf0c15b);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const bouquet = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  bouquet.name = '亲友献上的花束';
  bouquet.position.set(.38,.06,.65);
  bouquet.rotation.set(-.36,0,-.46);
  marker.add(bouquet);
}

function loadPortrait(texture, source, keepWholePhoto, signal) {
  // Read through the same authenticated origin; redirects must not expose a private request.
  async function paint() {
    if (typeof source !== 'string' || !source.startsWith('/') || source.startsWith('//')) return;
    const url = new URL(source, location.origin);
    if (url.origin !== location.origin) return;
    const response = await fetch(url, {
      mode: 'same-origin', credentials: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer',
      cache: keepWholePhoto ? 'no-store' : 'default', signal,
    });
    if (!response.ok) return;
    const blob = await response.blob();
    if (signal?.aborted) return;
    const image = await createImageBitmap(blob);
    try {
      if (signal?.aborted) return;
      const canvas = texture.image;
      const aspect = image.width / image.height;
      const width = keepWholePhoto ? Math.min(canvas.width, canvas.height * aspect) : Math.max(canvas.width, canvas.height * aspect);
      const height = width / aspect;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#e9e4d8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      texture.needsUpdate = true;
    } finally {
      image.close();
    }
  }
  // The neutral ceramic placeholder stays visible if access expires or decoding fails.
  paint().catch(() => {});
}

function makeMarker(group, heightAt, place, memorial, stone, surface, signal, random) {
  const { x, z, viewX, viewZ } = memorialPlots[place];
  const marker = new THREE.Group();
  marker.name = place === 'stone' ? '河湾纪念石' : '桦坡纪念石';
  marker.position.set(x, heightAt(x, z) - .04, z);
  marker.rotation.y = Math.atan2(viewX - x, viewZ - z);
  group.add(marker);

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
  const photo = canvasTexture(512, 640, (ctx) => {
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(0, 0, 512, 640);
    ctx.fillStyle = '#887e68';
    ctx.font = '45px serif';
    ctx.textAlign = 'center';
    ctx.fillText('留 念', 256, 336);
  });
  loadPortrait(photo, memorial ? memorial.photoUrl : '/pet.webp', !!memorial, signal);
  const portrait = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: photo, toneMapped: false }));
  portrait.position.set(0, portraitY, .258);
  marker.add(portrait);

  const dedication = memorial?.name || '永远想念你';
  const inscription = canvasTexture(768, 192, (ctx) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 79px "Noto Serif CJK SC","Songti SC",serif';
    ctx.fillStyle = '#e6ddc7';
    ctx.fillText(dedication, 385, 89, 730);
    ctx.fillStyle = '#45453b';
    ctx.fillText(dedication, 384, 86, 730);
  });
  const lettering = new THREE.Mesh(new THREE.PlaneGeometry(1.03, .258),
    new THREE.MeshBasicMaterial({ map: inscription, transparent: true, depthWrite: false }));
  lettering.position.set(0, .28, .223);
  marker.add(lettering);
  addDaisies(marker);
  addGiftBouquet(marker, memorial?.flowerCount);

  const pebbleGeometry = new THREE.IcosahedronGeometry(1, 1);
  const pebbles = new THREE.InstancedMesh(pebbleGeometry,
    new THREE.MeshStandardMaterial({ roughness: .97 }), 42);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
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
}

export function addMemorial(group, heightAt, memorial, signal) {
  const stone = stoneGeometry(), surface = limestone();
  const random = randomSource(1026);
  makeMarker(group, heightAt, 'stone', memorial?.place === 'stone' ? memorial : null, stone, surface, signal, random);
  if (memorial?.place === 'entrance') makeMarker(group, heightAt, 'entrance', memorial, stone, surface, signal, randomSource(2841));

  const dummy = new THREE.Object3D();
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
