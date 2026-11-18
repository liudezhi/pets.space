import * as THREE from 'three'
import { surfaceTexture } from './world-materials.js'
import { addWishingOak } from './forest-oak.js'

const TAU = 2 * Math.PI
const UP = new THREE.Vector3(0, 1, 0)

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function paintedTexture(size, paint) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  paint(canvas.getContext('2d'), size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function plantMap(name) {
  const texture = surfaceTexture(name)
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

// A spray contains leaves at many angles. Fold an upward skylight normal into
// the card's normal and give both faces equal transmission in backlight.
function sprayMaterial(map, alphaTest = .16) {
  const mat = new THREE.MeshLambertMaterial({map,alphaTest,alphaToCoverage:true,side:THREE.DoubleSide})
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>',
      '#include <defaultnormal_vertex>\ntransformedNormal = normalize(.27*normalize(transformedNormal) + mat3(viewMatrix)*vec3(0.,.80,0.));')
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\nnormal *= faceDirection;')
  }
  mat.customProgramCacheKey=()=> 'spray-transmission'
  return mat
}

function plantBatch(group, material, instances, role, label, anchored = false) {
  const geometry = new THREE.PlaneGeometry(1, 1)
  if (anchored) geometry.translate(0, .5, 0)
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
  mesh.name = label
  const random = seededRandom(6341)
  // Seasons reduce the submitted instance count. Shuffle across patches so that
  // thinning reveals twig silhouettes everywhere rather than erasing whole trees.
  for (let end = instances.length - 1; end > 0; end--) {
    const i = Math.floor(random() * (end + 1))
    const entry = instances[end]
    instances[end] = instances[i]
    instances[i] = entry
  }
  const helper = new THREE.Object3D()
  instances.forEach(({ position, rotation, size, color }, i) => {
    helper.position.copy(position)
    helper.rotation.set(...rotation)
    helper.scale.set(size[0], size[1], 1)
    helper.updateMatrix()
    mesh.setMatrixAt(i, helper.matrix)
    if (color) mesh.setColorAt(i, color)
  })
  if (role) mesh.userData.habitat = role
  mesh.computeBoundingSphere()
  group.add(mesh)
}

function paperBark(random) {
  const map = paintedTexture(384, (ctx, size) => {
    ctx.fillStyle = '#c8c4af'
    ctx.fillRect(0, 0, size, size)
    // Thin overlapping sheets of bark expose buff-colored bands and horizontal lenticels.
    for (let i = 0; i < 1450; i++) {
      const x = random() * size, y = random() * size
      ctx.fillStyle = i % 3 ? 'rgba(252,248,225,.20)' : 'rgba(102,99,83,.15)'
      ctx.fillRect(x, y, 3 + random() ** 2 * 77, .6 + random() ** 2 * 6)
    }
    function fissure(x,y,w,h) {
      ctx.beginPath()
      ctx.moveTo(x - w/2, y)
      ctx.lineTo(x - w*.19, y - h*.73)
      ctx.lineTo(x + w*.08, y - h*.18)
      ctx.lineTo(x + w*.5, y - h*.29)
      ctx.lineTo(x + w*.19, y + h*.27)
      ctx.lineTo(x - w*.08, y + h*.51)
      ctx.closePath()
      ctx.fill()
    }
    for (let i = 0; i < 220; i++) {
      const x = random()*size, y = random()*size
      const w = 3 + random() ** 2 * 82
      const h = .7 + random() ** 4 * 9
      ctx.fillStyle = random() > .3 ? '#67675d' : '#444941'
      for (const dx of [-size,0,size]) fissure(x + dx,y,w,h)
    }
  })
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  return map
}

