// Loaded only by capture-scenes.py. The regular application build never imports this file.
import * as THREE from 'three';
import { startWalk } from '/src/walk.js';
import { measureRoute } from './scene-benchmark.mjs';

const places = ['stone', 'entrance', 'tree', 'courtyard'];
const environment = {
  time: 'live', season: 'autumn', weather: 'clear', quality: 'auto',
  sound: false, lightning: false, reduceMotion: true,
};

function recordPosition(name, camera) {
  return {
    name, position: camera.position.toArray(),
    yaw: camera.rotation.y, pitch: camera.rotation.x, fov: camera.fov,
  };
}

export async function photograph({width, height, instant, rig, family}) {
  const originalNow = Date.now;
  let epoch = Date.parse(instant);
  Date.now = () => epoch;
  const container = document.querySelector('main');
  container.style.width = width + 'px';
  container.style.height = height + 'px';

  const response = await fetch('/pet.webp');
  if (!response.ok) throw new Error('Missing sample portrait');
  const sample = {id: 'demo-riverbend', place: 'stone', name: '麦子', photoUrl: await response.blob()};
  if (family) sample.courtyard = {id: 'camera-family'};

  const failures = [];
  const loaded = new Promise(resolve => { THREE.DefaultLoadingManager.onLoad = resolve; });
  THREE.DefaultLoadingManager.onError = url => failures.push(url);
  const decode = window.createImageBitmap.bind(window);
  let portraitDecoded;
  const portraitReady = new Promise(resolve => { portraitDecoded = resolve; });
  let pendingPortraits = family ? 3 : 1;
  window.createImageBitmap = async (...args) => {
    const bitmap = await decode(...args);
    if ((args[0] === sample.photoUrl || family) && --pendingPortraits === 0) {
      setTimeout(portraitDecoded, 0);
    }
    return bitmap;
  };
  const walk = startWalk(container, {initial: 'stone', memorial: sample, environment});
  try {
    await Promise.all([loaded, portraitReady]);
  } finally {
    window.createImageBitmap = decode;
  }
  if (failures.length) throw new Error('Missing scene media: ' + failures.join(', '));

  // Advance only explicit frames until the last exposure. This keeps vegetation,
  // water and the automatic moving resolution from drifting between versions.
  const probe = window.cameraProbe;
  let exposureTime = 0;
  function expose() {
    const before = probe.renderCount;
    exposureTime += 1000;
    probe.frame(exposureTime);
    if (probe.renderCount === before) throw new Error('The requested exposure did not draw.');
  }
  expose();
  const {camera, renderer} = probe;
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
  const shots = rig || places.map(name => {
    walk.goTo(name);
    expose();
    return recordPosition(name, camera);
  });
  window.captureFrame = (shot, time) => {
    epoch = Date.parse(time);
    walk.setEnvironment(environment);
    walk.goTo(shot.name);
    probe.override = shot;
    camera.position.fromArray(shot.position);
    expose();
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
      throw new Error('Capture must use the full requested drawing-buffer resolution.');
    }
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  };
  window.benchmarkScene = (quality, scenario) => {
    epoch = Date.parse(instant);
    walk.setEnvironment(environment);
    return measureRoute(probe, walk, quality, scenario);
  };
  window.addEventListener('pagehide', () => {
    Date.now = originalNow;
    walk.dispose();
  }, {once: true});
  return {shots, gpu, shadowMap: renderer.shadowMap.enabled};
}
