const motionLevels = [
  { ratio: .42, detail: .28, pixels: 180000 },
  { ratio: .55, detail: .4, pixels: 300000 },
  { ratio: .72, detail: .62, pixels: 530000 },
  { ratio: .90, detail: .62, pixels: 920000 },
  { ratio: 1.15, detail: 1, pixels: 1800000 },
  { ratio: 1.35, detail: 1, pixels: 3200000 },
];
const light = { ratio: .65, detail: .28, pixels: 280000 };

export function createWalkQuality() {
  let level = 4, seconds = 0, frames = 0;
  function resetSamples() {
    seconds = 0;
    frames = 0;
  }
  return {
    resetSamples,
    sample(frameSeconds) {
      if (!(frameSeconds > 0)) return false;
      // A long upload or OS interruption should not outweigh several smooth frames.
      seconds += Math.min(frameSeconds, .2);
      frames++;
      // One slow frame can be an upload. Repeated stalls get a bigger step.
      if (frames < 3) return false;
      const mean = seconds / frames;
      let next = level;
      if (mean > .11) next -= 2;
      else if (frames >= 8 && mean > .043) next--;
      else if (frames >= 45 && seconds >= .8 && mean < .022) next++;
      else if (seconds < 1.25) return false;
      next = Math.max(0, Math.min(motionLevels.length - 1, next));
      resetSamples();
      if (next === level) return false;
      level = next;
      return true;
    },
    drawingSetup(quality, moving, native, width, height) {
      const budget = quality === 'low' ? light : quality === 'auto' && moving ? motionLevels[level] : null;
      if (!budget) return { ratio: native, detail: 1 };
      return {
        ratio: Math.min(native, budget.ratio, Math.sqrt(budget.pixels / (width * height))),
        detail: budget.detail,
      };
    },
  };
}
