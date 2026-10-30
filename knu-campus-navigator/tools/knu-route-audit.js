#!/usr/bin/env node
'use strict';

// Read-only graph inspection. Only an explicitly requested report file is written.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'src/core.js');
const GRAPH = path.join(ROOT, 'knu-graph.json');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function validateRaw(raw) {
  const errors = [], warnings = [];
  const error = (code, detail) => errors.push({ code, ...detail });
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    error('invalid-schema', { message: 'nodes와 edges 배열이 필요합니다.' });
    return { errors, warnings };
  }
  const ids = new Map(), edges = new Set();
  raw.nodes.forEach((n, index) => {
    if (!n || !['string', 'number'].includes(typeof n.id) || String(n.id) === '') {
      error('invalid-node', { index }); return;
    }
    const id = String(n.id);
    if (ids.has(id)) error('duplicate-node', { id, index });
    ids.set(id, n);
    if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng) || Math.abs(n.lat) > 90 || Math.abs(n.lng) > 180)
      error('invalid-coordinate', { id });
    if (!['building', 'gate', 'intersection'].includes(n.type)) error('invalid-node-type', { id, type: n.type });
  });
  raw.edges.forEach((e, index) => {
    if (!e || e.from == null || e.to == null) { error('invalid-edge', { index }); return; }
    const from = String(e.from), to = String(e.to), key = JSON.stringify([from, to].sort(compare));
    if (!ids.has(from) || !ids.has(to)) error('missing-endpoint', { index, from, to });
    if (from === to) error('self-edge', { index, from });
    if (edges.has(key)) error('duplicate-edge', { index, from, to });
    edges.add(key);
    if (!['sidewalk', 'road', 'stairs', 'slope'].includes(e.type)) error('invalid-edge-type', { index, type: e.type });
    if (e.weight != null && (!Number.isFinite(e.weight) || e.weight < 0)) error('invalid-stored-weight', { index });
  });
  return { errors, warnings };
}

// Independently validate a returned path; never equate a large detour with an error.
function inspectRoute(C, G, from, to, result, avoid) {
  const errors = [];
  if (!result) return [{ code: 'no-route' }];
  if (result.same || !Array.isArray(result.nodes) || !Array.isArray(result.edges) ||
      result.nodes.length !== result.edges.length + 1 || !result.nodes.length)
    return [{ code: 'invalid-route-shape' }];
  if (!from.entrances.includes(result.nodes[0]) || !to.entrances.includes(result.nodes.at(-1)))
    errors.push({ code: 'wrong-route-endpoint' });
  if (result.fromNode !== result.nodes[0] || result.toNode !== result.nodes.at(-1))
    errors.push({ code: 'wrong-route-endpoint-metadata' });
  let meters = 0, cost = 0;
  result.nodes.forEach((i, k) => {
    if (!G.N[i] || !G.main[i]) errors.push({ code: 'invalid-route-node', node: i });
    if (k > 0 && k < result.nodes.length - 1 && G.blocked[i]) errors.push({ code: 'building-transit', node: i });
  });
  result.edges.forEach((ei, k) => {
    const e = G.E[ei], a = result.nodes[k], b = result.nodes[k + 1];
    if (!e || !((e.a === a && e.b === b) || (e.a === b && e.b === a))) {
      errors.push({ code: 'disconnected-route-edge', edge: ei }); return;
    }
    if (!Number.isFinite(e.m) || e.m < 0) errors.push({ code: 'invalid-edge-distance', edge: ei });
    meters += e.m; cost += C.edgeCost(e, avoid);
  });
  if (!Number.isFinite(result.meters) || Math.abs(meters - result.meters) > 1e-6)
    errors.push({ code: 'distance-mismatch' });
  if (!Number.isFinite(cost) || cost < 0) errors.push({ code: 'invalid-route-cost' });
  return errors;
}

