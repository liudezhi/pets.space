import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { memorialPlots } from './terrain-memorial.js';
import { courtyardView } from './world-courtyard.js';
import { createNeighborhood } from './neighborhood.js';
import { createWalkQuality } from './walk-quality.js';
import './walk.css';

// X points east and -Z north. Each arrival faces a meaningful part of the garden.
const gardenViews = {
  courtyard: courtyardView,
  entrance: { x: -40, z: 30, faceX: 20, faceZ: -16, pitch: -0.055 },
  stone: { x: memorialPlots.stone.viewX, z: memorialPlots.stone.viewZ, faceX: memorialPlots.stone.lookX, faceZ: memorialPlots.stone.lookZ, pitch: -0.18 },
  tree: { x: 26, z: -15.2, faceX: -40, faceZ: 30, phoneTarget: { x: -40, z: -2.3 }, pitch: -0.09 },
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.matrixAutoUpdate = false;
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
  let quality = environment?.quality ?? 'auto';
  const motionQuality = createWalkQuality();
  let quiet = environment?.reduceMotion ?? reducedMotion.matches;
  let lastMotion = -Infinity;
  let walkingResolution = false;
  let lastDetail;
  let lastWidth, lastHeight, lastRatio;
  let dirty = true;
  let lastPaint = -Infinity;
  const requestFrame = () => { dirty = true; };

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
    dirty = true;
    camera.position.set(point.x, terrain.heightAt(point.x, point.z) + eyeHeight, point.z);
    // Preserve the whole portrait in a narrow viewport; leave room for the river on desktop.
    let narrowTarget = point === places.stone ? memorialPlots.stone : point.phoneTarget;
    if (point === places.courtyard) {
      narrowTarget = { x: point.faceX, z: memorial?.courtyard ? point.narrowFaceZ : point.narrowEmptyFaceZ };
    }
    const target = camera.aspect < .85 && narrowTarget ? narrowTarget : {x:point.faceX,z:point.faceZ};
    yaw = Math.atan2(point.x - target.x, point.z - target.z);
    pitch = point.pitch;
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    notifyNearest();
    canvas.focus({ preventScroll: true });
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const native = Math.min(window.devicePixelRatio || 1, width < 800 ? 1.45 : 1.65);
    const { ratio, detail } = motionQuality.drawingSetup(quality, walkingResolution, native, width, height);
    if (detail !== lastDetail) {
      terrain.setDetail(detail);
      lastDetail = detail;
      dirty = true;
    }
    if (width === lastWidth && height === lastHeight && ratio === lastRatio) return;
    lastWidth = width; lastHeight = height; lastRatio = ratio;
    dirty = true;
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
    dirty = true;
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
    const held = keys.size || touches.size;
    if (held) lastMotion = time;
    const moving = time - lastMotion < 450;
    if (moving !== walkingResolution) {
      walkingResolution = moving;
      motionQuality.resetSamples();
      if (quality === 'auto') resize();
    } else if (moving && quality === 'auto' && motionQuality.sample(elapsed)) {
      resize();
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
      notifyNearest();
    }
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    animationTime += dt;
    terrain.update?.(animationTime,camera);
    // With motion reduced, the sky and water are still. Revisit the frame periodically
    // for newly decoded portraits, expired flowers and the live park clock.
    if (!dirty && quiet && !moving && time - lastPaint < 1500) return;
    if (dirty || moving) neighborhood?.update();
    renderer.render(scene, camera);
    lastPaint = time;
    dirty = false;
  }

  function syncVisibility() {
    previousTime = 0;
    terrain?.visibility?.();
    motionQuality.resetSamples();
    dirty = true;
    lastMotion = -Infinity;
    clearInput();
    renderer.setAnimationLoop(document.hidden ? null : draw);
  }

  try {
    terrain = buildTerrain(scene, memorial, environment, reducedMotion, requestFrame);
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
        notifyNearest();
      }, listening);
      pad.append(button);
    }
    container.append(canvas, pad);
    if (onVisit) neighborhood = createNeighborhood({ scene, camera, container, canvas, terrain, arrive, onVisit, onChange: requestFrame });
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
      lastMotion = performance.now();
      dirty = true;
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
    return { goTo, dispose, setEnvironment(patch) {
      if (disposed) return;
      dirty = true;
      if (typeof patch.reduceMotion === 'boolean') quiet = patch.reduceMotion;
      if (patch.quality && patch.quality !== quality) {
        quality = patch.quality;
        motionQuality.resetSamples();
        resize();
      }
      terrain.setEnvironment(patch);
    } };
  } catch (error) {
    dispose();
    throw error;
  }
}
