import * as THREE from 'three';
import {surfaceTexture} from './world-materials.js';
import { addFamilyMarkers } from './terrain-memorial.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const courtyardView = {
  x:33.15, z:-6.35, faceX:25.2, faceZ:-6.35, pitch:-.14,
  narrowFaceZ:-7.45, narrowEmptyFaceZ:-4.05,
};
const seat = {x:29.20, z:-4.13, yaw:-.48};

function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    return seed/4294967296;
  };
}

// A single masonry mesh includes the dry wall, its capstones and the flagstones.
// Each small stone has an exposed bevel. Scattered pieces of the walk follow the
// grade rather than forming a tiled platform over the hillside.
function buildStonework(court,heightAt,random,blockers,map) {
  const xyz=[], uv=[], colors=[];
  const chalk=new THREE.Color('#e7e3d1'), moss=new THREE.Color('#87916b');
  const base=new THREE.Color(), crown=new THREE.Color(), side=new THREE.Color();
  function triangle(a,b,c,tint,axis) {
    for(const point of [a,b,c]) {
      xyz.push(...point); colors.push(tint.r,tint.g,tint.b);
      const [x,y,z]=point;
      if(axis==='top') uv.push(x*.78,z*.78);
      else uv.push((axis==='x'?x:z)*.78,y*.78);
    }
  }
  function rock(points,bottom,top,green=0) {
    const n=points.length, center=points.reduce(([x,z],p)=>[x+p[0]/n,z+p[1]/n],[0,0]);
    const h=heightAt(...center), cap=.020+random()*.015;
    base.copy(chalk).multiplyScalar(.72+random()*.25);
    crown.copy(base).lerp(moss,green);
    side.copy(base).multiplyScalar(.88);
    const low=[],middle=[],high=[];
    points.forEach(([x,z])=>{
      const ground=heightAt(x,z);
      low.push([x,ground+bottom,z]);
      middle.push([x,ground+top-cap,z]);
      high.push([center[0]+(x-center[0])*.89, ground+top+.015*(random()-.5),center[1]+(z-center[1])*.89]);
    });
    const centerTop=[center[0],h+top+.006,center[1]];
    for(let i=0;i<n;i++){
      const j=(i+1)%n, axis=Math.abs(points[j][0]-points[i][0])>Math.abs(points[j][1]-points[i][1])?'x':'z';
      triangle(centerTop,high[i],high[j],crown,'top');
      triangle(high[i],middle[i],middle[j],base,axis); triangle(high[i],middle[j],high[j],base,axis);
      triangle(middle[i],low[i],low[j],side,axis); triangle(middle[i],low[j],middle[j],side,axis);
    }
  }
  const runs=[
    [[33.7,-2.45],[30.0,-2.4],[27.2,-2.9],[25.0,-4.08],[24.55,-5.40]],
    [[24.45,-7.93],[24.65,-9.22],[25.0,-9.65]],
    [[27.45,-10.64],[31.15,-10.78],[33.7,-10.02],[34.30,-8.36]],
    [[34.28,-5.62],[33.7,-2.45]],
  ];
  for(const run of runs) {
    for(let k=1;k<run.length;k++){
      const [ax,az]=run[k-1], [bx,bz]=run[k], length=Math.hypot(bx-ax,bz-az);
      const dx=(bx-ax)/length,dz=(bz-az)/length;
      const point=(along,across)=>[ax+along*dx-across*dz,az+along*dz+across*dx];
      for(let row=0;row<3;row++) {
        const top=[.18,.375,.505][row], bottom=[-.025,.166,.36][row];
        for(let u=0;u<length;) {
          let end=Math.min(length,u+(row===1?.36:.54)+random()*.52);
          if(length-end<.24)end=length;
          const left=u+.008, right=end-.009, w=(row===2?.28:.225)+random()*.022;
          const polygon=[point(left+.035,-w),point(left,-w+.08),point(left,w-.05),
            point(left+.056,w),point(right-.062,w+.014),point(right,w-.065),
            point(right,-w+.048),point(right-.067,-w)];
          rock(polygon,bottom,top+(random()-.5)*.023,row===2?random()*.60:0);
          if(row===0) {
            const [x,z]=point((left+right)/2,0);
            blockers.push([x,z,(right-left)*Math.abs(dx)/2+w*Math.abs(dz),(right-left)*Math.abs(dz)/2+w*Math.abs(dx)]);
          }
          u=end;
        }
      }
    }
  }
  // A loosely jointed path from the side opening to the bench. Keep the central
  // lawn open for family members and for a visitor looking down toward the valley.
  const sites=[];
  for(let i=-1;i<15;i++)for(let j=-1;j<14;j++){
    sites.push([24.75+(i+random()*.64)*.70,-11.2+(j+random()*.64)*.70]);
  }
  for(const [x,z] of sites){
    if(x<25||x>33.55||z< -10.3||z> -2.9)continue;
    const benchWalk=-4.55-.08*(x-29)**2;
    const gateWalk=-9.7+.50*(x-27)**2;
    const onPath=(x>27 && Math.abs(z-benchWalk)<.68) || (x>=26.7&&x<30.2&&Math.abs(z-gateWalk)<.58);
    if(!onPath)continue;
    let poly=[[x-.92,z-.92],[x-.92,z+.92],[x+.92,z+.92],[x+.92,z-.92]];
    for(const [nx,nz] of sites) {
      const dx=nx-x,dz=nz-z, distance=dx*dx+dz*dz;
      if(distance===0||distance>2.7)continue;
      const clip=[];
      for(let i=0;i<poly.length;i++){
        const a=poly[i], b=poly[(i+1)%poly.length];
        const da=(a[0]-x)*dx+(a[1]-z)*dz-distance/2;
        const db=(b[0]-x)*dx+(b[1]-z)*dz-distance/2;
        if(da<=0)clip.push(a);
        if((da>0)!==(db>0)){
          const t=da/(da-db);
          clip.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
        }
      }
      poly=clip;
    }
    const inset=.87+random()*.09;
    rock(poly.map(([px,pz])=>[x+(px-x)*inset,z+(pz-z)*inset]),-.026,.052,random()*.26);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
  const wall=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({
    map,bumpMap:map,bumpScale:.031,vertexColors:true,roughness:.97,side:THREE.DoubleSide,
  }));
  wall.name='山庭干砌矮墙与汀步';wall.userData.habitat='stone';court.add(wall);
}