// A ring smoothly turns with each curved stem; UV distance follows its length so
// short forked limbs carry the same bark scale as the trunk.
function woodBatch() {
  const positions = [], indices = [], colors = [], uv = []
  const basalBark = new THREE.Color('#615d4c')
  function tube(points, radii, segments, color, barkScale = 1.5, rootCollar = false) {
    const base = positions.length/3
    let distance = 0
    let right = new THREE.Vector3(1,0,0)
    const grain = new THREE.Color()
    points.forEach((center,k) => {
      if (k) distance += center.distanceTo(points[k-1])
      const axis = points[Math.min(points.length-1,k+1)].clone().sub(points[Math.max(0,k-1)]).normalize()
      right.addScaledVector(axis, -axis.dot(right))
      if (right.lengthSq() < .01) right.copy(UP).cross(axis)
      right.normalize()
      const across = axis.clone().cross(right).normalize()
      for(let j=0;j<=segments;j++) {
        const a = TAU*j/segments
        const radial = radii[k] * (1 + .052*Math.sin(3*a + .37*k) + .026*Math.cos(7*a+.12*k))
        const v = center.clone().addScaledVector(right,radial*Math.cos(a)).addScaledVector(across,radial*Math.sin(a))
        positions.push(v.x,v.y,v.z)
        grain.copy(color)
        if (rootCollar) grain.lerp(basalBark,Math.exp(-distance*1.65)*(.86+.13*Math.cos(3*a)))
        grain.multiplyScalar(.82 + .13*Math.cos(a-.4) + .05*Math.sin(3*a))
        colors.push(grain.r,grain.g,grain.b)
        uv.push(j / segments,distance/barkScale)
        if (k && j) {
          const d=base+k*(segments+1)+j, c=d-1, b=d-segments-1, a=b-1
          indices.push(a,b,c,b,d,c)
        }
      }
    })
  }
  function finish(group, material, name) {
    const geo=new THREE.BufferGeometry()
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    const obj=new THREE.Mesh(geo,material)
    obj.name=name
    group.add(obj)
  }
  return {tube,finish}
}

function birchStand(group,heightAt,shade) {
  const random = seededRandom(1631)
  const wood=woodBatch(), twigs=woodBatch(), leaves=[]
  const paper=new THREE.Color('#f2efe2'), shoot=new THREE.Color('#776c55')
  const stems=[[-38.9,25.1,9.7,.27,-.34,.64],[-37.1,23.5,10.8,.19,.78,-.36],[-36.9,22.3,8.4,.155,-.16,-.7]]
  for(const [x,z,h,r,lean,tilt] of stems) {
    const y=heightAt(x,z)-.1
    const phase=random()*TAU
    function stemAt(t) {
      return new THREE.Vector3(x+lean*t+.19*Math.sin(t*5+phase)*t, y+h*t, z+tilt*t+.22*Math.sin(t*3.2+phase)*t)
    }
    const sections=[0,.04,.14,.34,.54,.70,.85,1]
    wood.tube(sections.map(stemAt),sections.map(t=>r*(1-t*.98)*(1+.44*Math.exp(-t*20))),14,paper,1.25,true)
    for (let k=0;k<5;k++) {
      const a=phase+k*TAU/5+.23*Math.sin(k+phase)
      const root = (distance, rise, turn) => {
        const px=x+Math.cos(a+turn)*distance, pz=z+Math.sin(a+turn)*distance
        return new THREE.Vector3(px,heightAt(px,pz)+rise,pz)
      }
      wood.tube([root(r*.45,.15,0),root(r*1.52,.045,.12),root(r*2.3,-.045,.26),root(r*3,-.11,.36)],
        [r*.41,r*.26,r*.13,.004],7,new THREE.Color('#98927a'),1.4)
    }
    shade(x,z,2.2,1.55,.75)
    const heights=Array.from({length:18},()=>.23+random()*.74).sort((a,b)=>a-b)
    for (const t of heights) {
      const a=random()*TAU
      const span=(.35+2.7*Math.sin(t*Math.PI))*(.61+random()*.66)
      const climb=.35+span*(.30+random()*.34)
      const start=stemAt(t), bend=random()*.42-.21
      const point=(reach,rise,offset=0)=>new THREE.Vector3(
        start.x+Math.cos(a+offset)*reach, start.y+rise, start.z+Math.sin(a+offset)*reach)
      const fork=point(span*.46,climb*.73,bend)
      const elbow=point(span*.79,climb,bend*.39)
      const end=point(span,climb*(.81+random()*.19))
      const radius=r*(1-t*.6)*(.18+random()*.22)
      wood.tube([start,fork,elbow],[radius,radius*.61,radius*.26],7,paper,.95)
      twigs.tube([elbow,end],[radius*.3,.009],5,shoot)
      for(let j=0;j<4;j++){
        const origin=fork.clone().lerp(end,.16+j*.19)
        const sign=j%2?1:-1, heading=a+sign*(.42+random()*.61), length=.40+random()*.70
        const middle=origin.clone().add(new THREE.Vector3(Math.cos(heading)*length*.63,.03+random()*.13,Math.sin(heading)*length*.63))
        const tip=origin.clone().add(new THREE.Vector3(Math.cos(heading)*length,-.10-random()*.50,Math.sin(heading)*length))
        twigs.tube([origin,middle,tip],[.018,.011,.002],4,shoot)
        for(let n=0;n<3;n++){
          const spread=.67+random()*.53, sx=(n-1)*.14
          const anchor=middle.clone().lerp(tip,.24+random()*.68)
          anchor.x+=sx*Math.cos(heading+.8)
          anchor.y-=.13
          leaves.push({position:anchor, rotation:[random()*.96-.43,heading+(n-1)*.8,sign*(.34+random()*.57)],
            size:[spread*(.77+random()*.18),spread],color:new THREE.Color().setRGB(.87+random()*.19,.88+random()*.17,.78+random()*.17)})
        }
      }
    }
    shade(x+.34,z-.4,4.0,2.7,.24)
  }
  const barkMap=paperBark(random)
  wood.finish(group,new THREE.MeshStandardMaterial({map:barkMap,bumpMap:barkMap,bumpScale:.015,vertexColors:true,roughness:.98}),'入口 · 桦树主干')
  twigs.finish(group,new THREE.MeshLambertMaterial({vertexColors:true}),'桦树细梢')
  plantBatch(group,sprayMaterial(plantMap('birch-spray')),leaves,'leaves','桦树叶幕')
}

