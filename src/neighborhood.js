import * as THREE from 'three';

// Each stone sits off the trail. Its viewing point lies on the open meadow beside it.
// The same six pairs are reused in each server-assigned neighborhood.
const sites = [
  { x: -13.4, z: 13.9, viewX: -12.2, viewZ: 11.1 },
  { x: -16.0, z: 11.9, viewX: -16.1, viewZ: 14.1 },
  { x: -19.5, z: 19.6, viewX: -19.4, viewZ: 16.8 },
  { x: -23.7, z: 16.4, viewX: -23.1, viewZ: 19.1 },
  { x: -27.1, z: 24.4, viewX: -27.1, viewZ: 21.5 },
  { x: -30.8, z: 21.5, viewX: -30.1, viewZ: 24.3 },
];

function button(text) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  return el;
}

function stoneShape() {
  const oval = new THREE.Shape();
  oval.moveTo(-0.55, -0.12);
  oval.lineTo(0.55, -0.12);
  oval.lineTo(0.53, 0.68);
  oval.bezierCurveTo(0.49, 1.19, -0.48, 1.12, -0.54, 0.7);
  oval.closePath();
  return new THREE.ExtrudeGeometry(oval, {
    depth: 0.25, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.045, bevelThickness: 0.04, curveSegments: 8,
  });
}

async function plaqueTexture(garden, signal) {
  const path = '/api/gardens/' + encodeURIComponent(garden.id) + '/photo';
  if (garden.photoUrl !== path) return null;
  const response = await fetch(path, { signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) return null;
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 272;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ded6bf';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 22, 15, 212, 212);
    ctx.font = '21px serif';
    ctx.textAlign = 'center'; ctx.fillStyle = '#423e32';
    const glyphs = Array.from(garden.name);
    const label = glyphs.length > 9 ? glyphs.slice(0, 8).join('') + '…' : garden.name;
    ctx.fillText(label, 128, 256, 232);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } finally { bitmap.close(); }
}

