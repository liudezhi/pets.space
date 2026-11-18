import * as THREE from 'three'
import { surfaceTexture } from './world-materials.js'
import { distantRidge } from './valley-horizon.js'
import { addRiverSedges } from './river-sedges.js'
import { cloudShader } from './valley-clouds.js'

const { sin, cos, abs, exp, PI } = Math
const smooth = THREE.MathUtils.smoothstep

// The bridge crosses a narrow neck. Downstream, the west bank opens into a shallower cove.
function cove(z) {
  return smooth(z, 0.6, 7.5) * exp(-((z - 10.7) ** 2) / 120)
}

export function riverX(z) {
  const distant = smooth(abs(z), 34, 72) * sin(z * .067) * 8.8
  const upperBend=12.0*smooth(-z,0,14)*exp(-((z+14)**2)/460)
  return .12*z + 3.1*sin(z*.076) + 1.7*sin(z*.13) - 6.25*cove(z) + upperBend + distant
}

export function riverWidth(z) {
  const edge = .26*sin(z*.65+.6) + .18*sin(z*1.08-.4)
  return 3.60 + 1.35*smooth(abs(z),4,24) + .46*sin(z*.11) + 2.35*cove(z) + edge*smooth(abs(z),2,7)
}

export function riverbedHeight(x,z) {
  const width=riverWidth(z), u=(x-riverX(z))/width
  const thalweg=.20*sin(z*.102+.55)
  const bowl=Math.max(0,1-u*u)
  const scour=.87+.44*exp(-((u-thalweg)**2)/.19)
  const gravel=.095*sin(x*1.4+z*.65)*cos(z*1.17-x*.78)
  return -.035 - bowl*(scour+.16*sin(z*.17)+gravel)
}

const rapidStones = [
  [3.4,-.38,.61],[5.1,-.72,.68],[6.2,-.38,.48],[7.3,-.69,.73],
  [8.2,.52,.84],[9.3,-.78,.71],[11,-.61,.57],[12.1,-.67,.74],
  [16.3,-.08,.77],[-3.8,.19,.43],[-5.2,.55,.66],[-9.7,-.34,.79],[-16,.22,.58]
]

function seeded(seed) {
  return () => ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
}

function riverbed(group, ground, stone) {
  const vertices=[],uv=[],colors=[],indices=[]
  const rings=248
  const band=[-1.54,-1.25,-1.08,-.94,-.72,-.43,0,.43,.72,.94,1.08,1.25,1.54]
  const count=band.length, tints=[.97,.92,.80,.73,.74,.71,.66,.69,.75,.78,.85,.93,.97]
  for(let i=0;i<=rings;i++){
    const z=-96+192*i/rings, center=riverX(z),width=riverWidth(z)
    for(let j=0;j<count;j++){
      const u=band[j], side=Math.sign(u)
      const offset=abs(u)>1 ? side*(width+(abs(u)-1)*(2.35+.25*sin(z*.56))/.54) : u*width
      const x=center+offset
      vertices.push(x,ground(x,z)+.043,z);uv.push(.76*x+.22*z,.76*z-.22*x)
      const shade=tints[j]*(.91+.06*sin(x*.37+z*.29)+.05*cos(z*.88))
      const excess=abs(offset)-width, weedy=.5+.36*cos(z*.71+side*2.2)+.13*sin(z*2.59)
      const alpha=1-smooth(excess,.53+.36*weedy,1.53+.55*weedy)
      const silt=smooth(excess,.14,1.43)*(.42+.48*weedy)
      colors.push(shade*(.97-.15*silt),shade*(1-.15*silt),shade*(.95-.28*silt),alpha)
      if(i && j){
        const d=i*count+j
        indices.push(d-count-1,d-1,d,d-count-1,d,d-count)
      }
    }
  }
  const geo=new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3))
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2))
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,4))
  geo.setIndex(indices);geo.computeVertexNormals()
  const bed=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({
    map:stone,roughness:.77,vertexColors:true,side:THREE.DoubleSide,transparent:true,depthWrite:false
  }))
  bed.name='圆砾河床与退水线';bed.renderOrder=1;bed.receiveShadow=true;group.add(bed)
}

