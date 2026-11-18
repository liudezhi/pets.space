import * as THREE from 'three'
import { surfaceTexture } from './world-materials.js'

const TAU = Math.PI * 2
const point = (x, y, z) => new THREE.Vector3(x, y, z)

function oakRandom() {
  let state = 16817
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296)
}

// Parallel transport keeps the fluted bark and longitudinal grain continuous
// around a crook. Main limbs, winter twigs and exposed roots share one draw call.
function woodGeometry() {
  const positions = [], colors = [], uvs = [], indices = []
  const direction = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3()
  const position = new THREE.Vector3()
  function limb(points, radii, sides, seed) {
    const start = positions.length / 3
    const thick = radii[0] > .45
    const phase = seed * TAU
    let length = 0
    for (let i = 0; i < points.length; i++) {
      direction.subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(0, i - 1)]).normalize()
      if (!i) right.set(Math.abs(direction.y) > .8 ? 1 : 0, Math.abs(direction.y) > .8 ? 0 : 1, 0)
      else length += points[i].distanceTo(points[i - 1])
      right.addScaledVector(direction, -right.dot(direction)).normalize()
      up.crossVectors(direction, right)
      for (let j = 0; j <= sides; j++) {
        const turn = j / sides, angle = turn * TAU
        const flute = Math.cos(6 * angle + phase + length * .29)
        const detail = Math.sin(11 * angle - length * .35 + phase)
        const radius = radii[i] * (1 + (thick ? .104 : .048) * flute + .041 * detail)
        position.copy(points[i]).addScaledVector(right, radius * Math.cos(angle)).addScaledVector(up, radius * Math.sin(angle))
        positions.push(position.x, position.y, position.z)
        uvs.push(seed + turn * Math.max(.32, Math.round(radii[0] * TAU / 1.45)) + .027 * Math.sin(length * .85 + phase), length / 2.1 + seed)
        const tone = THREE.MathUtils.clamp(.87 + flute * .07 + .065 * detail + (position.y - 1) * .018, .65, 1.12)
        colors.push(tone, tone * .986, tone * .955)
        if (i && j < sides) {
          const a = start + (i - 1) * (sides + 1) + j, b = a + sides + 1
          indices.push(a, a + 1, b, a + 1, b + 1, b)
        }
      }
    }
  }
  function finish() {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }
  return { limb, finish }
}

