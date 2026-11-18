import * as THREE from 'three'
import { surfaceTexture } from './world-materials.js'
import { addRiver, riverX, riverWidth, riverbedHeight } from './terrain-river.js'
import { addBridge } from './terrain-bridge.js'
import { atmosphere } from './world-atmosphere.js'
import { mountainRanges } from './valley-horizon.js'
import { buildCourtyard } from './world-courtyard.js'
import { addForest } from './terrain-forest.js'
import { addMemorial, memorialPlots } from './terrain-memorial.js'

const WORLD = 190
const BRIDGE_END = 6.5
const WALK_WIDTH = 1.2
const clamp = THREE.MathUtils.clamp
const mix = THREE.MathUtils.lerp
const { sin, cos, abs, exp, pow, PI } = Math

function smooth(a, b, t) {
  const u = clamp((t - a) / (b - a), 0, 1)
  return u * u * (3 - 2 * u)
}

function randomSource(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function bridgeDeck(x) {
  return 2.1 - 0.95 * pow(x / BRIDGE_END, 2)
}

function ground(x, z) {
  const side = x - riverX(z)
  const bank = abs(side) - riverWidth(z)
  const lift = side < 0 ? 6.7 : 4.35
  const rise = smooth(3, side < 0 ? 40 : 24, bank)
  const relief = 1.15*sin(z*.073+x*.067) + .62*cos(x*.14-z*.087) + .19*sin(z*.35+x*.19)
  const rolling = smooth(8, 26, bank)*relief + smooth(30,61,bank)*2.8*cos(x*.08+z*.063)
  const approach = exp(-.14*z*z)*(1-smooth(.4,5,abs(abs(x)-BRIDGE_END)))
  const terrace = bank < 0 ? riverbedHeight(x,z) : -.035+1.09*smooth(-.35,3.18,bank)
  const terrain = terrace + rise*lift + rolling
  return mix(terrain, bridgeDeck(clamp(x, -BRIDGE_END, BRIDGE_END)), approach)
}

function heightAt(x, z) {
  if (abs(z) < 1.67 && abs(x) <= BRIDGE_END) return bridgeDeck(x)
  return ground(x, z)
}

function canWalkAt(x, z, birchPlot) {
  if (x < -56 || x > 40 || z < -38 || z > 46) return false
  if (Math.hypot(x + 12, z - 6) < 1.1 || Math.hypot(x - 20, z + 16) < 1.25) return false
  if (birchPlot && Math.hypot(x - birchPlot.x, z - birchPlot.z) < 1.1) return false
  if (abs(z) < WALK_WIDTH && abs(x) < BRIDGE_END + 0.5) return true
  return abs(x - riverX(z)) > riverWidth(z) + 1.35
}

const trail = new THREE.CatmullRomCurve3([
  [-53, 39], [-40, 30], [-32, 26], [-25, 19], [-18, 16],
  [-10, 9], [-9.7, 5.6], [-8.3, 1.6], [-6.5, 0], [-3, 0],
  [0, 0], [3, 0], [6.5, 0], [8.2, -1.1], [11, -5.7],
  [14, -10.3], [17, -15], [19, -19.4], [23, -23],
].map(([x, z]) => new THREE.Vector3(x, 0, z)))

const trailSamples = trail.getPoints(130)
function pathDistance(x, z) {
  let d2 = Infinity
  for (const v of trailSamples) {
    const dx = x - v.x
    const dz = z - v.z
    d2 = Math.min(d2, dx * dx + dz * dz)
  }
  return Math.sqrt(d2)
}

function mesh(group, geo, mat) {
  const object = new THREE.Mesh(geo, mat)
  group.add(object)
  return object
}

function buildGround(group) {
  // Follow the river contour at each row. The riverbed owns its submerged triangles,
  // preventing broad grassy facets from cutting across the pebble shoreline.
  const positions=[],uv=[],colors=[],faces=[]
  const rows=232, cols=56, width=WORLD/2
  const lo=new THREE.Color('#c3caa5'), high=new THREE.Color('#f3e8bd'), tint=new THREE.Color()
  for(const side of [-1,1]){
    const start=positions.length/3
    for(let row=0;row<=rows;row++){
      const z=-96+row*192/rows, center=riverX(z), rail=center+side*(riverWidth(z)+.50)
      for(let col=0;col<=cols;col++){
        const t=col/cols, x=mix(rail,side*width, .48*t+.52*t*t)
        positions.push(x,ground(x,z)-.015,z)
        uv.push(x/WORLD+.5,z/WORLD+.5)
        const patch=.48+.26*sin(.15*x+.22*z)+.16*cos(.32*z-.11*x)+.08*sin(1.13*z+x*.79)
        tint.copy(lo).lerp(high, smooth(.08,.91,patch))
        colors.push(tint.r,tint.g,tint.b)
        if(row&&col){
          const d=start+row*(cols+1)+col
          if(side>0) faces.push(d-cols-2,d-1,d,d-cols-2,d,d-cols-1)
          else faces.push(d-cols-2,d,d-1,d-cols-2,d-cols-1,d)
        }
      }
    }
  }
  const geo=new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
  geo.setIndex(faces);geo.computeVertexNormals()
  const mat=new THREE.MeshStandardMaterial({map:surfaceTexture('meadow',125),vertexColors:true,roughness:.94})
  const land=mesh(group,geo,mat)
  land.userData.habitat='ground';land.receiveShadow=true
}

function trailGeometry(group) {
  const pts = trail.getPoints(230)
  const positions = [], cols = [], faces = [], uvs = []
  const earth = new THREE.Color('#efead5'), verge = new THREE.Color('#cbccac')
  pts.forEach((p, i) => {
    const next = pts[Math.min(i + 1, pts.length - 1)]
    const prev = pts[Math.max(i - 1, 0)]
    const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz)
    const width = 0.82 + 0.14 * sin(i * 0.14)
    const onBridge = abs(p.x) < BRIDGE_END && abs(p.z) < 1.2
    for (let j = 0; j < 5; j++) {
      const edge = j === 0 || j === 4
      const offset = [-1.26, -0.85, 0, 0.85, 1.26][j] * width + (edge ? 0.09 * sin(i * 2 + j) : 0)
      const x = p.x - dz / len * offset, z = p.z + dx / len * offset
      positions.push(x, ground(x, z) + (onBridge ? -1.4 : 0.065), z)
      const c = (edge ? verge : earth).clone().multiplyScalar(0.95 + 0.06 * cos(i * 0.22 + j))
      cols.push(c.r, c.g, c.b, edge ? .025 : .99)
      uvs.push(x*.54+z*.23,z*.54-x*.23)
      if (i > 0 && j < 4) {
        const a = i * 5 + j
        faces.push(a - 5, a - 4, a, a, a - 4, a + 1)
      }
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4))
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
  geo.setIndex(faces)
  geo.computeVertexNormals()
  mesh(group, geo, new THREE.MeshStandardMaterial({map:surfaceTexture('gravel'),vertexColors:true,roughness:1,side:THREE.DoubleSide,transparent:true,depthWrite:false})).userData.habitat='trail'
}

function scatterMeadow(group, random, birchPlot) {
  const positions=[], colors=[], uv=[], normals=[]
  const rootTint=new THREE.Color('#c4c5a9'), seedTint=new THREE.Color('#ced4bd')
  const dummy = new THREE.Object3D()
  const rocks=[], blossoms=[]
  // Small grass clumps use the photographed silhouettes of many interlaced blades.
  // One oversize triangle holds each texture. Its only moving vertex is the tip,
  // matching the seasonal shader and keeping stems anchored without splitting cards.
  for (let i=0;i<19800;i++) {
    const x=random()*98-59, z=random()*85-39
    const bank=abs(x-riverX(z))-riverWidth(z)
    if (bank < .9 || (x>25.4 && x<34.5 && z>-10.6 && z<-2.4)) continue
    if (pathDistance(x,z)<1.29 || (abs(z)<1.75 && abs(x)<BRIDGE_END+1.3)) continue
    if (Math.hypot(x+12,z-6)<1.30) continue
    if (birchPlot && Math.hypot(x-birchPlot.x,z-birchPlot.z)<1.25) continue
    const patch=.5+.25*sin(x*.54+z*.32)+.14*cos(x*.38-z*.66)+.09*sin(x*1.23+z*.72)
    if(random()>.32+.69*patch) continue
    const y=ground(x,z), damp=bank<3.5
    const tall=(.055+(.065+.12*patch)*random())*(damp?1.28:1)
    const angle=random()*PI*2, width=tall*(.93+random()*.52)
    const light=.75+random()*.33
    const b=rootTint.clone().multiplyScalar(light), tip=seedTint.clone().multiplyScalar(light)
    const bend=.05+random()*.14
    for(let j=0;j<(patch>.54?3:2);j++){
      const axis=angle+j*(1.14+random()*.42), wx=cos(axis)*width*1.16, wz=sin(axis)*width*1.16
      const px=x+cos(axis)*.027, pz=z+sin(axis)*.027
      positions.push(px-wx,y-.018,pz-wz, px+wx,y-.018,pz+wz, px+bend*tall,y+2.22*tall,pz-.09*tall)
      uv.push(-.66,0,1.66,0,.5,2.22)
      colors.push(b.r,b.g,b.b,b.r,b.g,b.b,tip.r,tip.g,tip.b)
      // Clump lighting approximates the many upward-facing leaves within the card.
      for(let n=0;n<3;n++) normals.push(-.18*sin(axis),.983,.18*cos(axis))
    }
    if (!damp && random()<.034 && sin(x*.48+z*.7)>.15) {
      blossoms.push([x,y+tall*.67,z,.012+random()*.017,random()<.78?'#e1d9af':'#bea66d'])
    }
  }
  const meadow=new THREE.BufferGeometry()
  meadow.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  meadow.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
  meadow.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
  meadow.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3))
  const grasses=surfaceTexture('meadow-fescue')
  grasses.wrapS=grasses.wrapT=THREE.ClampToEdgeWrapping
  const grass=mesh(group,meadow,new THREE.MeshLambertMaterial({
    map:grasses,vertexColors:true,side:THREE.DoubleSide,alphaTest:.11,alphaToCoverage:true
  }))
  // Both sides represent the same cluster of narrow leaves. Keep their shared
  // upward-facing normal so the reverse side receives the same skylight.
  grass.material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\nnormal *= faceDirection;')
  }
  grass.material.customProgramCacheKey=()=> 'meadow-transmission'
  grass.name='冷季草甸'
  grass.userData.habitat='grass'

  for(let i=0;i<1000;i++) {
    const route=trail.getPointAt(random())
    const x=route.x+random()*2.4-1.2,z=route.z+random()*2.4-1.2
    if(abs(x)<BRIDGE_END+.8 && abs(z)<2) continue
    rocks.push([x,ground(x,z)+.066,z,random()*.052+.012,'#b8ad93'])
  }
  function scatter(items, geom, floral) {
    const object=new THREE.InstancedMesh(geom,new THREE.MeshStandardMaterial({roughness:1,flatShading:true}),items.length)
    items.forEach(([x,y,z,s,c],i)=>{
      dummy.position.set(x,y,z)
      dummy.scale.set(s*(.9+random()),s*(floral?.65:.5),s*(.8+random()*.7))
      dummy.rotation.set(random()*.25,random()*PI,random()*.25)
      dummy.updateMatrix()
      object.setMatrixAt(i,dummy.matrix)
      object.setColorAt(i,new THREE.Color(c))
    })
    if (floral) object.userData.habitat='flowers'
    group.add(object)
  }
  scatter(rocks,new THREE.IcosahedronGeometry(1,0),false)
  scatter(blossoms,new THREE.IcosahedronGeometry(1,0),true)
}

