import * as THREE from 'three'
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

// Repeating substrate supplies fine-scale meadow variation beneath the grass blades.
function soilTexture(random) {
  const size = 192
  const pixels = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = Math.floor(i / size)
    const striation = 5 * sin(2 * PI * (8 * x + 13 * y) / size) + 4 * sin(2 * PI * (x - 3 * y) / size)
    const luminance = 213 + 27 * random() + striation
    pixels.set([luminance + 4, luminance + 5, luminance - 4, 255], i * 4)
  }
  const tex = new THREE.DataTexture(pixels, size, size)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(88, 88)
  tex.generateMipmaps = true
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  return tex
}

function buildGround(group, random) {
  const g = new THREE.PlaneGeometry(WORLD, WORLD, 184, 184).rotateX(-PI / 2)
  const p = g.attributes.position
  const colors = []
  const c = new THREE.Color()
  const green = new THREE.Color('#94a765')
  const shadow = new THREE.Color('#617f55')
  const hay = new THREE.Color('#bac083')
  const shore = new THREE.Color('#a9a486')
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
  const land = mesh(group, g, new THREE.MeshStandardMaterial({ map: soilTexture(random), vertexColors: true, roughness: 1 }))
  land.receiveShadow = true
}

function trailGeometry(group) {
  const pts = trail.getPoints(230)
  const positions = [], cols = [], faces = []
  const earth = new THREE.Color('#cdbe9f'), verge = new THREE.Color('#a4a778')
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
      cols.push(c.r, c.g, c.b)
      if (i > 0 && j < 4) {
        const a = i * 5 + j
        faces.push(a - 5, a - 4, a, a, a - 4, a + 1)
      }
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  geo.setIndex(faces)
  geo.computeVertexNormals()
  mesh(group, geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }))
}

function addRidge(group, radius, base, peaks, tint, phase) {
  const geo = new THREE.BufferGeometry()
  const positions = [], colors = [], indices = []
  const steps = 256, rows = 7
  const palette = new THREE.Color(tint)
  for (let j = 0; j <= rows; j++) {
    const t = j / rows
    for (let i = 0; i <= steps; i++) {
      const a = i / steps * 2 * PI
      const wave = sin(3 * a + phase) * 0.38 + cos(6 * a - phase) * 0.26 + sin(13 * a + phase) * 0.12 + 0.09 * cos(31 * a + phase) + 0.045 * cos(63 * a)
      const shoulder = 0.10 * sin(a * 12 + phase + 2 * t) * sin(t * PI)
      const r = radius * (0.77 + t * 0.23 + 0.06 * sin(3 * a + phase) + shoulder)
      positions.push(r * cos(a), -3 + t * (base + peaks * wave) + sin(t * PI) * sin(a * 11 + phase) * 3, r * sin(a))
      const c = palette.clone().multiplyScalar(0.84 + 0.13 * t + 0.12 * sin(11 * a + phase))
      colors.push(c.r, c.g, c.b)
      if (j && i) {
        const b = j * (steps + 1) + i
        indices.push(b, b - 1, b - steps - 1, b - steps - 1, b - 1, b - steps - 2)
      }
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  mesh(group, geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }))
}