// A periodic wave-slope atlas. Independent moving lookups keep the ripples irregular
// without a second scene render, GPU readbacks, or a live environment texture.
function waterSlopes() {
  const random=seeded(57451),size=128,bytes=new Uint8Array(size*size*4)
  const waves=Array.from({length:20},(_,i)=>({
    x:(random()<.5?-1:1)*(1+Math.floor(random()*9)),
    z:2+Math.floor(random()*16), phase:random()*2*PI, amplitude:1/Math.sqrt(i+1)
  }))
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    const u=x/size*2*PI,v=z/size*2*PI
    const bend=.17*sin(u+v)+.10*cos(2*u-v)
    let nx=0,nz=0
    for(const wave of waves){
      const w=wave.amplitude*cos(wave.x*u+wave.z*v+wave.phase+wave.x*bend)
      nx+=w*wave.x/10;nz+=w*wave.z/13
    }
    const j=4*(z*size+x)
    bytes[j]=128+95*Math.tanh(nx*.66);bytes[j+1]=128+102*Math.tanh(nz*.58)
    bytes[j+2]=128;bytes[j+3]=255
  }
  const map=new THREE.DataTexture(bytes,size,size)
  map.wrapS=map.wrapT=THREE.RepeatWrapping;map.generateMipmaps=true
  map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.needsUpdate=true
  return map
}

