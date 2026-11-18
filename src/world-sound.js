// Generate wind, water and distant rumbles locally. Audio is opt-in.
export function valleySound() {
  let context, level, wind, filter, bed;
  let enabled = false;
  function setup() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    context = new Audio();
    level = context.createGain();
    level.gain.value = 0;
    level.connect(context.destination);
    const samples = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const data = samples.getChannelData(0);
    let last = 0;
    for (let i=0; i<data.length; i++) {
      last = .94 * last + .06 * (Math.random()*2-1);
      data[i] = 2.7 * last + .10 * (Math.random()*2-1);
    }
    bed = context.createBufferSource();
    bed.buffer = samples;
    bed.loop = true;
    filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    bed.connect(filter).connect(level);
    wind = context.createOscillator();
    wind.frequency.value = .13;
    const gust = context.createGain();
    gust.gain.value = 55;
    wind.connect(gust).connect(filter.frequency);
    wind.start(); bed.start();
  }
  return {
    configure(value, weather, riverDistance) {
      enabled = Boolean(value);
      if (enabled && !context) {
        try { setup(); } catch { return; }
      }
      if (!context) return;
      if (!enabled || document.hidden) {
        if (context.state === 'running') context.suspend().catch(() => {});
        return;
      }
      if (context.state === 'suspended') context.resume().catch(() => {});
      const raining = weather === 'rain' || weather === 'storm';
      filter.frequency.setTargetAtTime(raining ? 4600 : weather === 'wind' ? 920 : 520, context.currentTime, .6);
      const water = .10 / (1 + riverDistance / 9);
      level.gain.setTargetAtTime(.05 + water + (raining ? .17 : weather === 'wind' ? .1 : 0), context.currentTime, .8);
    },
    thunder() {
      if (!context || !enabled || context.state !== 'running') return;
      const osc = context.createOscillator(), gain = context.createGain(), start = context.currentTime + .65;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(46, start);
      osc.frequency.exponentialRampToValueAtTime(28, start + 2);
      gain.gain.setValueAtTime(.001, start);
      gain.gain.exponentialRampToValueAtTime(.28, start + .25);
      gain.gain.exponentialRampToValueAtTime(.001, start + 2.7);
      osc.connect(gain).connect(level); osc.start(start); osc.stop(start + 2.8);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    },
    dispose() {
      enabled = false;
      if (!context) return;
      bed?.stop(); wind?.stop(); bed?.disconnect(); wind?.disconnect();
      filter?.disconnect(); level?.disconnect();
      context.close().catch(() => {});
    },
  };
}
