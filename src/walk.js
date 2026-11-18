import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { memorialPlots } from './terrain-memorial.js';
import { courtyardView } from './world-courtyard.js';
import { createNeighborhood } from './neighborhood.js';
import './walk.css';

// X points east and -Z north. Each arrival faces a meaningful part of the garden.
const gardenViews = {
  courtyard: courtyardView,
  entrance: { x: -40, z: 30, faceX: 20, faceZ: -16, pitch: -0.055 },
  stone: { x: memorialPlots.stone.viewX, z: memorialPlots.stone.viewZ, faceX: memorialPlots.stone.lookX, faceZ: memorialPlots.stone.lookZ, pitch: -0.18 },
  tree: { x: 17, z: -15, faceX: -40, faceZ: 30, pitch: -0.09 },
};
const controls = new Map([
  ['KeyW', 'forward'], ['ArrowUp', 'forward'],
  ['KeyS', 'back'], ['ArrowDown', 'back'],
  ['KeyA', 'left'], ['ArrowLeft', 'left'],
  ['KeyD', 'right'], ['ArrowRight', 'right'],
  ['KeyQ', 'turnLeft'], ['KeyE', 'turnRight'],
]);
const touchButtons = [
  ['forward', '向前走', '↑'], ['left', '向左走', '←'],
  ['back', '向后走', '↓'], ['right', '向右走', '→'],
];
const stride = 3.8;
const eyeHeight = 1.55;

