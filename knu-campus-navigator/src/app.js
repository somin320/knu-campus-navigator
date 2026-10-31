/* KNU Campus Navigator app: UI + map adapters (NAVER Maps primary, OpenStreetMap fallback). */
(function () {
  'use strict';
  const NAVER_KEY = 'ntn7ch5ym4';
  const CENTER = [35.8885, 128.6105];
  const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const QUICK = ['111', '103', '408', '305', '215', '304', 'g:정문', 'g:북문'];

  const C = window.KNUCore;
  const CAT = Object.fromEntries(C.CATS.map(c => [c.id, c]));
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMobile = () => window.matchMedia('(max-width:899px)').matches;

  const SVG = {
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M7 4L3.5 7.5M7 4l3.5 3.5M17 20V4M17 20l-3.5-3.5M17 20l3.5-3.5"/></svg>',
    loc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    net: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="18" cy="17" r="2"/><path d="M7 6.3l10 .6M6 8l1.6 8M10 18h6M18.8 9l-.6 6"/></svg>',
    pin: '<svg viewBox="0 0 26 34"><path d="M13 0C5.8 0 0 5.6 0 12.6 0 22 13 34 13 34s13-12 13-21.4C26 5.6 20.2 0 13 0z" fill="#2f6fed"/><circle cx="13" cy="12.5" r="5" fill="#fff"/></svg>',
  };

  let G = null, MAP = null, H = { places: [], route: [], ep: [], net: [], me: null, pick: null };
  const S = { start: null, end: null, avoid: false, cat: null, view: 'home', focus: null, pick: null, me: null, net: false, res: null, resAvoid: null, field: null, hl: -1 };
  const transfer = { open: false, preset: '10', custom: '', margin: C.TRANSFER_DEFAULTS.comfortableMarginMinutes };

  /* =========================================================
     Map adapters
     ========================================================= */
  function naverAdapter(el) {
    const nm = window.naver.maps;
    const LL = (a, b) => new nm.LatLng(a, b);
    const map = new nm.Map(el, {
      center: LL(CENTER[0], CENTER[1]), zoom: 16, minZoom: 13,
      zoomControl: false, mapDataControl: false, scaleControl: false,
      logoControlOptions: { position: nm.Position.BOTTOM_LEFT },
    });
    const icon = o => ({ content: o.html, anchor: new nm.Point(o.anchor[0], o.anchor[1]), size: o.size ? new nm.Size(o.size[0], o.size[1]) : undefined });
    return {
      kind: 'naver',
      marker(o) {
        const m = new nm.Marker({ position: LL(o.lat, o.lng), map, icon: icon(o), zIndex: o.z || 100, clickable: !!o.onClick });
        if (o.onClick) nm.Event.addListener(m, 'click', () => o.onClick());
        return { remove() { m.setMap(null); } };
      },
      line(pts, o) {
        const pl = new nm.Polyline({
          map, path: pts.map(p => LL(p[0], p[1])), strokeColor: o.color, strokeWeight: o.weight,
          strokeOpacity: o.opacity == null ? 1 : o.opacity, strokeLineCap: 'round', strokeLineJoin: 'round',
          strokeStyle: o.dash ? 'shortdash' : 'solid', clickable: false, zIndex: o.z || 1,
        });
        return { remove() { pl.setMap(null); } };
      },
      fit(pts, pad) {
        let s = 90, w = 180, n = -90, e = -180;
        for (const p of pts) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
        map.fitBounds(new nm.LatLngBounds(LL(s, w), LL(n, e)), { top: pad.t, right: pad.r, bottom: pad.b, left: pad.l, maxZoom: 19 });
      },
      pan(lat, lng, z) { if (z && map.getZoom() < z) map.morph(LL(lat, lng), z); else map.panTo(LL(lat, lng)); },
      zoom() { return map.getZoom(); },
      onClick(fn) { nm.Event.addListener(map, 'click', e => fn(e.coord.lat(), e.coord.lng())); },
      onZoom(fn) { nm.Event.addListener(map, 'zoom_changed', () => fn(map.getZoom())); },
      destroy() { try { map.destroy(); } catch (e) { /* ignore */ } },
    };
  }

  function leafletAdapter(el) {
    const L = window.L;
    const map = L.map(el, { zoomControl: false, minZoom: 13, maxZoom: 20, zoomSnap: 0.5 }).setView(CENTER, 16);
    map.createPane('netPane').style.zIndex = 395;
    map.createPane('routePane').style.zIndex = 405;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const icon = o => L.divIcon({ className: '', html: o.html, iconSize: o.size || null, iconAnchor: o.anchor });
    return {
      kind: 'osm',
      marker(o) {
        const m = L.marker([o.lat, o.lng], { icon: icon(o), zIndexOffset: (o.z || 100) * 10, interactive: !!o.onClick, keyboard: false }).addTo(map);
        if (o.onClick) m.on('click', ev => { L.DomEvent.stopPropagation(ev); o.onClick(); });
        return { remove() { m.remove(); } };
      },
      line(pts, o) {
        const pl = L.polyline(pts, {
          color: o.color, weight: o.weight, opacity: o.opacity == null ? 1 : o.opacity, lineCap: 'round', lineJoin: 'round',
          dashArray: o.dash ? '6 8' : null, interactive: false, pane: (o.z || 1) >= 5 ? 'routePane' : 'netPane',
        }).addTo(map);
        return { remove() { pl.remove(); } };
      },
      fit(pts, pad) { map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [pad.l, pad.t], paddingBottomRight: [pad.r, pad.b], maxZoom: 19 }); },
      pan(lat, lng, z) { map.flyTo([lat, lng], Math.max(map.getZoom(), z || 0), { duration: 0.35 }); },
      zoom() { return map.getZoom(); },
      onClick(fn) { map.on('click', e => fn(e.latlng.lat, e.latlng.lng)); },
      onZoom(fn) { map.on('zoomend', () => fn(map.getZoom())); },
      destroy() { try { map.remove(); } catch (e) { /* ignore */ } },
    };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('script'));
      document.head.appendChild(s);
    });
  }
  function loadCss(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
  function freshMapEl() { const old = $('#map'); const el = document.createElement('div'); el.id = 'map'; old.replaceWith(el); return el; }

  let naverFailed = false;
  async function startMap() {
    if (location.protocol === 'file:') return useOSM('file');
    window.navermap_authFailure = function () {
      naverFailed = true;
      if (!MAP || MAP.kind === 'naver') useOSM('auth');
    };
    try {
      await Promise.race([loadScript('https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=' + NAVER_KEY), timeout(9000)]);
      if (naverFailed) return;
      if (!window.naver || !window.naver.maps) throw new Error('nomaps');
      attachMap(naverAdapter(freshMapEl()));
    } catch (e) {
      if (!naverFailed) useOSM('load');
    }
  }
  let osmLoading = null;
  async function useOSM(reason) {
    showBanner(reason);
    if (MAP && MAP.kind === 'osm') return;
    if (!window.L) {
      if (!osmLoading) { loadCss(LEAFLET_CSS); osmLoading = loadScript(LEAFLET_JS); }
      try { await osmLoading; } catch (e) { toast('지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); return; }
    }
    if (MAP && MAP.kind === 'osm') return;
    attachMap(leafletAdapter(freshMapEl()));
  }
  function attachMap(adapter) {
    if (MAP) MAP.destroy();
    MAP = adapter;
    H = { places: [], route: [], ep: [], net: [], me: null, pick: null };
    MAP.onClick(onMapClick);
    MAP.onZoom(setZoomClass);
    setZoomClass(MAP.zoom());
    renderPlaces(); renderNet(); renderRoute(); renderEndpoints(); renderMe(); renderPick();
    if (curRoute() && !curRoute().same) fitRoute();
    else MAP.fit(G.places.map(p => [p.lat, p.lng]), padding());
    document.body.dataset.map = MAP.kind;
  }
  function setZoomClass(z) {
    $('#mapWrap').dataset.z = z < 17 ? 'lo' : z < 18 ? 'mid' : 'hi';
  }

  /* =========================================================
     Map rendering
     ========================================================= */
  function placeHtml(p, pi) {
    const sel = S.view === 'place' && S.focus === pi ? ' sel' : '';
    if (S.cat && (S.cat in p.cats)) {
      const c = CAT[S.cat];
      return `<div class="pmw" style="width:30px;height:30px;display:grid;place-items:center"><div class="pm cat${sel}" style="--cc:${c.color}">${c.icon}<em>${esc(p.name)}</em></div></div>`;
    }
    const dim = S.cat ? ' dim' : '';
    const box = p.kind === 'gate' ? 14 : p.kind === 'landmark' ? 12 : 22;
    const inner = p.kind === 'gate' ? `<div class="pm gate${sel}${dim}"><em>${esc(p.name)}</em></div>`
      : p.kind === 'landmark' ? `<div class="pm landmark${sel}${dim}"><em>${esc(p.name)}</em></div>`
      : `<div class="pm${sel}${dim}">${esc(p.num)}<em>${esc(p.name)}</em></div>`;
    return `<div class="pmw" style="width:${box}px;height:${box}px;display:grid;place-items:center">${inner}</div>`;
  }
  function placeSize(p) { return S.cat && (S.cat in p.cats) ? 30 : p.kind === 'gate' ? 14 : p.kind === 'landmark' ? 12 : 22; }
  function renderPlaces() {
    if (!MAP) return;
    H.places.forEach(h => h.remove()); H.places = [];
    G.places.forEach((p, pi) => {
      const sz = placeSize(p);
      const isCat = S.cat && (S.cat in p.cats);
      H.places.push(MAP.marker({
        lat: p.lat, lng: p.lng, html: placeHtml(p, pi), size: [sz, sz], anchor: [sz / 2, sz / 2],
        z: isCat ? 300 : (S.focus === pi ? 280 : p.kind === 'building' ? 120 : 110),
        onClick: () => openPlace(pi, true),
      }));
    });
  }

  function epLatLng(ep, which) {
    const r = curRoute();
    if (r && !r.same) { const n = G.N[which === 's' ? r.fromNode : r.toNode]; return [n.lat, n.lng]; }
    if (ep.type === 'place') { const p = G.places[ep.place]; return [p.lat, p.lng]; }
    if (ep.lat != null) return [ep.lat, ep.lng];
    const n = G.N[ep.nodes[0]]; return [n.lat, n.lng];
  }
  function renderEndpoints() {
    if (!MAP) return;
    H.ep.forEach(h => h.remove()); H.ep = [];
    [['s', S.start, '출발'], ['e', S.end, '도착']].forEach(([k, ep, txt]) => {
      if (!ep) return;
      const [lat, lng] = epLatLng(ep, k);
      H.ep.push(MAP.marker({ lat, lng, html: `<div class="pin-ep ${k}"><i></i><b>${txt}</b></div>`, anchor: [0, 0], z: 500 }));
    });
  }

  function renderRoute() {
    if (!MAP) return;
    H.route.forEach(h => h.remove()); H.route = [];
    const r = curRoute();
    if (!r || r.same) return;
    const pts = r.nodes.map(i => [G.N[i].lat, G.N[i].lng]);
    H.route.push(MAP.line(pts, { color: '#ffffff', weight: 13, z: 8 }));
    H.route.push(MAP.line(pts, { color: '#03c75a', weight: 7.5, z: 9 }));
    // stairs segments highlighted
    let seg = null;
    r.edges.forEach((ei, k) => {
      const e = G.E[ei];
      if (e.t === 'stairs') {
        if (!seg) seg = [pts[k]];
        seg.push(pts[k + 1]);
      } else if (seg) { H.route.push(MAP.line(seg, { color: '#8b5cf6', weight: 7.5, z: 10 })); seg = null; }
    });
    if (seg) H.route.push(MAP.line(seg, { color: '#8b5cf6', weight: 7.5, z: 10 }));
  }

  let netCache = null;
  const NET_STYLE = {
    road: { color: '#8e97a6', weight: 3, opacity: 0.55 },
    walk: { color: '#03c75a', weight: 2.5, opacity: 0.6 },
    stairs: { color: '#8b5cf6', weight: 4, opacity: 0.95, dash: true },
    slope: { color: '#f08c00', weight: 4, opacity: 0.95, dash: true },
    custom: { color: '#2f6fed', weight: 4, opacity: 0.9 },
    link: { color: '#b6bdc8', weight: 2, opacity: 0.8, dash: true },
  };
  function renderNet() {
    if (!MAP) return;
    H.net.forEach(h => h.remove()); H.net = [];
    $('#legend').classList.toggle('on', S.net);
    $('#btnNet').classList.toggle('on', S.net);
    if (!S.net) return;
    netCache = netCache || C.chains(G);
    for (const ch of netCache) H.net.push(MAP.line(ch.pts, Object.assign({ z: 3 }, NET_STYLE[ch.c])));
  }
  function renderMe() {
    if (!MAP) return;
    if (H.me) H.me.remove(); H.me = null;
    if (S.me) H.me = MAP.marker({ lat: S.me.lat, lng: S.me.lng, html: '<div class="me"></div>', size: [18, 18], anchor: [9, 9], z: 450 });
  }
  function renderPick() {
    if (!MAP) return;
    if (H.pick) H.pick.remove(); H.pick = null;
    if (S.pick && S.view === 'pick') H.pick = MAP.marker({ lat: S.pick.lat, lng: S.pick.lng, html: `<div class="pin-pick"><b>${SVG.pin}</b></div>`, anchor: [0, 0], z: 480 });
  }
  function padding() {
    if (isMobile()) {
      const top = $('#top').getBoundingClientRect().height;
      const sheet = $('#sheet');
      const sh = sheet.classList.contains('min') ? 118 : Math.min(sheet.scrollHeight, window.innerHeight * 0.58);
      return { t: top + 40, b: sh + 40, l: 40, r: 60 };
    }
    return { t: 70, b: 70, l: 70, r: 70 };
  }
  function fitRoute() {
    const r = curRoute();
    if (!MAP || !r || r.same) return;
    MAP.fit(r.nodes.map(i => [G.N[i].lat, G.N[i].lng]), padding());
  }

  /* =========================================================
     State changes
     ========================================================= */
  const curRoute = () => (S.avoid ? S.resAvoid : S.res);
  function placeEp(pi) { const p = G.places[pi]; return { type: 'place', place: pi, label: p.name, nodes: p.entrances.slice() }; }
  function epKey(ep) { return ep && ep.type === 'place' ? G.places[ep.place].key : null; }

  function setEndpoint(role, ep) {
    S[role] = ep;
    S.pick = null;
    syncInputs();
    if (S.start && S.end) computeRoute();
    else {
      S.res = S.resAvoid = null;
      S.view = 'home';
      renderAllRouteBits();
      renderSheet();
      if (ep && ep.type === 'place' && MAP) { const p = G.places[ep.place]; MAP.pan(p.lat, p.lng, 17); }
    }
    syncURL();
  }
  function computeRoute() {
    S.res = C.route(G, S.start, S.end, false);
    S.resAvoid = S.res && !S.res.same ? C.route(G, S.start, S.end, true) : S.res;
    S.view = 'route'; S.focus = null;
    renderPlaces(); renderAllRouteBits(); renderSheet();
    requestAnimationFrame(fitRoute);
  }
  function renderAllRouteBits() { renderRoute(); renderEndpoints(); renderPick(); }
  function clearRole(role) {
    S[role] = null; S.res = S.resAvoid = null;
    S.view = 'home';
    syncInputs(); renderAllRouteBits(); renderSheet(); syncURL();
  }
  function swap() {
    const t = S.start; S.start = S.end; S.end = t;
    syncInputs();
    if (S.start && S.end) computeRoute(); else { renderAllRouteBits(); renderSheet(); }
    syncURL();
  }
  function openPlace(pi, pan) {
    transfer.open = false; renderChips();
    S.view = 'place'; S.focus = pi; S.pick = null;
    closeSuggest();
    renderPlaces(); renderPick(); renderSheet(true);
    if (pan && MAP) { const p = G.places[pi]; MAP.pan(p.lat, p.lng, 17); }
  }
  function onMapClick(lat, lng) {
    closeSuggest();
    const sn = C.snap(G, lat, lng);
    if (sn.node < 0 || sn.meters > 120) { toast('캠퍼스 안의 길 근처를 눌러 주세요'); return; }
    transfer.open = false; renderChips();
    S.pick = { lat, lng, node: sn.node, meters: sn.meters };
    S.view = 'pick'; S.focus = null;
    renderPlaces(); renderPick(); renderSheet(true);
  }
  function setCat(cat) {
    transfer.open = false;
    S.cat = S.cat === cat ? null : cat;
    S.focus = null;
    renderChips(); renderPlaces();
    if (S.cat) S.view = 'cat';
    else S.view = curRoute() ? 'route' : 'home';
    renderSheet(true);
    if (S.cat && MAP) {
      const pts = G.places.filter(p => S.cat in p.cats).map(p => [p.lat, p.lng]);
      if (S.start) pts.push(epLatLng(S.start, 's'));
      requestAnimationFrame(() => MAP.fit(pts, padding()));
    } else if (curRoute()) requestAnimationFrame(fitRoute);
  }
  function locateMe() {
    if (!navigator.geolocation) { toast('이 브라우저에서는 위치를 쓸 수 없어요'); return; }
    toast('내 위치를 찾고 있어요');
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      S.me = { lat, lng };
      renderMe();
      const sn = C.snap(G, lat, lng);
      if (sn.meters > 400) toast(`캠퍼스에서 약 ${(sn.meters / 1000).toFixed(1)}km 떨어져 있어요`);
      if (MAP) MAP.pan(lat, lng, 17);
      if (!S.start) setEndpoint('start', { type: 'me', label: '내 위치', nodes: [sn.node], lat, lng });
      else if (S.view === 'cat') renderSheet();
    }, err => toast(err.code === 1 ? '브라우저 설정에서 위치 권한을 허용해 주세요' : '위치를 가져오지 못했어요'),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  /* =========================================================
     Search box
     ========================================================= */
  function syncInputs() {
    [['start', '#inStart'], ['end', '#inEnd']].forEach(([role, sel]) => {
      const el = $(sel);
      el.value = S[role] ? S[role].label : '';
      el.closest('.field').classList.toggle('has', !!S[role] || !!el.value);
    });
  }
  function hl(text, q) {
    const t = String(text), i = t.toLowerCase().indexOf(String(q).toLowerCase().trim());
    if (!q || i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.trim().length)) + '</mark>' + esc(t.slice(i + q.trim().length));
  }
  function catIcons(p) { return C.CATS.filter(c => c.id in p.cats).map(c => c.icon).join(' '); }
  function sgPlace(pi, q) {
    const p = G.places[pi];
    const icCls = p.kind === 'gate' ? 'ic gate' : 'ic';
    const ic = p.kind === 'gate' ? '문' : p.kind === 'landmark' ? '•' : esc(p.num);
    const sub = [p.kind === 'gate' ? '출입문' : p.kind === 'landmark' ? '캠퍼스 장소' : p.num + '동', p.entrances.length > 1 ? `출입구 ${p.entrances.length}곳` : '', catIcons(p)].filter(Boolean).join(' · ');
    return `<button class="sg" data-pick="${pi}"><span class="${icCls}">${ic}</span><span class="t"><b>${hl(p.name, q)}</b><small>${sub}</small></span></button>`;
  }
  function renderSuggest() {
    const role = S.field; if (!role) return;
    const q = (role === 'start' ? $('#inStart') : $('#inEnd')).value.trim();
    let h = '';
    if (!q || (S[role] && q === S[role].label)) {
      if (role === 'start') h += `<button class="sg" data-me="1"><span class="ic me">${SVG.loc}</span><span class="t"><b>내 위치에서 출발</b><small>GPS로 가장 가까운 캠퍼스 길을 찾아요</small></span></button>`;
      h += '<div class="sg-h">자주 찾는 곳</div>' + QUICK.map(k => G.byKey.get(k)).filter(Boolean).map(p => sgPlace(p.idx, '')).join('');
    } else {
      const cat = C.catOfQuery(q);
      if (cat) h += `<button class="sg" data-cat="${esc(cat)}"><span class="ic cat">${CAT[cat].icon}</span><span class="t"><b>${esc(cat)} 전체 보기</b><small>지도에 표시하고 가까운 순으로 정렬해요</small></span></button>`;
      const res = C.search(G, q, 8);
      h += res.map(pi => sgPlace(pi, q)).join('');
      if (!res.length && !cat) h += `<div class="sg-h">'${esc(q)}' 검색 결과가 없어요. 지도에서 건물을 직접 눌러도 돼요.</div>`;
    }
    const box = $('#suggest');
    box.innerHTML = h; box.hidden = false; S.hl = -1;
  }
  function closeSuggest() {
    $('#suggest').hidden = true;
    document.querySelectorAll('.field').forEach(f => f.classList.remove('act'));
    S.field = null;
  }
  function pickFromSuggest(btn) {
    const role = S.field;
    if (btn.dataset.me) { closeSuggest(); document.activeElement.blur(); locateMe(); return; }
    if (btn.dataset.cat) { closeSuggest(); document.activeElement.blur(); setCat(btn.dataset.cat); return; }
    const pi = +btn.dataset.pick;
    closeSuggest(); document.activeElement.blur();
    setEndpoint(role, placeEp(pi));
    if (role === 'start' && !S.end && !isMobile()) setTimeout(() => $('#inEnd').focus(), 50);
  }
  function wireSearch() {
    [['start', '#inStart'], ['end', '#inEnd']].forEach(([role, sel]) => {
      const el = $(sel);
      el.addEventListener('focus', () => {
        S.field = role;
        document.querySelectorAll('.field').forEach(f => f.classList.toggle('act', f.dataset.role === role));
        el.select();
        renderSuggest();
      });
      el.addEventListener('input', () => { el.closest('.field').classList.toggle('has', !!el.value); renderSuggest(); });
      el.addEventListener('keydown', ev => {
        const items = [...document.querySelectorAll('#suggest .sg')];
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          S.hl = Math.max(0, Math.min(items.length - 1, S.hl + (ev.key === 'ArrowDown' ? 1 : -1)));
          items.forEach((b, i) => b.classList.toggle('hl', i === S.hl));
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          const b = items[S.hl >= 0 ? S.hl : 0];
          if (b) pickFromSuggest(b);
        } else if (ev.key === 'Escape') { closeSuggest(); el.blur(); syncInputs(); }
      });
    });
    $('#suggest').addEventListener('mousedown', ev => ev.preventDefault());
    $('#suggest').addEventListener('click', ev => { const b = ev.target.closest('.sg'); if (b) pickFromSuggest(b); });
    document.querySelectorAll('.field .x').forEach(b => b.addEventListener('click', () => clearRole(b.dataset.clear)));
    $('#swap').addEventListener('click', swap);
    document.addEventListener('mousedown', ev => { if (!ev.target.closest('#searchCard')) { if (S.field) { closeSuggest(); syncInputs(); } } });
  }

  /* =========================================================
     Chips and sheet
     ========================================================= */
  function renderChips() {
    $('#chips').innerHTML = `<button class="chip${transfer.open ? ' on' : ''}" style="--cc:var(--green-d)" data-transfer aria-pressed="${transfer.open}">연강 이동 확인</button>` + C.CATS.map(c => {
      const n = G.places.filter(p => c.id in p.cats).length;
      return `<button class="chip${S.cat === c.id ? ' on' : ''}" style="--cc:${c.color}" data-chip="${esc(c.id)}"><span>${c.icon}</span>${esc(c.id)} <small style="opacity:.7">${n}</small></button>`;
    }).join('');
  }

  const fmtM = m => (m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m) + 'm');
  function eta(min) {
    const d = new Date(Date.now() + min * 60000);
    const h = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
    return `${h < 12 ? '오전' : '오후'} ${((h + 11) % 12) + 1}:${mm} 도착`;
  }
  function entranceLabel(ep, nodeIdx) {
    if (!ep || ep.type !== 'place') return '';
    const p = G.places[ep.place];
    if (p.entrances.length < 2) return '';
    const k = p.entrances.indexOf(nodeIdx);
    return k >= 0 ? `${p.entranceNames[k]} 쪽 출입구` : '';
  }

  function viewHome() {
    let h = '';
    if (S.start && !S.end) {
      h += `<div class="h2">도착지를 골라 주세요</div><p class="sub"><b>${esc(S.start.label)}</b>에서 출발해요. 위 검색창이나 지도에서 도착지를 선택하세요.</p>`;
    } else if (!S.start && S.end) {
      h += `<div class="h2">출발지를 골라 주세요</div><p class="sub"><b>${esc(S.end.label)}</b>까지 안내할게요.</p>
        <div class="btnrow"><button class="btn s" data-act="me-start">내 위치에서 출발</button></div>`;
    } else {
      h += `<div class="h2">어디로 갈까요?</div><p class="sub">건물 이름, 번호, 줄임말(중도, 글플, 공12, 4합)로 검색하거나 지도에서 건물을 눌러 보세요.</p>`;
    }
    h += '<div class="qgrid">' + QUICK.map(k => G.byKey.get(k)).filter(Boolean).map(p =>
      `<button class="qbtn" data-open="${p.idx}"><span>${p.kind === 'gate' ? '문' : esc(p.num)}</span>${esc(p.name)}</button>`).join('') + '</div>';
    const mainN = G.main.reduce((a, b) => a + b, 0);
    h += `<p class="foot">경북대학교 대구캠퍼스 보행 네트워크 ${mainN.toLocaleString()}개 지점, ${G.E.length.toLocaleString()}개 구간을 다익스트라 알고리즘으로 계산해요.<br>지도 ${MAP && MAP.kind === 'naver' ? '© NAVER Corp.' : '© OpenStreetMap contributors'} · 보행로 데이터 일부 © OpenStreetMap contributors (ODbL)</p>`;
    return h;
  }

  function viewPlace() {
    const p = G.places[S.focus];
    const badge = p.kind === 'gate' ? '<span class="num gate">출입문</span>' : p.kind === 'landmark' ? '<span class="num landmark">장소</span>' : `<span class="num">${esc(p.num)}</span>`;
    let h = `<div class="ptitle">${badge}<h3>${esc(p.name)}</h3></div>`;
    const facs = C.CATS.filter(c => c.id in p.cats);
    if (facs.length) {
      h += '<div class="facs">' + facs.map(c => `<div class="fac"><span class="e">${c.icon}</span><b>${esc(c.id)}</b><small>${esc(p.cats[c.id] || '')}</small></div>`).join('') + '</div>';
    }
    const metaBits = [];
    if (p.entrances.length > 1) metaBits.push(`출입구 ${p.entrances.length}곳 중 가장 가까운 곳으로 안내해요`);
    if (p.aliases.length) {
      const al = [...new Set(p.aliases)].filter(a => !/^\d/.test(a) && a !== p.name).slice(0, 5);
      if (al.length) metaBits.push('이렇게도 검색돼요: ' + al.join(', '));
    }
    if (S.start && !(S.start.type === 'place' && S.start.place === S.focus)) {
      const r = C.route(G, S.start, placeEp(S.focus), S.avoid);
      if (r && !r.same) metaBits.unshift(`${esc(S.start.label)}에서 도보 약 ${r.minutes}분 (${fmtM(r.meters)})`);
    }
    if (metaBits.length) h += `<p class="meta">${metaBits.join('<br>')}</p>`;
    h += `<div class="btnrow"><button class="btn s" data-act="set-start">출발</button><button class="btn e" data-act="set-end">도착</button></div>`;
    return h;
  }

  function viewPick() {
    return `<div class="h2">지도에서 선택한 위치</div>
      <p class="sub">가장 가까운 캠퍼스 길 지점(${Math.round(S.pick.meters)}m 거리)을 기준으로 안내해요.</p>
      <div class="btnrow"><button class="btn s" data-act="pick-start">여기서 출발</button><button class="btn e" data-act="pick-end">여기로 도착</button></div>`;
  }

  function viewRoute() {
    const a = S.res, b = S.resAvoid;
    let h = routeModes();
    if (!a || !curRoute()) return h + `<div class="h2">경로를 찾지 못했어요</div><div class="err">두 지점을 잇는 길 데이터가 없어요. 편집기에서 이 구간을 연결해 주세요.</div>`;
    if (a.same) return h + `<div class="h2">출발지와 도착지가 같아요</div><p class="sub">다른 도착지를 골라 주세요.</p>`;
    const r = curRoute();
    h += `<div class="sum"><span class="min">${r.minutes}<small>분</small></span><span class="dist">${fmtM(r.meters)}</span><span class="eta">${eta(r.minutes)}</span></div>`;
    h += `<p class="route-names"><b>${esc(S.start.label)}</b> 에서 <b>${esc(S.end.label)}</b> 까지 도보</p>`;
    const tot = r.meters || 1;
    const segs = [['인도', r.walkM, 'var(--walk)'], ['차도 옆', r.roadM, 'var(--road)'], ['계단', r.stairsM, 'var(--stairs)'], ['경사', r.slopeM, 'var(--slope)']].filter(s => s[1] >= 1);
    h += '<div class="compo"><div class="bar">' + segs.map(s => `<span style="width:${(s[1] / tot * 100).toFixed(1)}%;background:${s[2]}"></span>`).join('') + '</div>';
    h += '<div class="compo-l">' + segs.map(s => `<span><i style="background:${s[2]}"></i>${s[0]} ${fmtM(s[1])}</span>`).join('') + '</div></div>';
    h += '<div class="tags">';
    h += r.stairsRuns ? `<span class="tag st">계단 ${r.stairsRuns}곳</span>` : '<span class="tag ok">계단 없는 길</span>';
    if (r.customM >= 20) h += `<span class="tag sc">캠퍼스 샛길 ${fmtM(r.customM)} 포함</span>`;
    if (S.avoid && r.stairsRuns) h += '<span class="tag">계단을 완전히 피할 수는 없어요</span>';
    h += '</div>';
    h += '<ol class="steps">' + r.steps.map(s => {
      let t = '', sm = '';
      if (s.k === 'start') { t = `<b>${esc(S.start.label)}</b> 출발`; sm = entranceLabel(S.start, r.fromNode); }
      else if (s.k === 'end') { t = `<b>${esc(S.end.label)}</b> 도착`; sm = entranceLabel(S.end, r.toNode); }
      else if (s.k === 'pass') { t = `<b>${esc(G.places[s.place].name)}</b> 앞 지나기`; }
      else if (s.k === 'stairs') { t = '<b>계단</b> 구간'; sm = S.avoid ? '' : '계단 회피를 누르면 돌아가는 길도 볼 수 있어요'; }
      else if (s.k === 'shortcut') { t = `<b>샛길</b> ${fmtM(s.len)}`; sm = '일반 지도 앱에는 없는 캠퍼스 길이에요'; }
      return `<li class="${s.k}"><span class="at">${s.k === 'start' ? '' : fmtM(s.at)}</span><span class="dot"></span><span class="txt">${t}${sm ? `<small>${esc(sm)}</small>` : ''}</span></li>`;
    }).join('') + '</ol>';
    h += `<div class="btnrow"><button class="btn ghost" data-act="swap">출발 도착 바꾸기</button><button class="btn ghost" data-act="share">링크 복사</button></div>`;
    return h;
  }

  function routeModes() {
    const a = S.res, b = S.resAvoid;
    const same = a && b && (a.same && b.same || a.nodes && b.nodes && a.nodes.length === b.nodes.length && a.nodes.every((n, i) => n === b.nodes[i]));
    const detail = r => !r ? '경로 없음' : r.same ? '같은 건물' : `${r.minutes}분 · ${fmtM(r.meters)}`;
    return `<div class="tabs" aria-label="경로 선택">
      <button class="tab${!S.avoid ? ' on' : ''}" data-act="mode-0" aria-pressed="${!S.avoid}">추천 경로<small>${detail(a)}</small></button>
      <button class="tab${S.avoid ? ' on' : ''}" data-act="mode-1" aria-pressed="${S.avoid}">계단 회피<small>${same ? '같은 경로' : detail(b)}</small></button>
    </div><p class="meta">계단 회피는 계단과 경사를 덜 지나는 경로를 우선해요. 완전히 피하는 것을 보장하지는 않아요.</p>`;
  }

  function transferAssessment() {
    const gap = transfer.preset === 'custom' ? (transfer.custom.trim() === '' ? NaN : Number(transfer.custom)) : Number(transfer.preset);
    return C.assessTransfer(G, S.start, S.end, gap, {
      avoid: S.avoid, comfortableMarginMinutes: transfer.margin,
    }, curRoute());
  }
  function transferResult() {
    const r = transferAssessment();
    if (!r.ok) {
      const message = r.reason === 'same-building-internal-time-unknown'
        ? '같은 건물의 강의실·층간 이동시간은 알 수 없어 판정을 보류해요.' : r.message;
      return `<div class="err"><b>판정 불가</b><br>${esc(message)}</div>`;
    }
    const tone = r.status === '여유' ? 'comfortable' : r.status === '빠듯' ? 'tight' : 'difficult';
    const mins = n => Number(n.toFixed(2));
    return `<div class="transfer-result ${tone}"><strong>${r.status}</strong>
      <dl><div><dt>예상 도보시간</dt><dd>${r.estimatedWalkingMinutes}분</dd></div>
      <div><dt>남은 시간</dt><dd>${mins(r.remainingMinutes)}분${r.remainingMinutes < 0 ? ` (${mins(-r.remainingMinutes)}분 부족)` : ''}</dd></div></dl></div>`;
  }
  function viewTransfer() {
    const summary = ep => ep ? esc(ep.label) : '미선택';
    return `<div class="h2">연강 이동 확인</div><p class="sub">위 검색창에서 출발 건물과 도착 건물을 선택하세요.</p>
      <p class="route-names"><b>${summary(S.start)}</b> → <b>${summary(S.end)}</b></p>
      <div class="transfer-controls"><label for="transferBreak">쉬는 시간</label>
      <select id="transferBreak">${[['10', '10분'], ['15', '15분'], ['20', '20분'], ['custom', '직접 입력']].map(([v, label]) => `<option value="${v}"${transfer.preset === v ? ' selected' : ''}>${label}</option>`).join('')}</select>
      <div id="transferCustomWrap"${transfer.preset === 'custom' ? '' : ' hidden'}><label for="transferCustom">쉬는 시간 (분)</label>
      <input id="transferCustom" type="number" min="0" step="any" inputmode="decimal" placeholder="예: 12" value="${esc(transfer.custom)}"></div></div>
      ${routeModes()}<div id="transferResult" role="status" aria-live="polite">${transferResult()}</div>
      <p class="meta">건물 간 예상 도보시간 기준이며, 건물 내부 이동시간은 포함되지 않습니다.</p>
      <div class="btnrow"><button class="btn ghost" data-act="swap">출발 도착 바꾸기</button><button class="btn ghost" data-act="transfer-close">일반 길찾기</button></div>`;
  }
  function onTransferInput(ev) {
    if (ev.target.id === 'transferBreak') {
      transfer.preset = ev.target.value;
      $('#transferCustomWrap').hidden = transfer.preset !== 'custom';
    } else if (ev.target.id === 'transferCustom') transfer.custom = ev.target.value;
    else return;
    $('#transferResult').innerHTML = transferResult();
    updateSheetVar();
  }
  function toggleTransfer() {
    transfer.open = !transfer.open;
    S.cat = null; S.view = S.start && S.end ? 'route' : 'home';
    S.focus = null; S.pick = null;
    closeSuggest(); renderChips(); renderPlaces(); renderPick(); renderSheet(true);
  }

  function viewCat() {
    const c = CAT[S.cat];
    const from = S.start || (S.me ? { type: 'me', label: '내 위치', nodes: [C.snap(G, S.me.lat, S.me.lng).node] } : null);
    let h = `<div class="h2">${c.icon} ${esc(c.id)}</div>`;
    let items;
    if (from) {
      const near = C.nearestInCat(G, from, S.cat, S.avoid);
      h += `<p class="sub"><b>${esc(from.label)}</b> 기준으로 가까운 순이에요.</p>`;
      items = near.map(x => ({ pi: x.place, m: x.minutes }));
    } else {
      h += `<p class="sub">출발지를 정하면 걸어서 가까운 순으로 정렬해 드려요.</p><div class="btnrow" style="margin-top:0"><button class="btn ghost" data-act="me-start">내 위치 기준으로 보기</button></div>`;
      items = G.places.map((p, pi) => ({ pi, m: null })).filter(x => S.cat in G.places[x.pi].cats);
    }
    h += `<div class="list" style="--cc:${c.color}">` + items.map((x, k) => {
      const p = G.places[x.pi];
      const note = p.cats[S.cat];
      return `<button class="li" data-go="${x.pi}"><span class="rank">${k + 1}</span><span class="t"><b>${esc(p.name)}</b><small>${p.num ? p.num + '동' : ''}${note ? (p.num ? ' · ' : '') + esc(note) : ''}</small></span>${x.m != null ? `<span class="m">${x.m}분<small>도보</small></span>` : ''}</button>`;
    }).join('') + '</div>';
    return h;
  }

  function renderSheet(expand) {
    const body = $('#sheetBody');
    const v = S.view;
    body.innerHTML = transfer.open ? viewTransfer() : v === 'place' ? viewPlace() : v === 'pick' ? viewPick() : v === 'route' ? viewRoute() : v === 'cat' ? viewCat() : viewHome();
    body.scrollTop = 0;
    const idle = !transfer.open && v === 'home' && !S.start && !S.end;
    if (isMobile() && idle) $('#sheet').classList.add('min');
    else if (expand || !idle) $('#sheet').classList.remove('min');
    updateSheetVar();
  }
  function onSheetClick(ev) {
    const t = ev.target.closest('[data-act],[data-open],[data-go]');
    if (!t) return;
    if (t.dataset.open != null) { openPlace(+t.dataset.open, true); return; }
    if (t.dataset.go != null) {
      const pi = +t.dataset.go;
      if (S.start || S.me) {
        if (!S.start && S.me) S.start = { type: 'me', label: '내 위치', nodes: [C.snap(G, S.me.lat, S.me.lng).node], lat: S.me.lat, lng: S.me.lng };
        S.cat = null; renderChips(); setEndpoint('end', placeEp(pi));
      } else openPlace(pi, true);
      return;
    }
    const a = t.dataset.act;
    if (a === 'set-start') setEndpoint('start', placeEp(S.focus));
    else if (a === 'set-end') setEndpoint('end', placeEp(S.focus));
    else if (a === 'pick-start' || a === 'pick-end') {
      const ep = { type: 'point', label: '지도에서 선택한 위치', nodes: [S.pick.node], lat: S.pick.lat, lng: S.pick.lng };
      setEndpoint(a === 'pick-start' ? 'start' : 'end', ep);
    } else if (a === 'me-start') locateMe();
    else if (a === 'mode-0' || a === 'mode-1') { S.avoid = a === 'mode-1'; renderAllRouteBits(); renderSheet(); fitRoute(); }
    else if (a === 'swap') swap();
    else if (a === 'transfer-close') toggleTransfer();
    else if (a === 'share') {
      const url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('경로 링크를 복사했어요'), () => toast(url));
    }
  }

  /* =========================================================
     Misc UI
     ========================================================= */
  let toastT = 0;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600);
  }
  function showBanner(reason) {
    const o = location.origin && location.origin !== 'null' ? location.origin : '';
    const msg = reason === 'file'
      ? '파일을 직접 열면 네이버 지도 인증이 되지 않아 <b>OpenStreetMap</b>으로 보여드려요. 로컬 서버(http://localhost)나 배포 주소로 열어 주세요.'
      : reason === 'auth'
        ? `네이버 지도 인증에 실패해서 <b>OpenStreetMap</b>으로 보여드려요. 네이버 클라우드 콘솔의 Maps Application에서 Dynamic Map을 선택하고 Web 서비스 URL에 <b>${esc(o)}</b> 를 등록해 주세요.`
        : '네이버 지도를 불러오지 못해 <b>OpenStreetMap</b>으로 보여드려요. 네트워크를 확인해 주세요.';
    const b = $('#banner');
    b.innerHTML = msg + `<button aria-label="닫기">${SVG.x}</button>`;
    b.hidden = false;
    b.querySelector('button').onclick = () => { b.hidden = true; };
  }
  function updateSheetVar() {
    const mob = isMobile();
    const sheet = $('#sheet');
    const h = mob ? sheet.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--sheetH', h + 'px');
    document.documentElement.style.setProperty('--topH', mob ? $('#top').getBoundingClientRect().height + 'px' : '0px');
  }
  function syncURL() {
    const s = epKey(S.start), e = epKey(S.end);
    const q = new URLSearchParams();
    if (s) q.set('from', s);
    if (e) q.set('to', e);
    const url = location.pathname + (q.toString() ? '?' + q.toString() : '');
    try { history.replaceState(null, '', url); } catch (err) { /* ignore */ }
  }
  function readURL() {
    const q = new URLSearchParams(location.search);
    const s = q.get('from') && G.byKey.get(q.get('from'));
    const e = q.get('to') && G.byKey.get(q.get('to'));
    if (s) S.start = placeEp(s.idx);
    if (e) S.end = placeEp(e.idx);
    syncInputs();
    if (S.start && S.end) computeRoute(); else renderSheet();
  }

  /* =========================================================
     Boot
     ========================================================= */
  async function loadData() {
    if (location.protocol.startsWith('http')) {
      try {
        const r = await fetch('knu-graph.json', { cache: 'no-cache' });
        if (r.ok) return await r.json();
      } catch (e) { /* use embedded */ }
    }
    const emb = document.getElementById('graph-data');
    if (emb) return JSON.parse(emb.textContent);
    throw new Error('길 데이터를 읽지 못했어요. 폴더에서 python -m http.server 8000 을 실행한 뒤 http://localhost:8000 으로 열어 주세요.');
  }

  async function boot() {
    const raw = await loadData();
    G = C.build(raw);
    $('#searchCard').insertAdjacentHTML('beforeend', '');
    document.querySelectorAll('.field .x').forEach(b => { b.innerHTML = SVG.x; });
    $('#swap').innerHTML = SVG.swap;
    $('#btnLoc').innerHTML = SVG.loc;
    $('#btnNet').innerHTML = SVG.net;
    renderChips();
    wireSearch();
    $('#chips').addEventListener('click', ev => {
      if (ev.target.closest('[data-transfer]')) { toggleTransfer(); return; }
      const b = ev.target.closest('[data-chip]'); if (b) setCat(b.dataset.chip);
    });
    $('#sheetBody').addEventListener('click', onSheetClick);
    $('#sheetBody').addEventListener('input', onTransferInput);
    $('#sheet .handle').addEventListener('click', () => { $('#sheet').classList.toggle('min'); setTimeout(updateSheetVar, 260); });
    // swipe the sheet down to fold it and see the map, swipe up to open it again
    (function () {
      const sheet = $('#sheet'), body = $('#sheetBody'); let y0 = null, atTop = false;
      sheet.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; atTop = body.scrollTop <= 0 || !!e.target.closest('.handle'); }, { passive: true });
      sheet.addEventListener('touchend', e => {
        if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null;
        if (dy > 50 && atTop && !sheet.classList.contains('min')) { sheet.classList.add('min'); setTimeout(updateSheetVar, 260); }
        else if (dy < -50 && sheet.classList.contains('min')) { sheet.classList.remove('min'); setTimeout(updateSheetVar, 260); }
      }, { passive: true });
    })();
    $('#btnLoc').addEventListener('click', locateMe);
    $('#btnNet').addEventListener('click', () => { S.net = !S.net; renderNet(); if (S.net) toast('파란 선은 우리가 직접 그린 캠퍼스 길이에요'); });
    if (window.ResizeObserver) new ResizeObserver(updateSheetVar).observe($('#sheet'));
    window.addEventListener('resize', updateSheetVar);
    readURL();
    updateSheetVar();
    window.__knu = { G, S, C, get map() { return MAP; }, setEndpoint, placeEp, setCat, openPlace, onMapClick };
    startMap();
  }
  boot().catch(err => {
    console.error(err);
    $('#sheetBody').innerHTML = `<div class="err">데이터를 불러오지 못했어요: ${esc(err.message)}</div>`;
  });
})();
