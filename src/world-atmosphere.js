import * as THREE from 'three';
import { gardenClimate } from './world-clock.js';
import { valleySound } from './world-sound.js';
import { surfaceTexture } from './world-materials.js';
import { createSunlight } from './world-sunlight.js';
import { cloudShader } from './valley-clouds.js';

function buildSky(group) {
  const cloudAtlas = surfaceTexture('valley-sky');
  cloudAtlas.wrapT = THREE.ClampToEdgeWrapping;
  const uniforms = {
    sun: {value: new THREE.Vector3()}, moon: {value: new THREE.Vector3()}, phase: {value: 0},
    horizon: {value: new THREE.Color()}, zenith: {value: new THREE.Color()}, cloud: {value: new THREE.Color()},
    cloudAtlas: {value: cloudAtlas}, day: {value: 1}, cover: {value: .2}, clock: {value: 0}, flash: {value: 0},
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420,32,16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms,
    vertexShader: 'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `
      varying vec3 direction; uniform vec3 sun,moon,horizon,zenith,cloud;
      uniform float phase,cover,clock,flash,day;
      uniform sampler2D cloudAtlas;
      ${cloudShader}
      void main(){
        vec3 d=normalize(direction);
        float h=max(d.y,0.);
        vec3 color=mix(horizon,zenith,pow(h,.55));
        float glow=max(dot(d,sun),0.);
        float dusk=1.-smoothstep(.0,.39,abs(sun.y));
        float facingSun=pow(glow,6.);
        color+=vec3(.95,.32,.075)*facingSun*dusk*(1.-cover*.8)*.62;
        color+=vec3(1.,.84,.60)*(pow(glow,340.)*.37+smoothstep(.99986,.99997,glow)*2.15)*(1.-cover*.91);
        // Project the illuminated lunar hemisphere onto its visible circular disc.
        vec3 right=normalize(cross(moon,vec3(0,1,0))), up=cross(right,moon);
        vec2 xy=vec2(dot(d,right),dot(d,up))/.018;
        float r2=dot(xy,xy);
        if(dot(d,moon)>.99 && r2<1.){
          float light=dot(vec3(xy,sqrt(1.-r2)),vec3(sin(phase),0.,-cos(phase)));
          color=mix(color,vec3(.78,.84,.94),smoothstep(-.05,.05,light)*(1.-smoothstep(.87,1.,r2)));
        }
        color=skyWithClouds(color,d,sun,zenith,cloud,cover,day,clock,cloudAtlas);
        color+=vec3(.28,.34,.44)*flash;
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -4;
  group.add(sky);

  const starPoints=[];
  for(let i=0;i<850;i++){
    const y=(i+.5)/850, a=i*2.39996323, r=Math.sqrt(1-y*y);
    starPoints.push(350*r*Math.cos(a),350*y,350*r*Math.sin(a));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(starPoints,3));
  const stars = new THREE.Points(geo,new THREE.PointsMaterial({size:1.35,sizeAttenuation:false,color:0xf1eee1,transparent:true,depthWrite:false,fog:false}));
  stars.renderOrder = -3;
  group.add(stars);
  return {uniforms, stars, sky};
}

function precipitation(group, snow) {
  const geometry = new THREE.BufferGeometry(), seed=[], tails=[], pos=[];
  let state=4816;
  const random = () => ((state=(Math.imul(1664525,state)+1013904223)>>>0)/4294967296);
  for(let i=0;i<(snow?980:630);i++) {
    const xyz=[random()*26,random()*14,random()*26];
    for(let j=0;j<(snow?1:2);j++){ pos.push(0,0,0);seed.push(...xyz);tails.push(j); }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('seed', new THREE.Float32BufferAttribute(seed,3));
  geometry.setAttribute('tail', new THREE.Float32BufferAttribute(tails,1));
  const material = new THREE.ShaderMaterial({transparent:true,depthWrite:false,
    uniforms:{clock:{value:0}, eye:{value:new THREE.Vector3()},tone:{value:1}},
    vertexShader:`
      attribute vec3 seed; attribute float tail; uniform vec3 eye; uniform float clock; varying float alpha;
      void main(){vec3 box=vec3(26.,14.,26.);
        vec3 motion=${snow?'vec3(sin(seed.z+clock*.8)*.8-clock*.5,-clock*.9,cos(seed.x+clock*.55)*.5)':'vec3(-clock*1.8,-clock*11.,clock*.25)'};
        vec3 p=mod(seed+motion-eye,box)-box*.5+eye;
        p+=vec3(-.07,-.46,.01)*tail;
        vec4 mv=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(16./max(1.,-mv.z),1.3,4.);
        alpha=smoothstep(.2,2.,-mv.z)*(1.-smoothstep(9.,15.,length(p-eye)));
      }`,
    fragmentShader:`varying float alpha; uniform float tone; void main(){
      ${snow?'if(length(gl_PointCoord-.5)>.5) discard;':''}
      gl_FragColor=vec4(vec3(.72,.85,.94)*tone,alpha*${snow?'.83':'.42'});
      #include <colorspace_fragment>
    }`,
  });
  const object=snow?new THREE.Points(geometry, material):new THREE.LineSegments(geometry,material);
  object.frustumCulled=false; object.renderOrder=2; group.add(object);
  return object;
}

// Apply colour and upward-facing snow patches in the material's usual lighting path.
function seasonalMaterials(group) {
  const wetSurfaces = new Map();
  const compiled = new Set();
  const wetTint = new THREE.Color('#bec9cf');
  const uniforms = {airTone:{value:new THREE.Color()},seasonTint:{value:new THREE.Color(1,1,1)},snowAmount:{value:0},windTime:{value:0},windForce:{value:.1}};
  const meadowTint = { value: new THREE.Color(1, 1, 1) };
  const leaves=[], grasses=[], blooms=[], woods=[];
  let detail = 1, currentSeason;
  group.traverse(object=>{
    const role=object.userData.habitat;
    if(!role) return;
    if(role==='leaves') leaves.push(object);
    if(role==='conifer'||role==='oak') woods.push(object);
    if(role==='grass') grasses.push(object);
    if(role==='flowers') blooms.push(object);
    const mat=object.material;
    if (compiled.has(mat)) return;
    compiled.add(mat);
    if (['stone','ground','trail'].includes(role) && mat.color) {
      wetSurfaces.set(mat, { color: mat.color.clone(), roughness: mat.roughness });
    }
    const vegetation=['leaves','grass','flowers','ground'].includes(role);
    const bend=role==='grass'||role==='ribbons'||role==='leaves';
    const previousCompile = mat.onBeforeCompile;
    const previousKey = mat.customProgramCacheKey();
    mat.onBeforeCompile=(shader, renderer)=>{
      previousCompile.call(mat, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      if (role === 'grass' || role === 'ground') shader.uniforms.seasonTint = meadowTint;
      shader.uniforms.airAmount={value:object.userData.air??0};
      shader.vertexShader='varying vec3 envPos; uniform float windTime,windForce;\n'+shader.vertexShader;
      let motion='';
      if(bend){
        const weight=role==='grass'?'float(gl_VertexID%3==2)':role==='leaves'?'(.5+.5*uv.y)':'float((gl_VertexID/2)%6)/5.';
        const phase=role==='leaves'?'instanceMatrix[3].x*.8+instanceMatrix[3].z*.3':'position.x*.8+position.z*.3';
        motion='transformed.x+=sin(windTime*2.1+'+phase+')*windForce*.18*('+weight+');';
      }
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+motion+'\nenvPos=transformed;');
      shader.fragmentShader='varying vec3 envPos; uniform vec3 seasonTint,airTone; uniform float snowAmount,airAmount;\n'+shader.fragmentShader;
      const snowFactor=(role==='ground'||role==='trail')?'(.55+.35*sin(envPos.x*.49+envPos.z*.53)*cos(envPos.z*.43))':
        (role==='stone')?'smoothstep(.62,.94,normalize(cross(dFdx(envPos),dFdy(envPos))).y)':'0.';
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+
        (vegetation?'diffuseColor.rgb*=seasonTint;':'')+'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.87,.90,.92),clamp(snowAmount*'+snowFactor+',0.,1.));');
      if(role==='ridge'){
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+
          'float ridgeSnow=smoothstep(.40,.92,vMapUv.y)*smoothstep(.08,.46,max(sampledDiffuseColor.r,sampledDiffuseColor.g));'+
          'diffuseColor.rgb=mix(diffuseColor.rgb,diffuse*vec3(.80,.86,.90),min(.67,snowAmount*.53)*ridgeSnow);'+
          'diffuseColor.rgb=mix(diffuseColor.rgb,airTone,airAmount);');
      }
    };
    mat.customProgramCacheKey=()=> previousKey + '/garden-climate-' + role;
  });
  const tint={spring:0xe0ffd0,summer:0xc5efa8,autumn:0xffc775,winter:0xbcc0ab};
  // Meadows keep patches of sage through autumn while deciduous crowns turn gold.
  const meadow = {spring: 0xe2f0c9, summer: 0xe3f0d2, autumn: 0xede0bf, winter: 0xb0b2a7};
  function adjustDensity(){
    if(!currentSeason)return;
    const foliage={spring:.8,summer:1,autumn:.72,winter:.09}[currentSeason];
    const grassCover=currentSeason==='winter' ? .16 : 1;
    const flowers={spring:1,summer:.72,autumn:.24,winter:0}[currentSeason];
    for(const o of leaves) o.count=Math.ceil(o.instanceMatrix.count*foliage*detail);
    for(const o of blooms) o.count=Math.ceil(o.instanceMatrix.count*flowers*detail);
    for(const o of grasses){
      const triangles=o.geometry.attributes.position.count/3;
      o.geometry.setDrawRange(0,3*Math.floor(triangles*detail*grassCover));
    }
  }
  return {
    setDetail(value){ detail=value;adjustDensity(); },
    change(s,day,horizon){
      currentSeason=s.season;
      uniforms.airTone.value.copy(horizon);
      for(const wood of woods){
        const autumn=s.season==='autumn'&&wood.userData.habitat==='oak';
        wood.visible=!(wood.userData.habitat==='oak'&&s.season==='winter');
        wood.material.color.set(autumn?'#e5b879':'#eef0e1').multiplyScalar(.16+.84*day);
        if(s.weather==='snow')wood.material.color.lerp(new THREE.Color('#a8bcc6'),.22*(.3+.7*day));
      }
      uniforms.seasonTint.value.set(tint[s.season]);
      meadowTint.value.set(meadow[s.season]);
      const wet=s.weather==='rain'||s.weather==='storm';
      for (const [mat, dry] of wetSurfaces) {
        mat.color.copy(dry.color);
        if (wet) mat.color.multiply(wetTint);
        mat.roughness = wet ? Math.min(dry.roughness,.48) : dry.roughness;
      }
      uniforms.snowAmount.value=s.weather==='snow'?1.38:s.season==='winter'?.48:0;
      uniforms.windForce.value={clear:.16,wind:1,rain:.48,snow:.28,storm:1.3}[s.weather];
      grasses.forEach(o=>o.visible=s.weather!=='snow');
      adjustDensity();
    },
    tick(t){uniforms.windTime.value=t;},
  };
}

export function atmosphere(scene, group, water, prefs, reducedMotion) {
  const {uniforms,stars,sky}=buildSky(group);
  if (water.cloudAtlas) water.cloudAtlas.value = uniforms.cloudAtlas.value;
  const rain=precipitation(group,false), snow=precipitation(group,true);
  const sunlight = createSunlight(group);
  const { fill: hemi, key: directional } = sunlight;
  const sound=valleySound(), seasons=seasonalMaterials(group);
  scene.fog=new THREE.FogExp2('#c1cfc8',.008);
  const ridges=[], grasses=[], lamps=[];
  group.traverse(o=>{ if(o.name==='步道灯火') lamps.push(o); if(o.name==='远山') ridges.push(o); if(o.userData.habitat==='grass') grasses.push(o); });
  let state, nextUpdate=0, previousThunder=-1, lastDistance=10, prefsNow={...prefs};
  const temp=new THREE.Color(), base=new THREE.Color();
  function refresh() {
    state=gardenClimate(prefsNow);
    const now=Date.now();
    group.traverse(o=>{ if(o.userData.visibleUntil && o.userData.visibleUntil<=now) o.visible=false; });
    const altitude=state.sun[1], day=THREE.MathUtils.smoothstep(altitude,-.15,.13);
    const warm=(1-THREE.MathUtils.smoothstep(Math.abs(altitude),.025,.32))*THREE.MathUtils.smoothstep(altitude,-.17,-.02);
    const cover={clear:.17,wind:.42,rain:.91,snow:.83,storm:1}[state.weather];
    function palette(target,night,noon,twilight,storm){
      return target.set(night).lerp(temp.set(noon),day).lerp(temp.set(twilight),warm*.83)
        .lerp(temp.set(storm),cover*.55*day);
    }
    uniforms.sun.value.fromArray(state.sun); uniforms.moon.value.fromArray(state.moon); uniforms.phase.value=state.moonAge*2*Math.PI;
    palette(uniforms.horizon.value,'#23304b','#d9e7ed','#ffddb4','#97a6af');
    palette(uniforms.zenith.value,'#080d20','#5186b4','#778ca9','#667889');
    palette(uniforms.cloud.value,'#1b2640','#f8faf6','#ffdcba','#a8b3bd');
    uniforms.day.value = day;
    uniforms.cover.value=cover;
    lamps.forEach(o => o.material.emissiveIntensity = .09 + (1-day)*1.5);
    stars.material.opacity=(1-day)*(1-cover*.87); stars.visible=stars.material.opacity>.035;
    hemi.intensity = .38 + day*(1.18 + cover*.32);
    hemi.color.set('#9db8da').lerp(temp.set('#e3effc'),day);
    hemi.groundColor.set(day>.45?'#9a9276':'#657590');
    directional.color.set('#acc5fa').lerp(temp.set('#fff4dc'),day).lerp(temp.set('#ffd39d'),warm);
    directional.intensity=(.29+day*2.28)*(1-cover*.72);
    sunlight.update(altitude>-.055?state.sun:state.moon, state.season, day, cover);
    scene.fog.color.copy(uniforms.horizon.value);
    scene.fog.density=.0055+cover*.006;
    for (const ridge of ridges) {
      const wooded = ridge.userData.forest;
      const sunlit = wooded && state.season === 'autumn' ? '#f2d69d' : '#f4f3e8';
      ridge.material.color.copy(base.set(wooded ? '#515c73' : '#606e88'))
        .lerp(temp.set(sunlit), day).lerp(temp.set('#e5c1aa'), warm*.24);
    }
    grasses.forEach(o=>o.material.color.set('#5e6985').lerp(temp.set('#ffffff'),day));
    if (water.horizon) water.horizon.value.copy(uniforms.horizon.value);
    if (water.zenith) water.zenith.value.copy(uniforms.zenith.value);
    if (water.cloud) water.cloud.value=cover;
    if (water.cloudTint) water.cloudTint.value.copy(uniforms.cloud.value);
    water.sun.value.copy(uniforms.sun.value); water.tone.value=.23+day*.77;
    water.wet.value=state.weather==='rain'||state.weather==='storm'?1:0;
    seasons.change(state,day,uniforms.horizon.value); rain.visible=Boolean(water.wet.value); snow.visible=state.weather==='snow';
    for(const o of [rain,snow]) o.material.uniforms.tone.value=.55+day*.45;
    sound.configure(prefsNow.sound,state.weather,lastDistance);
    nextUpdate=Date.now()+5000;
  }
  refresh();
  return {
    setDetail: seasons.setDetail,
    configure(patch) { prefsNow={...prefsNow,...patch};refresh(); },
    tick(time, camera, riverDistance){
      lastDistance=riverDistance;
      if (camera) {
        sky.position.copy(camera.position);
        stars.position.copy(camera.position);
      }
      if(Date.now()>nextUpdate) refresh();
      const quiet=prefsNow.reduceMotion ?? reducedMotion?.matches;
      const t=quiet?0:time;
      seasons.tick(t); water.time.value=t;
      uniforms.clock.value=t;
      for(const o of [rain,snow]){o.material.uniforms.clock.value=t;if(camera)o.material.uniforms.eye.value.copy(camera.position);}
      const cycle=Math.floor(time/21), beat=(time%21)-4;
      const thunder=state.weather==='storm' && beat>=0 && beat<2;
      uniforms.flash.value=thunder&&prefsNow.lightning&&!quiet ? Math.exp(-beat*6)*.8 : 0;
      if(thunder && cycle!==previousThunder){previousThunder=cycle;if(prefsNow.thunder !== false) sound.thunder();}
    },
    visibility(){ sound.configure(prefsNow.sound,state.weather,lastDistance); },
    dispose(){sound.dispose();sunlight.dispose();},
  };
}