function addWater(group, ground, mountains, stone) {
  const positions=[],depths=[],bands=[],indices=[]
  const samples=260,columns=13
  for(let i=0;i<=samples;i++){
    const z=-96+192*i/samples,center=riverX(z),w=riverWidth(z)+.22
    for(let j=0;j<columns;j++){
      const u=j/(columns-1)*2-1, x=center+w*u
      positions.push(x,0,z);bands.push(u);depths.push(Math.max(.025,-ground(x,z)))
      if(i&&j){
        const d=i*columns+j
        indices.push(d-columns-1,d-1,d,d-columns-1,d,d-columns)
      }
    }
  }
  const geo=new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geo.setAttribute('bottomDepth',new THREE.Float32BufferAttribute(depths,1))
  geo.setAttribute('bank',new THREE.Float32BufferAttribute(bands,1))
  geo.setIndex(indices)
  const uniforms={
    time:{value:0},wet:{value:0},tone:{value:1},cloud:{value:.2},
    sun:{value:new THREE.Vector3(-1,.7,-.25).normalize()},
    horizon:{value:new THREE.Color('#d6e0df')},zenith:{value:new THREE.Color('#6893af')},
    cloudAtlas:{value:null},cloudTint:{value:new THREE.Color('#f0f4f2')},
    slopes:{value:waterSlopes()},ridges:{value:mountains},gravel:{value:stone}
  }
  const surface=new THREE.Mesh(geo,new THREE.ShaderMaterial({
    uniforms,transparent:true,depthWrite:false,
    vertexShader:`
      attribute float bottomDepth,bank;
      varying vec3 point;varying float depth,edge;
      void main(){point=position;depth=bottomDepth;edge=bank;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
    `,
    fragmentShader:`
      uniform sampler2D slopes,ridges,gravel,cloudAtlas;
      uniform vec3 cloudTint;
      const float ridgeRadius=${distantRidge.radius.toFixed(3)}, ridgeHeight=${distantRidge.height.toFixed(3)}, ridgeBase=${distantRidge.bottom.toFixed(3)};
      const float ridgeYaw=${distantRidge.yaw.toFixed(3)}, ridgeRepeats=${distantRidge.repeats.toFixed(3)};
      uniform float time,wet,tone,cloud;uniform vec3 sun,horizon,zenith;
      varying vec3 point;varying float depth,edge;
      const float TAU=6.2831853;
      ${cloudShader}
      vec3 reflectedBank(vec3 ray){
        vec3 sky=mix(horizon,zenith,pow(clamp(ray.y,0.,1.),.57));
        float day=smoothstep(-.15,.13,sun.y);
        float facing=pow(max(dot(ray,sun),0.),6.),dusk=1.-smoothstep(.0,.39,abs(sun.y));
        sky+=vec3(.95,.32,.075)*facing*dusk*(1.-cloud*.8)*.62;
        sky=skyWithClouds(sky,ray,sun,zenith,cloudTint,cloud,day,time,cloudAtlas);
        float a=max(.01,dot(ray.xz,ray.xz)), b=dot(point.xz,ray.xz);
        float distanceToRidge=(-b+sqrt(max(0.,b*b-a*(dot(point.xz,point.xz)-ridgeRadius*ridgeRadius))))/a;
        vec3 hit=point+ray*distanceToRidge;
        vec2 uv=vec2(fract((atan(hit.x,hit.z)-ridgeYaw)/TAU)*ridgeRepeats,(hit.y-ridgeBase)/ridgeHeight);
        vec4 ridge=texture2D(ridges,uv);
        float daylight=smoothstep(-.12,.25,sun.y);
        float veil=.24+cloud*.22;
        vec3 forest=mix(ridge.rgb*(.12+.88*daylight),horizon,veil);
        vec3 env=mix(sky,forest,ridge.a*(1.-smoothstep(.93,1.02,uv.y)));
        // The same stone arch shades and reflects into the pool on either side.
        float side=sign(point.z),wallZ=side*1.56;
        if(abs(ray.z)>.001 && abs(point.z)>1.56){
          float dist=(wallZ-point.z)/ray.z;
          vec3 q=point+dist*ray;
          float arch= -.38+1.98*sqrt(max(0.,1.-q.x*q.x/(4.5*4.5)));
          float top=2.61-.95*q.x*q.x/(6.5*6.5);
          float mask=(1.-smoothstep(6.39,6.62,abs(q.x)))*(1.-smoothstep(top-.05,top+.07,q.y));
          mask*=smoothstep(arch-.05,arch+.06,q.y)*smoothstep(0.,.25,dist);
          env=mix(env,mix(vec3(.21,.19,.15),vec3(.34,.31,.23),smoothstep(.0,1.,q.y))*(.13+.87*daylight),mask*.91);
        }
        return env;
      }
      void main(){
        vec3 view=normalize(cameraPosition-point);
        float t=mod(time,4096.);
        float twist=sin(point.z*.21+point.x*.14);
        vec2 flow=vec2(.15+.34*twist,1.);
        vec2 p=point.xz;
        vec2 warp=texture2D(slopes,p*.047-flow*t*.009).rg-.5;
        vec2 a=texture2D(slopes,p*.146-flow*t*.030+warp*.083).rg-.5;
        vec2 b=texture2D(slopes,mat2(.84,.54,-.54,.84)*p*.32-vec2(.02,.047)*t+warp*.065).rg-.5;
        float energy=.65+.63*smoothstep(.2,.93,abs(edge))+.16*wet;
        vec2 tilt=(a*.36+b*.14)*energy;
        tilt+=wet*.027*vec2(cos(length(fract(p*2.)-.5)*36.-t*8.),sin(p.x*7.+p.y*9.-t*7.));
        vec3 normal=normalize(vec3(tilt.x,1.,tilt.y));
        vec3 ray=reflect(-view,normal);
        ray.y=max(-.18,ray.y);
        float fres=.026+.974*pow(1.-max(dot(view,normal),.0),5.);
        float distanceInWater=depth/max(.33,view.y);
        float transmission=exp(-distanceInWater*.67);
        float sunlight=smoothstep(-.12,.30,sun.y);
        vec3 scatter=mix(vec3(.012,.062,.053),vec3(.043,.16,.134),.30+.70*transmission)*(.17+.83*sunlight);
        vec3 bed=texture2D(gravel,vec2(.76*p.x+.22*p.y,.76*p.y-.22*p.x)+tilt*depth*.52).rgb;
        float caustic=pow(clamp(1.-abs(a.x+b.y)*3.7,0.,1.),5.)*.15*sunlight;
        vec3 refracted=bed*vec3(.61,.78,.66)*(.18+.82*sunlight)*(1.+caustic);
        float passThrough=transmission*(1.-fres)*.64;
        vec2 underDeck=point.xz+sun.xz*(1.8/max(.04,sun.y));
        float shade=(1.-smoothstep(6.28,6.6,abs(underDeck.x)))*(1.-smoothstep(1.43,1.79,abs(underDeck.y)))*sunlight;
        refracted*=1.-shade*.39;
        vec3 energyColor=reflectedBank(ray)*fres+scatter*(1.-transmission)*(1.-fres)+refracted*transmission*(1.-fres)*.36;
        vec3 halfVector=normalize(sun+view);
        float sparkle=pow(max(dot(halfVector,normal),0.),260.)*.80+pow(max(dot(halfVector,normal),0.),52.)*.08;
        energyColor+=vec3(1.,.80,.49)*sparkle*smoothstep(-.03,.08,sun.y)*(1.-.7*cloud)*(1.-shade);
        float opacity=1.-passThrough;
        gl_FragColor=vec4(energyColor/max(opacity,.001),opacity);
        #include <colorspace_fragment>
      }`
  }))
  surface.name='河湾动水';surface.renderOrder=2;group.add(surface)
  return uniforms
}

