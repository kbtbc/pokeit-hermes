import { host, atom, useValue, useTheme, gatewayActivationEpoch, PANES_AREA, STATUSBAR_AREAS, TRANSCRIPT_DIRECTIVE_AREA } from '@hermes/plugin-sdk';
import { useEffect, useState, useId } from 'react';
import { jsx as h, jsxs as hs } from 'react/jsx-runtime';

const VERSION = '0.1.12';
const ORIGIN = 'https://pokeit.cc';
const ID = /^pid_[A-Za-z0-9_-]{1,96}$/;
const SCAN_ID = /^[A-Za-z0-9_-]{32}$/;
const TERMINAL = new Set(['data_refreshed', 'existing_coverage', 'partial_unverified', 'failed']);
const empty = () => ({ center: null, label: 'Choose a spot', radius: 500, observations: [], selected: null,
  queriedAt: null, coverage: null, busy: false, error: '', truncated: false, generation: 0 });
const text = (s, n = 180) => typeof s === 'string' ? s.slice(0, n) : '';
const number = n => typeof n === 'number' && Number.isFinite(n);

export function coordinate(v, max) {
  if (typeof v !== 'string' || !/^-?(?:\d{1,3}(?:\.\d{1,17})?|\.\d{1,17})$/.test(v)) return null;
  const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}
export function catchAttributes(attrs) {
  const lat = coordinate(attrs?.lat, 85), lon = coordinate(attrs?.lon, 180);
  if (!ID.test(attrs?.id || '') || lat === null || lon === null) return null;
  const result = { id: attrs.id, lat, lon };
  const a = coordinate(attrs.origin_lat, 85), b = coordinate(attrs.origin_lon, 180);
  if (a !== null && b !== null) Object.assign(result, { origin_lat: a, origin_lon: b });
  return result;
}
export function safeMapUrl(value) {
  try {
    const u = new URL(value);
    return u.origin === ORIGIN && !u.username && !u.password &&
      (/^\/map\/?$/.test(u.pathname) || /^\/(?:pokemon|gym|pokestop)\/[A-Za-z0-9_-]+$/.test(u.pathname)) ? u.href : null;
  } catch { return null; }
}
export function distanceBearing(center, p) {
  if (!center || ![center.lat, center.lon, p?.lat, p?.lon].every(number)) return null;
  const r = Math.PI / 180, a = center.lat * r, b = p.lat * r;
  const da = b - a, dl = (p.lon - center.lon) * r;
  const x = Math.sin(da / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dl / 2) ** 2;
  const meters = 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  const bearing = (Math.atan2(Math.sin(dl) * Math.cos(b), Math.cos(a) * Math.sin(b) -
    Math.sin(a) * Math.cos(b) * Math.cos(dl)) / r + 360) % 360;
  return { meters, bearing, direction: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8] };
}
export function expiry(p, now) {
  const end = typeof p?.expires_at === 'string' ? Date.parse(p.expires_at) : NaN;
  if (!Number.isFinite(end)) return { label: 'Time unknown', seconds: null, expired: false, low: false };
  const seconds = Math.ceil((end - now) / 1000), verified = p.expiry_verified === true;
  if (seconds <= 0) return { label: verified ? 'Expired' : 'May have expired', seconds, expired: verified, low: false };
  const mm = Math.floor(seconds / 60), ss = String(seconds % 60).padStart(2, '0');
  return { label: `${verified ? '' : '~'}${mm}:${ss}`, seconds, expired: false, low: seconds <= 120 };
}
export function scanProgress(data) {
  const total = Number.isInteger(data?.total_points) && data.total_points > 0 ? data.total_points : null;
  const c = data?.counts || {};
  const count = k => Number.isInteger(c[k]) && c[k] >= 0 ? c[k] : 0;
  const done = count('existing_area') + count('confirmed');
  return { total, done: total === null ? null : Math.min(total, done),
    failed: count('failed'), unverified: count('unverified'), terminal: TERMINAL.has(data?.status),
    delay: Math.max(5, Math.min(60, Number(data?.poll_after_seconds) || 5)) };
}
function hasRankOne(p) {
  return Object.values(p?.pvp_iv_rankings || {}).some(rows => Array.isArray(rows) && rows.some(r => r.rank === 1));
}
function rankLabel(p) {
  for (const [league, rows] of Object.entries(p?.pvp_iv_rankings || {})) {
    const rank = Array.isArray(rows) && rows.find(r => r.rank === 1);
    if (rank) return `${text(rank.ranked_species_name || p.name, 40)} · ${league} #1${rank.same_species_as_observation === false ? ' after evolving' : ''}`;
  }
  return '';
}
function metric(p) { return number(p?.iv_percent) ? `${Number(p.iv_percent.toFixed(1))}% IV` : 'IV unknown'; }
function distanceLabel(center, p) {
  const d = distanceBearing(center, p);
  if (!d) return 'Distance from you unknown';
  return d.meters < 10 ? 'At the search point' : `${d.meters < 1000 ? Math.round(d.meters) + ' m' : (d.meters / 1000).toFixed(1) + ' km'} ${d.direction} of search point`;
}
function mapUrl(center, radius) {
  const zoom = radius <= 250 ? 17 : radius <= 500 ? 16 : radius <= 1000 ? 15 : 14;
  return `${ORIGIN}/map?${new URLSearchParams({ lat: center.lat, lon: center.lon, zoom, view: 1 })}`;
}
function palette(light) {
  return light ? { bg: '#FBF8F1', surface: '#FFFFFF', raised: '#F0EBDD', fg: '#0A1633', muted: '#4A5878',
    accent: '#B15700', ink: '#FFFFFF', line: '#D8D4CA', green: '#157148', red: '#B52F2C', blue: '#315DA6' }
    : { bg: '#050C20', surface: '#0A1633', raised: '#14264F', fg: '#F2F6FF', muted: '#A9B6D3',
      accent: '#FFB020', ink: '#0A1633', line: '#30436A', green: '#4ADE9A', red: '#FF8174', blue: '#80A8FF' };
}
function useColors() { return palette(useTheme().resolvedMode === 'light'); }
const font = "'Segoe UI', system-ui, sans-serif";
const rowStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
const fine = c => ({ color: c.muted, fontSize: 12, lineHeight: 1.5 });
const panel = c => ({ fontFamily: font, color: c.fg, background: c.surface, border: `1px solid ${c.line}`,
  borderRadius: 12, padding: 14, overflow: 'hidden', minWidth: 0, lineHeight: 1.45 });
