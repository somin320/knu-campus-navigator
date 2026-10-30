'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/core');
const raw = JSON.parse(fs.readFileSync(require.resolve('../knu-graph.json'), 'utf8'));

// Run the app's real handlers with lightweight DOM/map stubs. These tests do
// not claim to verify browser layout or external map authentication.
function app(mobile = false) {
  const G = C.build(raw), elements = new Map();
  function el(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, { innerHTML: '', value: '', hidden: false, scrollTop: 0,
        style: { setProperty() {} }, getBoundingClientRect: () => ({ height: 180 }),
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
          toggle(c, force) { const on = force === undefined ? !classes.has(c) : force; if (on) classes.add(c); else classes.delete(c); return on; } },
        closest() { return el('.field'); } });
    }
    return elements.get(selector);
  }
  let calls = 0;
  const core = { ...C, route(...args) { calls++; return C.route(...args); } };
  const document = { querySelector: el, querySelectorAll: () => [], documentElement: el('html'), activeElement: { blur() {} } };
  const ctx = { window: { KNUCore: core, matchMedia: () => ({ matches: mobile }), innerHeight: 720 },
    document, URLSearchParams, location: { pathname: '/', search: '' }, history: { replaceState() {} },
    requestAnimationFrame() {}, testGraph: G, console, setTimeout, clearTimeout };
  const source = fs.readFileSync(require.resolve('../src/app'), 'utf8');
  const boot = source.lastIndexOf('  boot().catch');
  assert.ok(boot > 0);
  vm.runInNewContext(source.slice(0, boot) + `
    G = testGraph;
    globalThis.UI = { S, transfer, placeEp, setEndpoint, swap, clearRole, toggleTransfer,
      onSheetClick, onTransferInput, transferAssessment, viewTransfer, viewRoute,
      viewCat, viewPlace, setCat, renderSheet, renderSuggest, pickFromSuggest };
  })();`, ctx);
  const UI = ctx.UI;
  const select = (role, key) => UI.setEndpoint(role, UI.placeEp(G.byKey.get(key).idx));
  const action = act => UI.onSheetClick({ target: { closest: () => ({ dataset: { act } }) } });
  const input = (id, value) => UI.onTransferInput({ target: { id, value } });
  return { UI, G, el, select, action, input, calls: () => calls };
}

test('avoidance stays selected across slope-only routes, swap, clear and new searches', () => {
  const a = app();
  a.select('start', '100'); a.select('end', '213');
  assert.equal(a.UI.S.res.stairsRuns, 0); assert.ok(a.UI.S.res.slopeM > 0);
  a.action('mode-1'); a.UI.swap();
  assert.equal(a.UI.S.avoid, true);
  a.UI.clearRole('end'); a.select('end', '111');
  assert.equal(a.UI.S.avoid, true);
  a.select('end', '213');
  assert.equal(a.UI.S.avoid, true);
  assert.match(a.UI.viewRoute(), /계단과 경사/);
  a.action('mode-0'); assert.equal(a.UI.S.avoid, false);
});

test('transfer reuses selected route ETA and never searches again when break or mode changes', () => {
  const a = app(); a.select('start', '413'); a.select('end', '414');
  assert.equal(a.calls(), 2);
  a.UI.toggleTransfer();
  for (const avoid of [false, true]) {
    a.action(avoid ? 'mode-1' : 'mode-0');
    const route = avoid ? a.UI.S.resAvoid : a.UI.S.res;
    for (const gap of ['10', '15', '20']) {
      a.input('transferBreak', gap);
      const r = a.UI.transferAssessment();
      assert.equal(r.estimatedWalkingMinutes, route.minutes);
      assert.equal(r.remainingMinutes, Number(gap) - route.minutes);
      assert.equal(r.conditions.comfortableMarginMinutes, 5);
    }
    a.input('transferBreak', 'custom');
    for (const [remaining, status] of [[5, '여유'], [0, '빠듯'], [-0.5, '어려움']]) {
      a.input('transferCustom', String(route.minutes + remaining));
      assert.equal(a.UI.transferAssessment().status, status);
      assert.match(a.el('#transferResult').innerHTML, new RegExp(status));
    }
  }
  assert.equal(a.calls(), 2);
});

