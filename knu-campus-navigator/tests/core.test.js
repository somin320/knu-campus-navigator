'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/core');

function lineGraph(meters = 134, type = 'sidewalk') {
  const raw = { nodes: [
    { id: 'a', type: 'building', buildingNumber: '100', lat: 35, lng: 128 },
    { id: 'x', type: 'intersection', lat: 35.0001, lng: 128 },
    { id: 'b', type: 'building', buildingNumber: '101', lat: 35.0002, lng: 128 },
  ], edges: [{ from: 'a', to: 'x', type }, { from: 'x', to: 'b', type }] };
  const G = C.build(raw);
  // Synthetic unit-test distances; these are not field measurements.
  G.E.forEach(e => { e.m = meters / 2; });
  return G;
}
const ep = (G, key) => ({ place: G.byKey.get(key).idx, nodes: G.byKey.get(key).entrances });

test('browser and Node retain existing API with additive new exports', () => {
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/core'), 'utf8'), box);
  for (const name of ['build', 'route', 'nearestInCat', 'snap', 'search', 'chains', 'assessTransfer'])
    assert.equal(typeof box.window.KNUCore[name], 'function');
  assert.ok(Object.isFrozen(C.TERRAIN_WEIGHTS)); assert.ok(Object.isFrozen(C.TRANSFER_DEFAULTS));
});

test('terrain and avoidance policies remain unchanged; avoidance is a cost, not ETA', () => {
  assert.deepEqual(C.TERRAIN_WEIGHTS, { stairs: 1.65, slope: 1.1, road: 1 });
  assert.deepEqual(C.AVOID_WEIGHTS, { stairs: 25, slope: 2.5 }); assert.equal(C.WALK_M_PER_MIN, 67);
  for (const [type, normal, avoid] of [['sidewalk', 100, 100], ['road', 100, 100], ['stairs', 165, 2500], ['slope', 110, 250]]) {
    assert.ok(Math.abs(C.edgeCost({ m: 100, t: type }, false) - normal) < 1e-9);
    assert.ok(Math.abs(C.edgeCost({ m: 100, t: type }, true) - avoid) < 1e-9);
  }
  const G = lineGraph(134, 'stairs'), from = ep(G, '100'), to = ep(G, '101');
  const r = C.route(G, from, to, true); assert.equal(r.minutes, 3);
  G.byKey.get('101').cats.test = '';
  const n = C.nearestInCat(G, from, 'test', true)[0];
  assert.equal(n.minutes, r.minutes); assert.equal(n.cost, 134 * 25);
});

test('transfer states, exact boundaries and configurable 3/5 minute margins', () => {
  const G = lineGraph();
  for (const [gap, status, remaining] of [[7, '여유', 5], [6.99, '빠듯', 4.99], [2, '빠듯', 0], [1.99, '어려움', -0.01]]) {
    const r = C.assessTransfer(G, '100', '101', gap);
    assert.equal(r.status, status); assert.ok(Math.abs(r.remainingMinutes - remaining) < 1e-9);
    assert.equal(r.canMakeIt, remaining >= 0); assert.equal(r.conditions.indoorTimeKnown, false);
    assert.match(r.message, /잠정/);
  }
  assert.equal(C.assessTransfer(G, '100', '101', 5, { comfortableMarginMinutes: 3 }).status, '여유');
  assert.equal(C.assessTransfer(G, '100', '101', 5, { comfortableMarginMinutes: 5 }).status, '빠듯');
  assert.equal(C.TRANSFER_DEFAULTS.comfortableMarginMinutes, 5);
});

test('transfer uses route rounding and minimum for display, remaining time and judgement', () => {
  for (const exact of [0, 0.1, 2.1, 2.5, 2.9]) {
    const G = lineGraph(67 * exact);
    const route = C.route(G, ep(G, '100'), ep(G, '101'), false);
    const r = C.assessTransfer(G, 100, 101, route.minutes);
    assert.equal(route.minutes, Math.max(1, Math.round(exact)));
    assert.equal(r.estimatedWalkingMinutes, route.minutes); assert.equal(r.routeMinutes, route.minutes);
    assert.equal(r.requiredMinutes, route.minutes); assert.equal(r.remainingMinutes, 0);
    assert.equal(r.status, '빠듯'); assert.equal(r.canMakeIt, true);
    assert.equal(r.conditions.rounding, 'route-minutes');
    assert.ok(Math.abs(r.exactWalkingMinutes - exact) < 1e-9);
    const comfortable = C.assessTransfer(G, 100, 101, route.minutes + 5);
    assert.equal(comfortable.status, '여유'); assert.equal(comfortable.remainingMinutes, 5);
    assert.match(r.message, new RegExp(`필요시간 ${route.minutes}분, 남는 시간 0분`));
  }
  const G = lineGraph(67 * 2.1);
  const inside = C.assessTransfer(G, '100', '101', 10, { indoorMinutes: 0.5 });
  assert.equal(inside.estimatedWalkingMinutes, 2); assert.equal(inside.requiredMinutes, 2.5);
  assert.equal(inside.remainingMinutes, 7.5); assert.equal(inside.conditions.indoorTimeKnown, true);
});