function timberTexture(random) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#9b886b';ctx.fillRect(0,0,512,128);
  for(let i=0;i<2100;i++){
    const x=random()*512,y=random()*128,run=13+random()*155;
    ctx.strokeStyle=random()>.46?'rgba(73,56,42,.20)':'rgba(210,202,176,.30)';
    ctx.lineWidth=.30+random()*.95;
    ctx.beginPath();ctx.moveTo(x,y);
    ctx.bezierCurveTo(x+run*.35,y-1.6,x+run*.70,y+1.2,x+run,y+.57);ctx.stroke();
  }
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=4;return tex;
}

function buildSeat(court,heightAt,random) {
  const {x,z,yaw}=seat,c=Math.cos(yaw),s=Math.sin(yaw), parts=[];
  const world=(u,v)=>[x+c*u+s*v,z-s*u+c*v];
  const ground=(u,v)=>heightAt(...world(u,v));
  const top=Math.max(...[-.97,.97].flatMap(u=>[-.23,.23].map(v=>ground(u,v))))+.43;
  function plank(u,y,v,length,height,width,lean=0) {
    const geo=new RoundedBoxGeometry(length,height,width,1,.012);
    geo.rotateX(lean);geo.translate(u,y,v);geo.rotateY(yaw);geo.translate(x,0,z);parts.push(geo);
  }
  for(const u of [-.98,.98]){
    for(const v of [-.22,.22]){
      const base=ground(u,v)-.04, cap=v>0?top+.56:top+.20;
      plank(u,(base+cap)/2,v,.086,cap-base,.105);
    }
    plank(u,top+.19,0,.11,.064,.68,-.05);
    plank(u,top-.10,0,.085,.16,.58);
  }
  for(let i=0;i<5;i++)plank(0,top,-.238+i*.115,2.31,.061,.099);
  plank(0,top-.12,-.211,2.05,.115,.055);
  plank(0,top+.125,.232,2.17,.085,.081,-.08);
  for(let i=0;i<15;i++)plank(-.968+i*.138,top+.335,.251,.09,.38,.052,-.11);
  plank(0,top+.56,.279,2.32,.103,.088,-.09);
  const geometry=mergeGeometries(parts);
  parts.forEach(g=>g.dispose());
  const map=timberTexture(random);
  const bench=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map,bumpMap:map,bumpScale:.012,roughness:.90}));
  bench.name='望山木长椅';bench.receiveShadow=bench.castShadow=true;court.add(bench);
}