// Sculpt the proximal limbs, trunk and roots from a common signed distance field.
// One surface-net vertex per occupied boundary cell avoids tube ends or collars
// at the forks. The field is sampled only at startup and discarded after meshing.
function scaffoldGeometry(paths) {
  const step = .155, lo = point(-9.15,-2.8,-7.05)
  const nx = 111, ny = 82, nz = 96, layer = nx * ny
  const field = new Float32Array(layer * nz).fill(1)
  const cellVertex = new Int32Array(field.length).fill(-1)
  for (const { points, radii, root } of paths) {
    for (let s = 1; s < points.length; s++) {
      const a = points[s-1], b = points[s]
      const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z
      const vertical = root ? 1.5 : 1
      const squared = dx*dx + dy*dy*vertical*vertical + dz*dz
      const r0 = radii[s-1], r1 = radii[s]
      const blend = Math.min(.35,Math.max(.07,r0*.43))
      const margin = Math.max(r0,r1) * 1.15 + blend + 2*step
      const minI=Math.max(0,Math.floor((Math.min(a.x,b.x)-margin-lo.x)/step)), maxI=Math.min(nx-1,Math.ceil((Math.max(a.x,b.x)+margin-lo.x)/step))
      const minJ=Math.max(0,Math.floor((Math.min(a.y,b.y)-margin-lo.y)/step)), maxJ=Math.min(ny-1,Math.ceil((Math.max(a.y,b.y)+margin-lo.y)/step))
      const minK=Math.max(0,Math.floor((Math.min(a.z,b.z)-margin-lo.z)/step)), maxK=Math.min(nz-1,Math.ceil((Math.max(a.z,b.z)+margin-lo.z)/step))
      for(let k=minK;k<=maxK;k++) for(let j=minJ;j<=maxJ;j++) for(let i=minI;i<=maxI;i++){
        const x=lo.x+i*step-a.x, y=lo.y+j*step-a.y, z=lo.z+k*step-a.z
        const t=THREE.MathUtils.clamp((x*dx+y*dy*vertical*vertical+z*dz)/squared,0,1)
        const rx=x-dx*t, ry=(y-dy*t)*vertical, rz=z-dz*t
        const angle = Math.atan2(rz,rx)
        const phase = (a.y+y)*.42
        const ridges = r0 > .3 ? 1+.045*Math.cos(angle*5+phase)+.021*Math.sin(angle*9-phase) : 1
        const distance = Math.sqrt(rx*rx+ry*ry+rz*rz) - (r0+(r1-r0)*t)*ridges
        const idx=i+j*nx+k*layer, old=field[idx]
        const near=Math.max(blend-Math.abs(distance-old),0)
        field[idx]=Math.min(distance,old)-near*near/(4*blend)
      }
    }
  }
  const corner=[0,1,nx,nx+1,layer,layer+1,layer+nx,layer+nx+1]
  const position=[], uv=[], index=[]
  const edgePairs=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]]
  const strides=[1,nx,layer]
  for(let k=1;k<nz-1;k++) for(let j=1;j<ny-1;j++) for(let i=1;i<nx-1;i++){
    const cell=i+j*nx+k*layer
    let mask=0
    for(let n=0;n<8;n++) if(field[cell+corner[n]]<0) mask|=1<<n
    if(!mask || mask===255) continue
    let x=0,y=0,z=0,n=0
    for(const [a,b] of edgePairs){
      if(((mask>>a) & 1)===((mask>>b) & 1))continue
      const va=field[cell+corner[a]], vb=field[cell+corner[b]], t=va/(va-vb)
      x+=(a&1)+t*((b&1)-(a&1))
      y+=((a>>1)&1)+t*(((b>>1)&1)-((a>>1)&1))
      z+=((a>>2)&1)+t*(((b>>2)&1)-((a>>2)&1))
      n++
    }
    const id=position.length/3
    cellVertex[cell]=id
    position.push(lo.x+(i+x/n)*step,lo.y+(j+y/n)*step,lo.z+(k+z/n)*step)
    uv.push(0,0) // The bark shader supplies a continuous, seam-free projection.
    for(let axis=0;axis<3;axis++){
      if((field[cell]<0)===(field[cell+strides[axis]]<0)) continue
      const u=strides[(axis+1)%3], v=strides[(axis+2)%3]
      const b=cellVertex[cell-u], c=cellVertex[cell-u-v], d=cellVertex[cell-v]
      if(b<0||c<0||d<0) continue
      if(field[cell]<0) index.push(id,b,c,id,c,d)
      else index.push(id,c,b,id,d,c)
    }
  }
  const geo=new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.Float32BufferAttribute(position,3))
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

function scaffoldMaterial(bark) {
  const material = new THREE.MeshStandardMaterial({map:bark,color:0xc4af92,roughness:.96})
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 barkPos; varying vec3 barkNormal;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nbarkPos=position; barkNormal=normal;')
    shader.fragmentShader = 'varying vec3 barkPos; varying vec3 barkNormal;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      // The longitudinal coordinate climbs the trunk, then turns progressively
      // outward with the boughs and buttresses. No cylindrical UV seam at forks.
      float rad=length(barkPos.xz);
      float flow=barkPos.y+.79*max(0.,rad-.65);
      vec3 q=abs(normalize(barkNormal)); q=pow(q,vec3(4.)); q/=max(.001,q.x+q.y+q.z);
      vec2 bend=vec2(.039*sin(flow*.94+barkPos.z*.7),.05*cos(flow*.76+barkPos.x*.65));
      float crossgrain=rad<.01?0.:(barkPos.x*barkPos.z/rad);
      vec3 sideX=texture2D(map,vec2(barkPos.z/1.65+bend.x,flow/2.35)).rgb;
      vec3 sideZ=texture2D(map,vec2(barkPos.x/1.65+bend.y,flow/2.35)).rgb;
      vec3 top=texture2D(map,vec2(crossgrain/1.5+.13*barkPos.z,flow/2.35)).rgb;
      vec3 grain=q.x*sideX+q.y*top+q.z*sideZ;
      float oakRelief=dot(grain,vec3(.30,.56,.14));
      diffuseColor.rgb *= grain;
    `)
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec3 woodDx=dFdx(-vViewPosition), woodDy=dFdy(-vViewPosition);
      vec3 r1=cross(woodDy,normal),r2=cross(normal,woodDx);
      float det=dot(woodDx,r1);
      normal=normalize(abs(det)*normal-.065*sign(det)*(dFdx(oakRelief)*r1+dFdy(oakRelief)*r2));
    `)
  }
  material.customProgramCacheKey=()=> 'wishing-oak-fissured-v2'
  return material
}

