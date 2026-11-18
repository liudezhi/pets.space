import * as THREE from 'three';
import { surfaceTexture } from './world-materials.js';

export const memorialPlots = {
  stone: { x: -12, z: 6, viewX: -10.4, viewZ: 8.15, lookX: -11.45, lookZ: 5.60 },
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
  const map = surfaceTexture('limestone');
  return new THREE.MeshStandardMaterial({map, bumpMap: map, bumpScale: .027, vertexColors:true, roughness:.96});
}

function stoneGeometry() {
  // Weathered ridge, slightly asymmetric shoulders and a shallow cut for the ceramic frame.
  const geometry = new THREE.SphereGeometry(1,40,24);
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  const colors = [], tint = new THREE.Color(), moss = new THREE.Color('#68754d');
  for (let i=0; i<position.count; i++) {
    const nx=position.getX(i), ny=position.getY(i), nz=position.getZ(i);
    const pits = .055*Math.sin(7*nx+1.7*ny)*Math.cos(5*ny-2*nz) + .024*Math.sin(13*nz+10*ny);
    const x = nx*(1.17+pits) - ny*.11;
    const y = .47 + ny*(.95+pits*.9) - nx*.10 + .033*Math.sin(6*nz+nx);
    const naturalFront = nz*(.73+pits) - .11;
    const face = .34 + .042*Math.cos(7*x+3*y) + .017*Math.sin(15*y-5*x);
    const z = Math.min(naturalFront, face);
    position.setXYZ(i,x,y,z);
    const cover = THREE.MathUtils.clamp(.21 - y*.23 + Math.sin(x*8+y*4)*.07,0,.23);
    tint.set('#fff8e4').lerp(moss,cover);
    colors.push(tint.r,tint.g,tint.b);
    // Unwrap around the boulder rather than stretching a texture onto its rounded sides.
    uv.setXY(i,uv.getX(i)*3.2,uv.getY(i)*1.28);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  return geometry;
}

function addContactShadow(marker, heightAt, x, z) {
  const map = canvasTexture(96,96,ctx=>{
    const gradient=ctx.createRadialGradient(48,48,2,48,48,47);
    gradient.addColorStop(0,'rgba(32,37,26,.55)');
    gradient.addColorStop(.57,'rgba(41,42,29,.31)');
    gradient.addColorStop(1,'rgba(43,44,31,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,96,96);
  });
  const geo=new THREE.PlaneGeometry(3.15,1.95,6,5).rotateX(-Math.PI/2);
  const pos=geo.attributes.position;
  const c=Math.cos(marker.rotation.y),s=Math.sin(marker.rotation.y);
  for (let i=0;i<pos.count;i++){
    const px=pos.getX(i),pz=pos.getZ(i)+.08;
    pos.setXYZ(i,px,heightAt(x+c*px+s*pz,z-s*px+c*pz)-marker.position.y+.035,pz);
  }
  const shade=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));
  shade.renderOrder=1;
  marker.add(shade);
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
  async function readPhoto() {
    if (source instanceof Blob) return source;
    if (typeof source !== 'string' || !source.startsWith('/') || source.startsWith('//')) return;
    const url = new URL(source, location.origin);
    if (url.origin !== location.origin) return;
    const response = await fetch(url, {
      mode: 'same-origin', credentials: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer',
      cache: keepWholePhoto ? 'no-store' : 'default', signal,
    });
    if (!response.ok) return;
    return response.blob();
  }
  async function paint() {
    const blob = await readPhoto();
    if (!blob || signal?.aborted) return;
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

function addPaidGifts(marker, gifts = []) {
  const now = Date.now();
  const active = gifts.filter(g => !g.expiresAt || Date.parse(g.expiresAt) > now);
  const lily = active.some(g => g.type === 'lily');
  const vase = active.some(g => g.type === 'vase');
  if (!lily && !vase) return;
  const base = new THREE.Group();
  base.position.set(-.47,.055,.64);
  base.name = '纪念礼物';
  marker.add(base);
  if (vase) {
    const profile = [[0,0],[.12,.01],[.15,.09],[.135,.21],[.08,.29],[.088,.33],[.068,.34],[.061,.29]];
    const ceramic = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x,y])=>new THREE.Vector2(x,y)),16),
      new THREE.MeshStandardMaterial({color:0x9cbcb2,roughness:.33,side:THREE.DoubleSide}));
    ceramic.name='青瓷花瓶';base.add(ceramic);
  }
  if (lily) {
    const positions=[],colors=[];
    const white=new THREE.Color('#fff5e1'),green=new THREE.Color('#566e41'),gold=new THREE.Color('#c99037');
    function triangle(a,b,c,color){
      positions.push(...a,...b,...c);
      for(let i=0;i<3;i++)colors.push(color.r,color.g,color.b);
    }
    for(let i=0;i<4;i++){
      const a=i*2.4, x=Math.sin(a)*.14, z=Math.cos(a)*.12, h=.48+.07*(i%3)+(vase?.12:0);
      triangle([-.008,0,.01],[.008,0,.012],[x,h,z],green);
      triangle([x*.4,h*.4,z*.4],[x+.06,h*.58,z+.05],[x+.12,h*.64,z+.09],green);
      for(let j=0;j<6;j++){
        const yaw=j*Math.PI/3+a,sn=Math.sin(yaw),cs=Math.cos(yaw);
        const middle=[x+.052*cs,h+.05,z+.052*sn], tip=[x+.11*cs,h+.045,z+.11*sn];
        const l=[middle[0]-.029*sn,h+.042,middle[2]+.029*cs],r=[middle[0]+.029*sn,h+.042,middle[2]-.029*cs];
        triangle([x,h,z],l,tip,white);triangle([x,h,z],tip,r,white);
        triangle([x,h,z],[x+.008,h,z],[x+.033*cs,h+.06,z+.033*sn],gold);
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
    const flowers=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
    flowers.name='纪念百合';
    flowers.userData.visibleUntil=Math.max(...active.filter(g=>g.type==='lily').map(g=>g.expiresAt?Date.parse(g.expiresAt):Infinity));
    base.add(flowers);
  }
}

function makeMarker(group, heightAt, place, memorial, stone, surface, signal, random, location = memorialPlots[place]) {
  const { x, z, viewX, viewZ } = location;
  const marker = new THREE.Group();
  marker.name = {stone:'河湾纪念石',entrance:'桦坡纪念石',courtyard:'家庭纪念石'}[place];
  marker.position.set(x, heightAt(x, z) - .04, z);
  marker.rotation.y = Math.atan2(viewX - x, viewZ - z);
  group.add(marker);

  const monument = new THREE.Mesh(stone, surface);
  monument.castShadow = monument.receiveShadow = true;
  monument.userData.habitat='stone';
  marker.add(monument);

  addContactShadow(marker,heightAt,x,z);
  const w = .66, h = .76, portraitY = .82;
  const frameGeometry = new THREE.BoxGeometry(w+.084,h+.084,.09);
  const frame = new THREE.Mesh(frameGeometry, new THREE.MeshStandardMaterial({
    color: 0xd5bf96, metalness: .08, roughness: .48,
  }));
  frame.position.set(0, portraitY, .397);
  marker.add(frame);
  const photo = canvasTexture(528, 608, (ctx) => {
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(0, 0, 528, 608);
    ctx.fillStyle = '#887e68';
    ctx.font = '45px serif';
    ctx.textAlign = 'center';
    ctx.fillText('留 念', 264, 319);
  });
  loadPortrait(photo, memorial ? memorial.photoUrl : '/pet.webp', !!memorial, signal);
  const portrait = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: photo, toneMapped: false }));
  portrait.position.set(0, portraitY, .444);
  marker.add(portrait);

  const dedication = memorial?.name || '永远想念你';
  const inscription = canvasTexture(768, 192, (ctx) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 104px "Noto Serif CJK SC","Songti SC",serif';
    ctx.fillStyle = '#f2ead7';
    ctx.fillText(dedication, 385, 89, 730);
    ctx.fillStyle = '#342d27';
    ctx.fillText(dedication, 384, 86, 730);
  });
  const lettering = new THREE.Mesh(new THREE.PlaneGeometry(1.18, .295),
    new THREE.MeshBasicMaterial({ map: inscription, transparent: true, depthWrite: false }));
  lettering.position.set(0, .256, .402);
  marker.add(lettering);
  addDaisies(marker);
  addGiftBouquet(marker, memorial?.flowerCount);
  addPaidGifts(marker,memorial?.gifts);

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

export function addFamilyMarkers(group, heightAt, gardens, signal, blockers) {
  if (!gardens.length) return;
  const stone=stoneGeometry(), surface=limestone(), random=randomSource(372);
  const columns=Math.min(gardens.length,4);
  gardens.forEach((garden,i)=>{
    // Continue the family rows down the hillside, with visitors looking west.
    const x=28.5-2.9*Math.floor(i/4), z=-6.8+(i%4-(columns-1)/2)*2.05;
    makeMarker(group,heightAt,'courtyard',garden,stone,surface,signal,random,{x,z,viewX:x+3,viewZ:z+.15});
    blockers.push([x,z,.65,.99]);
  });
}
