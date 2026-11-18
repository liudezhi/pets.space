import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import './walk.css';

// X points east and -Z north. Each arrival faces a meaningful part of the garden.
const places = {
  entrance: { x: -40, z: 30, faceX: 20, faceZ: -16, pitch: -0.055 },
  stone: { x: -10, z: 9, faceX: -12, faceZ: 6, pitch: -0.18 },
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

export function startWalk(container, { initial = 'entrance', onPlace, onExit, onError } = {}) {
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
    clearInput();
    const point = places[id];
    camera.position.set(point.x, terrain.heightAt(point.x, point.z) + eyeHeight, point.z);
    yaw = Math.atan2(point.x - point.faceX, point.z - point.faceZ);
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
    if (terrain.canWalkAt(position.x + dx, position.z)) position.x += dx;
    if (terrain.canWalkAt(position.x, position.z + dz)) position.z += dz;
    position.y = terrain.heightAt(position.x, position.z) + eyeHeight;
    notifyNearest();
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
    if (!reducedMotion.matches) animationTime += dt;
    terrain.update?.(animationTime);
    renderer.render(scene, camera);
  }

  function syncVisibility() {
    previousTime = 0;
    sampleFrames = 0;
    sampleSeconds = 0;
    clearInput();
    renderer.setAnimationLoop(document.hidden ? null : draw);
  }

  try {
    terrain = buildTerrain(scene);
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
    goTo(Object.hasOwn(places, initial) ? initial : 'entrance');
    syncVisibility();
    return { goTo, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