// Branchlet atlas with lobed, veined leaves. The cutout uses both dry olive and
// fresh sage so the seasonal colour multiply retains variation within each spray.
function makeLeaves(random) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 384
  const ctx = canvas.getContext('2d')
  ctx.lineCap = 'round'
  function leaf(x, y, angle, size) {
    const light = 36 + random() * 22, hue = 61 + random() * 18
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.scale(size, size * (.7 + random() * .35))
    ctx.beginPath()
    ctx.moveTo(0, 0)
    for (const side of [-1, 1]) {
      for (let j = 1; j <= 6; j++) {
        const t = (side < 0 ? j : 6 - j) / 6
        const last = t - (side < 0 ? 1 : -1) / 6
        const m = (t + last) / 2
        const w = .32 * Math.pow(Math.max(0, Math.sin(Math.PI * m)), .67)
        ctx.quadraticCurveTo(m + .04, side * w, t, side * w * .55)
      }
    }
    ctx.closePath()
    const fold = ctx.createLinearGradient(0, -.22, .02, .22)
    fold.addColorStop(0, `hsl(${hue},32%,${light + 7}%)`)
    fold.addColorStop(.50, `hsl(${hue},28%,${light + 2}%)`)
    fold.addColorStop(.55, `hsl(${hue},31%,${light - 4}%)`)
    fold.addColorStop(1, `hsl(${hue},32%,${light}%)`)
    ctx.fillStyle = fold
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(.44, -.015, .86, 0)
    ctx.strokeStyle = 'rgba(180,173,111,.55)'
    ctx.lineWidth = .025
    ctx.stroke()
    ctx.restore()
  }
  function twig(x, y, angle, length, level) {
    const dx = Math.cos(angle) * length, dy = Math.sin(angle) * length
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + dx * .44 + 3, y + dy * .52, x + dx, y + dy)
    ctx.lineWidth = level ? 2 : 1.2
    ctx.strokeStyle = level ? '#777450' : '#837846'
    ctx.stroke()
    const count = level ? 7 : 9
    for (let k = 0; k < count; k++) {
      const t = .18 + k / count * .84
      const side = (k % 2 ? 1 : -1)
      const a = angle + side * (.46 + random() * .61)
      if (level) twig(x + dx * t, y + dy * t, a, length * (.21 + .11 * random()), level - 1)
      else leaf(x + dx * t, y + dy * t, a, 12 + random() * 12)
    }
  }
  twig(190, 340, -1.57, 262, 2)
  twig(191, 300, -2.26, 170, 2)
  twig(192, 303, -.87, 166, 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

// A scattering shadow follows the actual hillside, including the changing
// elevation beneath the roots. It leaves open pools of sunlight between boughs.
function rootShade(group, heightAt, base, random) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')
  function blot(x, y, size, alpha) {
    const shade = ctx.createRadialGradient(x, y, 0, x, y, size)
    shade.addColorStop(0, `rgba(33,35,23,${alpha})`)
    shade.addColorStop(.55, `rgba(41,48,31,${alpha * .51})`)
    shade.addColorStop(1, 'rgba(52,58,34,0)')
    ctx.fillStyle = shade
    ctx.fillRect(x - size, y - size, size * 2, size * 2)
  }
  blot(128, 128, 50, .48)
  for (let i = 0; i < 140; i++) {
    const angle = TAU * random(), radius = 99 * Math.sqrt(random())
    blot(128 + radius * Math.cos(angle), 128 + radius * Math.sin(angle), 5 + 14 * random(), .11 + .17 * random())
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.PlaneGeometry(21, 21, 28, 28)
  geo.rotateX(-Math.PI / 2)
  const attr = geo.attributes.position
  for (let i = 0; i < attr.count; i++) attr.setY(i, heightAt(20 + attr.getX(i), -16 + attr.getZ(i)) - base + .038)
  const shadow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }))
  group.add(shadow)
}