function audit(raw, { core, threshold = 2.5 } = {}) {
  if (!Number.isFinite(threshold) || threshold <= 0) throw new TypeError('threshold must be positive');
  const C = core || require(CORE), { errors, warnings } = validateRaw(raw);
  const report = {
    schemaVersion: 1,
    policy: { threshold, straightLine: 'minimum-between-building-entrances', modes: ['recommended', 'avoid'],
      directions: 'both', detoursAreErrors: false, physicalPassageVerified: false },
    summary: { buildings: 0, unorderedPairs: 0, checkedRoutes: 0, errors: 0,
      detourPairs: { recommended: 0, avoid: 0 } },
    build: null, buildings: [], errors, warnings, routes: [],
  };
  if (errors.length) { report.summary.errors = errors.length; return report; }
  let G;
  try { G = C.build(raw); } catch (err) {
    errors.push({ code: 'build-failed', message: err.message }); report.summary.errors = errors.length; return report;
  }
  report.build = { nodes: G.N.length, edges: G.E.length, activeNodes: Array.from(G.main).reduce((a, b) => a + b, 0), ...G.report };
  for (const item of G.report.linked) warnings.push({ code: 'runtime-auto-link', ...item });
  for (const item of G.report.unreachable) errors.push({ code: 'excluded-place', ...item });
  if (G.report.removedOutside) warnings.push({ code: 'clipped-nodes', count: G.report.removedOutside });
  const rawIds = new Map(raw.nodes.map(n => [String(n.id), n]));
  raw.edges.forEach((e, index) => {
    const a = rawIds.get(String(e.from)), b = rawIds.get(String(e.to));
    const meters = C.hav(a.lat, a.lng, b.lat, b.lng);
    if (e.weight != null && Math.abs(e.weight - meters) > 1)
      warnings.push({ code: 'stored-distance-difference', index, from: e.from, to: e.to, stored: e.weight, coordinateMeters: meters });
  });
  const autoCount = raw.edges.filter(e => e.auto).length;
  if (autoCount) warnings.push({ code: 'raw-auto-tag', count: autoCount, message: 'auto 표시는 실제 통행 확인의 증거가 아닙니다.' });
  const places = G.places.filter(p => p.kind === 'building' && p.num).sort((a, b) => compare(a.key, b.key));
  report.buildings = places.map(p => ({ key: p.key, name: p.name, entranceIds: p.entrances.map(i => G.N[i].id) }));
  report.summary.buildings = places.length;
  report.summary.unorderedPairs = places.length * (places.length - 1) / 2;
  const detours = { recommended: new Set(), avoid: new Set() };
  for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) {
    const A = places[i], B = places[j];
    let direct = Infinity;
    for (const a of A.entrances) for (const b of B.entrances) {
      const x = G.N[a], y = G.N[b]; direct = Math.min(direct, C.hav(x.lat, x.lng, y.lat, y.lng));
    }
    if (direct === 0) warnings.push({ code: 'coincident-entrances', from: A.key, to: B.key });
    for (const [from, to] of [[A, B], [B, A]]) for (const avoid of [false, true]) {
      const mode = avoid ? 'avoid' : 'recommended';
      const row = { from: from.key, to: to.key, mode, straightMeters: direct };
      let result;
      try { result = C.route(G, { nodes: from.entrances, place: from.idx }, { nodes: to.entrances, place: to.idx }, avoid); }
      catch (err) { errors.push({ code: 'route-threw', ...row, message: err.message }); }
      const issues = inspectRoute(C, G, from, to, result, avoid);
      errors.push(...issues.map(issue => ({ ...row, ...issue })));
      row.valid = issues.length === 0;
      row.reviewCandidate = false;
      if (row.valid) {
        row.meters = result.meters;
        row.weightedCost = result.edges.reduce((s, ei) => s + C.edgeCost(G.E[ei], avoid), 0);
        row.minutes = result.minutes;
        row.fromEntrance = G.N[result.fromNode].id; row.toEntrance = G.N[result.toNode].id;
        row.detourRatio = direct > 0 ? result.meters / direct : null;
        row.reviewCandidate = row.detourRatio != null && row.detourRatio >= threshold;
        if (row.reviewCandidate) {
          detours[mode].add(JSON.stringify([A.key, B.key]));
          row.nodeIds = result.nodes.map(n => G.N[n].id);
        }
      }
      report.routes.push(row);
    }
  }
  report.summary.checkedRoutes = report.routes.length;
  report.summary.detourPairs = { recommended: detours.recommended.size, avoid: detours.avoid.size };
  report.summary.errors = errors.length;
  return report;
}

