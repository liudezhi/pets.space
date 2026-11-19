// Runs inside the photography harness. Browser time measures the work. A fixed
// simulation clock makes path positions independent of the speed of the GPU.
const stepMs = 250;
const walkingFrames = 24;
const landmarks = ['stone', 'entrance', 'tree', 'courtyard'];

function rounded(value) {
  return Number(value.toFixed(3));
}

function durationStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = rank => rounded(sorted[Math.ceil(sorted.length * rank) - 1]);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {meanMs: rounded(mean), medianMs: percentile(.5), p95Ms: percentile(.95)};
}

function summarize(frames) {
  const total = frames.reduce((sum, item) => sum + item.wallMs, 0);
  const submitted = frames.filter(item => item.rendered);
  return {
    ticks: frames.length, rendered: submitted.length, elapsedMs: rounded(total),
    completedFps: rounded(submitted.length * 1000 / total),
    frameTime: durationStats(frames.map(item => item.wallMs)),
    renderAndReadback: durationStats(submitted.map(item => item.drawMs)),
  };
}

export async function measureRoute(probe, walk, quality, scenario = 'route') {
  const {renderer, camera} = probe;
  const gl = renderer.getContext();
  const canvas = renderer.domElement;
  const pixel = new Uint8Array(4);
  const key = {bubbles: true, cancelable: true, code: 'KeyW', key: 'w'};
  const position = () => camera.position.toArray().map(rounded);
  const press = () => canvas.dispatchEvent(new KeyboardEvent('keydown', key));
  const release = () => canvas.dispatchEvent(new KeyboardEvent('keyup', key));
  let time = performance.now() + 5000;
  probe.override = null;
  walk.setEnvironment({quality, reduceMotion: scenario === 'idle' || scenario === 'restore'});
  const clockOffset = time - performance.now();

  async function tick(advanceMs = stepMs) {
    const start = performance.now();
    const rafTime = await new Promise(requestAnimationFrame);
    const startedDraw = performance.now();
    const before = probe.renderCount;
    time = advanceMs === null ? rafTime + clockOffset : time + advanceMs;
    probe.frame(time);
    const rendered = before !== probe.renderCount;
    if (rendered) {
      // A synchronous read from the default framebuffer awaits a real GPU result
      // (including MSAA resolution). Keep it to one pixel on both releases.
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1,
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) {
        throw new Error('GPU readback failed.');
      }
    }
    const end = performance.now();
    return {
      wallMs: rounded(end - start), drawMs: rounded(end - startedDraw), rendered,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], position: position(),
      triangles: renderer.info.render.triangles, calls: renderer.info.render.calls,
    };
  }

  if (scenario === 'natural') {
    walk.goTo('entrance');
    await tick(null);
    const origin = position();
    const samples = [];
    const start = performance.now();
    press();
    try {
      while (performance.now() - start < 12000) samples.push(await tick(null));
    } finally {
      release();
    }
    const end = position();
    const released = performance.now();
    let afterKeyup;
    do {
      afterKeyup = await tick(null);
    } while (performance.now() - released < 1300);
    return {
      method: 'natural-clock-readback-v1', quality, targetWallSeconds: 12, ...summarize(samples),
      start: origin, end, horizontalDistance: rounded(Math.hypot(end[0] - origin[0], end[2] - origin[2])),
      samples, afterKeyup,
    };
  }

  if (scenario === 'restore') {
    async function stonePixels() {
      walk.goTo('stone');
      const frame = await tick(1600);
      if (!frame.rendered) throw new Error('Stone did not redraw.');
      const [width, height] = frame.buffer;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Full-image readback failed.');
      let min = 255, max = 0;
      for (let i = 0; i < pixels.length; i += 4 * 83) {
        min = Math.min(min, pixels[i]);
        max = Math.max(max, pixels[i]);
      }
      if (max - min < 32) throw new Error('Restoration test sampled a blank frame.');
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      return {frame, pixels, sha256};
    }
    const before = await stonePixels();
    walk.goTo('entrance');
    press();
    let walking;
    try {
      for (let i = 0; i < 24; i++) walking = await tick();
    } finally {
      release();
    }
    const after = await stonePixels();
    if (before.pixels.length !== after.pixels.length ||
        after.frame.buffer[0] !== canvas.parentElement.clientWidth ||
        after.frame.buffer[1] !== canvas.parentElement.clientHeight) {
      throw new Error('Original full-resolution still image was not restored.');
    }
    let maxChannelError = 0, differentPixels = 0, absoluteError = 0;
    for (let i = 0; i < before.pixels.length; i += 4) {
      let changed = false;
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(before.pixels[i + channel] - after.pixels[i + channel]);
        maxChannelError = Math.max(delta, maxChannelError);
        absoluteError += delta;
        changed ||= delta > 0;
      }
      if (changed) differentPixels++;
    }
    return {
      method: 'restoration-rgba-v1', quality, before: before.frame, walking, after: after.frame,
      beforeSha256: before.sha256, afterSha256: after.sha256,
      maxChannelError, differentPixels, meanChannelError: rounded(absoluteError / (before.pixels.length * .75)),
    };
  }

  if (scenario === 'idle') {
    walk.goTo('entrance');
    await tick(5000);
    await tick(5000);
    const ticks = [];
    for (let i = 0; i < 30; i++) ticks.push(await tick(1000 / 60));
    const origin = position();
    press();
    let wake;
    try {
      wake = await tick(1000 / 60);
    } finally {
      release();
    }
    const displacement = Math.hypot(wake.position[0] - origin[0], wake.position[2] - origin[2]);
    if (!wake.rendered || displacement < .01) throw new Error('First key press did not wake the scene.');
    return {
      method: 'reduced-motion-wake-v1', quality, idleLogicalHz: 60, idleTicks: ticks.length,
      actualRenders: ticks.filter(frame => frame.rendered).length,
      elapsedWallMs: rounded(ticks.reduce((sum, frame) => sum + frame.wallMs, 0)),
      wake, firstInputDisplacement: rounded(displacement),
    };
  }

  // Warm shaders and the initial part of the measured path, then return to the
  // entrance. Identical keyboard events visit the same world positions on each run.
  walk.goTo('entrance');
  await tick();
  press();
  try {
    for (let i = 0; i < 8; i++) await tick();
  } finally {
    release();
  }
  walk.goTo('entrance');
  for (let i = 0; i < 3; i++) await tick();
  const origin = position();
  const yaw = camera.rotation.y;
  const route = [];
  press();
  try {
    for (let i = 0; i < walkingFrames; i++) route.push(await tick());
  } finally {
    release();
  }
  const end = position();
  if (route.some(frame => !frame.rendered)) throw new Error('Movement failed to render.');
  const length = Math.hypot(end[0] - origin[0], end[2] - origin[2]);
  if (Math.abs(length - 22.8) > .03) throw new Error('Entrance path length changed: ' + length);
  const walking = {
    ...summarize(route), start: origin, yaw, end, horizontalDistance: rounded(length),
    samples: route,
  };
  if (quality === 'fine') {
    const width = canvas.parentElement.clientWidth, height = canvas.parentElement.clientHeight;
    if (route.some(frame => frame.buffer[0] !== width || frame.buffer[1] !== height)) {
      throw new Error('Fine quality changed the drawing-buffer size along the route.');
    }
  }
  console.info('BENCH ' + JSON.stringify({quality, walking: walking.completedFps, distance: length}));

  const stationary = {};
  for (const landmark of landmarks) {
    walk.goTo(landmark);
    await tick();
    await tick();
    const frames = [];
    for (let i = 0; i < 4; i++) frames.push(await tick());
    const last = frames.at(-1);
    stationary[landmark] = {
      ...summarize(frames), buffer: last.buffer, position: last.position,
      triangles: last.triangles, calls: last.calls,
    };
    if (quality !== 'low' && (last.buffer[0] !== canvas.parentElement.clientWidth ||
        last.buffer[1] !== canvas.parentElement.clientHeight)) {
      throw new Error('Full resolution did not return at ' + landmark);
    }
    console.info('BENCH ' + JSON.stringify({landmark, ...stationary[landmark]}));
  }

  // Real controls should stop modifying world coordinates on keyup, focus loss,
  // or teleporting with a key held. Keep walking disabled before the next probe.
  const cancellations = {};
  for (const event of ['keyup', 'blur', 'goTo']) {
    walk.goTo('entrance');
    canvas.focus();
    press();
    await tick();
    if (event === 'keyup') release();
    else if (event === 'blur') canvas.blur();
    else walk.goTo('tree');
    const start = position();
    await tick();
    await tick();
    const stopped = position();
    cancellations[event] = start.every((coordinate, index) => coordinate === stopped[index]);
    release();
    if (!cancellations[event]) throw new Error('Movement continued after ' + event);
  }
  return {
    method: 'fixed-input-readback-v1', quality, logicalStepMs: stepMs,
    warmupWalkingFrames: 8, movingAnimation: true, walking, stationary, cancellations,
  };
}