function skyAndLights(scene, group) {
  const sky = mesh(group, new THREE.SphereGeometry(420, 40, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
      varying vec3 vPos;
      float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y); }
      void main(){
        vec3 d=normalize(vPos); float h=max(d.y,0.);
        vec3 sun=normalize(vec3(-.79,.34,-.50));
        float glow=max(dot(d,sun),0.);
        vec3 col=mix(vec3(.81,.83,.75), vec3(.22,.48,.72),pow(h,.5));
        col+=vec3(.23,.12,.035)*pow(glow,8.);
        vec2 p=d.xz/(max(h,.04)+.22)*vec2(2.1,6.);
        float cloud=.58*noise(p)+.28*noise(2.1*p)+.14*noise(4.4*p);
        col=mix(col,vec3(.96,.90,.78),.58*smoothstep(.52,.78,cloud)*smoothstep(.02,.16,h));
        col+=vec3(1.,.76,.40)*(pow(glow,290.)*.26+smoothstep(.9996,.9999,glow)*.9);
        gl_FragColor=vec4(col,1.);
        #include <colorspace_fragment>
      }`,
  }))
  sky.renderOrder = -2
  group.add(new THREE.HemisphereLight(0xfff3d6, 0x9aa989, 1.53))
  const sun = new THREE.DirectionalLight(0xffe2ad, 2.06)
  sun.position.set(-54, 45, -22)
  group.add(sun)
  scene.fog = new THREE.FogExp2('#cedacf', 0.0061)
  addRidge(group, 216, 43, 39, '#abbcc0', 0.4)
  addRidge(group, 170, 32, 28, '#8ba5aa', 2.6)
  addRidge(group, 133, 20, 17, '#79958c', 4.9)
}

function addWater(group) {
  const positions = [], indices = []
  for (let i = 0; i <= 240; i++) {
    const z = -96 + 192 * i / 240
    const mid = riverX(z), w = riverWidth(z) + 1.15
    positions.push(mid - w, WATER_LEVEL, z, mid + w, WATER_LEVEL, z)
    if (i) {
      const a = i * 2
      indices.push(a - 2, a, a - 1, a - 1, a, a + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  const water = mesh(group, geo, new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: 'varying vec3 wp; void main(){wp=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `
      varying vec3 wp; uniform float time;
      void main(){
        vec3 view=normalize(cameraPosition-wp);
        float t=mod(time,3600.);
        float wave=sin(wp.z*5.1-t*1.9+sin(wp.x*2.4+wp.z*.4))+sin(wp.z*9.-t*2.7+wp.x*2.)*.28;
        float coarse=sin(wp.x*1.1+wp.z*.8-t*.27)*.5+.5;
        vec3 norm=normalize(vec3(cos(wp.x*3.+wp.z*1.8-t)*.045,1.,wave*.105));
        float fres=pow(1.-max(dot(norm,view),0.),2.4);
        vec3 col=mix(vec3(.08,.23,.20),vec3(.22,.39,.31),coarse*.67+.12*wave);
        col=mix(col,vec3(.52,.70,.67),.17+.68*fres);
        vec3 sun=normalize(vec3(-.79,.34,-.50));
        float spec=pow(max(dot(normalize(view+sun),norm),0.),120.);
        col+=vec3(1.,.77,.42)*spec*.95;
        float ripple=smoothstep(1.04,1.22,wave)*smoothstep(.58,.9,coarse);
        col+=vec3(.16,.22,.18)*ripple;
        col=mix(col,vec3(.61,.70,.64),smoothstep(30.,130.,length(cameraPosition-wp))*.5);
        gl_FragColor=vec4(col,1.);
        #include <colorspace_fragment>
      }`,
  }))
  return water.material.uniforms.time
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
  mesh(group,geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1}))
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
    if (bank < .85) continue
    const distance=pathDistance(x,z)
    if (distance<1.12 || (abs(z)<1.75 && abs(x)<BRIDGE_END+1.3)) continue
    if (Math.hypot(x+12,z-6)<1.12) continue
    if (birchPlot && Math.hypot(x - birchPlot.x, z - birchPlot.z) < 1.15) continue
    const y=ground(x,z)
    const angle=random()*PI*2
    const damp=bank<3.25
    const tall=(.12+.23*random())*(damp?1.65:1)
    const light=.72+random()*.39
    const b=grassBase.clone().multiplyScalar(light*.87)
    const t=grassTip.clone().multiplyScalar(light)
    for (let j=0;j<4;j++) {
      const a=angle+j*2.4
      const tx=x+sin(a)*.09, tz=z+cos(a)*.09
      const w=.025+random()*.028
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
  mesh(group,meadow,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}))

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
    group.add(object)
  }
  scatter(rocks,new THREE.IcosahedronGeometry(1,0),false)
  scatter(blossoms,new THREE.IcosahedronGeometry(1,0),true)
}

export function buildTerrain(scene, memorial) {
  const group=new THREE.Group()
  group.name='Riverbend valley'
  const previousFog=scene.fog
  scene.add(group)
  const random=randomSource(746)
  skyAndLights(scene,group)
  buildGround(group,random)
  trailGeometry(group)
  const waterTime=addWater(group)
  addBridge(group)
  const birchPlot = memorial?.place === 'entrance' ? memorialPlots.entrance : null
  scatterMeadow(group,random,birchPlot)
  addForest(group,heightAt,riverX)
  const portraitRequests = new AbortController()
  addMemorial(group,heightAt,memorial,portraitRequests.signal)
  let disposed=false
  return {
    heightAt,
    canWalkAt: (x, z) => canWalkAt(x, z, birchPlot),
    update(elapsed) { waterTime.value=elapsed },
    dispose() {
      if (disposed) return
      disposed=true
      portraitRequests.abort()
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