export function createNeighborhood({ scene, camera, container, canvas, terrain, arrive, onVisit }) {
  const markers = new Map();
  const group = new THREE.Group();
  group.name = '沿路公开纪念园';
  scene.add(group);
  const stone = stoneShape();
  const portrait = new THREE.PlaneGeometry(0.54, 0.58);
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#b3aa92', roughness: 0.97 });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const listeners = new AbortController();
  const listening = { signal: listeners.signal };
  const controls = document.createElement('details');
  controls.className = 'neighborhood-guide';
  controls.hidden = true;
  const summary = document.createElement('summary');
  summary.textContent = '沿路花园';
  const label = document.createElement('label');
  label.textContent = '选择纪念地';
  const select = document.createElement('select');
  label.append(select);
  const go = button('到石前');
  const pages = document.createElement('div');
  const back = button('上一区'), forward = button('下一区');
  const region = document.createElement('span');
  pages.append(back, region, forward);
  controls.append(summary, label, go, pages);
  const visit = button('');
  visit.className = 'nearby-visit';
  visit.hidden = true;
  container.append(controls, visit);

  let currentPage = 0, previous = null, next = null;
  let request, timer, disposed = false, nearest = null, tap;
  let optionsKey = '';
  function remove(id) {
    const marker = markers.get(id);
    if (!marker) return;
    group.remove(marker.object);
    marker.photoMaterial.map.dispose();
    marker.photoMaterial.dispose();
    markers.delete(id);
  }

  function updateEntries() {
    const entries = [...markers.values()].sort((a, b) => a.garden.slot - b.garden.slot);
    const key = JSON.stringify(entries.map(({ garden }) => [garden.id, garden.name]));
    if (key !== optionsKey) {
      const selected = select.value;
      select.replaceChildren(...entries.map(({ garden }) => new Option(garden.name, garden.id)));
      if (markers.has(selected)) select.value = selected;
      optionsKey = key;
    }
    controls.hidden = entries.length === 0;
    if (controls.hidden) controls.open = false;
    pages.hidden = previous === null && next === null;
    back.disabled = previous === null;
    forward.disabled = next === null;
    region.textContent = '第 ' + (currentPage + 1) + ' 区';
    update();
  }

  function add(garden, texture) {
    const site = sites[garden.slot];
    const object = new THREE.Group();
    object.position.set(site.x, terrain.heightAt(site.x, site.z) - 0.02, site.z);
    object.rotation.y = Math.atan2(site.viewX - site.x, site.viewZ - site.z);
    object.userData.garden = garden.id;
    const photoMaterial = new THREE.MeshBasicMaterial({ map: texture, color: '#fdf7e9' });
    const frame = new THREE.Mesh(portrait, photoMaterial);
    frame.position.set(0, 0.60, 0.298);
    object.add(new THREE.Mesh(stone, stoneMaterial), frame);
    group.add(object);
    markers.set(garden.id, { garden, object, photoMaterial, site });
  }

  async function load(page = currentPage) {
    request?.abort();
    clearTimeout(timer);
    const current = new AbortController();
    request = current;
    const cancelled = () => disposed || current.signal.aborted;
    const changingPage = page !== currentPage;
    const keepGuideOpen = changingPage && controls.open;
    if (changingPage) {
      for (const id of markers.keys()) remove(id);
      currentPage = page;
      updateEntries();
    }
    try {
      const response = await fetch('/api/neighborhoods?page=' + page, {
        signal: current.signal, credentials: 'omit', cache: 'no-store',
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (cancelled()) return;
      previous = Number.isSafeInteger(data.previous) ? data.previous : null;
      next = Number.isSafeInteger(data.next) ? data.next : null;
      currentPage = data.page;
      const gardens = data.gardens.filter(g => typeof g.name === 'string' && Number.isInteger(g.slot) && sites[g.slot]);
      const wanted = new Map(gardens.map(g => [g.id, g]));
      for (const [id, entry] of markers) {
        const incoming = wanted.get(id);
        if (!incoming || entry.garden.name !== incoming.name || entry.garden.slot !== incoming.slot) remove(id);
      }
      updateEntries();
      await Promise.all(gardens.filter(g => !markers.has(g.id)).map(async garden => {
        try {
          const texture = await plaqueTexture(garden, current.signal);
          if (!texture) return;
          if (cancelled()) texture.dispose();
          else add(garden, texture);
        } catch { /* A withdrawn or unavailable photo is omitted. */ }
      }));
      if (cancelled()) return;
      updateEntries();
      if (keepGuideOpen && !controls.hidden) controls.open = true;
      if (!gardens.length && previous !== null && previous !== page) { void load(previous); }
    } catch {
      if (!cancelled()) {
        for (const id of markers.keys()) remove(id);
        updateEntries();
      }
    } finally {
      if (!cancelled()) timer = setTimeout(load, 15000);
    }
  }

  function update() {
    let near = null;
    let best = 5.5;
    for (const entry of markers.values()) {
      const distance = Math.hypot(entry.site.x - camera.position.x, entry.site.z - camera.position.z);
      if (distance < best) { best = distance; near = entry; }
    }
    const nextLabel = near ? '探访 ' + near.garden.name : '';
    if (nearest !== near || visit.textContent !== nextLabel) {
      nearest = near; visit.hidden = !near; visit.textContent = nextLabel;
    }
  }

  function jump(entry) {
    if (!entry) return;
    controls.open = false;
    const site = entry.site;
    arrive({ x: site.viewX, z: site.viewZ, faceX: site.x, faceZ: site.z, pitch: -0.25 });
    update();
  }

  async function open(entry) {
    if (!entry || visit.disabled) return;
    visit.disabled = true;
    try {
      const result = await fetch('/api/gardens/' + encodeURIComponent(entry.garden.id), {
        credentials: 'omit', cache: 'no-store', signal: listeners.signal,
      });
      if (disposed) return;
      if (result.ok && (await result.json()).garden?.isPublic && markers.get(entry.garden.id) === entry) {
        onVisit(entry.garden.id);
      } else {
        remove(entry.garden.id);
        updateEntries();
        void load();
      }
    } catch {
      if (!disposed) { remove(entry.garden.id); updateEntries(); }
    } finally { visit.disabled = false; }
  }

  go.addEventListener('click', () => jump(markers.get(select.value)), listening);
  back.addEventListener('click', () => { if (previous !== null) void load(previous); }, listening);
  forward.addEventListener('click', () => { if (next !== null) void load(next); }, listening);
  visit.addEventListener('click', () => void open(nearest), listening);
  canvas.addEventListener('pointerdown', e => { tap = { id: e.pointerId, x: e.clientX, y: e.clientY }; }, listening);
  canvas.addEventListener('pointerup', e => {
    if (!tap || tap.id !== e.pointerId || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 5) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(group.children, true);
    const entry = markers.get(hits[0]?.object.parent?.userData.garden);
    if (entry === nearest && entry) void open(entry);
    else jump(entry);
  }, listening);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void load();
  }, listening);
  void load();
  return {
    update,
    canWalkAt(x, z) {
      for (const entry of markers.values()) if (Math.hypot(x - entry.site.x, z - entry.site.z) < 0.74) return false;
      return true;
    },
    dispose() {
      disposed = true; clearTimeout(timer); request?.abort(); listeners.abort();
      for (const id of markers.keys()) remove(id);
      group.removeFromParent();
      stone.dispose(); stoneMaterial.dispose(); portrait.dispose();
      controls.remove(); visit.remove();
    },
  };
}