test('same-building unknown indoor time defers judgement, explicit indoor estimate enables it', () => {
  const G = lineGraph(), unknown = C.assessTransfer(G, '100', '100', 10);
  assert.equal(unknown.status, null); assert.equal(unknown.canMakeIt, null);
  assert.equal(unknown.requiredMinutes, null); assert.equal(unknown.reason, 'same-building-internal-time-unknown');
  const known = C.assessTransfer(G, '100', '100', 7, { indoorMinutes: 2 });
  assert.equal(known.status, '여유'); assert.equal(known.requiredMinutes, 2);
  assert.equal(C.assessTransfer(G, '100', '100', 0, { indoorMinutes: 0 }).status, '빠듯');
  const fractional = C.assessTransfer(G, '100', '100', 1, { indoorMinutes: 0.5 });
  assert.equal(fractional.requiredMinutes, 0.5); assert.equal(fractional.remainingMinutes, 0.5);
});

test('invalid break/options/building and unknown route return structured, undecided results', () => {
  const G = lineGraph();
  for (const gap of [-1, NaN, Infinity, '10', null, undefined, {}, [], { endTime: '12:00', startTime: '11:00' }, { endTime: '24:00', startTime: '25:00' }]) {
    const r = C.assessTransfer(G, '100', '101', gap);
    assert.equal(r.reason, 'invalid-break'); assert.equal(r.status, null);
  }
  for (const options of [{ comfortableMarginMinutes: -1 }, { comfortableMarginMinutes: NaN }, { indoorMinutes: '2' }, { avoid: 'true' }, 'oops', []])
    assert.equal(C.assessTransfer(G, '100', '101', 10, options).reason, 'invalid-options');
  assert.equal(C.assessTransfer(G, 'unknown', '101', 10).reason, 'unknown-building');
  G.blocked[1] = 1; // Graph deliberately requires transit through a blocked building.
  assert.equal(C.assessTransfer(G, '100', '101', 10).reason, 'no-route');
});

test('same-day times and existing endpoint/place objects work without changing simple minute input', () => {
  const G = lineGraph(), r = C.assessTransfer(G, ep(G, '100'), G.byKey.get('101'), { endTime: '10:50', startTime: '11:00' });
  assert.equal(r.conditions.breakMinutes, 10); assert.equal(r.conditions.timeSource, 'same-day-HH:mm');
  assert.equal(r.status, C.assessTransfer(G, '100', '101', 10).status);
});

test('multiple entrances pick the least-cost endpoint; same building remains grouped', () => {
  const G = lineGraph();
  const p = G.byKey.get('101'); p.entrances.push(1);
  const r = C.route(G, ep(G, '100'), ep(G, '101'), false);
  assert.equal(r.toNode, 1); assert.equal(r.meters, 67);
  assert.deepEqual(C.route(G, ep(G, '101'), ep(G, '101'), false), { same: true });
});

test('unnumbered building supports search and routing, but transfer requires a numbered building', () => {
  // Fictional coordinates and names: this fixture never edits the campus data.
  const G = C.build({ nodes: [
    { id: 'test-a', name: '번호없는테스트관', type: 'building', lat: 35, lng: 128 },
    { id: 'test-x', type: 'intersection', lat: 35.0001, lng: 128 },
    { id: 'test-b', name: '번호있는테스트관', buildingNumber: '100', type: 'building', lat: 35.0002, lng: 128 },
    { id: 'test-a2', name: '번호없는테스트관', type: 'building', lat: 35, lng: 128.0001 },
  ], edges: [
    { from: 'test-a', to: 'test-x', type: 'sidewalk' },
    { from: 'test-a2', to: 'test-x', type: 'sidewalk' },
    { from: 'test-x', to: 'test-b', type: 'sidewalk' },
  ] });
  const p = G.byKey.get('l:번호없는테스트관');
  assert.equal(p.kind, 'landmark'); assert.equal(p.entrances.length, 2);
  assert.equal(C.search(G, '번호없는테스트관')[0], p.idx);
  for (const avoid of [false, true]) {
    for (const [from, to] of [[p.key, '100'], ['100', p.key]]) {
      const r = C.route(G, ep(G, from), ep(G, to), avoid);
      assert.ok(r && !r.same); assert.ok(r.minutes >= 1);
      assert.equal(C.assessTransfer(G, from, to, 10, { avoid }, r).reason, 'unknown-building');
    }
  }
});

module.exports = { lineGraph };