function csv(report) {
  const columns = ['recordType', 'from', 'to', 'mode', 'valid', 'reviewCandidate', 'meters', 'weightedCost',
    'straightMeters', 'detourRatio', 'minutes', 'code', 'detail'];
  const quote = x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
  const rows = [
    { recordType: 'summary', detail: JSON.stringify({ summary: report.summary, policy: report.policy, input: report.input }) },
    ...report.routes.map(r => ({ recordType: 'route', ...r })),
    ...report.errors.map(r => ({ recordType: 'error', ...r, detail: JSON.stringify(r) })),
    ...report.warnings.map(r => ({ recordType: 'warning', ...r, detail: JSON.stringify(r) })),
  ];
  return columns.map(quote).join(',') + '\n' + rows.map(r => columns.map(c => quote(r[c])).join(',')).join('\n') + '\n';
}

function parseArgs(args) {
  const options = { graph: GRAPH, format: 'json', threshold: 2.5, watch: false, out: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--watch') options.watch = true;
    else if (arg === '--help') options.help = true;
    else if (['--graph', '--out', '--format', '--threshold'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(arg + ' requires a value');
      options[arg.slice(2)] = arg === '--threshold' ? Number(value) : value;
    } else throw new Error('Unknown argument: ' + arg);
  }
  if (!['json', 'csv'].includes(options.format)) throw new Error('--format must be json or csv');
  if (!Number.isFinite(options.threshold) || options.threshold <= 0) throw new Error('--threshold must be positive');
  return options;
}

function run(options) {
  const graphPath = path.resolve(options.graph);
  // No existing files are overwritten except reports produced by this tool.
  if (options.out) {
    const out = path.resolve(options.out);
    if (out === graphPath || out === CORE || (fs.existsSync(out) && !isAuditReport(out)))
      throw new Error('Refusing to overwrite an input or non-audit file: ' + out);
  }
  const graphBytes = fs.readFileSync(graphPath), coreBytes = fs.readFileSync(CORE);
  delete require.cache[require.resolve(CORE)];
  const report = audit(JSON.parse(graphBytes), { core: require(CORE), threshold: options.threshold });
  report.input = { graphSha256: sha256(graphBytes), coreSha256: sha256(coreBytes) };
  report.comparison = { previousRecommendedPairs: 43, currentRecommendedPairs: report.summary.detourPairs.recommended,
    delta: report.summary.detourPairs.recommended - 43,
    note: '기준: 2026-10-30 분석, 최소 출입구 직선거리, 임계값 2.5. 입력 또는 임계값 변경 시 원인 검토 필요.' };
  const content = options.format === 'csv' ? csv(report) : JSON.stringify(report, null, 2) + '\n';
  if (options.out) {
    const out = path.resolve(options.out);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, content);
  } else process.stdout.write(content);
  process.stderr.write(JSON.stringify(report.summary) + '\n');
  process.exitCode = report.summary.errors ? 1 : 0;
  return report;
}

function isAuditReport(file) {
  const text = fs.readFileSync(file, 'utf8');
  try { const d = JSON.parse(text); return d.schemaVersion === 1 && d.policy?.straightLine === 'minimum-between-building-entrances'; }
  catch { return text.startsWith('"recordType","from","to","mode"') && text.includes('minimum-between-building-entrances'); }
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('node tools/knu-route-audit.js [--graph FILE] [--out REPORT] [--format json|csv] [--threshold 2.5] [--watch]'); return;
  }
  const execute = () => { try { run(options); } catch (err) { process.stderr.write(err.message + '\n'); process.exitCode = 1; } };
  execute();
  if (options.watch) {
    // Watch parent directories too, so atomic editor replacements are detected.
    let timer;
    const targets = [path.resolve(options.graph), CORE];
    for (const dir of new Set(targets.map(f => path.dirname(f)))) fs.watch(dir, (_, name) => {
      if (name && !targets.includes(path.join(dir, String(name)))) return;
      clearTimeout(timer); timer = setTimeout(execute, 250);
    });
    process.stderr.write('Watching graph, core and audit files. Ctrl+C to stop.\n');
  }
}

module.exports = { audit, inspectRoute, validateRaw, csv, parseArgs, run };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exitCode = 1; } }
