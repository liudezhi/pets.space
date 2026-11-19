import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWalkQuality } from '../src/walk-quality.js';

test('sustained slow motion lowers render cost and stopping restores full detail', () => {
  const quality = createWalkQuality();
  const setup = (mode, moving) => quality.drawingSetup(mode, moving, 1, 1280, 720);
  const before = setup('auto', true);
  quality.sample(1.9);
  for (let i = 0; i < 12; i++) quality.sample(1 / 60);
  assert.deepEqual(setup('auto', true), before);
  for (let i = 0; i < 14; i++) quality.sample(1.9);
  const slow = setup('auto', true);
  assert.ok(slow.ratio < before.ratio && slow.detail < before.detail);
  assert.deepEqual(setup('auto', false), { ratio: 1, detail: 1 });
  assert.deepEqual(setup('fine', true), { ratio: 1, detail: 1 });
  quality.resetSamples();
  for (let i = 0; i < 300; i++) quality.sample(1 / 60);
  assert.ok(setup('auto', true).ratio > slow.ratio);
});

test('light quality respects its pixel budget across viewport sizes and device scales', () => {
  const quality = createWalkQuality();
  for (const [w, h, native] of [[390, 740, 1.45], [1280, 720, 1], [3840, 2160, 1.65]]) {
    const setup = quality.drawingSetup('low', true, native, w, h);
    assert.ok(setup.ratio <= native && w * h * setup.ratio ** 2 <= 280001);
    assert.deepEqual(quality.drawingSetup('low', false, native, w, h), setup);
    assert.deepEqual(quality.drawingSetup('fine', false, native, w, h), { ratio: native, detail: 1 });
  }
});