function channelRocks(group, ground) {
  const random=seeded(31587), entries=[]
  // Asymmetrical shoals interrupt the broad pool; submerged stones are visible through the water.
  for(let i=0;i<100;i++){
    const z=-76+random()*152, side=random()<.52?-1:1
    const radius=.28+random()*.84
    const x=riverX(z)+side*riverWidth(z)*(.53+.66*random())
    if(abs(z)<2.1) continue
    for(let j=0;j<3+Math.floor(random()*6);j++){
      const px=x+(random()-.5)*2.9,pz=z+(random()-.5)*1.7
      const size=(j===0?.56+random()*.43:.11+random()*.42)*radius
      const y=ground(px,pz)
      entries.push([px,y+size*.19,pz,size,random()])
    }
  }
  for(const [z,across,radius] of rapidStones){
    const x=riverX(z)+across*riverWidth(z)
    entries.push([x,-radius*.18,z,radius,random()])
    for(let j=0;j<4;j++){
      const dx=(random()-.5)*2.4,dz=(random()-.5)*1.9
      const s=radius*(.20+.35*random())
      entries.push([x+dx,-.15*s-.08*random(),z+dz,s,random()])
    }
  }
  const material=new THREE.MeshStandardMaterial({map:surfaceTexture('limestone'),roughness:.68})
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying float wetHeight;\n'+shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nwetHeight=(instanceMatrix*vec4(transformed,1.)).y;')
    shader.fragmentShader='varying float wetHeight;\n'+shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\nfloat dry=smoothstep(-.035,.18,wetHeight);diffuseColor.rgb*=mix(vec3(.51,.63,.60),vec3(1.,1.,.94),dry);')
  }
  const dummy=new THREE.Object3D(), tint=new THREE.Color(), normal=new THREE.Vector3()
  const large=[], gravel=[]
  for(const entry of entries){
    (entry[3]>.40 && abs(entry[2])<28 ? large : gravel).push(entry)
  }
  for(const [stones,detail] of [[large,1],[gravel,0]]){
    const geo=new THREE.IcosahedronGeometry(1,detail), pos=geo.attributes.position
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i)
      const d=1+.09*sin(3.4*x+1.7*y)*cos(3.7*z)+.047*cos(7*y+2*z)
      pos.setXYZ(i,d*x,d*y,d*z)
      normal.set(x,y,z).normalize()
      geo.attributes.normal.setXYZ(i,normal.x,normal.y,normal.z)
    }
    const rocks=new THREE.InstancedMesh(geo,material,stones.length)
    stones.forEach(([x,y,z,r,s],i)=>{
      dummy.position.set(x,y,z);dummy.scale.set(r*(.78+random()*.48),r*(.40+random()*.28),r*(.66+random()*.51))
      dummy.rotation.set(random()*.3,random()*PI,random()*.18)
      dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix)
      tint.setHSL(.089+.039*s,.049+.060*s,.34+.30*random());rocks.setColorAt(i,tint)
    })
    rocks.name='河床嵌石';rocks.castShadow=Boolean(detail);rocks.receiveShadow=true;group.add(rocks)
  }
}

