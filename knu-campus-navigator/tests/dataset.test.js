'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const C = require('../src/core');
const { audit } = require('../tools/knu-route-audit');
const rawBytes = fs.readFileSync(require.resolve('../knu-graph.json'));
const raw = JSON.parse(rawBytes), G = C.build(raw);
const compare = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
const ps = G.places.filter(p => p.kind === 'building').sort(compare);
const ep = p => ({ nodes: p.entrances, place: p.idx });
const baselineGraph = '3ddb22c1f0c897212abb350c29ec29915052df35ebfa1f8a32fcdf0fa3a651e7';
const isBaseline = crypto.createHash('sha256').update(rawBytes).digest('hex') === baselineGraph;

// Bellman-Ford relaxation, independent of core's heap/Dijkstra and edgeCost().
function reference(from, avoid) {
  const d = new Float64Array(G.N.length).fill(Infinity), sources = new Set(from.entrances);
  from.entrances.forEach(i => { d[i] = 0; });
  const arcs = [];
  G.E.forEach(e => {
    const cost = e.m * (e.t === 'stairs' ? (avoid ? 25 : 1.65) : e.t === 'slope' ? (avoid ? 2.5 : 1.1) : 1);
    for (const [a, b] of [[e.a, e.b], [e.b, e.a]])
      if (G.main[b] && (!G.blocked[a] || sources.has(a))) arcs.push([a, b, cost]);
  });
  for (let round = 0; round < G.N.length - 1; round++) {
    let changed = false;
    for (const [a, b, cost] of arcs) if (d[a] + cost < d[b] - 1e-10) { d[b] = d[a] + cost; changed = true; }
    if (!changed) break;
  }
  return d;
}

test('all actual building routes match independent shortest costs and the original route fingerprint', t => {
  const hash = crypto.createHash('sha256'); let checked = 0;
  // Preserve pre-change iteration order for the baseline fingerprint.
  const refs = new Map();
  for (const from of ps) for (const avoid of [false, true]) refs.set(from.key + '|' + avoid, reference(from, avoid));
  for (const a of ps) for (const b of ps) if (a !== b) for (const avoid of [false, true]) {
    const r = C.route(G, ep(a), ep(b), avoid), d = refs.get(a.key + '|' + avoid);
    assert.ok(r && !r.same, `${a.key}->${b.key} avoid=${avoid}`);
    const actual = r.edges.reduce((s, i) => s + C.edgeCost(G.E[i], avoid), 0);
    const expected = Math.min(...b.entrances.map(i => d[i]));
    assert.ok(Math.abs(actual - expected) < 1e-6, `${a.key}->${b.key}: ${actual} != ${expected}`);
    assert.ok(r.nodes.slice(1, -1).every(i => !G.blocked[i]));
    hash.update(JSON.stringify([a.key, b.key, avoid, r])); checked++;
  }
  assert.equal(checked, ps.length * (ps.length - 1) * 2);
  if (isBaseline) assert.equal(hash.digest('hex'), 'c37cbe3a8acc28fe61b99c2d795fbfbd2af7d2d8d8defa4b9f7c87cea23993cd');
  else t.diagnostic('Graph changed: original fingerprint comparison is inapplicable; independent shortest-cost checks still ran.');
});

test('full audit checks connectivity and keeps 43 recommended candidates on the baseline data', t => {
  const before = JSON.stringify(raw), r = audit(raw);
  assert.deepEqual(r.errors, []); assert.equal(JSON.stringify(raw), before);
  if (isBaseline) {
    assert.equal(r.summary.buildings, 85); assert.equal(r.summary.checkedRoutes, 14280);
    assert.deepEqual(r.summary.detourPairs, { recommended: 43, avoid: 92 });
  } else t.diagnostic('Review candidate counts after data change; high ratios alone do not fail this test.');
});

test('facility ETA matches route ETA in both modes, while cost and ordering keep the original fingerprint', () => {
  const hash = crypto.createHash('sha256'); let checked = 0;
  for (const a of ps) for (const cat of C.CATS) for (const avoid of [false, true]) {
    const list = C.nearestInCat(G, ep(a), cat.id, avoid);
    hash.update(JSON.stringify([a.key, cat.id, avoid, list.map(x => [x.place, x.cost])]));
    for (let i = 0; i < list.length; i++) {
      const x = list[i], r = C.route(G, ep(a), ep(G.places[x.place]), avoid);
      assert.equal(x.minutes, r.minutes, `${a.key}->${G.places[x.place].key} avoid=${avoid}`);
      assert.deepEqual(Object.keys(x).sort(), ['cost', 'minutes', 'place']);
      if (i) assert.ok(list[i - 1].cost <= x.cost); checked++;
    }
  }
  assert.ok(checked > 0);
  if (isBaseline) assert.equal(hash.digest('hex'), '44697c89b3397dc37d6e25221c635de9afee96fbb48780c721400f0bd9b468f3');
  const a = G.byKey.get('100'), b = G.byKey.get('416');
  if (a && b) {
    const x = C.nearestInCat(G, ep(a), '프린터', true).find(x => x.place === b.idx);
    const r = C.route(G, ep(a), ep(b), true);
    assert.equal(x.minutes, r.minutes);
    if (isBaseline) { assert.equal(x.minutes, 7); assert.equal(Math.round(x.cost / 67), 11); }
  }
});

