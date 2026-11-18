import { DefaultLoadingManager } from 'three';
import { startWalk } from '../../src/walk.js';
import { climatePanel, loadEnvironment } from '../../src/climate-panel.js';
import { places } from '../../src/places.js';
import { renderIcons } from '../../src/icons.js';
import '../../src/style.css';
import '../../src/care.css';
import sampleImage from '../../public/pet.webp?inline';
import mapImage from '../../docs/scene-riverbend/plan.svg?inline';

const tiles = import.meta.glob('../../public/surfaces/*.webp', { eager: true, import: 'default', query: '?inline' });
const embedded = new Map(Object.entries(tiles).map(([file, data]) => ['/surfaces/' + file.split('/').pop(), data]));
DefaultLoadingManager.setURLModifier(url => {
  if (url.startsWith('data:')) return url;
  if (embedded.has(url)) return embedded.get(url);
  throw new Error('找不到离线素材');
});

const encoded = sampleImage.slice(sampleImage.indexOf(',') + 1);
const sample = { name: '麦子', place: 'stone', photoUrl: new Blob(
  [Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: 'image/webp' }),
};
const $ = selector => document.querySelector(selector);
const panel = $('#panel'), body = $('#panel-body'), vista = $('.vista');
let selected = places[1], climate = loadEnvironment(), walk;

function showPlace(id) {
  selected = places.find(p => p.id === id) || selected;
  $('#landscape').src = selected.image;
  $('#landscape').alt = selected.alt;
  vista.dataset.current = selected.id;
  $('#region').textContent = selected.region + ' · 景观设定图';
  $('#english-name').textContent = selected.english;
  $('#place-name').textContent = $('#walk-place').textContent = selected.name;
  $('#place-copy').textContent = selected.description;
  for (const card of $('#places').children) card.setAttribute('aria-pressed', String(card.dataset.place === selected.id));
}
function visitPlace(id) {
  showPlace(id);
  walk?.goTo(selected.id);
  vista.scrollIntoView({ block: 'start' });
}
for (const place of places) {
  const card = document.createElement('button');
  card.className = 'place-card'; card.dataset.place = place.id;
  const thumb = new Image(); thumb.alt = ''; thumb.src = place.image;
  const label = document.createElement('span'); label.className = 'card-copy';
  const region = document.createElement('small'); region.textContent = place.region;
  const name = document.createElement('strong'); name.textContent = place.name;
  const arrow = document.createElement('i'); arrow.dataset.icon = 'upRight';
  label.append(region, name); card.append(thumb, label, arrow);
  card.onclick = () => visitPlace(place.id);
  $('#places').append(card);
}

function leave() {
  walk?.dispose(); walk = undefined;
  $('.walk-menu').hidden = $('.walk-tip').hidden = $('#world').hidden = true;
  vista.classList.remove('walking');
  $('#begin').focus({ preventScroll:true });
}
function unavailable() {
  leave();
  $('#notice').textContent = '这台设备暂时无法显示 WebGL 2。仍可切换四张风景图、看地图和阅读麦子的纪念册。';
}
function enter() {
  if (panel.open) panel.close();
  if (walk) return;
  try {
    $('#world').hidden = false;
    walk = startWalk($('#world'), { initial:selected.id, environment:climate, memorial:sample,
      onPlace:showPlace, onExit:leave, onError:unavailable });
    vista.classList.add('walking');
    $('.walk-menu').hidden = $('.walk-tip').hidden = false;
    $('#notice').textContent = '';
    $('#world canvas').focus({ preventScroll:true });
  } catch { unavailable(); }
}
function show(kind) {
  body.replaceChildren();
  $('#panel-title').textContent = { map:'园区地图', album:'麦子的纪念册', climate:'时光与天气' }[kind];
  if (kind === 'map') {
    const image = new Image(); image.className = 'map'; image.src = mapImage;
    image.alt = '河湾北向地图与步道机位';
    body.append(image);
  } else if (kind === 'album') {
    const article = document.createElement('article'); article.className='entry';
    const image = new Image(); image.src = sampleImage; image.alt = '示例宠物麦子的照片';
    const text = document.createElement('div');
    text.innerHTML = '<small>河湾 · 示例纪念</small><h3>麦子</h3><p>从前沿河散步，你总会在水边停下来，等我跟上。今天也陪你在这里坐一会儿。</p>';
    const visit = document.createElement('button'); visit.textContent = '去石前看看';
    visit.onclick = () => { panel.close(); visitPlace('stone'); };
    text.append(visit); article.append(image, text); body.append(article);
  } else {
    climatePanel(body, climate, prefs => { climate=prefs; walk?.setEnvironment(prefs); }, enter);
  }
  panel.showModal();
}
showPlace(selected.id); renderIcons();
$('#begin').onclick = enter; $('#leave').onclick = leave;
$('#close').onclick = () => panel.close();
document.querySelectorAll('[data-show]').forEach(button => { button.onclick=()=>show(button.dataset.show); });
