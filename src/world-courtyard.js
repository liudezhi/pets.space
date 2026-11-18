import * as THREE from 'three';
import {surfaceTexture} from './world-materials.js';
import { addFamilyMarkers } from './terrain-memorial.js';

export const courtyardView = {x:32, z:-6.5, faceX:26, faceZ:-7, pitch:-.12};

// The western side remains open to the river. Walls and the bench follow the actual slope.
export function buildCourtyard(group, heightAt, memorial, signal) {
  const court=new THREE.Group();
  court.name='听风山庭';
  group.add(court);
  const stone=new THREE.MeshStandardMaterial({color:0xb5ad96,roughness:1});
  const timber=new THREE.MeshStandardMaterial({color:0x887055,roughness:.92});
  const shrub=new THREE.MeshStandardMaterial({color:0x7b865b,roughness:1});
  const dummy=new THREE.Object3D();
  const walls=[], greenery=[], bench=[], paving=[];
  for(const z of [-11,-2]){
    for(let x=25;x<34;x+=.85){
      // A break in the northern wall marks the turn from the wishing oak.
      if(z===-11&&x<28)continue;
      for(let row=0;row<2;row++){
        const px=x+row*.18;
        walls.push([px,heightAt(px,z)+.12+row*.24,z,.83,.24,.53]);
      }
      if(x>30 && Math.round(x)%2===0)greenery.push([x,heightAt(x,z)+.46,z+Math.sign(z+6.5)*.37,.86,.74,.72]);
    }
  }
  for(let z=-10.7;z<-2;z+=.84)
    walls.push([34,heightAt(34,z)+.22,z,.5,.45,.8]);
  const benchX=32.6,benchZ=-3.6,benchY=heightAt(benchX,benchZ);
  for(let i=0;i<4;i++)bench.push([benchX+i*.17,benchY+.48,benchZ,.14,.12,2.7]);
  for(const z of [benchZ-1,benchZ+1])bench.push([benchX+.26,benchY+.24,z,.44,.42,.17]);
  bench.push([benchX+.5,benchY+.88,benchZ,.12,.23,2.67]);
  for(let x=26;x<34;x+=.93)
    for(let z=-10;z<-3;z+=1.08)
      paving.push([x,heightAt(x,z)+.044,z,.90,.085,1.05]);
  function batch(rows,geometry,material) {
    const mesh=new THREE.InstancedMesh(geometry,material,rows.length);
    rows.forEach(([x,y,z,w,h,d],i)=>{
      dummy.position.set(x,y,z);dummy.scale.set(w,h,d);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
      mesh.setColorAt(i,new THREE.Color().setScalar(.83+.16*((i*37)%19)/19));
    });
    court.add(mesh);return mesh;
  }
  batch(walls,new THREE.BoxGeometry(1,1,1),stone);
  batch(bench,new THREE.BoxGeometry(1,1,1),timber);
  // Fit each flagstone corner to the slope. A flat box at its midpoint floats on a hill.
  const vertices=[],uv=[],floorTint=[];
  for(const [x,,z,w,,d] of paving){
    const corners=[[-1,-1],[-1,1],[1,1],[-1,-1],[1,1],[1,-1]];
    const shade=.76+.14*Math.cos(x*8+z*13);
    for(const [sx,sz] of corners){
      const px=x+sx*w*.5,pz=z+sz*d*.5;
      vertices.push(px,heightAt(px,pz)+.065,pz);uv.push(px*.91+pz*.16,pz*.89-px*.16);
      floorTint.push(shade,shade*.98,shade*.93);
    }
  }
  const floor=new THREE.BufferGeometry();
  floor.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  floor.setAttribute('color',new THREE.Float32BufferAttribute(floorTint,3));
  floor.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));floor.computeVertexNormals();
  const floorSurface=new THREE.MeshStandardMaterial({map:surfaceTexture('limestone'),vertexColors:true,roughness:.97});
  court.add(new THREE.Mesh(floor,floorSurface));
  batch(greenery,new THREE.IcosahedronGeometry(1,1),shrub);
  const lampStops=[[-38.2,27],[-17,14],[-7.7,1.9],[7.9,-1.8],[15,-12],[26.8,-10.7],[32.6,-3.1]];
  const posts=[], lights=[];
  for(const [x,z] of lampStops){
    const y=heightAt(x,z);
    posts.push([x,y+.24,z,.13,.48,.13]); lights.push([x,y+.49,z,.12,.11,.12]);
  }
  batch(posts,new THREE.BoxGeometry(1,1,1),timber);
  batch(lights,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xffdb99,emissive:0xffce8c})).name='步道灯火';
  const blockers=walls.map(([x,,z,w,,d])=>[x,z,w/2,d/2]);
  blockers.push([benchX+.25,benchZ,.46,1.42]);
  const courtId=memorial?.courtyard?.id;
  // The server filters the member list and photo endpoints for this exact viewer.
  if(courtId){
    fetch('/api/courtyards/'+encodeURIComponent(courtId),{signal,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store'})
      .then(res=>res.ok?res.json():null).then(data=>{
        if(signal.aborted||data?.courtyard?.id!==courtId||!Array.isArray(data.gardens))return;
        court.name=data.courtyard.name || court.name;
        addFamilyMarkers(court,heightAt,data.gardens,signal,blockers);
      }).catch(()=>{});
  }
  return {canWalkAt(x,z){return !blockers.some(([px,pz,rx,rz])=>Math.abs(x-px)<rx+.10&&Math.abs(z-pz)<rz+.10);}};
}
