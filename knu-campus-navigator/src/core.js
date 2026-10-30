/* KNU Campus Navigator core: graph building, search, Dijkstra routing.
   Pure JS, no DOM. Works in browser (window.KNUCore) and Node (module.exports). */
(function (root) {
  'use strict';

  const R = 6371008.8, RAD = Math.PI / 180;
  function hav(a1, o1, a2, o2) {
    const dA = (a2 - a1) * RAD, dO = (o2 - o1) * RAD;
    const f = Math.sin(dA / 2) ** 2 + Math.cos(a1 * RAD) * Math.cos(a2 * RAD) * Math.sin(dO / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(f)));
  }
  const isOsm = id => String(id).startsWith('osm_');

  /* ---------- reference data ---------- */
  const WALK_M_PER_MIN = 67; // about 4 km/h, similar to Naver walking estimates

  const CATS = [
    { id: '편의점', icon: '🏪', color: '#2f6fed' },
    { id: '학식', icon: '🍚', color: '#e5484d' },
    { id: '카페', icon: '☕', color: '#1f9d55' },
    { id: '프린터', icon: '🖨️', color: '#0e8a82' },
    { id: '기숙사', icon: '🏠', color: '#e8890c' },
    { id: '핫플', icon: '⭐', color: '#b4232c' },
  ];

  // Facilities from the campus maps the team collected. Value = short note ('' when none).
  const FAC = {
    '103': { 편의점: '', 학식: '', 카페: '', 프린터: '3층 엘리베이터 옆', 핫플: '' },
    '104': { 프린터: '1층' },
    '109': { 편의점: '', 학식: '' },
    '111': { 프린터: '신관, 구관', 핫플: '' },
    '113': { 기숙사: '향토생활관' },
    '114': { 편의점: '', 기숙사: '' },
    '116': { 학식: '', 핫플: '' },
    '120': { 프린터: '로비' },
    '124': { 편의점: '', 기숙사: '' },
    '201': { 프린터: '3층' },
    '205': { 편의점: '', 학식: '' },
    '211': { 핫플: '수영장' },
    '214': { 핫플: '헬스장' },
    '215': { 핫플: '' },
    '304': { 프린터: '1층', 핫플: '' },
    '305': { 편의점: '', 학식: '', 카페: '', 핫플: '' },
    '407': { 프린터: '로비' },
    '408': { 편의점: '', 학식: '', 프린터: '로비홀', 핫플: '' },
    '412': { 카페: '무인 커피머신' },
    '416': { 프린터: '1층' },
    '420': { 프린터: '5층 컴퓨터실' },
    '501': { 편의점: '', 기숙사: '' },
    '502': { 카페: '', 기숙사: '' },
    '503': { 기숙사: '' },
    '504': { 편의점: '', 기숙사: '' },
    'l:대운동장': { 핫플: '' },
    'l:센트럴파크': { 핫플: '' },
    'l:일청당': { 핫플: '' },
    'l:프롬프트(카페)': { 카페: '일청당 옆', 핫플: '일청당' },
  };

  const NAME_OVERRIDE = {
    '111': '중앙도서관',
    '109': '도서관휴게실',
    'l:프롬프트(카페)': '프롬프트 카페 (일청당)',
  };

  const ALIAS = {
    '100': ['본관'], '101': ['대강당'], '102': ['디지비', 'DGB'], '103': ['글플', '글로벌'],
    '104': ['인문대'], '106': ['인문관', '인진관'], '108': ['미래관'], '109': ['도휴', '도서관 휴게실'],
    '111': ['중도', '도서관', '중앙도서관 신관', '중앙도서관 구관', '신관', '구관'],
    '113': ['향토생활관'], '116': ['종정', '정센'], '117': ['테크노빌딩', '테크노파크'],
    '118': ['약대'], '120': ['예대'], '126': ['간호대'],
    '201': ['농대', '농대1호관'], '209': ['자연대'], '211': ['수영장', '국체'],
    '214': ['헬스장', '청룡관'], '215': ['백호관', '학생회관', '1학생회관', '학관'], '217': ['생물관'], '219': ['미융관'],
    '301': ['사대'], '304': ['4합', '사합', '4합강'], '305': ['카페테리아 첨성'], '307': ['생과대'], '308': ['경상대'],
    '310': ['사과대', '사회대'], '311': ['로스쿨', '법전원'],
    '408': ['공12', '공대12'], '412': ['신축동', '미래창작관'], '415': ['융복합공학관'],
    '420': ['수의대'], '421': ['동물병원'],
    'l:대운동장': ['운동장', '대운'], 'l:프롬프트(카페)': ['일청당', '프롬프트'],
  };

  // Places to add at load time when the data does not have them yet (none right now).
  const EXTRA = [];

  /* ---------- geometry helpers ---------- */
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function expandPoly(h, f) {
    const cx = h.reduce((s, q) => s + q[0], 0) / h.length, cy = h.reduce((s, q) => s + q[1], 0) / h.length;
    return h.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
  }
  function inPoly(x, y, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }

  /* ---------- min heap ---------- */
  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v; const tk = k[0], tv = v[0];
      const lk = k.pop(), lv = v.pop(); const n = k.length;
      if (n) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return [tk, tv];
    }
  }

  /* ---------- text helpers ---------- */
  const ENT_TAG = /\s*\((앞|뒤|정문|후문|옆|입구|출입구)\)/g;
  function cleanName(s) {
    return String(s || '').replace(/\(\s*\d{3}\s*\)/g, '').replace(/(^|\s)\d{3}\s*$/, '').replace(/\s+/g, ' ').trim();
  }
  function numOf(n) {
    if (n.buildingNumber || n.num) return String(n.buildingNumber || n.num).trim();
    const s = n.name || '';
    const m = s.match(/\(\s*(\d{3})\s*\)/) || s.match(/(?:^|\s)(\d{3})\s*$/);
    return m ? m[1] : '';
  }
  const norm = s => String(s || '').toLowerCase().replace(/[\s()\[\]·.,\-_/]/g, '');

  function autoAliases(name, num) {
    const out = [];
    let m;
    if ((m = name.match(/^공대(\d+A?)호관$/))) out.push('공' + m[1], '공대' + m[1]);
    if ((m = name.match(/^IT대학(\d+)호관$/i))) out.push('IT' + m[1], 'IT대' + m[1], '아이티' + m[1]);
    if ((m = name.match(/^농생대(\d+)호관$/))) out.push('농대' + m[1], '농생대' + m[1]);
    if ((m = name.match(/^(.+)대학$/)) && m[1].length <= 3) out.push(m[1] + '대');
    if (num) out.push(num, num + '동', num + '호관');
    return out;
  }

  /* ---------- clip outside campus ---------- */
  function clipRaw(raw, factor) {
    const anchors = raw.nodes.filter(n => n.type === 'building' || n.type === 'gate');
    if (anchors.length < 3) return { nodes: raw.nodes.slice(), edges: raw.edges.slice(), poly: null };
    const poly = expandPoly(hull(anchors.map(n => [+n.lng, +n.lat])), factor || 1.12);
    const keep = new Set();
    for (const n of raw.nodes) if (!isOsm(n.id) || inPoly(+n.lng, +n.lat, poly)) keep.add(String(n.id));
    return {
      nodes: raw.nodes.filter(n => keep.has(String(n.id))),
      edges: raw.edges.filter(e => keep.has(String(e.from)) && keep.has(String(e.to))),
      poly,
    };
  }

  /* ---------- build ---------- */
  function build(raw, opt) {
    opt = opt || {};
    const src = { nodes: (raw.nodes || []).slice(), edges: (raw.edges || []).slice() };
    // inject missing buildings
    const haveNum = new Set(src.nodes.map(numOf).filter(Boolean));
    const ids = new Set(src.nodes.map(n => String(n.id)));
    for (const x of EXTRA) if (!haveNum.has(x.buildingNumber) && !ids.has(x.id)) src.nodes.push(Object.assign({}, x));

    const clipped = clipRaw(src, opt.clipFactor);
    const N = [], idx = new Map();
    for (const n of clipped.nodes) {
      const id = String(n.id);
      if (idx.has(id)) continue;
      idx.set(id, N.length);
      N.push({
        id, lat: +n.lat, lng: +n.lng, type: n.type || 'intersection', name: n.name || '',
        num: n.buildingNumber ? String(n.buildingNumber) : '', poi: n.poi || '', osm: isOsm(id), est: !!n.est,
      });
    }
    const E = [], adj = N.map(() => []), seen = new Set();
    const userPt = n => !n.osm && n.type === 'intersection';
    function addEdge(a, b, t, sc, link) {
      if (a === b) return;
      const key = a < b ? a + '_' + b : b + '_' + a;
      if (seen.has(key)) return;
      seen.add(key);
      const A = N[a], B = N[b];
      const m = hav(A.lat, A.lng, B.lat, B.lng);
      const custom = !link && (!!sc || userPt(A) || userPt(B) || (!A.osm && !B.osm && A.type !== 'gate' && B.type !== 'gate' && (A.type === 'intersection' || B.type === 'intersection')));
      const ei = E.length;
      E.push({ a, b, m, t: t || 'sidewalk', sc: !!sc, custom, link: !!link });
      adj[a].push(ei); adj[b].push(ei);
    }
    for (const e of clipped.edges) {
      const a = idx.get(String(e.from)), b = idx.get(String(e.to));
      if (a == null || b == null) continue;
      addEdge(a, b, e.type, e.isShortcut, false);
    }

    // connected components
    const comp = new Int32Array(N.length).fill(-1);
    let nc = 0;
    for (let s = 0; s < N.length; s++) {
      if (comp[s] >= 0) continue;
      const st = [s]; comp[s] = nc;
      while (st.length) { const u = st.pop(); for (const ei of adj[u]) { const e = E[ei]; const v = e.a === u ? e.b : e.a; if (comp[v] < 0) { comp[v] = nc; st.push(v); } } }
      nc++;
    }
    const placeScore = new Array(nc).fill(0), compSize = new Array(nc).fill(0);
    N.forEach((n, i) => { compSize[comp[i]]++; if (n.type === 'building' || n.type === 'gate') placeScore[comp[i]]++; });
    let mainC = 0;
    for (let c = 1; c < nc; c++) if (placeScore[c] > placeScore[mainC] || (placeScore[c] === placeScore[mainC] && compSize[c] > compSize[mainC])) mainC = c;
    const main = new Uint8Array(N.length);
    N.forEach((_, i) => { main[i] = comp[i] === mainC ? 1 : 0; });

    // attach places that are not on the main network to the nearest walkable node
    const report = { linked: [], unreachable: [], removedOutside: (raw.nodes || []).length + EXTRA.length - clipped.nodes.length };
    const walkable = [];
    N.forEach((n, i) => { if (main[i] && n.type !== 'building' && n.type !== 'gate') walkable.push(i); });
    N.forEach((n, i) => {
      if (main[i] || (n.type !== 'building' && n.type !== 'gate')) return;
      let best = -1, bd = Infinity;
      for (const j of walkable) { const d = hav(n.lat, n.lng, N[j].lat, N[j].lng); if (d < bd) { bd = d; best = j; } }
      if (best >= 0 && bd <= 150) {
        addEdge(i, best, 'sidewalk', false, true);
        main[i] = 1;
        report.linked.push({ id: n.id, name: n.name, meters: Math.round(bd) });
      } else report.unreachable.push({ id: n.id, name: n.name });
    });
    // isolated place nodes that sit in small components but were linked above also bring their component along
    // (only the place node itself is attached; stray fragments stay out of routing)

    /* ---------- places (multi-entrance grouping) ---------- */
    const places = [], byKey = new Map();
    const nodePlace = new Int32Array(N.length).fill(-1);
    N.forEach((n, i) => {
      if (n.type !== 'building' && n.type !== 'gate') return;
      if (!main[i]) return;
      const num = numOf(n);
      const base = cleanName(n.name).replace(ENT_TAG, '').trim() || n.id;
      let key, kind;
      if (n.type === 'gate') { key = 'g:' + base; kind = 'gate'; }
      else if (num) { key = num; kind = 'building'; }
      else { key = 'l:' + cleanName(n.name); kind = 'landmark'; }
      let p = byKey.get(key);
      if (!p) {
        p = { key, kind, num: kind === 'building' ? num : '', name: '', entrances: [], entranceNames: [], cats: {}, aliases: [], est: false, lat: 0, lng: 0 };
        byKey.set(key, p); places.push(p);
      }
      p.entrances.push(i);
      p.entranceNames.push(cleanName(n.name) || n.id);
      if (n.est) p.est = true;
      if (!p.name || (n.num && kind === 'building')) p.name = base;
      if (n.poi) p.cats[n.poi] = p.cats[n.poi] || '';
    });
    places.forEach((p, pi) => {
      if (NAME_OVERRIDE[p.key]) p.name = NAME_OVERRIDE[p.key];
      p.lat = p.entrances.reduce((s, i) => s + N[i].lat, 0) / p.entrances.length;
      p.lng = p.entrances.reduce((s, i) => s + N[i].lng, 0) / p.entrances.length;
      Object.assign(p.cats, FAC[p.key] || {});
      p.aliases = [].concat(ALIAS[p.key] || [], autoAliases(p.name, p.num), p.entranceNames);
      p.search = [p.name].concat(p.aliases).map(norm).filter(Boolean);
      p.entrances.forEach(i => { nodePlace[i] = pi; });
      p.idx = pi;
    });

    // nearest place for each walkable node (used for "지나가는 곳" guidance)
    const near = new Int32Array(N.length).fill(-1);
    const cosLat = Math.cos(35.888 * RAD);
    const ent = [];
    places.forEach((p, pi) => { if (p.kind !== 'gate') p.entrances.forEach(i => ent.push([N[i].lat, N[i].lng, pi])); });
    for (let i = 0; i < N.length; i++) {
      if (!main[i]) continue;
      let bd = 38, bp = -1;
      for (const [la, lo, pi] of ent) {
        const dy = (la - N[i].lat) * 111195, dx = (lo - N[i].lng) * 111195 * cosLat;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bd) { bd = d; bp = pi; }
      }
      near[i] = bp;
    }

    const blocked = new Uint8Array(N.length);
    N.forEach((n, i) => { if (n.type === 'building') blocked[i] = 1; });

    const G = { N, E, adj, main, places, byKey, nodePlace, near, blocked, report, poly: clipped.poly };
    return G;
  }

  /* ---------- routing ---------- */
  
  const TERRAIN_WEIGHTS = Object.freeze({
    stairs: 1.65,
    slope: 1.10,
    road: 1.00
  });

  const AVOID_WEIGHTS = Object.freeze({
    stairs: 25,
    slope: 2.5
  });

  function edgeCost(e, avoid) {
    let w = e.m;

    if (e.t === 'stairs')
      w *= avoid ? AVOID_WEIGHTS.stairs : TERRAIN_WEIGHTS.stairs;
    else if (e.t === 'slope')
      w *= avoid ? AVOID_WEIGHTS.slope : TERRAIN_WEIGHTS.slope;
    else if (e.t === 'road')
      w *= TERRAIN_WEIGHTS.road;

    return w;
  }


  function dijkstra(G, sources, avoid, targets) {
    const n = G.N.length;
    const dist = new Float64Array(n).fill(Infinity), pn = new Int32Array(n).fill(-1), pe = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const src = new Set(sources);
    const h = new Heap();
    for (const s of sources) { dist[s] = 0; h.push(0, s); }
    let hit = -1;
    while (h.size) {
      const [d, u] = h.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (targets && targets.has(u)) { hit = u; break; }
      if (G.blocked[u] && !src.has(u)) continue; // never walk through a building node
      for (const ei of G.adj[u]) {
        const e = G.E[ei];
        const v = e.a === u ? e.b : e.a;
        if (done[v] || !G.main[v]) continue;
        const nd = d + edgeCost(e, avoid);
        if (nd < dist[v]) { dist[v] = nd; pn[v] = u; pe[v] = ei; h.push(nd, v); }
      }
    }
    return { dist, pn, pe, hit };
  }

  
  function walkingMinutes(meters, stairsM, slopeM) {
    const adjustedM = meters
      + stairsM * (TERRAIN_WEIGHTS.stairs - 1)
      + slopeM * (TERRAIN_WEIGHTS.slope - 1);

    return adjustedM / WALK_M_PER_MIN;
  }

  function minutesFor(meters, stairsM, slopeM) {
    return Math.max(1, Math.round(walkingMinutes(meters, stairsM, slopeM)));
  }


  function route(G, from, to, avoid) {
    const tset = new Set(to.nodes);
    if (from.nodes.some(i => tset.has(i))) return { same: true };
    const r = dijkstra(G, from.nodes, !!avoid, tset);
    if (r.hit < 0) return null;
    const nodes = [], edges = [];
    let u = r.hit;
    while (u !== -1) { nodes.push(u); if (r.pe[u] >= 0) edges.push(r.pe[u]); u = r.pn[u]; }
    nodes.reverse(); edges.reverse();

    let m = 0, stairsM = 0, stairsRuns = 0, roadM = 0, customM = 0, slopeM = 0, prevStairs = false;
    for (const ei of edges) {
      const e = G.E[ei];
      m += e.m;
      if (e.t === 'stairs') { stairsM += e.m; if (!prevStairs) stairsRuns++; prevStairs = true; } else prevStairs = false;
      if (e.t === 'road') roadM += e.m;
      if (e.t === 'slope') slopeM += e.m;
      if (e.custom) customM += e.m;
    }

    // guidance steps
    const fromP = from.place != null ? from.place : -1, toP = to.place != null ? to.place : -1;
    const steps = [{ k: 'start', at: 0 }];
    let cum = 0, lastPass = -1, lastAt = -999, inStairs = false, inCustom = false, cStart = 0, cIdx = -1;
    for (let i = 0; i < edges.length; i++) {
      const e = G.E[edges[i]];
      if (e.t === 'stairs' && !inStairs) { steps.push({ k: 'stairs', at: cum }); inStairs = true; }
      else if (e.t !== 'stairs') inStairs = false;
      if (e.custom && !inCustom) { inCustom = true; cStart = cum; cIdx = steps.length; steps.push({ k: 'shortcut', at: cum, len: 0 }); }
      else if (!e.custom && inCustom) { inCustom = false; steps[cIdx].len = cum - cStart; }
      cum += e.m;
      const v = nodes[i + 1];
      const np = G.near[v];
      if (np >= 0 && np !== fromP && np !== toP && np !== lastPass && cum - lastAt >= 45 && cum < m - 25) {
        steps.push({ k: 'pass', at: cum, place: np }); lastPass = np; lastAt = cum;
      }
    }
    if (inCustom) steps[cIdx].len = cum - cStart;
    let out = steps.filter(s => s.k !== 'shortcut' || s.len >= 20);
    const passes = out.filter(s => s.k === 'pass');
    if (passes.length > 6) {
      const keep = new Set();
      for (let j = 0; j < 6; j++) keep.add(passes[Math.round(j * (passes.length - 1) / 5)]);
      out = out.filter(s => s.k !== 'pass' || keep.has(s));
    }
    out.push({ k: 'end', at: m });

    return {
      nodes, edges, meters: m, minutes: minutesFor(m, stairsM, slopeM),
      stairsM, stairsRuns, roadM, customM, slopeM,
      walkM: Math.max(0, m - roadM - stairsM - slopeM),
      steps: out,
      fromNode: nodes[0], toNode: nodes[nodes.length - 1],
    };
  }

  // walking cost from an endpoint to every place in a category, nearest first
  function nearestInCat(G, from, cat, avoid) {
    const r = dijkstra(G, from.nodes, !!avoid, null);
    const list = [];
    G.places.forEach((p, pi) => {
      if (!(cat in p.cats) || pi === from.place) return;
      let best = Infinity;
      for (const i of p.entrances) if (r.dist[i] < best) best = r.dist[i];
      if (best < Infinity) {
        // Keep selection cost and ranking unchanged. Ask route() for the canonical
        // path (including entrance tie-breaking), then use its physical ETA.
        const selected = route(G, from, { nodes: p.entrances, place: pi }, avoid);
        if (selected) list.push({ place: pi, cost: best, minutes: selected.same ? 1 : selected.minutes });
      }
    });
    list.sort((a, b) => a.cost - b.cost);
    return list;
  }

  function snap(G, lat, lng) {
    let best = -1, bd = Infinity;
    const cosLat = Math.cos(lat * RAD);
    for (let i = 0; i < G.N.length; i++) {
      const n = G.N[i];
      if (!G.main[i] || n.type === 'building' || n.type === 'gate') continue;
      const dy = (n.lat - lat) * 111195, dx = (n.lng - lng) * 111195 * cosLat;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bd) { bd = d; best = i; }
    }
    return { node: best, meters: bd };
  }

  /* ---------- consecutive-class transfer (no UI dependencies) ---------- */
  // Team-review default; not a measured allowance or a change to route().minutes.
  const TRANSFER_DEFAULTS = Object.freeze({ comfortableMarginMinutes: 5 });

  // Optional routeResult must match these endpoints and avoidance mode. The UI
  // passes its current route (including null) to avoid a second graph search.
  function assessTransfer(G, from, to, breakMinutes, options, routeResult) {
    options = options == null ? {} : options;
    const conditions = {
      avoid: !!options.avoid,
      comfortableMarginMinutes: options.comfortableMarginMinutes === undefined
        ? TRANSFER_DEFAULTS.comfortableMarginMinutes : options.comfortableMarginMinutes,
      indoorMinutes: options.indoorMinutes === undefined ? null : options.indoorMinutes,
      breakMinutes: null, timeSource: 'minutes', rounding: 'route-minutes',
      walkMetersPerMinute: WALK_M_PER_MIN, terrainWeights: TERRAIN_WEIGHTS,
      selectionWeights: options.avoid ? AVOID_WEIGHTS : TERRAIN_WEIGHTS,
      policyProvisional: true, indoorTimeKnown: false,
    };
    const result = {
      ok: false, reason: null, status: null, canMakeIt: null,
      estimatedWalkingMinutes: null, exactWalkingMinutes: null, routeMinutes: null,
      requiredMinutes: null, remainingMinutes: null, message: '', conditions,
    };
    const fail = (reason, message) => Object.assign(result, { reason, message });
    if (typeof options !== 'object' || Array.isArray(options) ||
        (options.avoid !== undefined && typeof options.avoid !== 'boolean') ||
        !Number.isFinite(conditions.comfortableMarginMinutes) || conditions.comfortableMarginMinutes < 0 ||
        (conditions.indoorMinutes !== null && (!Number.isFinite(conditions.indoorMinutes) || conditions.indoorMinutes < 0)))
      return fail('invalid-options', '여유 기준과 내부 이동시간은 0 이상의 유한한 분 단위 숫자여야 합니다.');

    let gap = breakMinutes;
    if (gap && typeof gap === 'object' && !Array.isArray(gap)) {
      const parse = s => {
        if (typeof s !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)) return null;
        const [h, m] = s.split(':').map(Number); return h * 60 + m;
      };
      const end = parse(gap.endTime), start = parse(gap.startTime);
      gap = end === null || start === null ? NaN : start - end;
      conditions.timeSource = 'same-day-HH:mm';
    }
    if (!Number.isFinite(gap) || gap < 0)
      return fail('invalid-break', '쉬는 시간은 0 이상의 유한한 숫자 또는 같은 날의 종료·시작 시각(HH:mm)이어야 합니다.');
    conditions.breakMinutes = gap;
    conditions.indoorTimeKnown = conditions.indoorMinutes !== null;
    const building = value => {
      let p;
      if (typeof value === 'string' || typeof value === 'number') p = G.byKey.get(String(value));
      else if (value && typeof value === 'object') p = value.key != null
        ? G.byKey.get(String(value.key)) : Number.isInteger(value.place) ? G.places[value.place] : null;
      return p && p.kind === 'building' ? p : null;
    };
    const a = building(from), b = building(to);
    if (!a || !b) return fail('unknown-building', '번호가 있는 출발·도착 건물을 확인해 주세요.');
    conditions.from = a.key; conditions.to = b.key;
    const r = routeResult === undefined
      ? route(G, { nodes: a.entrances, place: a.idx }, { nodes: b.entrances, place: b.idx }, conditions.avoid)
      : routeResult;
    if (!r) return fail('no-route', '두 건물 사이의 경로를 찾지 못해 이동 가능 여부를 계산할 수 없습니다.');
    if (r.same && !conditions.indoorTimeKnown)
      return fail('same-building-internal-time-unknown', '같은 건물이지만 강의실 간 내부 이동시간을 알 수 없어 판정을 보류합니다. 내부 이동시간을 입력해 주세요.');
    const exact = r.same ? 0 : walkingMinutes(r.meters, r.stairsM, r.slopeM);
    result.exactWalkingMinutes = exact;
    // Reuse the displayed route ETA, including its rounding and one-minute minimum.
    result.estimatedWalkingMinutes = r.same ? 0 : r.minutes;
    result.routeMinutes = r.same ? null : r.minutes;
    // Explicit indoor estimates keep their supplied precision; do not round again.
    result.requiredMinutes = result.estimatedWalkingMinutes + (conditions.indoorMinutes || 0);
    result.remainingMinutes = gap - result.requiredMinutes;
    result.status = result.remainingMinutes < 0 ? '어려움'
      : result.remainingMinutes >= conditions.comfortableMarginMinutes ? '여유' : '빠듯';
    result.ok = true; result.canMakeIt = result.remainingMinutes >= 0;
    result.reason = conditions.indoorTimeKnown ? 'estimated' : 'outdoor-only';
    result.message = `예상 필요시간 ${result.requiredMinutes}분, 남는 시간 ${result.remainingMinutes}분으로 ${result.status}입니다.`
      + (conditions.indoorTimeKnown ? ' 입력한 내부 이동시간을 포함한 추정입니다.' : ' 건물 간 도보 기준의 잠정 판정이며 내부 이동·대기는 포함하지 않았습니다.');
    return result;
  }

  /* ---------- search ---------- */
  function search(G, q, limit) {
    const qn = norm(q);
    if (!qn) return [];
    // Preserve text aliases and scoring. Numeric queries must match complete
    // number/suffix tokens: 공12 != 공1, 농대2 != 농대, 공2a != 공2.
    const numeric = qn.match(/\d+[a-z]?/g);
    const res = [];
    G.places.forEach((p, pi) => {
      let s = 0;
      for (const t of p.search) {
        if (numeric) {
          const tokens = t.match(/\d+[a-z]?/g);
          if (!tokens || tokens.some(n => !numeric.includes(n))) continue;
        }
        if (t === qn) s = Math.max(s, 100);
        else if (t.startsWith(qn)) s = Math.max(s, 80 - Math.min(20, t.length - qn.length));
        else if (t.includes(qn)) s = Math.max(s, 55);
        else if (qn.length >= 3 && qn.includes(t) && t.length >= 2) s = Math.max(s, 40);
      }
      if (s > 0) res.push({ place: pi, score: s + (p.kind === 'building' ? 3 : p.kind === 'landmark' ? 1 : 0) });
    });
    res.sort((a, b) => b.score - a.score || G.places[a.place].name.localeCompare(G.places[b.place].name, 'ko'));
    return res.slice(0, limit || 8).map(r => r.place);
  }
  function catOfQuery(q) {
    const qn = norm(q);
    const c = CATS.find(c => norm(c.id) === qn || (qn.length >= 2 && norm(c.id).startsWith(qn)));
    return c ? c.id : null;
  }

  /* ---------- network overlay chains ---------- */
  function edgeClass(e) {
    if (e.t === 'stairs') return 'stairs';
    if (e.t === 'slope') return 'slope';
    if (e.custom) return 'custom';
    if (e.link) return 'link';
    return e.t === 'road' ? 'road' : 'walk';
  }
  function chains(G) {
    const byCls = {};
    G.E.forEach((e, i) => {
      if (!G.main[e.a] || !G.main[e.b]) return;
      const c = edgeClass(e);
      (byCls[c] = byCls[c] || []).push(i);
    });
    const out = [];
    for (const c in byCls) {
      const list = byCls[c], deg = new Map(), adjc = new Map(), used = new Set();
      for (const ei of list) {
        const e = G.E[ei];
        for (const x of [e.a, e.b]) { deg.set(x, (deg.get(x) || 0) + 1); if (!adjc.has(x)) adjc.set(x, []); adjc.get(x).push(ei); }
      }
      const walk = (start, ei) => {
        const pts = [start]; let cur = start, ce = ei;
        for (;;) {
          used.add(ce);
          const e = G.E[ce]; const nx = e.a === cur ? e.b : e.a; pts.push(nx);
          if (deg.get(nx) !== 2) break;
          const nextE = adjc.get(nx).find(x => x !== ce && !used.has(x));
          if (nextE == null) break;
          cur = nx; ce = nextE;
        }
        return pts;
      };
      for (const [x, d] of deg) if (d !== 2) for (const ei of adjc.get(x)) if (!used.has(ei)) out.push({ c, pts: walk(x, ei) });
      for (const ei of list) if (!used.has(ei)) out.push({ c, pts: walk(G.E[ei].a, ei) });
    }
    return out.map(o => ({ c: o.c, pts: o.pts.map(i => [G.N[i].lat, G.N[i].lng]) }));
  }

  /* ---------- export back to editor format ---------- */
  function toEditor(G) {
    const B = { minLat: 35.880526, maxLat: 35.896022, minLng: 128.600258, maxLng: 128.618526 };
    const keepNode = new Uint8Array(G.N.length);
    G.N.forEach((n, i) => { if (G.main[i]) keepNode[i] = 1; });
    const nodes = [];
    G.N.forEach((n, i) => {
      if (!keepNode[i]) return;
      const o = {
        id: n.id, name: n.name,
        x: Math.round(((n.lng - B.minLng) / (B.maxLng - B.minLng)) * 100),
        y: Math.round(100 - ((n.lat - B.minLat) / (B.maxLat - B.minLat)) * 100),
        lat: +n.lat.toFixed(6), lng: +n.lng.toFixed(6), type: n.type,
      };
      if (n.num) o.buildingNumber = n.num;
      if (n.poi) o.poi = n.poi;
      if (n.est) o.est = true;
      nodes.push(o);
    });
    const edges = [];
    G.E.forEach(e => {
      if (!keepNode[e.a] || !keepNode[e.b]) return;
      const o = { from: G.N[e.a].id, to: G.N[e.b].id, weight: Math.round(e.m), type: e.t };
      if (e.sc) o.isShortcut = true;
      edges.push(o);
    });
    return { nodes, edges };
  }

  const api = { build, route, nearestInCat, snap, search, catOfQuery, chains, toEditor, hav, CATS, FAC, WALK_M_PER_MIN, edgeClass,
    edgeCost, walkingMinutes, TERRAIN_WEIGHTS, AVOID_WEIGHTS, assessTransfer, TRANSFER_DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KNUCore = api;
})(typeof window !== 'undefined' ? window : this);