function leaflessCrown() {
  const random = seededRandom(5952)
  return paintedTexture(256, ctx=>{
    ctx.lineCap='round'
    function fork(x,y,angle,length,width,level){
      const bent=angle+(random()-.52)*.42
      const mx=x+Math.cos(angle)*length*.52, my=y+Math.sin(angle)*length*.52
      const nx=mx+Math.cos(bent)*length*.5, ny=my+Math.sin(bent)*length*.5
      ctx.strokeStyle=level>3?'#695e48':'#797360'
      ctx.lineWidth=width
      ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(mx,my,nx,ny);ctx.stroke()
      if (level===0) return
      fork(nx,ny,bent+(.17+random()*.48),length*(.61+random()*.16),width*.66,level-1)
      fork(nx,ny,bent-(.17+random()*.55),length*(.62+random()*.19),width*.64,level-1)
    }
    fork(130,254,-1.56,54,7,6)
    fork(130,213,-2.25,42,4.5,5)
    fork(131,202,-.85,45,4.2,5)
  })
}

function woodland(group,heightAt,riverX,shade) {
  const random=seededRandom(2094)
  const pines=[],crowns=[],branches=[],trees=[]
  function place(x,z,h,conifer,shadow=true) {
    if(Math.abs(x-riverX(z))<6.8) return
    if(trees.some(tree=>Math.hypot(tree.x-x,tree.z-z)<(tree.h+h)*.115)) return
    trees.push({x,z,h})
    const y=heightAt(x,z)-.08
    const yaw=random()*Math.PI
    const spread=(conifer?.55:.9)*h*(.79+.49*random())
    const light=.76+random()*.47
    const tint=new THREE.Color().setRGB(light*(.91+random()*.12),light,light*(.83+random()*.16))
    const target=conifer?pines:crowns
    const px=random()>.5?1:-1
    for(const a of [yaw,yaw+Math.PI*.50]){
      target.push({position:new THREE.Vector3(x,y,z), rotation:[0,a,0],size:[spread*px,h],color:tint})
      if(!conifer) branches.push({position:new THREE.Vector3(x,y,z),rotation:[0,a,0],size:[spread*.98,h*.96],color:tint})
    }
    if(shadow) shade(x+.19*h,z+h*.08,h*(conifer?.48:.64),h*.42,.67)
  }

  // Rocky higher shoulders sustain conifers. The more open, rounded groves trace
  // the moisture-rich lower slopes, with gaps where the bridge and river are seen.
  const groups=[
    [-61,-27,20,13,18,8,.47],[-46,-43,38,14,10,8.5,.58],[-27,-65,42,21,13,7.6,.60],
    [7,-69,35,20,11,6.4,.57],[35,-58,48,17,11,8.4,.71],[59,-34,28,10,18,7.7,.58],
    [72,-8,32,12,17,9.3,.79],[60,30,31,12,17,8.3,.60],[40,55,29,16,10,7,.41],
    [10,61,25,17,10,8,.52],[-45,60,29,19,10,9.1,.58],[-67,31,28,9,16,8.2,.38],
    [-43,-14,10,7,4.2,5,.08],[-30,-28,11,6.5,5,4.7,.14],[41,10,11,7,4,5.6,.05],
    [47,-29,12,8,4.9,5,.08],
  ]
  for(const [cx,cz,count,rx,rz,base,pineShare] of groups){
    const bend=random()*TAU
    for(let i=0;i<count;i++){
      const a=random()*TAU, rr=Math.sqrt(random()), d=rr*(.8+.24*Math.sin(a*3+bend))
      const x=cx+Math.cos(a)*rx*d, z=cz+Math.sin(a)*rz*d
      const h=base*(.4+random()*.57+(1-rr)*.34)
      place(x,z,h, random()<pineShare,Math.hypot(x,z)<50)
    }
  }
  // A few open-grown alders mark the turns in the river, below the distant woods.
  for(const [x,z,h] of [[-21,-21,5.2],[-21.9,-23.5,3.1],[9.4,34,4.9],[11.4,35.8,3.4],[-45,7.5,6],[-46,9.2,3.5],[38,-23,5.2],[-27,44.5,4.8]]) place(x,z,h,false)
  for(const [name,entries] of [['conifer',pines],['oak',crowns]]){
    plantBatch(group,new THREE.MeshBasicMaterial({map:plantMap(name),alphaTest:.28,side:THREE.DoubleSide}),entries,name,'谷地林缘 · '+name,true)
  }
  plantBatch(group,new THREE.MeshLambertMaterial({map:leaflessCrown(),alphaTest:.29,side:THREE.DoubleSide}),branches,null,'谷地林缘 · 落叶乔木冬枝',true)
}