test('normal aliases survive and numeric overmatching is removed', () => {
  for (const [query, key] of [['중도', '111'], ['글플', '103'], ['공12', '408'], ['4합', '304'], ['DGB', '102'],
    ['dgb', '102'], ['공2a', '402'], ['IT 3', '413'], ['111동', '111'], ['농대2', '203'],
    ['정센', '116'], ['미융관', '219'], ['종정', '116'], ['사대', '301']]) {
    assert.equal(G.places[C.search(G, query)[0]]?.key, key, query);
  }
  const keys = q => C.search(G, q).map(i => G.places[i].key);
  assert.ok(!keys('공대10호관').includes('404')); assert.ok(!keys('공12').includes('404'));
  assert.ok(!keys('농대2').includes('201')); assert.ok(!keys('공2a').includes('401'));
  for (const p of G.places) for (const query of [p.name, ...p.aliases, ...p.entranceNames])
    assert.ok(C.search(G, query).includes(p.idx), `${p.key}: ${query}`);
  for (const p of ps) assert.ok(C.search(G, `${p.name} (${p.num})`).includes(p.idx), `${p.key}: name with building number`);
});

test('humanities hall aliases resolve to 106 without colliding with humanities college 104', () => {
  const keys = query => C.search(G, query).map(i => G.places[i].key);
  for (const query of ['인문관', '인진관', '인문한국진흥관'])
    assert.deepEqual(keys(query), ['106'], query);
  for (const query of ['인문대', '인문대학'])
    assert.deepEqual(keys(query), ['104'], query);
  for (const key of ['104', '106'])
    assert.equal(keys(key)[0], key);
});

test('biology and cafeteria aliases uniquely find existing buildings without renaming them', () => {
  const keys = query => C.search(G, query).map(i => G.places[i].key);
  for (const [alias, key, name] of [['생물관', '217', '생물학관'], ['카페테리아 첨성', '305', '복지관']]) {
    const p = G.byKey.get(key), normalized = alias.replace(/\s/g, '');
    assert.equal(p.name, name);
    assert.equal(p.aliases.filter(a => a.replace(/\s/g, '') === normalized).length, 1);
    assert.deepEqual(G.places.filter(p => p.search.includes(normalized)).map(p => p.key), [key]);
    assert.deepEqual(keys(alias), [key], alias);
    assert.equal(keys(name)[0], key, name);
  }
  assert.deepEqual(keys('카페테리아첨성'), ['305']);
  assert.deepEqual(keys('카페테리아   첨성'), ['305']);
  for (const [query, key] of [['첨성관', '114'], ['첨성인미래관', '108'], ['생과대', '307'], ['학관', '215']])
    assert.equal(keys(query)[0], key, query);
  assert.equal(C.catOfQuery('카페테리아 첨성'), null, 'cafeteria alias must remain a building search');
});

test('actual transfers use the same ETA as route and facility displays in both modes', () => {
  for (const [from, to] of [['100', '416'], ['413', '414'], ['111', '103']]) {
    const a = G.byKey.get(from), b = G.byKey.get(to);
    if (!a || !b) continue;
    for (const avoid of [false, true]) {
      const route = C.route(G, ep(a), ep(b), avoid);
      const transfer = C.assessTransfer(G, from, to, 10, { avoid });
      assert.equal(transfer.estimatedWalkingMinutes, route.minutes);
      assert.equal(transfer.requiredMinutes, route.minutes);
      assert.equal(transfer.remainingMinutes, 10 - route.minutes);
      if (isBaseline && from === '100') {
        const facility = C.nearestInCat(G, ep(a), '프린터', avoid).find(x => x.place === b.idx);
        assert.equal(transfer.estimatedWalkingMinutes, facility.minutes);
        assert.equal(transfer.estimatedWalkingMinutes, 7); assert.equal(transfer.remainingMinutes, 3);
        assert.equal(transfer.status, '빠듯');
      }
    }
  }
});

test('actual multi-entrance grouping and optional avoidance remain usable', () => {
  if (isBaseline) {
    assert.equal(G.byKey.get('111').entrances.length, 3);
    assert.equal(G.byKey.get('114').entrances.length, 2);
    const a = G.byKey.get('413'), b = G.byKey.get('414');
    const normal = C.route(G, ep(a), ep(b), false), avoid = C.route(G, ep(a), ep(b), true);
    assert.ok(normal.stairsM > 0); assert.equal(avoid.stairsM, 0); assert.ok(avoid.meters > normal.meters);
  }
});
