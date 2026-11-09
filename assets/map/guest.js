/* PokeIt map guest. Runs only inside the Desktop plugin's sandboxed, opaque-origin frame.
 *
 * It draws what the plugin already read: the search point, its radius, the returned
 * catches as large icons and other observations as small dots. It never reads PokeIt
 * data itself and cannot start a search or a scan. The only things it loads from the
 * network are map tiles and species icons, both listed in the document's CSP.
 *
 * In:  the first state is embedded in the document; later states arrive from the
 *      plugin as window messages ({source: 'pokeit-host', state}).
 * Out: {source: 'pokeit-map', type: 'ready'} once, and {type: 'select', id} when the
 *      player taps a catch. The plugin checks the id against its own list.
 */
/* global L */
(function () {
  'use strict';
  var ID = /^pid_[A-Za-z0-9_-]{1,96}$/;
  var ICONS = 'https://pokeit.cc/assets/bigfunOutline/pokemon/';
  var root = document.documentElement, note = document.getElementById('note');
  var num = function (n) { return typeof n === 'number' && isFinite(n); };
  var str = function (s, n) { return typeof s === 'string' ? s.slice(0, n || 80) : ''; };

  var map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 }).setView([39.5, -98.35], 4);
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Plain-text attribution: links cannot open from a sandboxed frame.
  var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  var loaded = false;
  tiles.on('tileload', function () { loaded = true; if (note.dataset.kind === 'tiles') { note.textContent = ''; } });
  setTimeout(function () { if (!loaded) { note.dataset.kind = 'tiles'; note.textContent = 'Map tiles unavailable. Catches are still placed correctly.'; } }, 12000);

  var state = null, placeKey = '', listSig = '', markers = new Map(), known = new Set();
  var spot = null, ring = null, inner = null, label = null, sweep = null, walk = null, userMoved = false;
  var layer = L.layerGroup().addTo(map);

  function ringBounds() { return L.latLng(state.center.lat, state.center.lon).toBounds(state.radius * 2); }
  function fit() { if (state && state.center) { userMoved = false; map.fitBounds(ringBounds(), { padding: [14, 14], animate: false }); } }
  var Fit = L.Control.extend({ options: { position: 'bottomright' }, onAdd: function () {
    var bar = L.DomUtil.create('div', 'leaflet-bar'), b = L.DomUtil.create('button', 'fit-control', bar);
    b.type = 'button'; b.textContent = 'FIT'; b.title = 'Show the whole search area'; b.style.borderTop = '0';
    L.DomEvent.disableClickPropagation(b); L.DomEvent.on(b, 'click', fit); return bar;
  } });
  map.addControl(new Fit());
  map.on('dragstart', function () { userMoved = true; });

  function pixels(meters) {
    var c = L.latLng(state.center.lat, state.center.lon), p = map.latLngToLayerPoint(c);
    return Math.abs(map.latLngToLayerPoint(L.latLng(c.toBounds(meters * 2).getNorth(), c.lng)).y - p.y);
  }
  function drawSweep() {
    if (sweep) { layer.removeLayer(sweep); sweep = null; }
    if (!state || !state.center) { return; }
    var r = Math.round(pixels(state.radius));
    if (r < 20 || r > 1500) { return; }
    sweep = L.marker([state.center.lat, state.center.lon], { interactive: false, keyboard: false, zIndexOffset: -500,
      icon: L.divIcon({ className: 'pin-wrap', html: '<div class="sweep" style="width:' + r * 2 + 'px;height:' + r * 2 + 'px"></div>', iconSize: [r * 2, r * 2], iconAnchor: [r, r] }) }).addTo(layer);
  }
  map.on('zoomend', drawSweep);

  function place() {
    [spot, ring, inner, label].forEach(function (l) { if (l) { layer.removeLayer(l); } });
    spot = ring = inner = label = null;
    if (!state.center) { return; }
    var at = [state.center.lat, state.center.lon];
    ring = L.circle(at, { radius: state.radius, className: 'ring', interactive: false }).addTo(layer);
    inner = L.circle(at, { radius: state.radius / 2, className: 'ring ring--inner', interactive: false }).addTo(layer);
    spot = L.marker(at, { interactive: false, keyboard: false, zIndexOffset: -100,
      icon: L.divIcon({ className: 'find-marker', html: '<span class="find-marker__ring"></span><span class="find-marker__dot"></span>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(layer);
    var north = L.latLng(at).toBounds(state.radius * 2).getNorth();
    var text = state.radius < 1000 ? state.radius + ' m' : state.radius / 1000 + ' km';
    label = L.marker([north, state.center.lon], { interactive: false, keyboard: false, zIndexOffset: -200,
      icon: L.divIcon({ className: 'ring-label', html: text, iconSize: [60, 12], iconAnchor: [30, 16] }) }).addTo(layer);
    fit(); drawSweep();
  }

  function art(p) {
    var img = document.createElement('img'), tried = 0;
    img.alt = ''; img.draggable = false; img.decoding = 'async';
    var base = ICONS + p.pokemon_id + '.webp?w=64';
    img.src = p.form ? ICONS + p.pokemon_id + '_f' + p.form + '.webp?w=64' : base;
    img.addEventListener('error', function () {
      // form icon -> base species -> a lettered badge
      if (p.form && !tried) { tried = 1; img.src = base; return; }
      var letter = document.createElement('span'); letter.className = 'pin__letter'; letter.textContent = str(p.name, 1) || '?';
      if (img.parentNode) { img.parentNode.replaceChild(letter, img); }
    });
    return img;
  }
  function choose(id) { parent.postMessage({ source: 'pokeit-map', type: 'select', id: id }, '*'); select(id); }
  function addMarker(p, big) {
    var el = document.createElement('div');
    if (big) {
      el.className = 'pin' + (known.size && !known.has(p.id) ? ' is-new' : '');
      el.appendChild(art(p));
      if (p.tag) {
        var tag = document.createElement('span');
        tag.className = 'pin__tag' + (p.tag === 'PvP #1' ? ' pin__tag--pvp' : p.tag === 'Nundo' ? ' pin__tag--nundo' : '');
        tag.textContent = p.tag === 'Hundo' ? '100%' : p.tag; el.appendChild(tag);
      }
    } else { el.className = 'dot'; }
    var title = str(p.name, 40) + (num(p.iv) ? ' · ' + Math.round(p.iv * 10) / 10 + '% IV' : '');
    var m = L.marker([p.lat, p.lon], { title: '', alt: title, zIndexOffset: big ? 200 : 0,
      icon: L.divIcon({ className: 'pin-wrap', html: el, iconSize: big ? [52, 52] : [19, 19], iconAnchor: big ? [26, 26] : [9.5, 9.5] }) });
    m.bindTooltip(title, { direction: 'top', offset: [0, big ? -24 : -8] });
    m.on('click', function (e) { L.DomEvent.stopPropagation(e); choose(p.id); });
    m.addTo(layer);
    markers.set(p.id, { marker: m, el: el, big: big, expires: num(p.expires) ? p.expires : null, verified: p.verified === true });
  }
  function select(id) {
    markers.forEach(function (m, key) {
      var on = key === id; m.el.classList.toggle('is-selected', on); m.marker.setZIndexOffset(on ? 1000 : m.big ? 200 : 0);
    });
    if (walk) { layer.removeLayer(walk); walk = null; }
    var hit = markers.get(id);
    if (hit && state.center) {
      walk = L.polyline([[state.center.lat, state.center.lon], hit.marker.getLatLng()], { className: 'walk', interactive: false }).addTo(layer);
      if (!map.getBounds().pad(-0.08).contains(hit.marker.getLatLng()) && !userMoved) { fit(); }
    }
  }
  function tick() {
    var now = Date.now();
    markers.forEach(function (m, id) {
      if (m.expires === null) { return; }
      var left = m.expires - now;
      if (left <= 0 && m.verified) { layer.removeLayer(m.marker); markers.delete(id); if (state && state.selected === id && walk) { layer.removeLayer(walk); walk = null; } return; }
      m.el.classList.toggle('is-low', m.big && left > 0 && left <= 120000);
    });
  }
  setInterval(tick, 1000);

  function clean(list) {
    return (Array.isArray(list) ? list : []).filter(function (p) {
      return p && ID.test(p.id) && num(p.lat) && num(p.lon) && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180;
    }).slice(0, 60);
  }
  function apply(next) {
    if (!next || typeof next !== 'object') { return; }
    var center = next.center && num(next.center.lat) && num(next.center.lon) ? { lat: next.center.lat, lon: next.center.lon } : null;
    state = { center: center, radius: num(next.radius) ? Math.min(2000, Math.max(50, next.radius)) : 500, selected: ID.test(next.selected) ? next.selected : null };
    root.classList.toggle('light', next.theme === 'light');
    root.classList.toggle('is-busy', next.busy === true);
    root.classList.toggle('is-watching', next.watching === true);
    var key = center ? [center.lat, center.lon, state.radius].join(',') : '';
    if (key !== placeKey) { placeKey = key; known = new Set(); place(); }
    var items = clean(next.items), dots = clean(next.dots);
    // Redraw the catches only when the list changed, so a selection does not make icons blink.
    var sig = JSON.stringify([key, items.map(function (p) { return [p.id, p.tag, p.expires]; }), dots.map(function (p) { return p.id; })]);
    if (sig === listSig) { select(state.selected); return; }
    listSig = sig;
    markers.forEach(function (m) { layer.removeLayer(m.marker); });
    markers = new Map();
    dots.forEach(function (p) { if (!markers.has(p.id)) { addMarker(p, false); } });
    items.forEach(function (p) { if (markers.has(p.id)) { layer.removeLayer(markers.get(p.id).marker); } addMarker(p, true); });
    if (next.busy !== true) { items.forEach(function (p) { known.add(p.id); }); }
    select(state.selected); tick();
  }

  try { apply(JSON.parse(document.getElementById('state').textContent)); } catch (e) { /* the plugin sends state after 'ready' */ }
  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.source !== 'pokeit-host') { return; }
    apply(e.data.state);
  });
  window.addEventListener('resize', function () { map.invalidateSize(); if (!userMoved) { fit(); } });
  parent.postMessage({ source: 'pokeit-map', type: 'ready' }, '*');
})();