test('transfer handles invalid input, gates, missing endpoints, same building and no route', () => {
  const a = app(); a.UI.toggleTransfer();
  assert.match(a.UI.viewTransfer(), /판정 불가/);
  a.select('start', '100'); a.select('end', '100');
  assert.equal(a.UI.transferAssessment().reason, 'same-building-internal-time-unknown');
  assert.match(a.UI.viewRoute(), /출발지와 도착지가 같아요/);
  a.select('end', '111'); a.input('transferBreak', 'custom');
  for (const value of ['', '-1', 'Infinity', 'NaN']) {
    a.input('transferCustom', value);
    assert.equal(a.UI.transferAssessment().reason, 'invalid-break');
  }
  a.input('transferBreak', '10'); a.select('end', 'g:정문');
  assert.equal(a.UI.transferAssessment().reason, 'unknown-building');
  a.select('end', '111'); a.UI.S.res = a.UI.S.resAvoid = null;
  assert.equal(a.UI.transferAssessment().reason, 'no-route');
  assert.match(a.UI.viewRoute(), /경로를 찾지 못했어요/);
});

test('facility list, detail and selected route agree under avoidance', () => {
  const a = app(); a.select('start', '100'); a.select('end', '416'); a.action('mode-1');
  a.UI.setCat('프린터');
  const p = a.G.byKey.get('416');
  const expected = C.route(a.G, a.UI.S.start, a.UI.placeEp(p.idx), true).minutes;
  const html = a.UI.viewCat();
  assert.match(html, new RegExp(`data-go="${p.idx}"[^]*?${expected}분`));
  a.UI.S.focus = p.idx;
  assert.match(a.UI.viewPlace(), new RegExp(`도보 약 ${expected}분`));
});

test('mobile transfer expands the sheet, retains custom input and survives endpoint selection', () => {
  const a = app(true); a.UI.renderSheet();
  assert.equal(a.el('#sheet').classList.contains('min'), true);
  a.UI.toggleTransfer();
  assert.equal(a.el('#sheet').classList.contains('min'), false);
  a.input('transferBreak', 'custom'); a.input('transferCustom', '12.5');
  a.select('start', '111'); a.select('end', '103');
  assert.equal(a.UI.transfer.open, true);
  assert.match(a.el('#sheetBody').innerHTML, /value="12.5"/);
  assert.match(a.el('#sheetBody').innerHTML, /role="status"/);
  a.UI.swap(); assert.equal(a.UI.transfer.custom, '12.5');
  a.action('transfer-close'); assert.equal(a.UI.transfer.open, false);
});

test('core supports route reuse, including null, without traversing the graph again', () => {
  const a = app(); a.select('start', '111'); a.select('end', '103');
  for (const avoid of [false, true]) {
    const r = avoid ? a.UI.S.resAvoid : a.UI.S.res;
    const normal = C.assessTransfer(a.G, '111', '103', 10, { avoid });
    const withoutAdj = { ...a.G, adj: null };
    assert.deepEqual(C.assessTransfer(withoutAdj, '111', '103', 10, { avoid }, r), normal);
    assert.equal(C.assessTransfer(withoutAdj, '111', '103', 10, { avoid }, null).reason, 'no-route');
  }
});

test('alias suggestions select endpoints and keep the transfer screen open', () => {
  const a = app(true); a.UI.toggleTransfer();
  for (const [role, query, key] of [['start', '중도', '111'], ['end', '공12', '408'],
    ['start', '정센', '116'], ['end', '미융관', '219'], ['start', '종정', '116'], ['end', '사대', '301']]) {
    a.UI.S.field = role; a.el(role === 'start' ? '#inStart' : '#inEnd').value = query;
    a.UI.renderSuggest();
    const pi = a.G.byKey.get(key).idx;
    assert.match(a.el('#suggest').innerHTML, new RegExp(`data-pick="${pi}"`));
    a.UI.pickFromSuggest({ dataset: { pick: String(pi) } });
    assert.equal(a.UI.S[role].place, pi);
    assert.equal(a.UI.transfer.open, true);
  }
  assert.equal(a.UI.transferAssessment().ok, true);
});

test('transfer shows only the simplified explanatory sentence without changing judgement', () => {
  const a = app(); a.UI.toggleTransfer();
  const note = '건물 간 예상 도보시간 기준이며, 건물 내부 이동시간은 포함되지 않습니다.';
  assert.ok(a.UI.viewTransfer().includes(note));
  a.select('start', '111'); a.select('end', '103');
  const before = a.UI.transferAssessment();
  const html = a.UI.viewTransfer();
  assert.equal(html.split(note).length - 1, 1);
  assert.ok(!html.includes('건물 간 야외 도보 기준의 잠정 판정이에요.'));
  assert.ok(!html.includes('남은 시간이 5분 이상이면'));
  assert.deepEqual(a.UI.transferAssessment(), before);
});