function Button({ c, children, primary, style, ...props }) {
  return h('button', { type: 'button', ...props, style: { font: `600 12px ${font}`, borderRadius: 8,
    padding: '8px 11px', border: `1px solid ${primary ? c.accent : c.line}`, background: primary ? c.accent : c.raised,
    color: primary ? c.ink : c.fg, cursor: props.disabled ? 'default' : 'pointer', opacity: props.disabled ? .6 : 1, ...style }, children });
}
function ErrorNote({ c, message }) {
  return h('p', { role: 'alert', style: { margin: '8px 0', color: c.red, fontSize: 12 } , children: message });
}
function Initial({ c, p, size = 38 }) {
  const color = p?.iv_percent === 100 ? c.accent : p?.iv_percent === 0 ? c.blue : hasRankOne(p) ? c.green : c.muted;
  return h('span', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center', width: size, height: size,
    flexShrink: 0, background: c.raised, color: c.fg, border: `2px solid ${color}`, borderRadius: '50%', fontWeight: 750 },
    children: text(p?.name, 1) || '?' });
}
function openMap(ctx, value) {
  const url = safeMapUrl(value);
  if (url) void ctx.os.openExternal(url).then(ok => { if (!ok) host.notify({ kind: 'warning', message: 'Could not open the map.' }); });
}
function activeSession() {
  return host.state.focusedStoredSessionId.get() || host.state.focusedSessionId.get() || 'new';
}
function useActiveSession() {
  const stored = useValue(host.state.focusedStoredSessionId);
  const runtime = useValue(host.state.focusedSessionId);
  return stored || runtime || 'new';
}
const WATCH_KINDS = { highlights: 'Highlights', hundo: 'Hundos', nundo: 'Nundos', pvp: 'PvP rank #1', iv: 'IV at least' };
function watchScope() { return JSON.stringify([host.state.connectionId?.get() || 'local', host.state.profile.get() || 'default']); }
function watchPrefs(value) {
  return { kind: Object.hasOwn(WATCH_KINDS, value?.kind) ? value.kind : 'highlights',
    minIV: Number.isInteger(value?.minIV) && value.minIV >= 0 && value.minIV <= 100 ? value.minIV : 90 };
}
export function watchQuery(config) {
  const params = { lat: config.center.lat, lon: config.center.lon, radius_m: 500, limit: 50, order: 'priority',
    selection: ['iv', 'hundo', 'nundo'].includes(config.kind) ? 'all' : 'highlights' };
  if (config.kind === 'hundo') params.min_iv = 100;
  if (config.kind === 'nundo') params.max_iv = 0;
  if (config.kind === 'iv') params.min_iv = config.minIV;
  return '/nearby?' + new URLSearchParams(params);
}
export function watchMatches(p, config, now) {
  const distance = distanceBearing(config.center, p), timer = expiry(p, now);
  if (!ID.test(p?.observation_id || '') || !distance || distance.meters > 500 || timer.seconds !== null && timer.seconds <= 0) return false;
  return config.kind === 'hundo' ? p.iv_percent === 100 : config.kind === 'nundo' ? p.iv_percent === 0
    : config.kind === 'pvp' ? hasRankOne(p) : config.kind === 'iv' ? number(p.iv_percent) && p.iv_percent >= config.minIV
      : p.iv_percent === 100 || p.iv_percent === 0 || hasRankOne(p);
}
export function createHuntWatch(ctx, { api, onFound, now = () => Date.now() }) {
  const saved = () => watchPrefs(ctx.storage?.get('watch-preferences:' + watchScope(), null));
  const view = atom({ ...saved(), active: false, busy: false, error: '', lastChecked: null, matched: 0, truncated: false, label: '', notice: '', notificationNote: '' });
  let current = null, alive = true, cancelTimer = null, clearBubble = null;
  const alerts = new Map();
  const patch = changes => view.set({ ...view.get(), ...changes });
  const valid = run => alive && current === run && run.scope === watchScope() && run.epoch === gatewayActivationEpoch();
  function stop(notice = 'Watch stopped.') {
    current = null; cancelTimer?.(); cancelTimer = null; clearBubble?.(); clearBubble = null;
    patch({ active: false, busy: false, notice });
  }
  function configure(value) {
    if (current) return;
    const prefs = watchPrefs(value); patch(prefs);
    ctx.storage?.set('watch-preferences:' + watchScope(), prefs);
  }
  async function poll() {
    const run = current;
    if (!run || !valid(run) || view.get().busy) return;
    patch({ busy: true });
    try {
      const data = await api(watchQuery(run));
      if (!valid(run)) return;
      const matches = [...new Map((Array.isArray(data.observations) ? data.observations : [])
        .filter(p => watchMatches(p, run, now())).map(p => [p.observation_id, p])).values()].slice(0, 50);
      const fresh = matches.filter(p => !run.seen.has(p.observation_id));
      patch({ busy: false, error: '', lastChecked: now(), matched: matches.length, truncated: !!data.truncated,
        notice: matches.length ? `${matches.length} matching ${matches.length === 1 ? 'catch' : 'catches'} in the latest read.` : 'No matching catches in the latest read.' });
      const alertKey = run.scope + ':' + run.kind;
      if (!fresh.length || now() - (alerts.get(alertKey) ?? -Infinity) < 120000) return;
      alerts.set(alertKey, now());
      // IDs are catch observations, not species. Keep bounded memory for a long-running watch.
      for (const p of fresh) run.seen.add(p.observation_id);
      while (run.seen.size > 1024) run.seen.delete(run.seen.values().next().value);
      const names = fresh.slice(0, 2).map(p => `${text(p.name, 35)} (${metric(p)})`).join(', ');
      const body = `Found ${fresh.length} ${fresh.length === 1 ? 'match' : 'matches'} near ${run.label}: ${names}${fresh.length > 2 ? ` +${fresh.length - 2} more` : ''}.`;
      patch({ notice: body });
      clearBubble?.(); clearBubble = ctx.pet?.say(body, { id: 'hunt-watch', tone: 'info', ttlMs: 10000 });
      host.notify({ kind: 'info', message: body });
      // Hosts may deliver through an asynchronous bridge. A notification failure is not a failed data read.
      void Promise.resolve().then(() => {
        if (!valid(run)) return;
        return ctx.os?.notify?.({ title: 'PokeIt Hunt Watch', body, onActivate: () => {
          if (alive && run.scope === watchScope() && run.epoch === gatewayActivationEpoch()) onFound(run.sid, fresh[0], run.center);
        } });
      }).catch(() => { if (valid(run)) patch({ notificationNote: 'OS alerts are unavailable. Your matches are shown here.' }); });
    } catch (e) {
      if (valid(run)) patch({ busy: false, error: text(e.message, 240), notice: 'Could not check. Trying again in about a minute.' });
    }
  }
  function start(sid, center, label) {
    if (!alive || ![center?.lat, center?.lon].every(number) || Math.abs(center.lat) > 85 || Math.abs(center.lon) > 180) return false;
    stop('');
    current = { ...watchPrefs(view.get()), sid, center: { ...center }, label: text(label, 80) || 'this spot',
      scope: watchScope(), epoch: gatewayActivationEpoch(), seen: new Set() };
    patch({ active: true, busy: false, error: '', lastChecked: null, matched: 0, truncated: false, label: current.label, notice: 'Checking this spot…', notificationNote: '' });
    cancelTimer = ctx.setInterval(() => { void poll(); }, 60000);
    void poll(); return true;
  }
  function reset() { stop(''); patch({ ...saved(), label: '', lastChecked: null, error: '', notice: '', notificationNote: '' }); }
  const subscriptions = [host.state.profile.subscribe(reset), host.state.connectionId?.subscribe(reset)].filter(Boolean);
  ctx.onEvent('gateway.ready', reset);
  ctx.onDispose(() => { stop(''); alive = false; subscriptions.forEach(unsubscribe => unsubscribe()); alerts.clear(); });
  return { view, start, stop, configure, poll };
}
export function createController(ctx) {
  const revision = atom(0), clock = atom(Date.now()), sessions = new Map();
  let alive = true, lastError = '', healthy = null;
  const key = sid => sid || activeSession();
  const state = sid => {
    const id = key(sid);
    if (!sessions.has(id)) {
      if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
      sessions.set(id, empty());
    }
    return sessions.get(id);
  };
  const update = (sid, patch) => { Object.assign(state(sid), patch); revision.set(revision.get() + 1); };
  async function api(path) {
    const epoch = gatewayActivationEpoch();
    try {
      const response = await ctx.rest(path);
      if (!alive || epoch !== gatewayActivationEpoch()) throw Object.assign(new Error('Connection changed. Refresh to use the current connection.'), { safeMessage: true });
      if (!response?.ok) throw Object.assign(new Error(response?.error?.message || 'PokeIt is temporarily unavailable.'), { safeMessage: true });
      healthy = true; return response.data;
    } catch (e) {
      healthy = false; lastError = e?.safeMessage ? text(e.message, 240) : 'The PokeIt backend could not be reached. Check that the plugin is enabled on the connected gateway.';
      throw new Error(lastError);
    }
  }
  async function read(sid, center, label, radius) {
    const s = state(sid), generation = s.generation + 1;
    update(sid, { center, label, radius, busy: true, error: '', generation, observations: [], selected: null, queriedAt: null, coverage: null });
    try {
      const params = new URLSearchParams({ lat: center.lat, lon: center.lon, radius_m: radius, limit: 50, selection: 'highlights' });
      const [result, coverage] = await Promise.all([api('/nearby?' + params),
        api('/coverage?' + new URLSearchParams(center)).catch(() => null)]);
      if (!alive || state(sid).generation !== generation) return;
      const observations = (Array.isArray(result.observations) ? result.observations : []).slice(0, 50);
      if (!observations.length && result.highest_observed_iv) observations.push(result.highest_observed_iv);
      update(sid, { observations, coverage, queriedAt: result.queried_at, truncated: !!result.truncated,
        candidates: result.observed_candidates_in_radius, quietPick: !result.observations?.length && !!result.highest_observed_iv,
        busy: false, selected: observations[0]?.observation_id || null });
    } catch (e) { if (alive && state(sid).generation === generation) update(sid, { busy: false, error: e.message }); }
  }
  function adopt(sid, observation, origin) {
    const s = state(sid), far = s.center && distanceBearing(s.center, observation)?.meters > s.radius;
    const center = origin || (!far && s.center) || { lat: observation.lat, lon: observation.lon };
    const moved = !s.center || distanceBearing(s.center, center)?.meters > 5;
    // A late refresh from the previous point must not undo this explicit selection.
    update(sid, { generation: s.generation + 1, busy: false, error: '' });
    if (moved) update(sid, { center, label: origin ? 'Search point' : text(observation.name, 60), queriedAt: new Date().toISOString(), coverage: null });
    const targetDistance = distanceBearing(center, observation)?.meters || 0;
    if (targetDistance > s.radius) update(sid, { radius: [250, 500, 1000, 2000].find(n => n >= targetDistance) || 2000 });
    const list = moved ? [] : s.observations.filter(p => p.observation_id !== observation.observation_id);
    update(sid, { observations: [observation, ...list].slice(0, 50), selected: observation.observation_id });
  }
  function reset() { sessions.clear(); revision.set(revision.get() + 1); healthy = null; }
  ctx.setInterval(() => clock.set(Date.now()), 1000);
  const unsub = host.state.profile.subscribe(reset);
  ctx.onEvent('gateway.ready', reset);
  ctx.onDispose(() => { alive = false; unsub(); sessions.clear(); });
  async function debug() {
    let health;
    try { health = await api('/health'); } catch { health = { reachable: false }; }
    const report = { plugin: 'PokeIt', version: VERSION, desktop_gateway: host.state.gateway.get(),
      backend: health, last_error: lastError || null, checked_at: new Date().toISOString() };
    const ok = await ctx.os.writeClipboard(JSON.stringify(report, null, 2));
    host.notify({ kind: ok ? 'info' : 'warning', message: ok ? 'PokeIt debug info copied. No location or chat text included.' : 'Could not copy debug info.' });
  }
  const controller = { ctx, revision, clock, state, update, api, read, adopt, debug, healthy: () => healthy };
  controller.watch = createHuntWatch(ctx, { api, onFound: (sid, observation, center) => showInRadar(controller, sid, observation, center) });
  return controller;
}
function useRadar(ctrl, sid) { useValue(ctrl.revision); return ctrl.state(sid); }
async function draft(textValue, sid = null) {
  const ok = await host.composer.insertText(sid, textValue, { mode: 'block' });
  if (!ok) host.notify({ kind: 'warning', message: 'Open this chat to add the question.' });
}
function openRadar(ctrl, sid) {
  host.openWorkspace('pokeit:radar', { title: 'PokeIt Radar', minWidth: 320, render: () => h(RadarPane, { ctrl, sessionId: sid }) });
}
export function showInRadar(ctrl, sid, observation, center) {
  ctrl.adopt(sid, observation, center);
  openRadar(ctrl, sid);
}
export function followUpQuestion(kind, s) {
  if (!s.center) return null;
  const place = s.label && !['Choose a spot', 'Search point'].includes(s.label) ? `near ${s.label}` : 'near this selected map pin';
  const names = [...new Set(s.observations.map(p => text(p.name, 60)).filter(Boolean))].slice(0, 3);
  const question = kind === 'raids' ? `What active raids are ${place}? Keep eggs separate.`
    : kind === 'gyms' ? `Which gyms ${place} have open slots?`
    : `Which active events make ${names.length ? names.join(', ') : 'these catches'} useful today ${place}?`;
  return `${question} Use this search area: ${mapUrl(s.center, s.radius)}`;
}
function FollowUps({ ctrl, c, sid }) {
  const s = useRadar(ctrl, sid);
  return hs('div', { style: { ...rowStyle, marginTop: 12 }, children: [
    ['Raids nearby', 'raids'], ['Open gyms', 'gyms'], ['Events today', 'events']
  ].map(([label, kind]) => h(Button, { c, disabled: !s.center, onClick: () => {
    const question = followUpQuestion(kind, ctrl.state(sid));
    if (question) void draft(question, sid);
  }, children: label }, label)) });
}
function HuntWatch({ ctrl, c, sid, center, label }) {
  const w = useValue(ctrl.watch.view), id = useId();
  return hs('section', { 'aria-label': 'Hunt Watch', style: { ...panel(c), marginTop: 14 }, children: [
    h('strong', { children: 'Hunt Watch' }),
    h('p', { style: fine(c), children: w.active ? `Watching ${w.label} · 500 m` : 'Watch this spot for worthwhile catches.' }),
    h('label', { htmlFor: id, style: fine(c), children: 'Alert me about' }),
    h('select', { id, value: w.kind, disabled: w.active, onChange: e => ctrl.watch.configure({ ...w, kind: e.target.value }),
      style: { width: '100%', background: c.raised, color: c.fg, border: `1px solid ${c.line}`, borderRadius: 8, padding: 8, marginTop: 4 },
      children: Object.entries(WATCH_KINDS).map(([value, name]) => h('option', { value, children: name }, value)) }),
    w.kind === 'iv' && hs('label', { style: { ...fine(c), display: 'block', marginTop: 8 }, children: ['Minimum IV % ',
      h('input', { type: 'number', min: 0, max: 100, step: 1, value: w.minIV, disabled: w.active,
        onChange: e => ctrl.watch.configure({ ...w, minIV: Number(e.target.value) }),
        style: { width: 65, background: c.raised, color: c.fg, border: `1px solid ${c.line}`, borderRadius: 6, padding: 6 } })] }),
    h(Button, { c, primary: !w.active, style: { marginTop: 10 }, disabled: !w.active && !center,
      onClick: () => w.active ? ctrl.watch.stop() : ctrl.watch.start(sid, center, label), children: w.active ? 'Stop watch' : 'Watch this spot' }),
    h('p', { role: 'status', style: fine(c), children: w.busy ? 'Checking existing observations…' : w.notice }),
    w.error && h(ErrorNote, { c, message: w.error }),
    w.notificationNote && h('p', { style: fine(c), children: w.notificationNote }),
    w.truncated && h('p', { style: fine(c), children: 'This read is a limited sample; other matches may be missing.' }),
    h('small', { style: fine(c), children: 'Checks existing data about once a minute. No scans start. Stops when you change profile or connection. OS alerts appear when Hermes is in the background.' })
  ] });
}
function CatchSummary({ ctrl, c, p, center, sid, compact = false }) {
  const now = useValue(ctrl.clock), timer = expiry(p, now);
  const rank = rankLabel(p);
  return hs('div', { style: { minWidth: 0 }, children: [
    hs('div', { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [
      h(Initial, { c, p }),
      hs('div', { style: { flex: 1, minWidth: 0 }, children: [
        h('strong', { style: { display: 'block', fontSize: 15 }, children: text(p.name, 80) || 'Pokémon' }),
        p.form_name && h('span', { style: fine(c), children: text(p.form_name, 60) }),
        h('div', { style: fine(c), children: `${metric(p)}${number(p.cp) ? ' · CP ' + p.cp : ''}` }),
        h('div', { style: fine(c), children: distanceLabel(center, p) })
      ] }),
      hs('div', { style: { textAlign: 'right', flexShrink: 0 }, children: [
        h('strong', { style: { display: 'block', fontSize: 17, fontVariantNumeric: 'tabular-nums', color: timer.low ? c.red : c.fg }, children: timer.label }),
        h('small', { style: fine(c), children: timer.seconds > 0 ? (p.expiry_verified ? 'left' : 'estimated left') : '' })
      ] })
    ] }),
    !compact && h('div', { style: { ...fine(c), marginTop: 7 }, children: `Attack / Defense / Stamina: ${[p.iv_attack, p.iv_defense, p.iv_stamina].map(v => number(v) ? v : '?').join(' / ')}` }),
    rank && h('div', { style: { color: c.green, fontSize: 12, marginTop: 5 }, children: rank }),
    hs('div', { style: { ...rowStyle, marginTop: 10 }, children: [
      h(Button, { c, primary: true, disabled: !safeMapUrl(p.map_url), onClick: () => openMap(ctrl.ctx, p.map_url), children: 'Open live map ↗' }),
      !compact && h(Button, { c, onClick: () => showInRadar(ctrl, sid, p, center), children: 'Show in Radar' })
    ] })
  ] });
}
function RadarSvg({ ctrl, c, s, sid }) {
  const now = useValue(ctrl.clock), marks = s.observations.filter(p => !expiry(p, now).expired);
  return hs('svg', { viewBox: '0 0 320 320', role: 'img', 'aria-label': `North-up radar, ${s.radius} metre radius from search point`,
    style: { display: 'block', width: '100%', maxHeight: 390, background: c.bg, borderRadius: 12, margin: '12px 0' }, children: [
      h('style', { children: '.pokeit-expiring{animation:pokeit-pulse 1.6s ease-out infinite}@keyframes pokeit-pulse{0%{opacity:.9}100%{opacity:.25}}@media(prefers-reduced-motion:reduce){.pokeit-expiring{animation:none}}' }),
      ...[45, 90, 136].map(r => h('circle', { cx: 160, cy: 160, r, fill: 'none', stroke: c.line, strokeDasharray: r === 136 ? undefined : '3 5' }, r)),
      h('path', { d: 'M160 24V296 M24 160H296', stroke: c.line, strokeDasharray: '2 6' }),
      ...[['N',160,16],['E',308,164],['S',160,314],['W',12,164]].map(([t,x,y]) => h('text', { x, y, textAnchor: 'middle', fill: c.muted, fontSize: 10, children: t }, t)),
      h('text', { x: 163, y: 34, fill: c.muted, fontSize: 9, children: s.radius + ' m' }),
      ...marks.map(p => {
        const d = distanceBearing(s.center, p); if (!d || d.meters > s.radius) return null;
        const a = d.bearing * Math.PI / 180, r = d.meters / s.radius * 136;
        const x = 160 + Math.sin(a) * r, y = 160 - Math.cos(a) * r, selected = s.selected === p.observation_id;
        const color = p.iv_percent === 100 ? c.accent : p.iv_percent === 0 ? c.blue : hasRankOne(p) ? c.green : c.muted;
        const choose = () => ctrl.update(sid, { selected: p.observation_id });
        return hs('g', { role: 'button', tabIndex: 0, 'aria-label': `${text(p.name)} ${metric(p)}, ${Math.round(d.meters)} metres ${d.direction}`,
          onClick: choose, onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }, style: { cursor: 'pointer' }, children: [
            h('title', { children: `${text(p.name)} · ${metric(p)} · ${Math.round(d.meters)} m ${d.direction}` }),
            selected && h('circle', { cx: x, cy: y, r: 19, fill: 'none', stroke: c.accent, strokeWidth: 2 }),
            expiry(p, now).low && h('circle', { cx: x, cy: y, r: 21, fill: 'none', stroke: c.red, className: 'pokeit-expiring' }),
            h('circle', { cx: x, cy: y, r: 12, fill: c.raised, stroke: color, strokeWidth: 2 }),
            h('text', { x, y: y + 4, fill: c.fg, textAnchor: 'middle', fontWeight: 700, fontSize: 11, children: text(p.name, 1) || '?' })
          ] }, p.observation_id);
      }),
      h('circle', { cx: 160, cy: 160, r: 7, fill: c.accent, stroke: c.bg, strokeWidth: 3 }),
      !s.center && h('text', { x: 160, y: 190, fill: c.muted, textAnchor: 'middle', fontSize: 12, children: 'Your next hunt starts here' })
    ] });
}
function RadarPane({ ctrl, sessionId }) {
  const c = useColors(), active = useActiveSession(), sid = sessionId || active, fieldId = useId();
  const s = useRadar(ctrl, sid), now = useValue(ctrl.clock);
  const [query, setQuery] = useState(''), [places, setPlaces] = useState([]), [finding, setFinding] = useState(false), [placeError, setPlaceError] = useState('');
  const selected = s.observations.find(p => p.observation_id === s.selected);
  useEffect(() => { setPlaces([]); setPlaceError(''); setQuery(''); }, [sid]);
  async function locate(e) {
    e.preventDefault(); if (!query.trim() || finding) return;
    const fromSession = sid, fromConnection = gatewayActivationEpoch();
    setFinding(true); setPlaceError(''); setPlaces([]);
    try {
      const result = await ctrl.api('/place?' + new URLSearchParams({ query: query.trim(), limit: 5 }));
      if ((!sessionId && fromSession !== activeSession()) || fromConnection !== gatewayActivationEpoch()) return;
      const rows = Array.isArray(result.results) ? result.results : Array.isArray(result.places) ? result.places : [];
      setPlaces(rows);
      if (!rows.length) setPlaceError('No match yet. Try an address, intersection or landmark and city.');
    } catch (e) { if (sessionId || fromSession === activeSession()) setPlaceError(e.message); } finally { setFinding(false); }
  }
  function choose(p) {
    if (p.requires_specific_location || !number(p.lat) || !number(p.lon)) { setPlaceError('Choose a nearby entrance, address or landmark so this scan covers a useful spot.'); return; }
    setPlaces([]); setPlaceError(''); void ctrl.read(sid, { lat: p.lat, lon: p.lon }, text(p.choice_label || p.label || p.name, 100), s.radius);
  }
  const status = s.coverage?.scan_plan?.status;
  const age = s.queriedAt ? Math.max(0, Math.floor((now - Date.parse(s.queriedAt)) / 1000)) : null;
  return hs('section', { 'aria-label': 'PokeIt Radar', style: { background: c.surface, color: c.fg, padding: 14, overflowY: 'auto', height: '100%', fontFamily: font, boxSizing: 'border-box' }, children: [
    hs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }, children: [
      hs('div', { children: [hs('h2', { style: { fontSize: 19, fontWeight: 800, margin: 0 }, children: ['Poke', h('span', { style: { color: c.accent }, children: 'It' }), ' Radar'] }),
        h('p', { style: { ...fine(c), margin: '4px 0 0' }, children: s.label })] }),
      h(Button, { c, disabled: !s.center || s.busy, onClick: () => void ctrl.read(sid, s.center, s.label, s.radius), children: s.busy ? 'Reading…' : 'Refresh' })
    ] }),
    hs('form', { onSubmit: locate, style: { marginTop: 14 }, children: [
      h('label', { htmlFor: fieldId, style: { ...fine(c), display: 'block', marginBottom: 5 }, children: 'Pick a precise spot' }),
      hs('div', { style: { display: 'flex', gap: 6 }, children: [
        h('input', { id: fieldId, value: query, maxLength: 160, onChange: e => setQuery(e.target.value), placeholder: 'Landmark and city',
          style: { background: c.bg, color: c.fg, border: `1px solid ${c.line}`, borderRadius: 8, padding: '8px 9px', minWidth: 0, width: '100%', font: `13px ${font}` } }),
        h('button', { type: 'submit', disabled: finding, style: { color: c.ink, background: c.accent, border: 0, borderRadius: 8, padding: '0 12px', fontWeight: 700, cursor: 'pointer' }, children: finding ? '…' : 'Find' })
      ] }),
      h(ErrorNote, { c, message: placeError }),
      ...places.map((p, i) => h(Button, { c, style: { width: '100%', marginTop: 6, textAlign: 'left' }, onClick: () => choose(p), children: text(p.choice_label || p.label || p.name, 160) || 'Unnamed location' }, i))
    ] }),
    hs('div', { style: { ...rowStyle, marginTop: 10, justifyContent: 'space-between' }, children: [
      hs('label', { style: fine(c), children: ['Radius ', h('select', { 'aria-label': 'Radar radius', value: s.radius, onChange: e => {
        const radius = Number(e.target.value); if (s.center) void ctrl.read(sid, s.center, s.label, radius); else ctrl.update(sid, { radius });
      }, style: { background: c.raised, color: c.fg, border: `1px solid ${c.line}`, borderRadius: 6, padding: 5 }, children: [100,250,500,1000,2000].map(n => h('option', { value: n, children: n < 1000 ? n + ' m' : n / 1000 + ' km' }, n)) })] }),
      h('span', { style: fine(c), children: 'North up · read only' })
    ] }),
    h(ErrorNote, { c, message: s.error }),
    status === 'needs_scan' && hs('div', { style: { ...panel(c), marginTop: 10, padding: 10 }, children: [
      h('p', { style: { ...fine(c), margin: '0 0 6px' }, children: 'No recent scan here. These are existing observations.' }),
      h(Button, { c, onClick: () => void draft(`Check ${s.label} and scan if needed. Use this selected map pin: ${mapUrl(s.center, s.radius)}`, sid), children: 'Ask Hermes to scan' })
    ] }),
    status === 'in_progress' && h('p', { style: fine(c), children: 'A scan is in progress here. Refresh after it finishes.' }),
    s.queriedAt && !s.coverage && h('p', { style: fine(c), children: 'Coverage freshness could not be checked. These are existing observations.' }),
    h(RadarSvg, { ctrl, c, s, sid }),
    hs('div', { style: { ...rowStyle, justifyContent: 'space-between', ...fine(c) }, children: [
      h('span', { children: `${s.observations.filter(p => !expiry(p, now).expired).length} shown${s.truncated ? ' · limited sample' : ''}` }),
      h('span', { children: age === null ? 'Waiting for a location' : `Read ${age < 60 ? age + 's' : Math.floor(age / 60) + 'm'} ago` })
    ] }),
    s.quietPick && h('p', { style: fine(c), children: 'No highlights returned. Here is the highest observed IV catch.' }),
    s.center && !s.busy && s.queriedAt && !s.observations.length && h('p', { style: fine(c), children: 'No matching catches in this read. Try nearby raids or open the live map.' }),
    selected && h('div', { style: { ...panel(c), background: c.bg, marginTop: 12 }, children: h(CatchSummary, { ctrl, c, p: selected, center: s.center, sid, compact: true }) }),
    s.observations.length > 1 && h('select', { 'aria-label': 'Select a catch', value: s.selected || '', onChange: e => ctrl.update(sid, { selected: e.target.value }),
      style: { marginTop: 8, width: '100%', background: c.raised, color: c.fg, border: `1px solid ${c.line}`, borderRadius: 8, padding: 8 }, children: s.observations.map(p => h('option', { value: p.observation_id, children: `${text(p.name)} · ${metric(p)}` }, p.observation_id)) }),
    s.center && h(Button, { c, style: { width: '100%', marginTop: 12 }, onClick: () => openMap(ctrl.ctx, mapUrl(s.center, s.radius)), children: 'Open full map ↗' }),
    h(FollowUps, { ctrl, c, sid }),
    h(HuntWatch, { ctrl, c, sid, center: s.center, label: s.label }),
    h('p', { style: { ...fine(c), marginTop: 12 }, children: 'The pin is the search point, not your live GPS position. No new scans start in this pane.' }),
    h(Button, { c, style: { background: 'transparent', fontSize: 11 }, onClick: () => void ctrl.debug(), children: 'Copy debug info' })
  ] });
}
function CatchCard({ ctrl, attrs, sid, streaming }) {
  const c = useColors(), args = catchAttributes(attrs), key = args ? JSON.stringify(args) : '';
  const [data, setData] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!key || streaming) return;
    const targetSid = sid || activeSession();
    let current = true; setData(null); setError('');
    ctrl.api('/card?' + new URLSearchParams(JSON.parse(key))).then(d => {
      if (!current) return; setData(d);
      if (d.observation && d.status === 'observed') ctrl.adopt(targetSid, d.observation, d.origin);
    }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [ctrl, key, sid, streaming, retry]);
  if (!args) return h('div', { style: panel(c), children: 'This catch card has an invalid location or identifier.' });
  return hs('article', { 'aria-label': 'PokeIt catch', style: { ...panel(c), maxWidth: 560, margin: '8px 0' }, children: [
    !data && !error && h('p', { style: fine(c), children: streaming ? 'Preparing catch card…' : 'Checking this catch…' }),
    error && hs('div', { children: [h(ErrorNote, { c, message: error }), h(Button, { c, onClick: () => setRetry(v => v + 1), children: 'Try again' })] }),
    data?.observation && h(CatchSummary, { ctrl, c, p: data.observation, center: data.origin, sid }),
    data && data.status !== 'observed' && h('p', { style: fine(c), children: data.status === 'expired' ? 'This catch has passed its verified expiry.' : 'This catch was not in the latest read. It may have expired or be missing from a limited result.' }),
    data?.truncated && h('small', { style: fine(c), children: 'The source returned a limited sample.' })
  ] });
}
function ScanCard({ ctrl, attrs, streaming }) {
  const c = useColors(), id = SCAN_ID.test(attrs?.id || '') ? attrs.id : null;
  const now = useValue(ctrl.clock), [data, setData] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [stoppedAt, setStoppedAt] = useState(null);
  useEffect(() => {
    if (!id || streaming) return;
    let current = true, cancel = () => {}; setError(''); setData(null); setStoppedAt(null);
    async function poll() {
      try {
        const d = await ctrl.api('/scan/' + id); if (!current) return;
        setData(d); const p = scanProgress(d);
        if (!p.terminal) cancel = ctrl.ctx.setTimeout(poll, p.delay * 1000);
        else setStoppedAt(Date.now());
      } catch (e) { if (current) setError(e.message); }
    }
    void poll(); return () => { current = false; cancel(); };
  }, [ctrl, id, streaming, retry]);
  if (!id) return h('div', { style: panel(c), children: 'This scan card has an invalid request identifier.' });
  const p = scanProgress(data), labels = { queued: 'Scouts are working', dispatch_unknown: 'Waiting for scan confirmation', data_refreshed: 'Scan complete', existing_coverage: 'Existing coverage reused', partial_unverified: 'Partial results — some points unverified', failed: 'Scan could not complete' };
  const elapsed = number(data?.created_at) ? Math.max(0, Math.floor(((stoppedAt ?? now) / 1000) - data.created_at)) : null;
  return hs('article', { 'aria-label': 'PokeIt scan progress', style: { ...panel(c), maxWidth: 560, margin: '8px 0' }, children: [
    h('strong', { style: { fontSize: 15 }, children: labels[data?.status] || 'Checking scan status…' }),
    hs('div', { style: { display: 'flex', gap: 16, alignItems: 'center', marginTop: 10 }, children: [
      hs('svg', { viewBox: '0 0 180 154', role: 'img', 'aria-label': p.total ? `${p.done} of ${p.total} points confirmed or covered` : 'Waiting for point counts',
        style: { width: 180, flexShrink: 1 }, children: Array.from({ length: Math.min(p.total || 49, 100) }, (_, i) => {
          const x = 24 + (i % 7) * 21 + (Math.floor(i / 7) % 2) * 10, y = 14 + Math.floor(i / 7) * 21;
          const color = p.total && i < p.done ? c.green : p.total && i >= p.total - p.failed ? c.red : p.total && i >= p.total - p.failed - p.unverified ? c.accent : c.line;
          return h('circle', { cx: x, cy: y, r: 6.5, fill: color }, i);
        }) }),
      hs('div', { children: [
        h('div', { style: { fontSize: 27, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }, children: p.total ? `${p.done}/${p.total}` : '—' }),
        h('div', { style: fine(c), children: 'points confirmed or covered' }),
        elapsed !== null && h('div', { style: fine(c), children: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2,'0')} ${p.terminal ? 'request age at check' : 'elapsed'}` }),
        p.unverified > 0 && h('div', { style: { ...fine(c), color: c.accent }, children: `${p.unverified} unverified` }),
        p.failed > 0 && h('div', { style: { ...fine(c), color: c.red }, children: `${p.failed} failed` })
      ] })
    ] }),
    h('small', { style: fine(c), children: 'Dots show aggregate counts, not the locations of individual scouts.' }),
    h(ErrorNote, { c, message: error }),
    error && h(Button, { c, onClick: () => setRetry(v => v + 1), children: 'Retry status' }),
    data?.map_url && h(Button, { c, style: { marginTop: 10 }, onClick: () => openMap(ctrl.ctx, data.map_url), children: 'Open live map ↗' })
  ] });
}
function StatusChip({ ctrl }) {
  const c = useColors(), sid = useActiveSession();
  const s = useRadar(ctrl, sid), now = useValue(ctrl.clock), watch = useValue(ctrl.watch.view);
  const liveCount = s.observations.filter(p => !expiry(p, now).expired).length;
  return h('button', { type: 'button', title: 'Open PokeIt Radar', style: { font: `600 11px ${font}`, cursor: 'pointer', color: 'var(--ui-text-secondary)', background: 'transparent', border: 0, padding: '2px 6px' },
    onClick: () => openRadar(ctrl, sid),
    children: hs('span', { children: ['Poke', h('span', { style: { color: c.accent }, children: 'It' }), watch.active ? ' · watching' : s.busy ? ' · reading' : liveCount ? ` · ${liveCount} nearby` : ' · Radar'] }) });
}

export default {
  id: 'pokeit', name: 'PokeIt Radar',
  register(ctx) {
    const ctrl = createController(ctx);
    ctx.register({ id: 'radar', area: PANES_AREA, title: 'PokeIt Radar', data: { placement: 'right', width: '350px' }, render: () => h(RadarPane, { ctrl }) });
    ctx.register({ id: 'status', area: STATUSBAR_AREAS.right, order: 130, render: () => h(StatusChip, { ctrl }) });
    ctx.register({ id: 'catch', area: TRANSCRIPT_DIRECTIVE_AREA, data: { name: 'pokeit-catch', render: ({ attrs, sessionId, streaming }) => h(CatchCard, { ctrl, attrs, sid: sessionId, streaming }) } });
    ctx.register({ id: 'scan', area: TRANSCRIPT_DIRECTIVE_AREA, data: { name: 'pokeit-scan', render: ({ attrs, streaming }) => h(ScanCard, { ctrl, attrs, streaming }) } });
  }
};