export function startWalk(container, { initial, memorial, environment, onPlace, onVisit, onExit, onError } = {}) {
  const site = Object.hasOwn(memorialPlots, memorial?.place) ? memorialPlots[memorial.place] : null;
  const places = site ? {
    ...gardenViews,
    [memorial.place]: {
      x: site.viewX, z: site.viewZ, faceX: site.lookX ?? site.x, faceZ: site.lookZ ?? site.z, pitch: -0.20,
    },
  } : gardenViews;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.08, 700);
  const canvas = renderer.domElement;
  const pad = document.createElement('div');
  const listeners = new AbortController();
  const listening = { signal: listeners.signal };
  const keys = new Set();
  const touches = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let terrain;
  let neighborhood;
  let resizeObserver;
  let disposed = false;
  let yaw = 0;
  let pitch = 0;
  let place;
  let lookPointer = null;
  let lastX = 0;
  let lastY = 0;
  let previousTime = 0;
  let animationTime = 0;
  let resolutionLimit = Infinity;
  let sampleSeconds = 0;
  let sampleFrames = 0;

  function clearInput() {
    keys.clear();
    touches.clear();
    lookPointer = null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.abort();
    renderer.setAnimationLoop(null);
    resizeObserver?.disconnect();
    clearInput();
    neighborhood?.dispose();
    terrain?.dispose?.();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    pad.remove();
  }

  function notifyNearest() {
    let nearest;
    let shortest = Infinity;
    for (const [id, point] of Object.entries(places)) {
      const distance = Math.hypot(point.x - camera.position.x, point.z - camera.position.z);
      if (distance < shortest) {
        nearest = id;
        shortest = distance;
      }
    }
    if (place !== nearest) {
      place = nearest;
      onPlace?.(place);
    }
  }

  function goTo(id) {
    if (disposed || !Object.hasOwn(places, id)) return;
    arrive(places[id]);
  }

  function arrive(point) {
    clearInput();
    camera.position.set(point.x, terrain.heightAt(point.x, point.z) + eyeHeight, point.z);
    // Preserve the whole portrait in a narrow viewport; leave room for the river on desktop.
    const target = point === places.stone && camera.aspect < .85 ? memorialPlots.stone : {x:point.faceX,z:point.faceZ};
    yaw = Math.atan2(point.x - target.x, point.z - target.z);
    pitch = point.pitch;
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    notifyNearest();
    canvas.focus({ preventScroll: true });
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, width < 800 ? 1.35 : 1.6, resolutionLimit);
    renderer.setDrawingBufferSize(width, height, ratio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function step(side, forward) {
    const dx = Math.cos(yaw) * side - Math.sin(yaw) * forward;
    const dz = -Math.sin(yaw) * side - Math.cos(yaw) * forward;
    const position = camera.position;
    // Sliding along an edge avoids stranding the visitor on uneven banks.
    if (canWalkAt(position.x + dx, position.z)) position.x += dx;
    if (canWalkAt(position.x, position.z + dz)) position.z += dz;
    position.y = terrain.heightAt(position.x, position.z) + eyeHeight;
    notifyNearest();
  }

  function canWalkAt(x,z) {
    return terrain.canWalkAt(x,z) && (!neighborhood || neighborhood.canWalkAt(x,z));
  }

  function active(action) {
    for (const key of keys) if (controls.get(key) === action) return 1;
    for (const direction of touches.values()) if (direction === action) return 1;
    return 0;
  }

  function draw(time) {
    const elapsed = previousTime ? (time - previousTime) / 1000 : 0;
    previousTime = time;
    // Look for sustained slowness; a single shader compilation need not lower detail.
    if (elapsed > 0 && elapsed < 1 && resolutionLimit > 0.5) {
      sampleSeconds += elapsed;
      sampleFrames++;
      if (sampleSeconds >= 1 && sampleFrames >= 3) {
        if (sampleSeconds / sampleFrames > 1 / 24) {
          resolutionLimit = Math.max(0.5, renderer.getPixelRatio() * 0.74);
          // The meadow underlay keeps close-up detail when slow GPUs draw fewer individual blades.
          if (resolutionLimit < .8) terrain.setDetail(resolutionLimit === .5 ? .34 : .62);
          resize();
        }
        sampleSeconds = 0;
        sampleFrames = 0;
      }
    }
    const dt = Math.min(elapsed, 0.35);
    yaw += (active('turnLeft') - active('turnRight')) * dt * 1.6;
    const side = active('right') - active('left');
    const forward = active('forward') - active('back');
    if ((side || forward) && dt > 0) {
      // At low frame rates keep walking speed stable and collision checks closely spaced.
      const steps = Math.ceil(dt / 0.05);
      const distance = stride * dt / (Math.hypot(side, forward) * steps);
      for (let i = 0; i < steps; i++) step(side * distance, forward * distance);
    }
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    animationTime += dt;
    terrain.update?.(animationTime,camera);
    neighborhood?.update();
    renderer.render(scene, camera);
  }

  function syncVisibility() {
    previousTime = 0;
    terrain?.visibility?.();
    sampleFrames = 0;
    sampleSeconds = 0;
    clearInput();
    renderer.setAnimationLoop(document.hidden ? null : draw);
  }

  try {
    terrain = buildTerrain(scene, memorial, environment, reducedMotion);
    canvas.className = 'garden-walk-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '河湾漫游，方向键或 WASD 移动，Q 和 E 转头，拖动可环顾，Esc 返回');
    pad.className = 'garden-walk-pad';
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', '步行方向');
    for (const [action, label, arrow] of touchButtons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.direction = action;
      button.setAttribute('aria-label', label);
      button.textContent = arrow;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        touches.set(event.pointerId, action);
      }, listening);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, (event) => touches.delete(event.pointerId), listening);
      }
      // Assistive technologies may dispatch a click without pointer events.
      button.addEventListener('click', (event) => {
        if (event.detail !== 0) return;
        step(({ left: -1, right: 1 }[action] || 0) * 0.45, ({ forward: 1, back: -1 }[action] || 0) * 0.45);
      }, listening);
      pad.append(button);
    }
    container.append(canvas, pad);
    if (onVisit) neighborhood = createNeighborhood({ scene, camera, container, canvas, terrain, arrive, onVisit });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      dispose();
      onError?.(new Error('3D 图形连接已中断'));
    }, listening);
    canvas.addEventListener('pointerdown', (event) => {
      if (lookPointer !== null || event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      lookPointer = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
    }, listening);
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId !== lookPointer) return;
      yaw -= (event.clientX - lastX) * 0.004;
      pitch = THREE.MathUtils.clamp(pitch - (event.clientY - lastY) * 0.0035, -1.15, 1.15);
      lastX = event.clientX;
      lastY = event.clientY;
    }, listening);
    canvas.addEventListener('lostpointercapture', (event) => {
      if (lookPointer === event.pointerId) lookPointer = null;
    }, listening);
    window.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === 'Escape' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        onExit?.();
      } else if (controls.has(event.code) && (container.contains(event.target) || event.target === document.body)) {
        event.preventDefault();
        keys.add(event.code);
      }
    }, listening);
    window.addEventListener('keyup', (event) => keys.delete(event.code), listening);
    canvas.addEventListener('blur', clearInput, listening);
    window.addEventListener('blur', clearInput, listening);
    document.addEventListener('visibilitychange', syncVisibility, listening);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    goTo(Object.hasOwn(places, initial) ? initial : site ? memorial.place : 'entrance');
    syncVisibility();
    return { goTo, dispose, setEnvironment(patch) { if (!disposed) terrain.setEnvironment(patch); } };
  } catch (error) {
    dispose();
    throw error;
  }
}