export function buildTerrain(scene, memorial, prefs = {}, reducedMotion) {
  const group=new THREE.Group()
  group.name='Riverbend valley'
  const previousFog=scene.fog
  scene.add(group)
  const random=randomSource(746)
  const ridgeTexture=mountainRanges(group)
  buildGround(group)
  trailGeometry(group)
  const water=addRiver(group,ground,ridgeTexture)
  addBridge(group)
  const birchPlot = memorial?.place === 'entrance' ? memorialPlots.entrance : null
  scatterMeadow(group,random,birchPlot)
  addForest(group,heightAt,riverX,pathDistance)
  const portraitRequests = new AbortController()
  const memorialStone=addMemorial(group,heightAt,memorial,portraitRequests.signal)
  const grounds = buildCourtyard(group,heightAt,memorial,portraitRequests.signal,memorialStone)
  const climate = atmosphere(scene,group,water,prefs,reducedMotion)
  let disposed=false
  return {
    heightAt,
    canWalkAt: (x, z) => canWalkAt(x, z, birchPlot) && grounds.canWalkAt(x,z),
    setEnvironment: climate.configure,
    setDetail: climate.setDetail,
    visibility: climate.visibility,
    update(elapsed, camera) { climate.tick(elapsed,camera, camera ? Math.abs(camera.position.x - riverX(camera.position.z)) : 12) },
    dispose() {
      if (disposed) return
      disposed=true
      portraitRequests.abort()
      climate.dispose()
      scene.remove(group)
      scene.fog=previousFog
      const resources=new Set()
      group.traverse(object=>{
        if(object.geometry) resources.add(object.geometry)
        if(object.isInstancedMesh) resources.add(object)
        const materials=Array.isArray(object.material)?object.material:[object.material]
        for(const material of materials) {
          if(!material) continue
          resources.add(material)
          for(const value of Object.values(material)) if(value?.isTexture) resources.add(value)
          for(const uniform of Object.values(material.uniforms ?? {})) {
            if(uniform.value?.isTexture) resources.add(uniform.value)
          }
        }
      })
      resources.forEach(resource=>resource.dispose())
    }
  }
}
