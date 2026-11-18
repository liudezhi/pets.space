import './style.css';
import { request, renderGarden, showPublicGardens } from './gardens.js';
import { showOwner } from './owner.js';
import { places } from './places.js';
import { renderIcons } from './icons.js';
import planUrl from '../docs/scene-riverbend/plan.svg';

const $ = selector => document.querySelector(selector);
const vista = $('.vista');
const panel = $('#panel');
const world = $('#world');
const grid = $('#places');
let current = places[1];
let walk;
let loading = false;
let panelVersion = 0;
let activeGarden = null;
const recordLink = $('#return-to-record');

function setGarden(garden) {
  activeGarden = garden;
  recordLink.hidden = !garden;
  const url = new URL(location.href);
  if (garden) url.searchParams.set('garden', garden.id);
  else url.searchParams.delete('garden');
  history.replaceState(null, '', url);
}

for (const place of places) {
  const button = document.createElement('button');
  button.className = 'place-card';
  button.dataset.place = place.id;
  button.innerHTML = `<img src="${place.image}" alt="" loading="lazy"><span class="card-copy"><small>${place.region}</small><strong>${place.name}</strong></span><i data-icon="upRight"></i>`;
  button.addEventListener('click', () => select(place.id, true));
  grid.append(button);
}
renderIcons();

function select(id, move = false) {
  const place = places.find(item => item.id === id);
  if (!place) return;
  current = place;
  const photo = $('#scene-photo');
  photo.src = place.image;
  photo.alt = place.alt;
  vista.dataset.current = place.id;
  $('#place-tag').textContent = place.region;
  $('#place-name').textContent = place.name;
  $('#walk-place').textContent = place.name;
  $('#english-name').textContent = place.english;
  $('#place-copy').textContent = place.description;
  for (const card of grid.children) card.setAttribute('aria-pressed', String(card.dataset.place === id));
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  if (move) {
    walk?.goTo(id);
    vista.scrollIntoView({ block: 'start' });
  }
}
function cycle(step) {
  select(places[(places.indexOf(current) + step + places.length) % places.length].id);
}
$('#prev').onclick = () => cycle(-1);
$('#next').onclick = () => cycle(1);
select(places.find(p => location.hash === '#' + p.id)?.id || 'stone');
window.addEventListener('hashchange', () => select(location.hash.slice(1), true));
$('.brand').addEventListener('click', event => {
  event.preventDefault();
  if (walk) stopWalk();
  setGarden(null);
  select('stone', true);
});

function stopWalk() {
  const active = walk;
  walk = undefined;
  active?.dispose();
  world.hidden = true;
  $('.walk-menu').hidden = true;
  $('.walk-tip').hidden = true;
  vista.classList.remove('walking');
  $('[data-walk]').focus({ preventScroll: true });
}
function walkFailed() {
  stopWalk();
  $('#notice').textContent = '当前设备暂时无法显示 3D。你仍可切换三个取景点、查看地图或打开纪念册。';
}
async function enterWalk() {
  if (loading || walk) return;
  loading = true;
  const button = $('[data-walk]');
  button.disabled = true;
  $('#notice').textContent = '正在加载河湾地形…';
  try {
    if (activeGarden) {
      try {
        const { garden } = await request('/api/gardens/' + encodeURIComponent(activeGarden.id));
        setGarden(garden);
      } catch (error) {
        setGarden(null);
        $('#notice').textContent = error.message;
        return;
      }
    }
    const { startWalk } = await import('./walk.js');
    world.hidden = false;
    walk = startWalk(world, { initial: current.id, memorial: activeGarden, onPlace: id => select(id), onExit: stopWalk, onError: walkFailed });
    vista.classList.add('walking');
    $('.walk-menu').hidden = false;
    $('.walk-tip').hidden = false;
    $('#notice').textContent = '';
    world.querySelector('canvas')?.focus({ preventScroll: true });
  } catch {
    walkFailed();
  } finally {
    button.disabled = false;
    loading = false;
  }
}
$('[data-walk]').onclick = enterWalk;
$('[data-leave]').onclick = stopWalk;
function closePanel() { panel.close(); }
function beginPanel(title) {
  const body = $('#panel-body');
  const version = ++panelVersion;
  body.replaceChildren();
  $('#panel-title').textContent = title;
  if (!panel.open) panel.showModal();
  panel.scrollTop = 0;
  return { body, isCurrent: () => version === panelVersion && panel.open };
}

async function openGarden(id) {
  const { body, isCurrent } = beginPanel('花园纪念册');
  body.textContent = '正在打开花园…';
  try {
    const { garden } = await request('/api/gardens/' + encodeURIComponent(id));
    if (!isCurrent()) return;
    if (walk) stopWalk();
    select(garden.place);
    function display(record, message = '') {
      setGarden(record);
      const status = renderGarden(body, record, { changed: display, isCurrent,
        goWalk: () => { closePanel(); select(record.place, true); enterWalk(); }
      });
      status.textContent = message;
    }
    display(garden);
  } catch (error) {
    if (isCurrent()) {
      setGarden(null);
      body.textContent = error.message;
    }
  }
}

function showPanel(kind) {
  const title = { map: '园区地图', album: '河湾纪念册', owner: '我的花园' }[kind];
  const { body, isCurrent } = beginPanel(title);
  if (kind === 'map') {
    body.innerHTML = `<img class="map" src="${planUrl}" alt="北向路线图，入口经纪念石和石桥到达许愿树"><div class="map-stops"></div>`;
    for (const place of places) {
      const stop = document.createElement('button');
      stop.textContent = place.name;
      stop.onclick = () => { closePanel(); select(place.id, true); };
      body.querySelector('.map-stops').append(stop);
    }
  } else if (kind === 'owner') {
    showOwner(body, { request, openGarden, isCurrent, setTitle: text => {
      if (isCurrent()) $('#panel-title').textContent = text;
    } }).catch(error => { if (isCurrent()) body.textContent = error.message; });
  } else {
    showPublicGardens(body, { openGarden, isCurrent, visitSample() {
      closePanel();
      if (walk) stopWalk();
      setGarden(null);
      select('stone', true);
    } });
  }
}
recordLink.onclick = () => { if (activeGarden) openGarden(activeGarden.id); };
document.querySelectorAll('[data-open]').forEach(button => button.onclick = () => showPanel(button.dataset.open));
$('#close-panel').onclick = closePanel;
panel.addEventListener('click', event => {
  if (event.target !== panel) return;
  const rect = panel.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePanel();
});
const sharedGarden = new URL(location.href).searchParams.get('garden');
if (sharedGarden) openGarden(sharedGarden);