function meadowIslands(group,heightAt,riverX,pathDistance) {
  const random=seededRandom(70931), oat=[],yarrow=[]
  // Narrow swaths on the uphill margins leave a clear mineral verge along the path.
  // The two memorial sites, courtyard floor and bridge are kept clear at every season.
  const drifts=[
    [-42.3,26.6,2.4,1.25],[-36.4,29.4,1.65,.58],[-36,20.2,2.2,.78],[-32.1,20.6,1.15,.79],
    [-35.5,30.9,2.7,1.33],[-28,25.6,2.55,.72],[-25,22.2,1.65,.82],[-23.2,16.8,1.54,1.1],
    [-17,11.9,2.05,.68],[-11.7,3.4,1.65,.88],[-12.8,9.4,1.55,.70],[-8.3,12.2,1.8,.81],
    [-10.8,-1.6,1.2,.86],[-8.1,-4,2.1,1.35],[8.9,-7.8,1.5,.76],[12.1,-9.8,1.38,.70],
    [13.3,-16.1,1.7,.81],[16.2,-18.6,2.45,1.03],[20,-12.8,1.92,.86],[22.8,-6.8,1.4,.58],
    [23.6,-3.3,1.45,.91],[34.7,-12.3,2.35,.94],
  ]
  for(const [cx,cz,rx,rz] of drifts){
    const angle=random()*TAU, lean=random()*.14-.07
    const seeds=7+Math.floor(random()*14)
    for(let j=0;j<seeds;j++){
      const a=random()*TAU,r=Math.sqrt(random()), dx=Math.cos(a)*r*rx, dz=Math.sin(a)*r*rz
      const x=cx+dx*Math.cos(angle)-dz*Math.sin(angle),z=cz+dx*Math.sin(angle)+dz*Math.cos(angle)
      if(pathDistance(x,z)<1.62 || Math.abs(x-riverX(z))<6.2 || Math.hypot(x+12,z-6)<1.52 || Math.hypot(x+34.5,z-23.5)<1.44) continue
      const flower=j<3 && random()<.76
      const h=(flower?.33:.29)+random()*(flower?.25:.44)+(1-r)*.13
      const w=h*(.63+random()*.42)
      const bright=.68+random()*.44
      const color=new THREE.Color().setRGB(bright*(.95+random()*.12),bright,bright*(.8+random()*.18))
      const heading=random()*TAU, y=heightAt(x,z)-.035
      for(let n=0;n<2;n++) {
        (flower?yarrow:oat).push({position:new THREE.Vector3(x,y,z),
          rotation:[lean,heading+n*1.5,random()*.16-.08],size:[w,h],color})
      }
    }
  }
  // Seasonal density and wind act on the flat sprays, while the photograph keeps
  // individual stalks and seed heads readable within a single draw for each species.
  plantBatch(group,sprayMaterial(plantMap('meadow-oat'),.15),oat,'leaves','坡缘 · 野燕麦',true)
  plantBatch(group,sprayMaterial(plantMap('meadow-yarrow'),.17),yarrow,'flowers','坡缘 · 蓍草',true)
}