export function addWishingOak(group, heightAt) {
  const oak = new THREE.Group()
  const base = heightAt(20, -16)
  oak.position.set(20, base, -16)
  oak.name = '东北低脊 · 许愿橡树'
  group.add(oak)
  const random = oakRandom()
  const wood = woodGeometry()
  const leaves = []
  const vecs = rows => rows.map(([x, y, z]) => point(x, y, z))
  const limb = (points, radii, sides) => wood.limb(points, radii, sides, random())
  const ground = (x, z) => heightAt(x + 20, z - 16) - base
  rootShade(oak, heightAt, base, random)

  const scaffold = []
  scaffold.push({
    points:vecs([[0,-.40,0],[.08,.20,.06],[.17,.70,.14],[.18,1.26,.19],[.05,1.93,.20],[-.17,2.60,.09],[-.42,3.23,.06],[-.64,3.73,.39]]),
    radii:[1.28,1.14,1.03,.94,.88,.72,.42,.17],
  })
  for (let i = 0; i < 9; i++) {
    const a = TAU * i / 9 + random() * .44
    const reach = 1.8 + random() * 2.15, dx = Math.cos(a), dz = Math.sin(a)
    const path = [point(dx * .37, .92 + random() * .32, dz * .37)]
    const wiggle=(random()-.5)*1.14
    for (const t of [.19,.36,.55,.71,.88,1]) {
      const bend = Math.sin(t * Math.PI * 1.53) * wiggle + Math.sin(t*7.9)*.10
      const x = dx * reach * t - dz * bend, z = dz * reach * t + dx * bend
      path.push(point(x, ground(x,z) + .29 * (1-t)**2 - .19*t + .07*Math.sin(8*t+i), z))
    }
    scaffold.push({ points:path, radii:[.51,.52,.41,.28,.18,.11,.04], root:true })
  }

  // Shape the big limbs as independent gestures. The low western arm is the
  // overhanging frame in the view back towards the bridge.
  const limbs = [
    { r:.74, p:[[-.14,2.26,.12],[-1.12,3.23,-.33],[-2.68,4.09,-.78],[-4.2,4.38,-1.08],[-5.76,4.27,-1.71],[-7.0,4.82,-2.58],[-8.1,5.42,-3.08]] },
    { r:.67, p:[[.00,2.17,.22],[.68,3.20,.61],[1.54,4.18,1.23],[2.16,5.45,1.72],[3.33,6.24,2.3],[4.62,6.55,2.75],[5.63,7.22,3.61]] },
    { r:.53, p:[[-.08,2.42,.11],[-.64,3.72,.43],[-.42,5.05,1.09],[-.82,6.17,1.34],[-.72,7.21,2.15],[-1.47,8.22,2.52]] },
    { r:.48, p:[[-.32,2.60,-.04],[-.43,3.64,-1.08],[-1.24,4.37,-2.31],[-1.75,5.56,-3.58],[-2.67,5.97,-4.91],[-3.13,6.57,-5.92]] },
    { r:.44, p:[[.16,2.39,.06],[.88,3.57,-.28],[1.86,4.31,-.95],[2.62,5.48,-1.73],[3.98,5.93,-2.40],[5.48,6.75,-3.16]] },
    { r:.48, p:[[-.24,2.59,.21],[-1.1,3.69,.80],[-2.44,3.96,1.6],[-3.85,4.51,1.75],[-4.82,4.34,2.87],[-6.13,4.84,3.07],[-6.91,5.57,3.61]] },
    { r:.27, p:[[.10,3.41,1.51],[-.75,4.19,2.49],[-1.52,4.54,3.58],[-1.74,4.69,4.87],[-2.40,4.72,5.77],[-3.12,4.89,6.59]] },
    { r:.39, p:[[.34,2.69,.32],[.53,3.60,1.45],[.16,4.44,2.46],[.60,4.84,3.82],[.81,5.80,5.01],[1.79,6.22,5.77]] },
  ]
  function terminal(fork, bearing, vigor) {
    for (let j = 0; j < 4; j++) {
      const angle = bearing + (j - 1.4) * .92 + random() * .4
      const length = (.71 + random() * 1.19) * vigor
      const tip = fork.clone().add(point(Math.cos(angle) * length, .28 + random() * 1.15, Math.sin(angle) * length))
      const mid = fork.clone().lerp(tip, .56)
      mid.y += .15 - random() * .37
      limb([fork,mid,tip],[.071,.043,.016],6)
      const count = 9 + Math.floor(random() * 5)
      for (let k = 0; k < count; k++) {
        const az = random() * TAU, rad = Math.sqrt(random()) * (1.03 + .18 * vigor)
        const center = mid.clone().lerp(tip, .38 + random() * .70)
        center.add(point(Math.cos(az) * rad, (random() - .4) * .83, Math.sin(az) * rad))
        const size = 1.20 + .62 * random()
        const brightness = THREE.MathUtils.clamp(.78 + (center.y - 4) * .07 + random() * .25, .7, 1.42)
        leaves.push({ center, angle: az, tilt: (random() - .5) * 2.55, roll: (random() - .5) * 2.3, size,
          color: new THREE.Color().setRGB(brightness, brightness * (1 + random() * .06), brightness * (.76 + random() * .18)) })
      }
    }
  }
  for (const { r, p } of limbs) {
    const line = vecs(p)
    const radii = line.map((_, i) => .052 + (r - .052) * Math.pow(1 - i / (line.length - 1), .95))
    scaffold.push({points:line,radii})
    // Keep the slender tips which are smaller than the scaffold sampling grid.
    limb(line.slice(-2),[radii.at(-2)*.77,radii.at(-1)],10)
    for (let i = 2; i < line.length; i++) {
      const origin = line[i].clone()
      const bearing = Math.atan2(origin.z, origin.x) + (i % 2 ? 1 : -1) * (.58 + random() * .66)
      const length = 1.0 + random() * 1.38
      const step = point(Math.cos(bearing) * length, .78 + random() * 1.56, Math.sin(bearing) * length)
      const fork = origin.clone().add(step)
      const mid = origin.clone().addScaledVector(step, .54)
      mid.y -= .37
      if (origin.lengthSq() < 40 && fork.y < 8.5) scaffold.push({points:[origin,mid,fork],radii:[.20,.13,.067]})
      else limb([origin,mid,fork],[.20,.13,.067],9)
      terminal(fork,bearing, .82 + random() * .34)
      if (i === line.length - 1) terminal(origin, bearing + 1.17, 1.18)
    }
  }
  const bark = surfaceTexture('oak-bark')
  bark.wrapS = bark.wrapT = THREE.RepeatWrapping
  const bole = new THREE.Mesh(scaffoldGeometry(scaffold),scaffoldMaterial(bark))
  bole.name='老橡树 · 连续根脚与分杈'
  oak.add(bole)
  const trunk = new THREE.Mesh(wood.finish(), new THREE.MeshStandardMaterial({
    map:bark, color:0xc4af92, bumpMap:bark, bumpScale:.068, vertexColors:true, roughness:.96,
  }))
  trunk.name = '老橡树 · 根与虬枝'
  oak.add(trunk)

  // Shuffle positions before assigning indices: a winter/low-detail count then
  // thins the entire crown, leaving the same limbs visible at every distance.
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const saved = leaves[i]
    leaves[i] = leaves[j]
    leaves[j] = saved
  }
  const leaflet = new THREE.PlaneGeometry(1.34, 1, 2, 1)
  const pos = leaflet.attributes.position
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) < .1) pos.setZ(i, .12)
  leaflet.computeVertexNormals()
  const crown = new THREE.InstancedMesh(leaflet, new THREE.MeshStandardMaterial({
    map:makeLeaves(random), alphaTest:.32, side:THREE.DoubleSide, roughness:.96,
  }), leaves.length)
  const transform = new THREE.Object3D()
  leaves.forEach((leaf, i) => {
    transform.position.copy(leaf.center)
    transform.rotation.set(leaf.tilt,leaf.angle,leaf.roll,'YXZ')
    transform.scale.setScalar(leaf.size)
    transform.updateMatrix()
    crown.setMatrixAt(i,transform.matrix)
    crown.setColorAt(i,leaf.color)
  })
  crown.userData.habitat = 'leaves'
  crown.computeBoundingSphere()
  oak.add(crown)

  const ribbonPos = [], ribbonColors = [], ribbonIndex = []
  const anchors = [[-2.22,4.74,5.54,1.05,0xe5cd96],[-2.55,4.80,5.99,.84,0xd1a66f],[-3.91,4.50,1.84,.74,0xb8987d]]
  for (const [x,y,z,length,tint] of anchors) {
    const start = ribbonPos.length / 3
    const color = new THREE.Color(tint)
    const angle = .76 + random() * .21
    for (let i = 0; i <= 5; i++) {
      const t = i / 5
      const twist = angle + .62 * Math.sin(t * Math.PI) - .21*t
      const dx = .104 * Math.cos(twist), dz = .104 * Math.sin(twist)
      const cx = x + .15 * t + Math.sin(t * 5.5) * .07, cz = z + Math.sin(t * 4) * .065
      ribbonPos.push(cx - dx,y - t * length,cz - dz,cx + dx,y - t * length - t * .028,cz + dz)
      ribbonColors.push(color.r,color.g,color.b,color.r,color.g,color.b)
      if (i) {
        const a = start + (i - 1) * 2
        ribbonIndex.push(a,a+1,a+2,a+1,a+3,a+2)
      }
    }
  }
  const cloth = new THREE.BufferGeometry()
  cloth.setAttribute('position',new THREE.Float32BufferAttribute(ribbonPos,3))
  cloth.setAttribute('color',new THREE.Float32BufferAttribute(ribbonColors,3))
  cloth.setIndex(ribbonIndex)
  cloth.computeVertexNormals()
  const ribbons = new THREE.Mesh(cloth,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1,emissive:0x30220f}))
  ribbons.userData.habitat='ribbons'
  oak.add(ribbons)
  return oak
}
