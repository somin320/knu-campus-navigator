'use strict';
// Execute existing UI/editor functions in a stubbed environment; no browser,
// protected-file edits, real geolocation, network access or saved data changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/core');
const raw = JSON.parse(fs.readFileSync(require.resolve('../knu-graph.json'), 'utf8'));
const G = C.build(raw);
const read = file => fs.readFileSync(require.resolve(file), 'utf8');
const between = (text, start, end) => {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'review fixture must match current source'); return text.slice(a, b);
};
const ep = key => { const p = G.byKey.get(key); return { place: p.idx, nodes: p.entrances }; };

test('team regression: slope-only avoidance selection survives computeRoute', () => {
  const source = read('../src/app.js');
  const S = { start: ep('100'), end: ep('213'), avoid: true };
  const ctx = { C, G, S, renderPlaces() {}, renderAllRouteBits() {}, renderSheet() {}, requestAnimationFrame() {}, fitRoute() {} };
  vm.createContext(ctx);
  vm.runInContext(between(source, '  function computeRoute()', '  function renderAllRouteBits()') + '\ncomputeRoute();', ctx);
  assert.equal(S.res.stairsRuns, 0); assert.ok(S.res.slopeM > 0);
  assert.equal(S.avoid, true, 'preserve user preference when the route has no stairs');
  assert.notDeepEqual(S.res.nodes, S.resAvoid.nodes);
});

test('team reproduction: editor uses different weights/speed and permits building transit', () => {
  const source = read('../tools/knu-map-editor.html');
  let map;
  const ctx = { nodes: raw.nodes, edges: raw.edges, avoidStairs: false,
    reindex() { map = new Map(raw.nodes.map(n => [n.id, n])); }, byId: id => map.get(id),
    clearRoute() {}, markClass() {}, setStatus() {}, routeLayer: {}, L: { polyline() { return { addTo() {} }; } } };
  vm.createContext(ctx);
  vm.runInContext(between(source, 'function haversine(', 'function refreshXY(') + '\n'
    + between(source, 'const TYPE_MULT=', '// ---- panel ----'), ctx);
  const out = vm.runInContext('runDijkstra("401", "403"); ({meters:routeDist, minutes:routeMin, path:route, multipliers:TYPE_MULT})', ctx);
  const r = C.route(G, ep('401'), ep('403'), false);
  assert.equal(out.multipliers.stairs, 1.7); assert.equal(out.multipliers.slope, 1.4);
  assert.ok(out.path.slice(1, -1).includes('404'));
  assert.ok(Math.abs(out.meters - 355) < 1); assert.equal(out.minutes, 5);
  assert.ok(Math.abs(r.meters - 448.4629145529315) < 1e-6); assert.equal(r.minutes, 7);
});

test('team regression: current app integrates the transfer API', () => {
  assert.equal(typeof C.assessTransfer, 'function');
  assert.ok(read('../src/app.js').includes('C.assessTransfer('));
});
