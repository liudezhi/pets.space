import './style.css';
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
$('[data-walk]').onclick = async () => {
  if (loading || walk) return;
  loading = true;
  const button = $('[data-walk]');
  button.disabled = true;
  $('#notice').textContent = '正在加载河湾地形…';
  try {
    const { startWalk } = await import('./walk.js');
    world.hidden = false;
    walk = startWalk(world, { initial: current.id, onPlace: id => select(id), onExit: stopWalk, onError: walkFailed });
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
};
$('[data-leave]').onclick = stopWalk;
function closePanel() { panel.close(); }
function showPanel(kind) {
  const body = $('#panel-body');
  $('#panel-title').textContent = kind === 'map' ? '园区地图' : '河湾纪念册';
  if (kind === 'map') {
    body.innerHTML = `<img class="map" src="${planUrl}" alt="北向路线图，入口经纪念石和石桥到达许愿树"><div class="map-stops"></div>`;
    for (const place of places) {
      const stop = document.createElement('button');
      stop.textContent = place.name;
      stop.onclick = () => { closePanel(); select(place.id, true); };
      body.querySelector('.map-stops').append(stop);
    }
  } else {
    body.innerHTML = '<article class="entry"><img src="/pet.webp" alt="草地上的金毛犬"><div><small>河湾花园 · 示例纪念</small><h3>麦子</h3><p>从前沿河散步，你总会在水边停下来，等我跟上。今天也陪你在这里坐一会儿。</p><button class="album-visit">去石前看看 <i data-icon="right"></i></button></div></article>';
    renderIcons(body);
    body.querySelector('button').onclick = () => { closePanel(); select('stone', true); };
  }
  panel.showModal();
}
document.querySelectorAll('[data-open]').forEach(button => button.onclick = () => showPanel(button.dataset.open));
$('#close-panel').onclick = closePanel;
panel.addEventListener('click', event => {
  if (event.target !== panel) return;
  const rect = panel.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePanel();
});