function buildBorder(court,heightAt,random) {
  // Clusters follow the retaining wall. The transparent sprays use the same native
  // flowers as the valley and share one draw call per species across the whole court.
  const roots=[[25.4,-3.77],[26.3,-3.45],[27.3,-3.16],[28.5,-3.04],[30,-2.91],
    [31.6,-2.83],[24.9,-8.89],[25.2,-9.32],[27.8,-10.04],[28.7,-10.24],[31.6,-10.12]];
  for(const [name,role] of [['meadow-oat','leaves'],['meadow-yarrow','flowers']]){
    const map=surfaceTexture(name);
    map.wrapS=map.wrapT=THREE.ClampToEdgeWrapping;
    const geo=new THREE.PlaneGeometry(1,1).translate(0,.5,0);
    const mat=new THREE.MeshLambertMaterial({map,alphaTest:.32,side:THREE.DoubleSide});
    const count=roots.length*(role==='leaves'?12:8);
    const patches=new THREE.InstancedMesh(geo,mat,count),dummy=new THREE.Object3D();
    for(let i=0;i<count;i++){
      const [cx,cz]=roots[i%roots.length],x=cx+(random()-.5)*.7,z=cz+(random()-.5)*.45;
      const h=(role==='leaves'?.37:.32)+random()*.34;
      dummy.position.set(x,heightAt(x,z)-.018,z);dummy.rotation.set(0,random()*Math.PI*2,(random()-.5)*.24);
      dummy.scale.set(h*.80,h,1);dummy.updateMatrix();patches.setMatrixAt(i,dummy.matrix);
    }
    patches.name='山庭墙边草花';patches.userData.habitat=role;court.add(patches);
  }
}

function addPathLights(court,heightAt) {
  const stops=[[-38.2,27],[-17,14],[-7.7,1.9],[7.9,-1.8],[15,-12],[26.8,-10.7],[32.6,-3.1]];
  // Both halves share their placement. The per-vertex mask leaves only the
  // glass luminous when the existing day/night controller turns the lights up.
  const parts=[
    [new THREE.BoxGeometry(.13,.48,.13).translate(0,.24,0),0x887055,0],
    [new THREE.BoxGeometry(.12,.11,.12).translate(0,.49,0),0xffdb99,1],
  ];
  for(const [geo,finish,glow] of parts) {
    const count=geo.attributes.position.count, tint=new THREE.Color(finish);
    const colors=new Float32Array(3*count),masks=new Float32Array(count);
    for(let i=0;i<count;i++)tint.toArray(colors,3*i);
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    geo.setAttribute('lampGlass',new THREE.BufferAttribute(masks.fill(glow),1));
  }
  const shape=mergeGeometries(parts.map(([geo])=>geo));
  for(const [part] of parts)part.dispose();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,emissive:0xffce8c});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float lampGlass; varying float isGlass;\n'+shader.vertexShader
      .replace('#include <begin_vertex>','#include <begin_vertex>\nisGlass=lampGlass;');
    shader.fragmentShader='varying float isGlass;\n'+shader.fragmentShader
      .replace('#include <emissivemap_fragment>','totalEmissiveRadiance *= isGlass;')
      .replace('#include <roughnessmap_fragment>','float roughnessFactor=mix(.92,1.,isGlass);');
  };
  material.customProgramCacheKey=()=>'court-path-lamp';
  const mesh=new THREE.InstancedMesh(shape,material,stops.length),matrix=new THREE.Matrix4();
  stops.forEach(([x,z],i)=>mesh.setMatrixAt(i,matrix.makeTranslation(x,heightAt(x,z),z)));
  mesh.name='步道灯火';court.add(mesh);
}

export function buildCourtyard(group,heightAt,memorial,signal,memorialStone,onChange) {
  const court=new THREE.Group(),random=randomSource(17591),blockers=[];
  court.name='听风山庭';group.add(court);
  buildStonework(court,heightAt,random,blockers,memorialStone?.map || surfaceTexture('memorial-limestone'));
  buildSeat(court,heightAt,random);
  const border=new THREE.Group(), rimLOD=new THREE.LOD();
  buildBorder(border,heightAt,random);
  rimLOD.position.set(29.4,heightAt(29.4,-6.5),-6.5);
  border.position.copy(rimLOD.position).multiplyScalar(-1);
  rimLOD.addLevel(border,0);
  rimLOD.addLevel(new THREE.Group(),44,.08);
  court.add(rimLOD);
  // Follow the rotated seat with several small obstacles, keeping both ends passable.
  for(const u of [-.83,-.28,.28,.83])blockers.push([seat.x+Math.cos(seat.yaw)*u,
    seat.z-Math.sin(seat.yaw)*u,.33,.34]);
  addPathLights(court,heightAt);
  const courtId=memorial?.courtyard?.id;
  // The server filters the member list and photo endpoints for this exact viewer.
  if(courtId){
    fetch('/api/courtyards/'+encodeURIComponent(courtId),{signal,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store'})
      .then(res=>res.ok?res.json():null).then(data=>{
        if(signal.aborted||data?.courtyard?.id!==courtId||!Array.isArray(data.gardens))return;
        court.name=data.courtyard.name || court.name;
        addFamilyMarkers(court,heightAt,data.gardens,signal,blockers,memorialStone,onChange);
        onChange?.();
      }).catch(()=>{});
  }
  return {canWalkAt(x,z){return !blockers.some(([px,pz,rx,rz])=>Math.abs(x-px)<rx+.10&&Math.abs(z-pz)<rz+.10);}};
}
