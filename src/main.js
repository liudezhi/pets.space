import './style.css';
import { addCare, showHandover, showWishes } from './care.js';
import { loadEnvironment, climatePanel } from './climate-panel.js';
import { request, renderGarden, showPublicGardens } from './gardens.js';
import { showOwner } from './owner.js';
import { checkoutReturn } from './checkout.js';
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
let environment = loadEnvironment();
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
  $('#notice').textContent = '当前设备暂时无法显示 3D。你仍可切换四处取景、查看地图或打开纪念册。';
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
    walk = startWalk(world, { initial: current.id, memorial: activeGarden, environment, onVisit: id=>openGarden(id), onPlace: id => select(id), onExit: stopWalk, onError: walkFailed });
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
  body.classList.remove('care-form');
  $('#panel-title').textContent = title;
  if (!panel.open) panel.showModal();
  panel.scrollTop = 0;
  return { body, isCurrent: () => version === panelVersion && panel.open };
}

async function openGarden(id, message = '') {
  const { body, isCurrent } = beginPanel('花园纪念册');
  body.textContent = '正在打开花园…';
  try {
    const { garden } = await request('/api/gardens/' + encodeURIComponent(id));
    if (!isCurrent()) return;
    if (walk) stopWalk();
    select(garden.place);
    function display(record, message = '') {
      setGarden(record);
      const status = renderGarden(body, record, { changed: display, isCurrent, openGarden,
        extraActions: (container,record) => addCare(container,record,{
          refresh:()=>openGarden(record.id), removed:()=>{setGarden(null);showPanel('owner');}
        }),
        goWalk: (place) => { closePanel(); select(place==='courtyard'?'courtyard':record.place, true); enterWalk(); }
      });
      status.textContent = message;
    }
    display(garden, message);
  } catch (error) {
    if (isCurrent()) {
      setGarden(null);
      body.textContent = error.message;
    }
  }
}

function showPanel(kind, recoveryKey) {
  const title = { map: '园区地图', album: '河湾纪念册', owner: '我的花园', wishes:'许愿树寄语',climate:'时光与天气',handover:'家庭交接',promise:'保存约定' }[kind];
  const { body, isCurrent } = beginPanel(title);
  if (kind === 'climate') {
    climatePanel(body,environment,prefs => { environment=prefs;walk?.setEnvironment(prefs); },()=>{closePanel();if(!walk)enterWalk();});
  } else if (kind === 'wishes') {
    showWishes(body,isCurrent).catch(err=>{if(isCurrent())body.textContent=err.message;});
  } else if (kind === 'handover') {
    showHandover(body,openGarden,isCurrent).catch(err=>{if(isCurrent())body.textContent=err.message;});
  } else if (kind === 'promise') {
    body.innerHTML='<p>栖光谷以一百年为存续目标。经营主体、长期资金和百年服务条款仍待正式上线前落实。</p><p>园主可以导出名字、回忆、已存原图、私人寄语和礼物记录，在离线设备打开。公开链接仅展示获准公开的内容。移交给家人后，档案转为私密。删除会清理当前服务中的纪念资料，历史备份保留时间取决于实际运营设置。</p><a class="garden-btn" href="/api/gardens/demo-riverbend/archive" download>下载示例离线纪念册</a>';
  } else if (kind === 'map') {
    body.innerHTML = `<img class="map" src="${planUrl}" alt="北向路线图，入口经纪念石和石桥到达许愿树"><div class="map-stops"></div>`;
    for (const place of places) {
      const stop = document.createElement('button');
      stop.textContent = place.name;
      stop.onclick = () => { closePanel(); select(place.id, true); };
      body.querySelector('.map-stops').append(stop);
    }
  } else if (kind === 'owner') {
    showOwner(body, { request, openGarden, isCurrent, recoveryKey, setTitle: text => {
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
const arrival = new URL(location.href);
const orderId = arrival.searchParams.get('order');
const returnType = arrival.searchParams.get('checkout');
if (['success', 'cancel'].includes(returnType) && /^[a-z0-9-]{1,64}$/.test(orderId || '')) {
  const { body, isCurrent } = beginPanel('结算结果');
  const clearReturn = () => {
    const url = new URL(location.href);
    url.searchParams.delete('checkout');
    url.searchParams.delete('order');
    history.replaceState(null, '', url);
  };
  panel.addEventListener('close', clearReturn, { once: true });
  checkoutReturn(body, { request, id: orderId, returned: returnType, isCurrent,
    onLater(order) {
      clearReturn();
      if (order?.gardenId) openGarden(order.gardenId);
      else if (order) showPanel('owner');
      else closePanel();
    },
    onPaid(result) {
      clearReturn();
      if (result.order.gardenId) openGarden(result.order.gardenId, '礼物订单已完成。');
      else showPanel('owner', result.recoveryKey);
    },
  });
} else if (arrival.searchParams.has('garden')) openGarden(arrival.searchParams.get('garden'));
