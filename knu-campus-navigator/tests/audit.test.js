'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const C = require('../src/core');
const { audit, validateRaw, inspectRoute, csv, parseArgs } = require('../tools/knu-route-audit');

function fixture() {
  return { nodes: [
    { id: 'a', type: 'building', buildingNumber: '100', lat: 35, lng: 128 },
    { id: 'x', type: 'intersection', lat: 35.0001, lng: 128 },
    { id: 'y', type: 'intersection', lat: 35.0001, lng: 128.0001 },
    { id: 'b', type: 'building', buildingNumber: '101', lat: 35, lng: 128.0001 },
  ], edges: [ ['a', 'x'], ['x', 'y'], ['y', 'b'] ].map(([from, to]) => ({ from, to, type: 'sidewalk' })) };
}

test('audit uses real build/route in both directions and modes; deterministic and read-only', () => {
  const raw = fixture(), before = JSON.stringify(raw), a = audit(raw);
  assert.equal(a.summary.checkedRoutes, 4);
  assert.equal(a.summary.errors, 0);
  assert.deepEqual(a, audit(raw));
  assert.equal(JSON.stringify(raw), before);
  assert.ok(a.routes.every(r => Number.isFinite(r.weightedCost) && Number.isFinite(r.meters)));
  assert.equal(a.policy.detoursAreErrors, false);
});

test('bad raw references, duplicates, coordinates and types are errors before build can hide them', () => {
  const raw = fixture();
  raw.nodes.push({ ...raw.nodes[0], lat: NaN });
  raw.edges.push({ from: 'missing', to: 'b', type: 'bogus', weight: -1 });
  raw.edges.push({ from: 'a', to: 'a', type: 'sidewalk' }, { ...raw.edges[0] });
  const codes = validateRaw(raw).errors.map(e => e.code);
  for (const code of ['duplicate-node', 'invalid-coordinate', 'missing-endpoint', 'invalid-edge-type', 'invalid-stored-weight', 'self-edge', 'duplicate-edge'])
    assert.ok(codes.includes(code), code);
  assert.equal(audit(raw).summary.checkedRoutes, 0);
  assert.ok(audit(null).summary.errors > 0);
});

test('disconnected through-building topology is reported, rather than silently considered connected', () => {
  const raw = fixture(); raw.nodes[1].type = 'building'; raw.nodes[1].buildingNumber = '102';
  const a = audit(raw);
  assert.ok(a.errors.some(e => e.code === 'no-route'));
});

test('route checker detects intermediate building transit and incorrect edges', () => {
  const G = C.build(fixture()), from = G.byKey.get('100'), to = G.byKey.get('101');
  const r = C.route(G, { nodes: from.entrances }, { nodes: to.entrances }, false);
  const transit = { ...G, blocked: Uint8Array.from(G.blocked) }; transit.blocked[r.nodes[1]] = 1;
  assert.ok(inspectRoute(C, transit, from, to, r, false).some(e => e.code === 'building-transit'));
  assert.ok(inspectRoute(C, G, from, to, { ...r, edges: [999, ...r.edges.slice(1)] }, false).some(e => e.code === 'disconnected-route-edge'));
});

test('high detours remain review candidates; coincident entrances never produce Infinity in JSON', () => {
  const raw = fixture(), a = audit(raw, { threshold: 1.01 });
  assert.ok(a.summary.detourPairs.recommended > 0); assert.equal(a.summary.errors, 0);
  raw.nodes[3].lng = raw.nodes[0].lng;
  const zero = audit(raw);
  assert.ok(zero.warnings.some(w => w.code === 'coincident-entrances'));
  assert.ok(zero.routes.every(r => r.detourRatio === null));
});

test('CSV includes summaries, review rows, errors and warnings; CLI options are strict', () => {
  const raw = fixture(); raw.edges.push({ from: 'missing', to: 'a', type: 'road' });
  assert.match(csv(audit(raw)), /missing-endpoint/);
  assert.match(csv(audit(fixture(), { threshold: 1.01 })), /reviewCandidate/);
  assert.throws(() => parseArgs(['--threshold', 'bad']));
  assert.throws(() => parseArgs(['--out']));
  assert.throws(() => parseArgs(['--format', 'txt']));
});

test('CLI refuses to overwrite graph or unrelated existing file, and returns 1 on malformed data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knu-audit-test-'));
  const script = path.resolve(__dirname, '../tools/knu-route-audit.js');
  try {
    const graph = path.join(dir, 'graph.json'), other = path.join(dir, 'other.json');
    fs.writeFileSync(graph, JSON.stringify(fixture())); fs.writeFileSync(other, 'keep');
    for (const out of [graph, other]) {
      const r = spawnSync(process.execPath, [script, '--graph', graph, '--out', out], { encoding: 'utf8' });
      assert.equal(r.status, 1); assert.match(r.stderr, /Refusing/);
    }
    assert.equal(fs.readFileSync(other, 'utf8'), 'keep');
    const bad = fixture(); bad.edges[0].from = 'missing'; fs.writeFileSync(graph, JSON.stringify(bad));
    const r = spawnSync(process.execPath, [script, '--graph', graph], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.ok(JSON.parse(r.stdout).errors.length > 0);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'knu-audit-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('watch reruns after graph file replacement, reports bad data, and recovers', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knu-audit-watch-'));
  const graph = path.join(dir, 'graph.json'), out = path.join(dir, 'report.json');
  const script = path.resolve(__dirname, '../tools/knu-route-audit.js');
  fs.writeFileSync(graph, JSON.stringify(fixture()));
  const child = spawn(process.execPath, [script, '--graph', graph, '--out', out, '--watch'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', b => { log += b.toString(); });
  const until = async predicate => {
    const start = Date.now();
    while (!predicate()) {
      if (child.exitCode !== null || Date.now() - start > 5000) throw new Error('Watcher did not respond: ' + log);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  // Remove/recreate verifies that watching the parent survives a new file identity.
  // This sandbox disallows rename(), so this test does not claim atomic-rename QA.
  const replace = data => {
    fs.unlinkSync(graph); fs.writeFileSync(graph, JSON.stringify(data));
  };
  try {
    await until(() => log.includes('Watching'));
    const before = JSON.parse(fs.readFileSync(out));
    const next = fixture(); next.edges[0].type = 'stairs'; replace(next);
    await until(() => JSON.parse(fs.readFileSync(out)).input.graphSha256 !== before.input.graphSha256);
    const changed = fs.readFileSync(out, 'utf8');
    replace(next);
    await until(() => log.split('"checkedRoutes":4').length >= 4);
    assert.equal(fs.readFileSync(out, 'utf8'), changed, 'same input produces byte-identical output');
    const bad = fixture(); bad.edges[0].from = 'missing'; replace(bad);
    await until(() => JSON.parse(fs.readFileSync(out)).summary.errors > 0);
    replace(fixture());
    await until(() => JSON.parse(fs.readFileSync(out)).summary.errors === 0);
  } finally {
    if (child.exitCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed;
    }
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'knu-audit-watch-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
