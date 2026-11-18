import * as THREE from 'three'
import { surfaceTexture } from './world-materials.js'
import { atmosphere } from './world-atmosphere.js'
import { buildCourtyard } from './world-courtyard.js'
import { addForest } from './terrain-forest.js'
import { addMemorial, memorialPlots } from './terrain-memorial.js'

const WORLD = 190
const BRIDGE_END = 6.5
const WALK_WIDTH = 1.2
const WATER_LEVEL = 0
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

function riverX(z) {
  return 0.12 * z + 3.1 * sin(z * 0.076) + 1.7 * sin(z * 0.13)
}

function riverWidth(z) {
  return 3.55 + 1.35 * smooth(4, 24, abs(z)) + 0.55 * sin(z * 0.11)
}

function bridgeDeck(x) {
  return 2.1 - 0.95 * pow(x / BRIDGE_END, 2)
}

function ground(x, z) {
  const side = x - riverX(z)
  const bank = abs(side) - riverWidth(z)
  const terrace = smooth(-0.75, 2.6, bank)
  const lift = side < 0 ? 6.7 : 4.35
  const rise = smooth(3, side < 0 ? 40 : 24, bank)
  const relief = 0.5 * sin(z * 0.13 + x * 0.09) + 0.31 * cos(x * 0.23 - z * 0.11)
  const rolling = smooth(8, 22, bank) * relief
  const approach = exp(-0.14 * z * z) * (1 - smooth(0.4, 5, abs(abs(x) - BRIDGE_END)))
  const terrain = -1.25 + terrace * 2.33 + rise * lift + rolling
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
  const g = new THREE.PlaneGeometry(WORLD, WORLD, 184, 184).rotateX(-PI / 2)
  const p = g.attributes.position
  const colors = []
  const c = new THREE.Color()
  const green = new THREE.Color('#dbe7c3')
  const shadow = new THREE.Color('#b7c798')
  const hay = new THREE.Color('#f9f0cd')
  const shore = new THREE.Color('#b8b69c')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    p.setY(i, ground(x, z))
    const patch = 0.5 + 0.24 * sin(x * 0.14 + z * 0.2) + 0.16 * cos(z * 0.31 - x * 0.13) + 0.08 * sin(z * 1.1 + x * 0.77)
    c.copy(shadow).lerp(green, smooth(0.04, 0.67, patch)).lerp(hay, smooth(0.5, 1, patch) * 0.7)
    c.lerp(shore, 1 - smooth(0.4, 3.9, abs(x - riverX(z)) - riverWidth(z)))
    colors.push(c.r, c.g, c.b)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.computeVertexNormals()
  const land = mesh(group, g, new THREE.MeshStandardMaterial({ map: surfaceTexture('meadow',122), vertexColors: true, roughness: 1 }))
  land.userData.habitat = 'ground'
  land.receiveShadow = true
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

function mountainRanges(group) {
  const map=surfaceTexture('ridges');
  map.repeat.set(4,1);
  map.wrapT=THREE.ClampToEdgeWrapping;
  // Both rings have their own parallax and horizon. The sky stays visible through
  // the photographic alpha edge, with time-of-day haze applied by the atmosphere.
  for(const [radius,height,bottom,yaw,air] of [[220,104,-21,.81,.45],[140,61,-19,.08,.18]]){
    const material=new THREE.MeshBasicMaterial({map,side:THREE.BackSide,alphaTest:.24,fog:false});
    const ridge=mesh(group,new THREE.CylinderGeometry(radius,radius,height,112,1,true),material);
    ridge.position.y=bottom+height*.5;
    ridge.rotation.y=yaw;
    ridge.name='远山';
    ridge.userData.air=air;
    ridge.userData.habitat='ridge';
  }
}

function addBanks(group, riverbed) {
  const vertices=[], uvs=[], colors=[], indices=[];
  const strips=4, samples=220;
  for (const side of [-1,1]) {
    const start=vertices.length/3;
    for(let i=0; i<=samples; i++) {
      const z=-90+i*180/samples, width=riverWidth(z);
      for(let band=0;band<strips;band++){
        const offset=[-.4,.5,1.45,2.45+.4*Math.sin(z*.66)][band];
        const x=riverX(z)+side*(width+offset);
        vertices.push(x,ground(x,z)+.055,z);uvs.push(x*.8+z*.16,z*.79-x*.16);
        const wet=[.62,.78,.96,.98][band];
        colors.push(wet,wet,wet,[.96,1,.83,0][band]);
        if(i&&band){
          const d=start+i*strips+band;
          indices.push(d-strips-1,d-1,d,d-strips-1,d,d-strips);
        }
      }
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geo.setIndex(indices);geo.computeVertexNormals();
  mesh(group,geo,new THREE.MeshStandardMaterial({map:riverbed,vertexColors:true,side:THREE.DoubleSide,transparent:true,depthWrite:false,roughness:.76}));
}

function addWater(group, riverbed) {
  const positions = [], indices = [], banks = [];
  for (let i = 0; i <= 240; i++) {
    const z = -96 + 192 * i / 240
    const mid = riverX(z), w = riverWidth(z) + 1.15
    positions.push(mid - w, WATER_LEVEL, z, mid + w, WATER_LEVEL, z)
    banks.push(-1,1)
    if (i) {
      const a = i * 2
      indices.push(a - 2, a, a - 1, a - 1, a, a + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.setAttribute('bank',new THREE.Float32BufferAttribute(banks,1))
  const water = mesh(group, geo, new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, sun:{value:new THREE.Vector3()}, wet:{value:0}, tone:{value:1}, bed:{value:riverbed} },
    vertexShader: 'varying vec3 wp; varying float bankFactor; attribute float bank; void main(){wp=position;bankFactor=bank;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `
      varying vec3 wp; varying float bankFactor; uniform sampler2D bed; uniform float time,wet,tone; uniform vec3 sun;
      void main(){
        vec3 view=normalize(cameraPosition-wp);
        float t=mod(time,3600.);
        float wave=sin(wp.z*5.1-t*1.9+sin(wp.x*2.4+wp.z*.4))+sin(wp.z*9.-t*2.7+wp.x*2.)*.28;
        float coarse=sin(wp.x*1.1+wp.z*.8-t*.27)*.5+.5;
        vec3 norm=normalize(vec3(cos(wp.x*3.+wp.z*1.8-t)*.045,1.,wave*.105));
        float fres=pow(1.-max(dot(norm,view),0.),2.4);
        vec3 col=mix(vec3(.08,.23,.20),vec3(.22,.39,.31),coarse*.67+.12*wave);
        float shallow=smoothstep(.40,.91,abs(bankFactor));
        vec3 pebble=texture2D(bed,wp.xz*.65+norm.xz*.07).rgb;
        col=mix(col,pebble*vec3(.58,.80,.70),shallow*.8);
        col=mix(col,vec3(.58,.71,.73),.09+.72*fres);
        wave+=wet*.35*sin(length(fract(wp.xz*1.7)-.5)*43.-t*8.);
        float spec=pow(max(dot(normalize(view+sun),norm),0.),120.);
        col+=vec3(1.,.77,.42)*spec*.95;
        float ripple=smoothstep(1.04,1.22,wave)*smoothstep(.58,.9,coarse);
        col+=vec3(.16,.22,.18)*ripple;
        col=mix(col,vec3(.61,.70,.64),smoothstep(30.,130.,length(cameraPosition-wp))*.5);
        gl_FragColor=vec4(col*tone,1.);
        #include <colorspace_fragment>
      }`,
  }))
  return water.material.uniforms
}

function addBridge(group) {
  const archWidth = 4.5
  const spring = -0.38
  const archRise = 1.98
  const shape = new THREE.Shape()
  shape.moveTo(-BRIDGE_END, -1.55)
  shape.lineTo(-BRIDGE_END, bridgeDeck(-BRIDGE_END))
  for (let i = 1; i <= 36; i++) {
    const x = -BRIDGE_END + 2 * BRIDGE_END * i / 36
    shape.lineTo(x, bridgeDeck(x))
  }
  shape.lineTo(BRIDGE_END, -1.55)
  shape.lineTo(archWidth, -1.55)
  for (let i = 0; i <= 36; i++) {
    const a = i / 36 * PI
    shape.lineTo(archWidth * cos(a), spring + archRise * sin(a))
  }
  shape.lineTo(-archWidth, -1.55)
  shape.closePath()
  const arch = mesh(group, new THREE.ExtrudeGeometry(shape, { depth: 3.15, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: '#a39478', roughness: .98 }))
  arch.position.z = -1.575
  const colors = [], positions = []
  const stoneTints = ['#ac9d83','#b5a58b','#c3b59a','#9d947c','#afa58c']
  function face(a, b, c, d, tint) {
    const color = new THREE.Color(tint)
    for (const v of [a,b,c,a,c,d]) {
      positions.push(...v)
      colors.push(color.r, color.g, color.b)
    }
  }
  // Individual voussoirs follow the actual elliptical opening.
  for (const sign of [-1, 1]) {
    const z = sign * 1.588
    for (let i = 0; i < 28; i++) {
      const a = PI * i / 28 + .005, b = PI * (i + 1) / 28 - .005
      const corner = (theta, ox, oy) => [(archWidth + ox) * cos(theta), spring + (archRise + oy) * sin(theta), z]
      face(corner(a,0,0),corner(b,0,0),corner(b,.53,.29),corner(a,.53,.29),stoneTints[i % 5])
    }
    // Low masonry parapets: offsets and seams keep their silhouette legible.
    for (let i = 0; i < 17; i++) {
      const a = -BRIDGE_END + 2 * BRIDGE_END * i / 17 + .017
      const b = a + 2 * BRIDGE_END / 17 - .033
      const ya = bridgeDeck(a), yb = bridgeDeck(b)
      const outer = sign * 1.585, inner = sign * 1.29
      const h = .51 + .045 * sin(i * 3.7)
      face([a,ya,outer],[b,yb,outer],[b,yb+h,outer],[a,ya+h,outer],stoneTints[(i+2)%5])
      face([a,ya,inner],[b,yb,inner],[b,yb+h,inner],[a,ya+h,inner],stoneTints[(i+1)%5])
      face([a,ya+h,inner],[a,ya+h,outer],[b,yb+h,outer],[b,yb+h,inner],'#cec3ab')
      face([a,ya,inner],[a,ya,outer],[a,ya+h,outer],[a,ya+h,inner],'#94866f')
      face([b,yb,inner],[b,yb,outer],[b,yb+h,outer],[b,yb+h,inner],'#94866f')
    }
  }
  for (let i=0;i<30;i++) {
    const x = -BRIDGE_END + .014 + 2*BRIDGE_END*i/30
    const x2 = x + 2*BRIDGE_END/30 - .028
    for (let j=0;j<3;j++) {
      const z=-1.32+j*.88+.01, z2=z+.86
      face([x,bridgeDeck(x)+.012,z],[x,bridgeDeck(x)+.012,z2],[x2,bridgeDeck(x2)+.012,z2],[x2,bridgeDeck(x2)+.012,z],stoneTints[(i+2*j)%5])
    }
  }
  const geo=new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
  geo.computeVertexNormals()
  mesh(group,geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1})).userData.habitat='stone'
}

function scatterMeadow(group, random, birchPlot) {
  const positions=[], colors=[]
  const grassBase = new THREE.Color('#87925a')
  const grassTip = new THREE.Color('#c2c58b')
  const dummy = new THREE.Object3D()
  const rocks=[], blossoms=[]
  for (let i=0;i<31500;i++) {
    const x=random()*98-59, z=random()*85-39
    const bank=abs(x-riverX(z))-riverWidth(z)
    if (bank < .85 || (x>25.4 && x<34.5 && z>-10.6 && z<-2.4)) continue
    const distance=pathDistance(x,z)
    if (distance<1.12 || (abs(z)<1.75 && abs(x)<BRIDGE_END+1.3)) continue
    if (Math.hypot(x+12,z-6)<1.12) continue
    if (birchPlot && Math.hypot(x - birchPlot.x, z - birchPlot.z) < 1.15) continue
    const y=ground(x,z)
    const angle=random()*PI*2
    const damp=bank<3.25
    const tall=(.09+.17*random())*(damp?1.62:1)
    const light=.72+random()*.39
    const b=grassBase.clone().multiplyScalar(light*.87)
    const t=grassTip.clone().multiplyScalar(light*.9)
    for (let j=0;j<4;j++) {
      const a=angle+j*2.4
      const tx=x+sin(a)*.09, tz=z+cos(a)*.09
      const w=.009+random()*.016
      positions.push(tx-w*cos(a),y-.025,tz+w*sin(a),tx+w*cos(a),y-.025,tz-w*sin(a),tx+sin(a)*.11+.06,y+tall*(.68+random()*.5),tz+cos(a)*.11)
      colors.push(b.r,b.g,b.b,b.r,b.g,b.b,t.r,t.g,t.b)
    }
    if (!damp && random()<.035 && sin(x*.48+z*.7)>.15) {
      blossoms.push([x,y+tall*.91,z,.022+random()*.028,random()<.78?'#fff7ce':'#e5bd69'])
    }
  }
  const meadow=new THREE.BufferGeometry()
  meadow.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  meadow.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
  mesh(group,meadow,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide})).userData.habitat='grass'

  const stoneColors=['#7d8479','#94998c','#a0a294','#b1b4a1','#868a77']
  for(let i=0;i<1550;i++) {
    const z=random()*149-74.5
    const side=random()>.5?1:-1
    const x=riverX(z)+side*(riverWidth(z)+random()*2.75-1.15)
    if (abs(z)<2.05 && abs(x)<7) continue
    const scale=.045+pow(random(),3)*.57
    rocks.push([x,ground(x,z)+scale*.10,z,scale,stoneColors[i%5]])
  }
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
  mountainRanges(group)
  buildGround(group)
  trailGeometry(group)
  const riverbed=surfaceTexture('riverbed')
  addBanks(group,riverbed)
  const water=addWater(group,riverbed)
  addBridge(group)
  const birchPlot = memorial?.place === 'entrance' ? memorialPlots.entrance : null
  scatterMeadow(group,random,birchPlot)
  addForest(group,heightAt,riverX)
  const portraitRequests = new AbortController()
  addMemorial(group,heightAt,memorial,portraitRequests.signal)
  const grounds = buildCourtyard(group,heightAt,memorial,portraitRequests.signal)
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
        }
      })
      resources.forEach(resource=>resource.dispose())
    }
  }
}
