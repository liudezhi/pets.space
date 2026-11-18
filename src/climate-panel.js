import { gardenClimate } from './world-clock.js';
const bands = {
  time: { live: '园区时间', dawn: '日出', day: '白昼', sunset: '日落', night: '星夜' },
  season: { live: '园区季节', spring: '春', summer: '夏', autumn: '秋', winter: '冬' },
  weather: { live: '园区天气', clear: '晴', wind: '风', rain: '雨', snow: '雪', storm: '雷雨' },
  quality: { auto: '自动 · 驻足时清晰', fine: '精细 · 优先画质', low: '轻量 · 优先流畅' },
};
function defaults() {
  return {
    time: 'live',
    season: 'live',
    quality: 'auto',
    weather: 'live',
    sound: false,
    thunder: true,
    lightning: false,
    reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
export function loadEnvironment() {
  const prefs = defaults();
  try {
    const stored = JSON.parse(localStorage.getItem('qiguang.environment.v1') || '{}');
    for (const [key, options] of Object.entries(bands))
      if (Object.hasOwn(options, stored[key])) prefs[key] = stored[key];
    for (const k of ['sound', 'thunder', 'lightning', 'reduceMotion'])
      if (typeof stored[k] === 'boolean') prefs[k] = stored[k];
  } catch {
    /* Storage can be unavailable in a private window. */
  }
  return prefs;
}
export function climatePanel(body, current, apply, view) {
  const prefs = { ...current };
  const label = document.createElement('p'),
    explanation = document.createElement('p');
  const controls = document.createElement('div');
  controls.className = 'climate-panel';
  explanation.textContent = '园区使用北京时间。预览只改变本设备的 3D 风景。';
  const update = () => {
    const state = gardenClimate(prefs);
    const clock = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    label.textContent =
      '园区 ' + clock + ' · 当前取景：' + bands.season[state.season] + '季 / ' + bands.weather[state.weather];
    try {
      localStorage.setItem('qiguang.environment.v1', JSON.stringify(prefs));
    } catch {}
    apply({ ...prefs });
  };
  const presets = document.createElement('div');
  presets.className = 'climate-presets';
  for (const [title, settings] of [
    ['晴秋傍晚', { time: 'sunset', season: 'autumn', weather: 'clear' }],
    ['跟随园区', { time: 'live', season: 'live', weather: 'live' }],
  ]) {
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'garden-btn';
    pick.textContent = title;
    pick.onclick = () => {
      for (const [key, value] of Object.entries(settings)) {
        prefs[key] = value;
        controls.querySelector(`select[name="${key}"]`).value = value;
      }
      update();
    };
    presets.append(pick);
  }
  body.replaceChildren(label, explanation, presets, controls);
  for (const [key, title] of [
    ['time', '时段'],
    ['season', '季节'],
    ['weather', '天气'],
    ['quality', '画面精度'],
  ]) {
    const wrap = document.createElement('label');
    wrap.textContent = title;
    const select = document.createElement('select');
    select.name = key;
    for (const [id, name] of Object.entries(bands[key])) select.append(new Option(name, id));
    select.value = prefs[key];
    select.onchange = () => {
      prefs[key] = select.value;
      update();
    };
    wrap.append(select);
    controls.append(wrap);
  }
  for (const [key, title] of [
    ['sound', '环境声音'],
    ['thunder', '雷鸣声'],
    ['lightning', '雷雨闪光'],
    ['reduceMotion', '减少动态效果'],
  ]) {
    const wrap = document.createElement('label');
    wrap.textContent = title;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = prefs[key];
    box.onchange = () => {
      prefs[key] = box.checked;
      update();
    };
    wrap.append(box);
    controls.append(wrap);
  }
  const show = document.createElement('button');
  show.className = 'garden-btn primary';
  show.textContent = '查看 3D 风景';
  show.onclick = view;
  body.append(show);
  update();
}
