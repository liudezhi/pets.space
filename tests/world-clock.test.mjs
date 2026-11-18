import test from 'node:test';
import assert from 'node:assert/strict';
import { gardenClimate } from '../src/world-clock.js';

test('park joins spring at its local midnight regardless of viewer timezone', () => {
  const before=gardenClimate({},Date.parse('2026-02-28T15:59:59Z'));
  const after=gardenClimate({},Date.parse('2026-02-28T16:00:00Z'));
  assert.equal(before.season,'winter');assert.ok(before.hour>23.99);
  assert.equal(after.season,'spring');assert.equal(after.hour,0);
});

test('fixed cameras observe dawn in the east and sunset in the west',() => {
  for(const day of ['2026-06-21','2026-12-21']){
    const now=Date.parse(day);
    const dawn=gardenClimate({time:'dawn'},now), dusk=gardenClimate({time:'sunset'},now);
    assert.ok(dawn.sun[0]>.6 && dusk.sun[0]<-.6);
    assert.ok(dawn.sun[1]>0 && dawn.sun[1]<.12);
    assert.ok(dusk.sun[1]>0 && dusk.sun[1]<.12);
    assert.ok(gardenClimate({time:'night'},now).sun[1]<0);
    assert.ok(Math.abs(Math.hypot(...dusk.sun)-1)<1e-10);
  }
});

test('weather is shared across a six-hour interval and personal overrides are isolated',()=>{
  const now=Date.parse('2026-11-18T05:02:00Z');
  const regular=gardenClimate({},now);
  assert.equal(gardenClimate({weather:'live'},now+30*60_000).weather, regular.weather);
  const override=gardenClimate({season:'winter',weather:'snow',time:'night'},now);
  assert.equal(override.weather,'snow');assert.equal(override.season,'winter');
  assert.equal(regular.season,'autumn');assert.deepEqual(gardenClimate({},now),regular);
});
