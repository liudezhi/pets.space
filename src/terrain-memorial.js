import * as THREE from 'three';
import { surfaceTexture } from './world-materials.js';

export const memorialPlots = {
  stone: { x: -12, z: 6, viewX: -12.66, viewZ: 8.36, lookX: -10.83, lookZ: 5.52 },
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

const frameSite = { x: .15, y: .88, width: .47, height: .59 };
const smoothstep = THREE.MathUtils.smoothstep;

function limestone() {
  const map = surfaceTexture('memorial-limestone');
  const material = new THREE.MeshStandardMaterial({
    map, bumpMap: map, bumpScale: .21, vertexColors: true, roughness: .96,
  });
  material.onBeforeCompile = shader => {
    const varyings = 'varying vec3 stonePosition; varying vec3 stoneNormal;\n';
    shader.vertexShader = varyings + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nstonePosition = position; stoneNormal = normal;');
    // Soluble limestone has no single grain direction. Blend the three projections
    // in local space so the texture can cross a fractured shoulder without stretching.
    shader.fragmentShader = varyings + shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 weights = pow(abs(normalize(stoneNormal)), vec3(3.5));
      weights /= max(dot(weights, vec3(1.0)), 0.00001);
      vec3 p = stonePosition * .61 + vec3(.49,.10,.25);
      vec3 mineral = texture2D(map, p.zy).rgb * weights.x
                  + texture2D(map, p.xz).rgb * weights.y
                  + texture2D(map, p.xy).rgb * weights.z;
      // Keep the inscription on a small dressed area where the mason removed
      // the deeper surface pits. Light still falls across it with the seasons.
      vec2 panel = abs(stonePosition.xy - vec2(.15,.365)) - vec2(.34,.066);
      float dressed = (1.0 - smoothstep(-.012,.055,max(panel.x,panel.y))) * smoothstep(.28,.36,stonePosition.z);
      mineral = mix(mineral, vec3(.59,.55,.49), .65*dressed);
      float mineralHeight = dot(mineral, vec3(.24,.56,.20));
      diffuseColor.rgb *= mineral;
    `).replace('#include <normal_fragment_maps>', `
      normal = perturbNormalArb(-vViewPosition, normal,
        bumpScale*vec2(dFdx(mineralHeight),dFdy(mineralHeight)), faceDirection);
    `);
  };
  material.customProgramCacheKey = () => 'memorial-limestone-projections';
  return material;
}

function stoneGeometry(detail = 1) {
  // Keep a grid on every face. An equatorial sphere projection would pinch the
  // photographed strata across the shoulder and across the face of the stone.
  const geometry = new THREE.BoxGeometry(2, 2, 2, Math.ceil(34*detail), Math.ceil(29*detail), Math.ceil(18*detail));
  const position = geometry.attributes.position;
  const colors = [], tint = new THREE.Color(), chalk = new THREE.Color('#fffefa');
  const stain = new THREE.Color('#8b9071');
  for (let i = 0; i < position.count; i++) {
    const bx = position.getX(i), by = position.getY(i), bz = position.getZ(i);
    const shell = Math.pow(bx*bx + by*by + bz*bz, -.44);
    const nx = bx * shell, ny = by * shell, nz = bz * shell;
    const fracture = .054*Math.sin(6*nx + 4*ny)*Math.cos(5*nz - ny)
      + .026*Math.sin(11*ny - 8*nx + nz) + .016*Math.sin(19*nz + 13*nx);
    const x = nx * (1.18 + fracture) - .14*ny;
    const y = .56 + ny*(1 + fracture) - .20*nx + .04*Math.sin(5*nz + 4*nx);
    let z = -.12 + nz * (.88 + fracture);
    if (nz > 0) {
      // Three cleavage planes, two eroded pockets and a continuous uncut shoulder.
      const face = .48 + .065*Math.sin(5*x + 2*y) + fracture
        - Math.max(0, x - .34)*.30 - Math.max(0, -x - .57)*.47;
      const pocket = (cx, cy, rx, ry) => Math.max(0, 1 - ((x-cx)/rx)**2 - ((y-cy)/ry)**2);
      z = Math.min(z, face - .089*pocket(-.59,.70,.14,.19) - .067*pocket(.71,.85,.13,.12));
      // A mason dressed only the limestone under the frame and its lettering.
      const frameEdge = Math.max(Math.abs(x-frameSite.x)-.281, Math.abs(y-frameSite.y)-.341);
      const textEdge = Math.max(Math.abs(x-frameSite.x)-.44, Math.abs(y-.365)-.096);
      const frameCut = .348 + .19*smoothstep(frameEdge, -.016, .06);
      const textCut = .405 + .16*smoothstep(textEdge, -.012, .08);
      z = Math.min(z, frameCut, textCut);
    }
    position.setXYZ(i, x, y, z);
    const damp = (1 - smoothstep(y, -.04, .43)) * (.22+.11*Math.sin(11*x + z));
    tint.copy(chalk).lerp(stain, damp);
    colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  // BoxGeometry has independent edge vertices on adjoining sides. Smooth only
  // those coincident positions to avoid a visible cube seam across the shoulders.
  const normals = geometry.attributes.normal, joined = new Map(), keys = [];
  for (let i=0;i<position.count;i++) {
    const key = [position.getX(i),position.getY(i),position.getZ(i)].map(v=>Math.round(v*10000)).join(',');
    const total = joined.get(key) || new THREE.Vector3();
    total.x += normals.getX(i); total.y += normals.getY(i); total.z += normals.getZ(i);
    joined.set(key,total); keys.push(key);
  }
  for (const total of joined.values()) total.normalize();
  keys.forEach((key,i) => {
    const n = joined.get(key);
    normals.setXYZ(i,n.x,n.y,n.z);
  });
  return geometry;
}

function roundedRim(width, height, band, depth, bevel, material) {
  function trace(path, w, h, radius) {
    const x = w/2, y = h/2, r = radius;
    path.moveTo(-x+r, -y);
    path.lineTo(x-r,-y); path.quadraticCurveTo(x,-y,x,-y+r);
    path.lineTo(x,y-r); path.quadraticCurveTo(x,y,x-r,y);
    path.lineTo(-x+r,y); path.quadraticCurveTo(-x,y,-x,y-r);
    path.lineTo(-x,-y+r); path.quadraticCurveTo(-x,-y,-x+r,-y);
  }
  const shape = new THREE.Shape(), opening = new THREE.Path();
  trace(shape, width, height, .018);
  trace(opening, width-2*band, height-2*band, .01);
  shape.holes.push(opening);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSegments: 2, bevelSize: bevel, bevelThickness: bevel, curveSegments: 3,
  });
  return new THREE.Mesh(geometry, material);
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

function addDaisies(marker, groundY) {
  const random = randomSource(9181);
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  function triangle(a, b, c, hex) {
    positions.push(...a, ...b, ...c);
    color.setHex(hex);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  }
  // Build leaves, bent stems and two flowering clumps in one draw call.
  const clumps = [[-.65,.59], [.94,.28], [-.99,.29], [.65,.49]];
  for (let i = 0; i < 29; i++) {
    const [cx,cz] = clumps[i % clumps.length];
    const x = cx + (random()-.5)*.23, z = cz + (random()-.5)*.21;
    const foot = groundY(x,z)-.008, stem = .18 + random()*.30;
    const flowerX = x+(random()-.5)*.16, h = foot+stem, size = .030+random()*.022;
    triangle([x-.004,foot,z], [x+.006,foot,z], [flowerX+.003,h,z+.014], 0x617544);
    triangle([x-.004,foot,z], [flowerX+.003,h,z+.014], [flowerX-.004,h,z+.014], 0x617544);
    for (let j=0;j<4;j++) {
      const angle = random()*Math.PI*2, dx = Math.cos(angle), dz = Math.sin(angle);
      const baseY = foot + (j%2)*.09;
      const base = [x,baseY,z], tip = [x+dx*.118,baseY+.15,z+dz*.118];
      const fold = [x+dx*.057,baseY+.115,z+dz*.057];
      triangle(base, [fold[0]-dz*.016,fold[1]-.02,fold[2]+dx*.016], tip, 0x6a7c4b);
      triangle(base, tip, [fold[0]+dz*.018,fold[1]-.026,fold[2]-dx*.018], 0x859564);
    }
    const petals = 10, phase = random()*Math.PI*2;
    for (let j=0;j<petals;j++) {
      const angle = j/petals * 2*Math.PI + phase;
      const axis = Math.cos(angle), cross = Math.sin(angle);
      function pt(radius,width,lift) {
        const dx = radius*axis - width*cross, dz = radius*cross + width*axis;
        return [flowerX+dx, h+lift-.62*dz, z+.014+.78*dz];
      }
      const base=pt(.005,0,0), tip=pt(size,0,.004);
      const left=pt(size*.70,.008,.009), right=pt(size*.70,-.008,.009);
      const white=j%3===0?0xe4e3ce:0xfff9e7;
      triangle(base,left,tip,white); triangle(base,tip,right,white);
      const next = angle+2*Math.PI/petals;
      triangle([flowerX,h+.006,z+.019],pt(.010,0,.001),
        [flowerX+.010*Math.cos(next),h+.001-.0062*Math.sin(next),z+.014+.0078*Math.sin(next)],0xe7ad37);
    }
  }
  // The dried seed heads stay below the frame, interspersed with the oxeye daisies.
  for(let i=0;i<24;i++) {
    const [cx,cz]=clumps[i%4], x=cx+(random()-.5)*.33, z=cz+.08+(random()-.5)*.18;
    const foot=groundY(x,z), height=.22+random()*.29, lean=(random()-.5)*.2;
    const top=[x+lean,foot+height,z+.03];
    triangle([x-.002,foot,z], [x+.003,foot,z], top, 0x978a55);
    for(let j=0;j<5;j++) {
      const side=j%2===0?1:-1, f=.66+j*.072;
      const base=[x+lean*f,foot+height*f,z+.03*f];
      triangle(base,[base[0]+side*.011,base[1]+.031,base[2]+.006],
        [base[0]+side*.027,base[1]+.053,base[2]+.011],0xb39e64);
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
  const { x: frameX, y: portraitY, width: w, height: h } = frameSite;
  // The photograph sits behind the lip. The shaded reveal stays visible especially
  // from an oblique angle, where a flat rectangle would appear pasted to the rock.
  const surround = roundedRim(w+.113,h+.113,.044,.039,.007,
    new THREE.MeshStandardMaterial({color:0x786c58,roughness:.89}));
  surround.position.set(frameX, portraitY, .35);
  marker.add(surround);
  const frame = roundedRim(w+.077,h+.077,.041,.034,.008,
    new THREE.MeshStandardMaterial({color:0xe3d4b6,roughness:.55}));
  frame.position.set(frameX, portraitY, .38);
  marker.add(frame);
  const photo = canvasTexture(480, 600, (ctx) => {
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(0, 0, 480, 600);
    ctx.fillStyle = '#887e68';
    ctx.font = '45px serif';
    ctx.textAlign = 'center';
    ctx.fillText('留 念', 240, 316);
  });
  loadPortrait(photo, memorial ? memorial.photoUrl : '/pet.webp', !!memorial, signal);
  const portrait = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: photo, roughness: .86, emissiveMap: photo, emissive: 0xffffff, emissiveIntensity: .13 }));
  portrait.position.set(frameX, portraitY, .395);
  marker.add(portrait);

  const dedication = memorial?.name || '永远想念你';
  const inscription = canvasTexture(768, 192, (ctx) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const characters = Array.from(dedication);
    const split = Math.ceil(characters.length/2);
    const lines = characters.length <= 9 ? [dedication]
      : [characters.slice(0,split).join(''),characters.slice(split).join('')];
    ctx.font = '600 ' + (lines.length === 1 ? 100 : 76) + 'px "Noto Serif CJK SC","Songti SC",serif';
    lines.forEach((line,i) => {
      const lineY = lines.length === 1 ? 91 : 52+i*82;
      ctx.fillStyle = '#f3eddd';
      ctx.fillText(line, 386, lineY+4, 730);
      ctx.fillStyle = '#38362e';
      ctx.fillText(line, 384, lineY, 730);
    });
  });
  const lettering = new THREE.Mesh(new THREE.PlaneGeometry(.86, .204),
    new THREE.MeshBasicMaterial({ map: inscription, transparent: true, depthWrite: false }));
  lettering.position.set(frameX, .365, .414);
  marker.add(lettering);
  const yaw = marker.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
  const groundY = (px,pz) => heightAt(x+c*px+sn*pz, z-sn*px+c*pz) - marker.position.y;
  addDaisies(marker, groundY);
  addGiftBouquet(marker, memorial?.flowerCount);
  addPaidGifts(marker,memorial?.gifts);

  // A handful of detached, half-buried strata and the smaller chips around them.
  // The path and the area where a visitor lays flowers both stay clear.
  const slabs = [[-.93,.47,.34],[-1.19,.13,.20],[-.78,.88,.20],
    [.86,.49,.32],[1.11,.27,.23],[.57,.72,.15],[-1.10,-.26,.25]];
  const pebbleGeometry = new THREE.DodecahedronGeometry(1);
  const pebbleSurface = new THREE.MeshStandardMaterial({map: surface.map, roughness:.98});
  const pebbles = new THREE.InstancedMesh(pebbleGeometry, pebbleSurface, 29);
  const dummy = new THREE.Object3D(), tint = new THREE.Color(), aged = new THREE.Color(0x9d9e8f);
  for (let i = 0; i < pebbles.count; i++) {
    const [cx,cz,r] = slabs[i % slabs.length];
    const large = i < slabs.length;
    const px = large ? cx : cx + (random()-.5)*.65;
    const pz = large ? cz : cz + (random()-.5)*.46;
    const radius = large ? r : .025+random()*.061;
    dummy.position.set(px, groundY(px,pz) + radius*.08, pz);
    dummy.scale.set(radius*1.36, radius*.48, radius*.76);
    dummy.rotation.set((random()-.5)*.42, random()*Math.PI, (random()-.5)*.39);
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);
    tint.set(0xeee9d9).lerp(aged, random()*.48);
    pebbles.setColorAt(i,tint);
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
  const distant = new THREE.InstancedMesh(stoneGeometry(.24), surface, clearings.length);
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
  return surface;
}

export function addFamilyMarkers(group, heightAt, gardens, signal, blockers, memorialStone) {
  if (!gardens.length) return;
  const stone=stoneGeometry(.65), surface=memorialStone || limestone(), random=randomSource(372);
  const columns=Math.min(gardens.length,4);
  gardens.forEach((garden,i)=>{
    // Continue the family rows down the hillside, with visitors looking west.
    const x=28.5-2.9*Math.floor(i/4), z=-6.8+(i%4-(columns-1)/2)*2.05;
    makeMarker(group,heightAt,'courtyard',garden,stone,surface,signal,random,{x,z,viewX:x+3,viewZ:z+.15});
    blockers.push([x,z,.65,.99]);
  });
}