// Short curls cling to partially exposed stones. Each pair of trailing streaks
// follows the local current; small breaks expose the water between the crests.
function addRockWakes(group, water) {
  const positions=[], uv=[], indices=[], random=seeded(5449)
  for(const [z,across,r] of rapidStones){
    const x=riverX(z)+across*riverWidth(z)
    const dx=(riverX(z+.35)-riverX(z-.35))/.7
    const norm=1/Math.hypot(dx,1), tx=dx*norm, tz=norm
    for(let strip=0;strip<4;strip++){
      const side=strip%2?1:-1, offset=strip<2?.76:1.11, phase=random()*5
      const linger=.96+random()*.8, segments=18, start=positions.length/3
      for(let i=0;i<=segments;i++){
        const u=i/segments, a=-1.28+u*2.45
        const along=(-.51*cos(a)+u*u*linger)*r
        const cross=side*r*(offset+.11*sin(phase+u*13.))*(.42+.61*sin(u*2.07))
        const thickness=(.038+.045*random())*(strip<2?1:.71)*sin(PI*u)**.7
        for(let j=0;j<2;j++){
          const spread=cross+thickness*(j*2-1)
          positions.push(x+tx*along+tz*spread,.011,z+tz*along-tx*spread)
          uv.push(u,j,phase)
        }
        if(i){
          const k=start+2*i
          indices.push(k-2,k-1,k,k,k-1,k+1)
        }
      }
    }
  }
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geometry.setAttribute('crest',new THREE.Float32BufferAttribute(uv,3))
  geometry.setIndex(indices)
  const material=new THREE.ShaderMaterial({
    uniforms:{time:water.time,sun:water.sun,horizon:water.horizon,slopes:water.slopes},
    transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
    vertexShader:`attribute vec3 crest;varying vec3 vCrest;varying vec2 p;
      void main(){ p=position.xz;vCrest=crest;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform float time;uniform vec3 sun,horizon;uniform sampler2D slopes;
      varying vec3 vCrest;varying vec2 p;
      void main(){
        float wave=texture2D(slopes,p*.62-vec2(.027,.041)*mod(time,4096.)).g;
        float rim=pow(max(0.,sin(vCrest.y*3.14159)),.58);
        float fade=sin(vCrest.x*3.14159);
        float white=smoothstep(.26,.65,wave+.11*sin(vCrest.x*42.-time+vCrest.z));
        vec3 glint=mix(horizon,vec3(.86,.94,.89),.47)*(.16+.84*smoothstep(-.15,.4,sun.y));
        gl_FragColor=vec4(glint, (.14+.59*white)*rim*fade);
        #include <colorspace_fragment>
      }`
  })
  const wakes=new THREE.Mesh(geometry,material)
  wakes.name='礁石水纹';wakes.renderOrder=3;group.add(wakes)
}

export function addRiver(group,ground,mountains) {
  const stone=surfaceTexture('riverbed')
  riverbed(group,ground,stone)
  channelRocks(group,ground)
  addRiverSedges(group,ground,riverX,riverWidth)
  const water=addWater(group,ground,mountains,stone)
  addRockWakes(group,water)
  return water
}
