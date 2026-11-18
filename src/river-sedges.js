import * as THREE from 'three'
import { surfaceTexture } from './world-materials.js'

function randomSource(seed) {
  return () => ((seed = (Math.imul(seed,1664525) + 1013904223) >>> 0) / 4294967296)
}

// A single reed culm with alternate blade sheaths and branching spikelets. Bake the
// silhouette once; transparent tips are antialiased and mipmapped in distant clumps.
function reedTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 384
  const ctx = canvas.getContext('2d')
  const random = randomSource(1723)
  const stem = t => [61 + 12*t + 64*t*t, 381 - 367*t]
  const curve = (a,b,c,width,color) => {
    ctx.beginPath()
    ctx.moveTo(...a)
    ctx.quadraticCurveTo(...b,...c)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke()
  }
  ctx.lineCap = 'round'
  curve(stem(0),[67,198],stem(1),2.7,'#aaa778')
  curve([62,381],[68,198],stem(1),.9,'#e4d9ab')
  for (let i=0;i<6;i++) {
    const t=.12 + i*.092, dir=i%2 ? 1 : -1
    const [x,y]=stem(t), reach=25+random()*32, lift=20+random()*26
    const elbow=[x+dir*reach*.48,y-lift], tip=[x+dir*reach,y-lift*(.55+random()*.9)]
    ctx.beginPath()
    ctx.moveTo(x,y+7)
    ctx.quadraticCurveTo(elbow[0],elbow[1]-3,...tip)
    ctx.quadraticCurveTo(elbow[0],elbow[1]+4,x,y+7)
    ctx.fillStyle=i%2?'#9d9b66':'#c0bb85'
    ctx.fill()
    curve([x,y+5],elbow,tip,1,'#d0c797')
  }
  // Panicle branches spring from separate nodes along the rachis, lean out, and
  // bow under the weight of smaller alternating sprays.
  for(let node=0;node<11;node++) {
    const t=.70 + node*.027, [x,y]=stem(t)
    const spread=10+28*Math.sin((node+1)/13*Math.PI)
    for(let j=0;j<3;j++) {
      const side=(node+j)%2?1:-1, width=side*spread*(.7+random()*.5)
      const rise=(12+13*random())*(1-node*.038)
      const start=[x,y], bend=[x+width*.50,y-rise*.95], end=[x+width,y-rise*.68]
      curve(start,bend,end,.9,'#ab9772')
      for(let k=1;k<=8;k++) {
        const u=k/8, q=1-u
        const bx=q*q*x+2*q*u*bend[0]+u*u*end[0], by=q*q*y+2*q*u*bend[1]+u*u*end[1]
        const fork=(3+random()*5)*side, drop=k%2?-4:2
        curve([bx,by],[bx+fork*.5,by+drop-.9],[bx+fork,by+drop+.5],1.7,k%3?'#c7b899':'#9e886c')
        curve([bx+fork,by+drop],[bx+fork*1.1,by+drop],[bx+fork*1.4,by+drop-.6],.65,'#e3d4b1')
      }
    }
  }
  // Empty canvas texels contain premultiplied black. Seed their colour before
  // building mipmaps so the fine grain heads stay straw-coloured at a distance.
  const {data}=ctx.getImageData(0,0,canvas.width,canvas.height)
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]>0) continue
    data[i]=181;data[i+1]=169;data[i+2]=131
  }
  const texture=new THREE.DataTexture(new Uint8Array(data.buffer),canvas.width,canvas.height)
  texture.flipY=true;texture.generateMipmaps=true
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter
  texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true
  texture.anisotropy=4
  return texture
}

export function addRiverSedges(group,ground,riverX,riverWidth) {
  const random=randomSource(93075)
  const near=[], far=[]
  for(const side of [-1,1]) {
    for(let z=-67+random()*5; z<67;) {
      const foreground=Math.abs(z)<31
      z+=foreground?1.45+random()*2.4:4+random()*5
      if(Math.abs(z)<3.6) continue
      const verge=.08+random()*1.05
      const x=riverX(z)+side*(riverWidth(z)+verge)
      const clump={x,z,side,size:.64+random()*.48}
      const bank=foreground?near:far
      bank.push(clump)
    }
  }
  const base={p:[],c:[],uv:[],n:[]}, stems={p:[],c:[],uv:[],n:[]}
  const foot=new THREE.Color('#b2b492'), tip=new THREE.Color('#fff7db')
  function card(batch,x,y,z,height,width,angle,lean,light) {
    const wx=Math.cos(angle)*width, wz=Math.sin(angle)*width
    batch.p.push(x-wx,y,z-wz, x+wx,y,z+wz, x+lean*height*2,y+height*2,z-.14*height)
    const mirror=random()<.5
    batch.uv.push(mirror?1.5:-.5,0,mirror?-.5:1.5,0,.5,2)
    for(const color of [foot,foot,tip]) {
      batch.c.push(color.r*light,color.g*light,color.b*light)
      batch.n.push(.15*Math.sin(angle),.985,.09*Math.cos(angle))
    }
  }
  // Keep the nearest plants first so the scene's low-detail draw range preserves
  // the bank silhouettes next to the public footpaths.
  for(const {x,z,side,size} of [...near.sort((a,b)=>Math.abs(a.z)-Math.abs(b.z)),...far]) {
    const plants=2+Math.floor(random()*4)
    for(let j=0;j<plants;j++) {
      const pz=z+(random()-.5)*1.08, px=x+(random()-.5)*.57
      const py=ground(px,pz)-.018
      const rot=random()*Math.PI, tall=size*(.51+random()*.35)
      const light=.80+random()*.23
      card(base,px,py,pz,tall,tall*.84,rot,.08,light)
      card(base,px,py,pz,tall*.89,tall*.66,rot+1.47,.08,light)
      const stalks=2+Math.floor(random()*3)
      for(let k=0;k<stalks;k++) {
        const sx=px+(random()-.5)*.22, sz=pz+(random()-.5)*.19
        const h=tall*(1.14+random()*.58), angle=rot+k*1.21
        card(stems,sx,ground(sx,sz)-.02,sz,h,h*.43,angle,.06+random()*.13*side,light)
      }
    }
  }
  const grass=surfaceTexture('meadow-oat')
  grass.wrapS=grass.wrapT=THREE.ClampToEdgeWrapping
  for(const [batch,map,name,cutoff] of [[base,grass,'水线莎草丛',.16],[stems,reedTexture(),'溪岸芦苇花穗',.22]]) {
    const geometry=new THREE.BufferGeometry()
    for(const [key,values,size] of [['position',batch.p,3],['normal',batch.n,3],['color',batch.c,3],['uv',batch.uv,2]]) {
      geometry.setAttribute(key,new THREE.Float32BufferAttribute(values,size))
    }
    const mat=new THREE.MeshLambertMaterial({map,side:THREE.DoubleSide,vertexColors:true,alphaTest:cutoff,alphaToCoverage:true})
    mat.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal *= faceDirection;')
    }
    mat.customProgramCacheKey=()=> 'reed-transmission'
    const patch=new THREE.Mesh(geometry,mat)
    patch.name=name
    patch.userData.habitat='grass'
    group.add(patch)
  }
}