function shadeBatch(group,heightAt) {
  const pos=[],uv=[],indices=[]
  function patch(x,z,rx,rz,intensity){
    const seg=6, start=pos.length/3
    for(let j=0;j<=seg;j++) for(let i=0;i<=seg;i++){
      const u=i/seg,v=j/seg,px=x+(u-.5)*rx*2,pz=z+(v-.5)*rz*2
      pos.push(px,heightAt(px,pz)+.021,pz)
      // The outer half of the same atlas is a lighter contact halo for the small plants.
      uv.push((u+(intensity<.4?1:0))*.5,1-v)
      if(i&&j){const end=start+j*(seg+1)+i;indices.push(end-seg-2,end-1,end-seg-1,end-1,end,end-seg-1)}
    }
  }
  function finish(){
    const tex=paintedTexture(256,ctx=>{
      const random=seededRandom(9905)
      for(let tile=0;tile<2;tile++){
        const x=64+tile*128,y=128
        ctx.save();ctx.translate(x,y);ctx.scale(1,2)
        const shadow=ctx.createRadialGradient(0,0,0,0,0,61)
        shadow.addColorStop(0,tile?'rgba(30,33,24,.16)':'rgba(30,33,24,.33)')
        shadow.addColorStop(.48,tile?'rgba(30,33,24,.09)':'rgba(30,33,24,.17)')
        shadow.addColorStop(1,'rgba(30,33,24,0)')
        ctx.fillStyle=shadow;ctx.fillRect(-64,-64,128,128)
        for(let j=0;j<65;j++){
          const a=random()*TAU,r=Math.sqrt(random())*42,px=Math.cos(a)*r,pz=Math.sin(a)*r
          const wave=ctx.createRadialGradient(px,pz,0,px,pz,8+random()*11)
          wave.addColorStop(0,tile?'rgba(28,33,24,.07)':'rgba(28,33,24,.10)');wave.addColorStop(1,'rgba(28,33,24,0)')
          ctx.fillStyle=wave;ctx.fillRect(px-22,pz-22,44,44)
        }
        ctx.restore()
      }
    })
    const geo=new THREE.BufferGeometry()
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices)
    const shade=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}))
    shade.name='树荫 · 地表接触与斑影'
    group.add(shade)
  }
  return {patch,finish}
}

export function addForest(group,heightAt,riverX,pathDistance = () => Infinity) {
  const groundShade=shadeBatch(group,heightAt)
  birchStand(group,heightAt,groundShade.patch)
  woodland(group,heightAt,riverX,groundShade.patch)
  groundShade.finish()
  meadowIslands(group,heightAt,riverX,pathDistance)
  addWishingOak(group,heightAt)
}
