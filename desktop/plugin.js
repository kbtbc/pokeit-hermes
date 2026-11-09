import { host, atom, useValue, useTheme, gatewayActivationEpoch, PANES_AREA, STATUSBAR_AREAS, TRANSCRIPT_DIRECTIVE_AREA } from '@hermes/plugin-sdk';
import * as sdk from '@hermes/plugin-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { jsx as h, jsxs as hs } from 'react/jsx-runtime';

const VERSION = '0.1.17';
const ORIGIN = 'https://pokeit.cc';
const ID = /^pid_[A-Za-z0-9_-]{1,96}$/;
const SCAN_ID = /^[A-Za-z0-9_-]{32}$/;
const ICON = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;
// The sandboxed frame arrived in a later Desktop; older hosts keep the drawn radar.
const Frame = sdk.SandboxedFrame || null;
const TERMINAL = new Set(['data_refreshed', 'existing_coverage', 'partial_unverified', 'failed']);
const RADII = [100, 250, 500, 1000, 2000];
const EXAMPLES = ['Alpharetta City Hall, Georgia', 'Bethesda Terrace in Central Park, New York', 'Pike Place Market, Seattle'];
const FORT_ID = /^[A-Za-z0-9._-]{1,80}$/;
const empty = () => ({ center: null, label: 'Choose a spot', radius: 500, observations: [], gyms: [], stops: [], selected: null,
  queriedAt: null, coverage: null, busy: false, error: '', truncated: false, generation: 0 });
const text = (s, n = 180) => typeof s === 'string' ? s.slice(0, n) : '';
const number = n => typeof n === 'number' && Number.isFinite(n);
const named = label => label && !['Choose a spot', 'Search point'].includes(label) ? label : '';

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
// The place name is display text only; it never reaches the service.
export function placeName(attrs) {
  return typeof attrs?.place === 'string' ? attrs.place.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';
}
// Only the exact word "compact" changes the card; anything else is the full card.
export function catchVariant(attrs) { return attrs?.variant === 'compact' ? 'compact' : 'full'; }
const mmss = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
// A walking guide: straight line at 5 km/h against the time left. Measured from the search point, not from the player.
export function walkVerdict(meters, seconds, verified = true) {
  if (!number(meters) || !number(seconds) || seconds <= 0) return null;
  const walk = meters < 10 ? 0 : Math.max(1, Math.round(meters / (5000 / 60))), spare = seconds / 60 - walk;
  const left = (verified ? '' : '~') + mmss(seconds), on = walk === 0 ? 'Right here' : `${walk} min on foot`, short = walk === 0 ? 'right here' : `${walk} min`;
  if (spare >= 3) return { tone: 'ok', label: 'Worth the walk', detail: `${on}, ${verified ? '' : '~'}${Math.floor(spare)} min to spare`, note: `Worth it: ${short}, ${left} left` };
  if (spare >= 0) return { tone: 'tight', label: 'Tight', detail: `${on}, ${left} left`, note: `Tight: ${short}, ${left} left` };
  return { tone: 'far', label: 'Probably too far', detail: `${on}, only ${left} left`, note: `Too far: ${short}, ${left} left` };
}
export function iconKey(p) {
  if (!Number.isInteger(p?.pokemon_id) || p.pokemon_id < 1 || p.pokemon_id > 4999) return null;
  return p.pokemon_id + (Number.isInteger(p.form) && p.form > 0 && p.form < 10000 ? '_' + p.form : '');
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
function amount(meters) { return meters < 1000 ? Math.round(meters) + ' m' : (meters / 1000).toFixed(1) + ' km'; }
function distanceLabel(center, p, place) {
  const d = distanceBearing(center, p);
  if (!d) return 'Distance unknown';
  if (d.meters < 10) return place ? `At ${place}` : 'At the search point';
  return `${amount(d.meters)} ${d.direction} of ${place || 'the search point'}`;
}
// What a catch card can still say when the PokeIt backend is unreachable: only what the directive carried.
export function offlineCatch(args, place) {
  if (!args) return null;
  const origin = number(args.origin_lat) && number(args.origin_lon) ? { lat: args.origin_lat, lon: args.origin_lon } : null;
  const where = origin ? distanceLabel(origin, args, place) : place ? `Near ${place}` : 'At the pin the agent chose';
  return { where, mapLink: mapUrl({ lat: args.lat, lon: args.lon }, 250) };
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
const CSS = '@keyframes pokeit-pulse{0%,100%{opacity:1}50%{opacity:.35}}.pokeit-pulse{animation:pokeit-pulse 1.4s ease-in-out infinite}'
  + '@media(prefers-reduced-motion:reduce){.pokeit-pulse{animation:none}}';
const Styles = () => h('style', { children: CSS });
function Button({ c, children, primary, style, ...props }) {
  return h('button', { type: 'button', ...props, style: { font: `600 12px ${font}`, borderRadius: 8,
    padding: '8px 11px', border: `1px solid ${primary ? c.accent : c.line}`, background: primary ? c.accent : c.raised,
    color: primary ? c.ink : c.fg, cursor: props.disabled ? 'default' : 'pointer', opacity: props.disabled ? .6 : 1, ...style }, children });
}
function ErrorNote({ c, message }) {
  return h('p', { role: 'alert', style: { margin: '8px 0', color: c.red, fontSize: 12 } , children: message });
}
// What makes a catch worth the walk: hundo, nundo or a PvP rank 1. Null for an ordinary catch.
function highlight(p, c) {
  if (p?.iv_percent === 100) return { label: 'Hundo', color: c.accent };
  if (p?.iv_percent === 0) return { label: 'Nundo', color: c.blue };
  return hasRankOne(p) ? { label: 'PvP #1', color: c.green } : null;
}
// Species art from the PokeIt map's icon set, loaded through the gateway. A letter stands in when there is none.
function Mon({ ctrl, c, p, size = 56, dim = false }) {
  useValue(ctrl.iconRev);
  const url = ctrl.icon(p), ring = highlight(p, c)?.color || c.line, art = size - 8;
  return h('span', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center', width: size, height: size, flexShrink: 0,
    boxSizing: 'border-box', background: c.raised, border: `2px solid ${ring}`, borderRadius: Math.round(size * .3), overflow: 'hidden',
    fontWeight: 750, color: c.fg, filter: dim ? 'grayscale(1)' : undefined, opacity: dim ? .6 : 1 },
    children: url ? h('img', { alt: '', src: url, width: art, height: art, draggable: false, style: { display: 'block' } })
      : url === null ? text(p?.name, 1) || '?' : null });
}
function Arrow({ c, degrees }) {
  return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, style: { flexShrink: 0, transform: `rotate(${degrees}deg)` },
    children: h('path', { d: 'M6 .5 10.5 11 6 8.4 1.5 11Z', fill: c.accent }) });
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
  const view = atom({ ...saved(), active: false, busy: false, error: '', lastChecked: null, matched: 0, matches: [], fresh: [], center: null, truncated: false, label: '', notice: '', notificationNote: '' });
  let current = null, alive = true, cancelTimer = null, clearBubble = null;
  const alerts = new Map();
  const patch = changes => view.set({ ...view.get(), ...changes });
  const valid = run => alive && current === run && run.scope === watchScope() && run.epoch === gatewayActivationEpoch();
  function stop(notice = 'Watch stopped.') {
    current = null; cancelTimer?.(); cancelTimer = null; clearBubble?.(); clearBubble = null;
    patch({ active: false, busy: false, notice, matches: [], fresh: [], center: null });
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
      // The map shows every match; the ones that were not in the previous read are marked new.
      const arrived = run.shown ? matches.filter(p => !run.shown.has(p.observation_id)).map(p => p.observation_id) : [];
      run.shown = new Set(matches.map(p => p.observation_id));
      patch({ busy: false, error: '', lastChecked: now(), matched: matches.length, matches, fresh: arrived, truncated: !!data.truncated,
        notice: matches.length ? `${matches.length} matching ${matches.length === 1 ? 'catch' : 'catches'} in the latest read.` : 'No matching catches in the latest read.' });
      const alertKey = run.scope + ':' + run.kind;
      if (!fresh.length || now() - (alerts.get(alertKey) ?? -Infinity) < 120000) return;
      alerts.set(alertKey, now());
      // IDs are catch observations, not species. Keep bounded memory for a long-running watch.
      for (const p of fresh) run.seen.add(p.observation_id);
      while (run.seen.size > 1024) run.seen.delete(run.seen.values().next().value);
      const names = fresh.slice(0, 2).map(p => `${text(p.name, 35)} (${metric(p)})`).join(', ');
      const body = `Found ${fresh.length} ${fresh.length === 1 ? 'match' : 'matches'} near ${run.label}: ${names}${fresh.length > 2 ? ` +${fresh.length - 2} more` : ''}.`;
      const title = fresh.length === 1 ? `PokeIt: ${text(fresh[0].name, 35) || 'a catch'} nearby` : `PokeIt: ${fresh.length} catches nearby`;
      patch({ notice: body });
      clearBubble?.(); clearBubble = ctx.pet?.say(body, { id: 'hunt-watch', tone: 'info', ttlMs: 10000 });
      host.notify({ kind: 'info', message: body });
      // Hosts may deliver through an asynchronous bridge. A notification failure is not a failed data read.
      void Promise.resolve().then(() => {
        if (!valid(run)) return;
        return ctx.os?.notify?.({ title, body, onActivate: () => {
          if (alive && run.scope === watchScope() && run.epoch === gatewayActivationEpoch()) onFound(run.sid, fresh[0], run.center, run.label);
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
    patch({ active: true, busy: false, error: '', lastChecked: null, matched: 0, matches: [], fresh: [], center: { ...center }, truncated: false, label: current.label, notice: 'Checking this spot…', notificationNote: '' });
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
  const revision = atom(0), clock = atom(Date.now()), iconRev = atom(0), sessions = new Map();
  const icons = new Map(), iconQueue = [];
  let alive = true, lastError = '', healthy = null, iconsBusy = 0;
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
  async function api(path, quiet = false) {
    const epoch = gatewayActivationEpoch();
    try {
      const response = await ctx.rest(path);
      if (!alive || epoch !== gatewayActivationEpoch()) throw Object.assign(new Error('Connection changed. Refresh to use the current connection.'), { safeMessage: true });
      if (!response?.ok) throw Object.assign(new Error(response?.error?.message || 'PokeIt is temporarily unavailable.'), { safeMessage: true });
      if (!quiet) healthy = true;
      return response.data;
    } catch (e) {
      const message = e?.safeMessage ? text(e.message, 240) : 'PokeIt could not be reached. Enable the plugin for the profile you are chatting in (Capabilities, then Plugins), then try again.';
      // Icons are decoration; a failed one must not mark the backend unhealthy.
      if (!quiet) { healthy = false; lastError = message; }
      throw new Error(message);
    }
  }
  // Icons arrive one species at a time, a few at once. undefined = loading, null = none, string = image.
  function pumpIcons() {
    while (alive && iconsBusy < 3 && iconQueue.length) {
      const [k, path] = iconQueue.shift(); iconsBusy++;
      api(path, true).then(d => icons.set(k, typeof d?.url === 'string' && d.url.length < 120000 && ICON.test(d.url) ? d.url : null), () => icons.set(k, null))
        .finally(() => { iconsBusy--; iconRev.set(iconRev.get() + 1); pumpIcons(); });
    }
  }
  function icon(p) {
    const k = iconKey(p); if (!k) return null;
    if (!icons.has(k)) { icons.set(k, undefined); iconQueue.push([k, `/icon/${p.pokemon_id}${k.includes('_') ? '?form=' + p.form : ''}`]); pumpIcons(); }
    return icons.get(k);
  }
  // The map viewer page comes from this plugin's own backend once. undefined = not asked, null = no map (older host or install).
  let mapShell = Frame ? undefined : null, mapAsked = false;
  function mapDocument() {
    if (mapShell === undefined && !mapAsked) {
      mapAsked = true;
      api('/map', true).then(d => { mapShell = typeof d?.document === 'string' && typeof d.state_slot === 'string' && d.document.includes(d.state_slot) ? d : null; },
        () => { mapShell = null; }).finally(() => revision.set(revision.get() + 1));
    }
    return mapShell;
  }
  function lastSpot() {
    const v = ctx.storage?.get('last-spot:' + watchScope(), null);
    return v && number(v.lat) && number(v.lon) && Math.abs(v.lat) <= 85 && Math.abs(v.lon) <= 180 && typeof v.label === 'string' && RADII.includes(v.radius)
      ? { center: { lat: v.lat, lon: v.lon }, label: text(v.label, 100), radius: v.radius } : null;
  }
  // Pokestops and gyms are the map's landmarks. A read of existing data; a failure only leaves the map plainer.
  async function loadForts(sid, center, radius, generation) {
    if (mapShell === null) return;
    try {
      const d = await api('/forts?' + new URLSearchParams({ lat: center.lat, lon: center.lon, radius_m: radius }), true);
      if (!alive || state(sid).generation !== generation) return;
      const rows = list => (Array.isArray(list) ? list : []).filter(f => FORT_ID.test(f?.id || '') && number(f.lat) && number(f.lon)).slice(0, 50);
      update(sid, { gyms: rows(d.gyms), stops: rows(d.stops) });
    } catch { /* decoration only */ }
  }
  async function read(sid, center, label, radius) {
    const s = state(sid), generation = s.generation + 1;
    update(sid, { center, label, radius, busy: true, error: '', generation, observations: [], gyms: [], stops: [], selected: null, queriedAt: null, coverage: null });
    try {
      const params = new URLSearchParams({ lat: center.lat, lon: center.lon, radius_m: radius, limit: 50, selection: 'highlights' });
      void loadForts(sid, center, radius, generation);
      const [result, coverage] = await Promise.all([api('/nearby?' + params),
        api('/coverage?' + new URLSearchParams(center)).catch(() => null)]);
      if (!alive || state(sid).generation !== generation) return;
      const observations = (Array.isArray(result.observations) ? result.observations : []).slice(0, 50);
      if (!observations.length && result.highest_observed_iv) observations.push(result.highest_observed_iv);
      update(sid, { observations, coverage, queriedAt: result.queried_at, truncated: !!result.truncated,
        candidates: result.observed_candidates_in_radius, quietPick: !result.observations?.length && !!result.highest_observed_iv,
        busy: false, selected: observations[0]?.observation_id || null });
      ctx.storage?.set('last-spot:' + watchScope(), { lat: center.lat, lon: center.lon, label: text(label, 100), radius });
    } catch (e) { if (alive && state(sid).generation === generation) update(sid, { busy: false, error: e.message }); }
  }
  function adopt(sid, observation, origin, place, pick = true) {
    const s = state(sid), far = s.center && distanceBearing(s.center, observation)?.meters > s.radius;
    const center = origin || (!far && s.center) || { lat: observation.lat, lon: observation.lon };
    const moved = !s.center || distanceBearing(s.center, center)?.meters > 5;
    // A late refresh from the previous point must not undo this explicit selection.
    update(sid, { generation: s.generation + 1, busy: false, error: '' });
    if (moved) update(sid, { center, gyms: [], stops: [], label: text(place, 80) || (origin ? 'Search point' : text(observation.name, 60)), queriedAt: new Date().toISOString(), coverage: null });
    const targetDistance = distanceBearing(center, observation)?.meters || 0;
    if (targetDistance > s.radius) update(sid, { radius: [250, 500, 1000, 2000].find(n => n >= targetDistance) || 2000 });
    const list = moved ? [] : s.observations.filter(p => p.observation_id !== observation.observation_id);
    const keep = !pick && !moved && s.observations.some(p => p.observation_id === s.selected);
    update(sid, { observations: (keep ? [...list, observation] : [observation, ...list]).slice(0, 50), selected: keep ? s.selected : observation.observation_id });
    if (moved) void loadForts(sid, center, state(sid).radius, state(sid).generation);
  }
  function reset() { sessions.clear(); icons.clear(); iconQueue.length = 0; if (Frame) { mapShell = undefined; mapAsked = false; } revision.set(revision.get() + 1); healthy = null; }
  ctx.setInterval(() => clock.set(Date.now()), 1000);
  const unsub = host.state.profile.subscribe(reset);
  ctx.onEvent('gateway.ready', reset);
  ctx.onDispose(() => { alive = false; unsub(); sessions.clear(); icons.clear(); });
  async function debug() {
    let health;
    try { health = await api('/health'); } catch { health = { reachable: false }; }
    const report = { plugin: 'PokeIt', version: VERSION, desktop_gateway: host.state.gateway.get(),
      backend: health, last_error: lastError || null, checked_at: new Date().toISOString() };
    const ok = await ctx.os.writeClipboard(JSON.stringify(report, null, 2));
    host.notify({ kind: ok ? 'info' : 'warning', message: ok ? 'PokeIt debug info copied. No location or chat text included.' : 'Could not copy debug info.' });
  }
  const controller = { ctx, revision, clock, iconRev, state, update, api, read, adopt, icon, lastSpot, mapDocument, debug, healthy: () => healthy };
  controller.watch = createHuntWatch(ctx, { api, onFound: (sid, observation, center, label) => showInRadar(controller, sid, observation, center, label) });
  return controller;
}
function useRadar(ctrl, sid) { useValue(ctrl.revision); return ctrl.state(sid); }
async function draft(textValue, sid = null) {
  const ok = await host.composer.insertText(sid, textValue, { mode: 'block' });
  if (!ok) host.notify({ kind: 'warning', message: 'Open this chat to add the question.' });
}
// The map docks beside the chat. Once the player closes it, answers stop reopening it until they ask for it again.
let closedByPlayer = false;
function openRadar(ctrl, sid, byPlayer = true) {
  if (byPlayer) closedByPlayer = false; else if (closedByPlayer) return;
  host.openWorkspace('pokeit:radar', { title: 'PokeIt Radar', minWidth: '22rem', dock: { pane: 'workspace', pos: 'right' },
    render: () => h(RadarPane, { ctrl, sessionId: sid }), onClose: () => { closedByPlayer = true; } });
}
export function showInRadar(ctrl, sid, observation, center, place) {
  ctrl.adopt(sid, observation, center, place);
  openRadar(ctrl, sid);
}
export function followUpQuestion(kind, s) {
  if (!s.center) return null;
  const place = s.label && !['Choose a spot', 'Search point'].includes(s.label) ? `near ${s.label}` : 'near this selected map pin';
  const names = [...new Set(s.observations.map(p => text(p.name, 60)).filter(Boolean))].slice(0, 3);
  const question = kind === 'catches' ? `What is worth catching ${place}? Show PokeIt cards.`
    : kind === 'raids' ? `What active raids are ${place}? Keep eggs separate.`
    : kind === 'gyms' ? `Which gyms ${place} have open slots?`
    : `Which active events make ${names.length ? names.join(', ') : 'these catches'} useful today ${place}?`;
  return `${question} Use this search area: ${mapUrl(s.center, s.radius)}`;
}
function FollowUps({ ctrl, c, sid }) {
  const s = useRadar(ctrl, sid);
  return hs('div', { style: { ...rowStyle, marginTop: 14 }, children: [
    ['Best catches', 'catches'], ['Raids nearby', 'raids'], ['Open gyms', 'gyms'], ['Events today', 'events']
  ].map(([label, kind]) => h(Button, { c, disabled: !s.center, onClick: () => {
    const question = followUpQuestion(kind, ctrl.state(sid));
    if (question) void draft(question, sid);
  }, children: label }, label)) });
}
function HuntWatch({ ctrl, c, sid, center, label }) {
  const w = useValue(ctrl.watch.view);
  const field = { background: c.raised, color: c.fg, border: `1px solid ${c.line}`, borderRadius: 8, padding: '7px 8px', font: `12px ${font}` };
  const status = w.busy ? 'Checking existing observations…'
    : w.active ? `Watching ${w.label} · 500 m. ${w.notice}` : w.notice || 'Alerts you to new catches at this spot. It reads existing data about once a minute and never starts a scan.';
  return hs('section', { 'aria-label': 'Hunt Watch', style: { marginTop: 16, paddingTop: 12, borderTop: `1px solid ${c.line}` }, children: [
    hs('div', { style: { ...rowStyle, gap: 6 }, children: [
      h('strong', { style: { fontSize: 12, marginRight: 4 }, children: 'Hunt Watch' }),
      h('select', { 'aria-label': 'Alert me about', value: w.kind, disabled: w.active, onChange: e => ctrl.watch.configure({ ...w, kind: e.target.value }),
        style: { ...field, flex: '1 1 120px', minWidth: 0 }, children: Object.entries(WATCH_KINDS).map(([value, name]) => h('option', { value, children: name }, value)) }),
      w.kind === 'iv' && h('input', { 'aria-label': 'Minimum IV %', type: 'number', min: 0, max: 100, step: 1, value: w.minIV, disabled: w.active,
        onChange: e => ctrl.watch.configure({ ...w, minIV: Number(e.target.value) }), style: { ...field, width: 58 } }),
      h(Button, { c, primary: !w.active, disabled: !w.active && !center, onClick: () => w.active ? ctrl.watch.stop() : ctrl.watch.start(sid, center, label), children: w.active ? 'Stop' : 'Watch' })
    ] }),
    h('p', { role: 'status', style: { ...fine(c), margin: '6px 0 0' }, children: status }),
    w.error && h(ErrorNote, { c, message: w.error }),
    w.notificationNote && h('p', { style: fine(c), children: w.notificationNote }),
    w.truncated && h('p', { style: fine(c), children: 'This read is a limited sample; other matches may be missing.' })
  ] });
}
function Pips({ c, value }) {
  const v = number(value) ? Math.min(15, Math.max(0, Math.round(value))) : 0;
  return h('div', { style: { flex: 1, minWidth: 90, display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: 2 }, children:
    Array.from({ length: 15 }, (_, i) => h('span', { style: { height: 8, borderRadius: 2, background: i < v ? (v === 15 ? c.accent : c.blue) : c.raised } }, i)) });
}
function IvBars({ c, p }) {
  return h('div', { style: { display: 'grid', gap: 6, marginTop: 14 }, children:
    [['Attack', p.iv_attack], ['Defense', p.iv_defense], ['Stamina', p.iv_stamina]].map(([name, v]) => hs('div', { role: 'img', 'aria-label': `${name} ${number(v) ? v : 'unknown'} of 15`,
      style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [
        h('span', { style: { ...fine(c), width: 56, flexShrink: 0 }, children: name }),
        h(Pips, { c, value: v }),
        h('strong', { style: { fontSize: 13, width: 18, textAlign: 'right' }, children: number(v) ? v : '?' })
      ] }, name)) });
}
function Sparkles({ c, size }) {
  const star = (x, y, r, opacity) => h('path', { opacity, fill: c.accent,
    d: `M${x} ${y - r}l${r * .28} ${r * .72} ${r * .72} ${r * .28} ${-r * .72} ${r * .28} ${-r * .28} ${r * .72} ${-r * .28} ${-r * .72} ${-r * .72} ${-r * .28} ${r * .72} ${-r * .28}z` }, x + ',' + y);
  return h('svg', { viewBox: '0 0 168 168', width: size, height: size, 'aria-hidden': true, style: { position: 'absolute', left: 0, top: 0, pointerEvents: 'none' },
    children: [star(26, 36, 12, 1), star(146, 58, 9, .8), star(138, 146, 7, .6)] });
}
// Species art on a soft glow in the colour that made the catch worth a look. A letter stands in without an icon.
function HeroArt({ ctrl, c, p, size, dim = false, sparkle = false }) {
  useValue(ctrl.iconRev);
  const url = ctrl.icon(p), glow = highlight(p, c)?.color || c.line;
  return hs('div', { 'aria-hidden': true, style: { position: 'relative', width: size, height: size, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
    background: dim ? 'transparent' : `radial-gradient(circle, ${glow}40 0, ${glow}00 68%)`, filter: dim ? 'grayscale(1)' : undefined, opacity: dim ? .6 : 1 }, children: [
    url ? h('img', { alt: '', src: url, width: size - 12, height: size - 12, draggable: false, style: { display: 'block', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.4))' } })
      : h('span', { style: { fontSize: size / 3, fontWeight: 750 }, children: url === null ? text(p?.name, 1) || '?' : '' }),
    sparkle && !dim && h(Sparkles, { c, size })
  ] });
}
function Compass({ c, d, place, timer, verified }) {
  return hs('div', { style: { width: 150, flexShrink: 0, textAlign: 'center' }, children: [
    d && hs('svg', { width: 112, height: 112, viewBox: '0 0 150 150', role: 'img', 'aria-label': `${amount(d.meters)} to the ${d.direction}`, style: { display: 'block', margin: '0 auto' }, children: [
      h('circle', { cx: 75, cy: 75, r: 62, fill: 'none', stroke: c.line, strokeWidth: 1.5, strokeDasharray: '3 6' }),
      h('text', { x: 75, y: 15, textAnchor: 'middle', fill: c.muted, fontSize: 11, children: 'N' }),
      h('g', { transform: `rotate(${d.bearing} 75 75)`, children: h('path', { d: 'M75 20 89 72 75 63 61 72Z', fill: c.accent }) }),
      h('circle', { cx: 75, cy: 75, r: 5, fill: c.accent })
    ] }),
    d && h('div', { style: { fontSize: 18, fontWeight: 700, marginTop: 4 }, children: d.meters < 10 ? 'Right here' : `${amount(d.meters)} ${d.direction}` }),
    d && h('div', { style: fine(c), children: `of ${place || 'the search point'}` }),
    timer.seconds > 0 ? hs('div', { style: { marginTop: 10 }, children: [
      h('div', { style: { fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: timer.low ? c.red : c.fg }, children: timer.label }),
      h('div', { style: fine(c), children: verified ? 'left' : 'est. left' })
    ] }) : h('div', { style: { ...fine(c), marginTop: 10 }, children: timer.label })
  ] });
}
const TONES = c => ({ ok: c.green, tight: c.accent, far: c.red });
const VERDICT_ICONS = { ok: 'M5 12.5l4.5 4.5L19 7.5', tight: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z', far: 'M6 6l12 12M18 6L6 18' };
function VerdictPill({ c, verdict }) {
  const color = TONES(c)[verdict.tone];
  return hs('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, background: color + '22', border: `1px solid ${color}77`, color, borderRadius: 999, padding: '6px 13px', font: `700 13px ${font}` }, children: [
    h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, children: h('path', { d: VERDICT_ICONS[verdict.tone] }) }),
    verdict.label] });
}
function CatchSummary({ ctrl, c, p, center, sid, place, inPane = false }) {
  const now = useValue(ctrl.clock), timer = expiry(p, now), gone = timer.expired, verified = p.expiry_verified === true;
  const hl = highlight(p, c), rank = rankLabel(p), d = distanceBearing(center, p);
  const verdict = !gone && d ? walkVerdict(d.meters, timer.seconds, verified) : null;
  return hs('div', { style: { ...rowStyle, gap: 22, alignItems: 'center', minWidth: 0 }, children: [
    h(HeroArt, { ctrl, c, p, size: inPane ? 96 : 150, dim: gone, sparkle: p.iv_percent === 100 }),
    hs('div', { style: { flex: inPane ? '1 1 150px' : '1 1 200px', minWidth: 0, opacity: gone ? .65 : 1 }, children: [
      hs('div', { style: { ...rowStyle, gap: 10 }, children: [
        h('strong', { style: { fontSize: inPane ? 20 : 28, lineHeight: 1.15 }, children: text(p.name, 80) || 'Pokémon' }),
        p.form_name && h('span', { style: fine(c), children: text(p.form_name, 60) }),
        hl && h('span', { style: { font: `700 12px ${font}`, color: c.ink, background: hl.color, borderRadius: 999, padding: '3px 11px' }, children: hl.label })
      ] }),
      h('div', { style: { fontSize: 14, marginTop: 3 }, children: [metric(p), number(p.cp) && `CP ${p.cp}`, number(p.level) && `Lv ${p.level}`].filter(Boolean).join(' · ') }),
      inPane && hs('div', { style: { ...fine(c), display: 'flex', alignItems: 'center', gap: 5 }, children: [
        d && d.meters >= 10 && h(Arrow, { c, degrees: d.bearing }), distanceLabel(center, p, place), timer.seconds > 0 && ` · ${timer.label} left`] }),
      verdict && hs('div', { style: { ...rowStyle, gap: 10, marginTop: 12 }, children: [
        h(VerdictPill, { c, verdict }), h('span', { style: fine(c), children: verdict.detail })] }),
      !gone && h(IvBars, { c, p }),
      !gone && rank && h('div', { style: { color: c.green, fontSize: 12, marginTop: 8 }, children: rank }),
      !gone && hs('div', { style: { ...rowStyle, marginTop: 14 }, children: [
        h(Button, { c, primary: true, style: { padding: '10px 16px', fontSize: 13 }, disabled: !safeMapUrl(p.map_url), onClick: () => openMap(ctrl.ctx, p.map_url), children: 'Open live map ↗' }),
        !inPane && h(Button, { c, style: { padding: '10px 16px', fontSize: 13 }, onClick: () => showInRadar(ctrl, sid, p, center, place), children: 'Show on map' })
      ] })
    ] }),
    !inPane && h(Compass, { c, d, place, timer, verified })
  ] });
}
// The runner-up row: one line per catch, art, the numbers that matter and whether it is worth the walk.
function CompactCatch({ ctrl, c, p, center, sid, place }) {
  const now = useValue(ctrl.clock), timer = expiry(p, now), gone = timer.expired, verified = p.expiry_verified === true;
  const d = distanceBearing(center, p), verdict = !gone && d ? walkVerdict(d.meters, timer.seconds, verified) : null;
  return hs('div', { style: { display: 'flex', alignItems: 'center', gap: 12, opacity: gone ? .65 : 1 }, children: [
    h(Mon, { ctrl, c, p, size: 58, dim: gone }),
    hs('div', { style: { flex: 1, minWidth: 0 }, children: [
      h('strong', { style: { fontSize: 14 }, children: text(p.name, 80) || 'Pokémon' }),
      h('div', { style: fine(c), children: [metric(p), d && `${amount(d.meters)} ${d.direction}`].filter(Boolean).join(' · ') }),
      gone ? h('div', { style: fine(c), children: timer.label })
        : verdict ? h('div', { style: { fontSize: 12, fontWeight: 650, color: TONES(c)[verdict.tone] }, children: verdict.note })
        : h('div', { style: fine(c), children: timer.seconds > 0 ? `${timer.label} left` : timer.label })
    ] }),
    !gone && hs('div', { style: { ...rowStyle, flexShrink: 0, gap: 6 }, children: [
      h(Button, { c, disabled: !safeMapUrl(p.map_url), onClick: () => openMap(ctrl.ctx, p.map_url), children: 'Map ↗' }),
      h(Button, { c, onClick: () => showInRadar(ctrl, sid, p, center, place), children: 'Radar' })
    ] })
  ] });
}
function RadarSvg({ ctrl, c, s, sid, ghost = false }) {
  const now = useValue(ctrl.clock), marks = s.observations.filter(p => !expiry(p, now).expired);
  useValue(ctrl.iconRev);
  return hs('svg', { viewBox: '0 0 320 320', role: 'img', 'aria-label': `North-up radar, ${s.radius} metre radius from search point`,
    style: { display: 'block', width: '100%', maxWidth: ghost ? 240 : undefined, maxHeight: 390, background: c.bg, borderRadius: 12, margin: ghost ? '12px auto' : 0, opacity: ghost ? .55 : 1 }, children: [
      h('style', { children: CSS }),
      ...[45, 90, 136].map(r => h('circle', { cx: 160, cy: 160, r, fill: 'none', stroke: c.line, strokeDasharray: r === 136 ? undefined : '3 5' }, r)),
      h('path', { d: 'M160 24V296 M24 160H296', stroke: c.line, strokeDasharray: '2 6' }),
      ...[['N',160,16],['E',308,164],['S',160,314],['W',12,164]].map(([t,x,y]) => h('text', { x, y, textAnchor: 'middle', fill: c.muted, fontSize: 10, children: t }, t)),
      h('text', { x: 163, y: 34, fill: c.muted, fontSize: 9, children: s.radius + ' m' }),
      ...marks.map(p => {
        const d = distanceBearing(s.center, p); if (!d || d.meters > s.radius) return null;
        const a = d.bearing * Math.PI / 180, r = d.meters / s.radius * 136;
        const x = 160 + Math.sin(a) * r, y = 160 - Math.cos(a) * r, selected = s.selected === p.observation_id;
        const color = highlight(p, c)?.color || c.muted, url = ctrl.icon(p);
        const choose = () => ctrl.update(sid, { selected: p.observation_id });
        return hs('g', { role: 'button', tabIndex: 0, 'aria-label': `${text(p.name)} ${metric(p)}, ${Math.round(d.meters)} metres ${d.direction}`,
          onClick: choose, onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }, style: { cursor: 'pointer' }, children: [
            h('title', { children: `${text(p.name)} · ${metric(p)} · ${Math.round(d.meters)} m ${d.direction}` }),
            selected && h('circle', { cx: x, cy: y, r: 21, fill: 'none', stroke: c.accent, strokeWidth: 2 }),
            expiry(p, now).low && h('circle', { cx: x, cy: y, r: 24, fill: 'none', stroke: c.red, className: 'pokeit-pulse' }),
            h('circle', { cx: x, cy: y, r: 15, fill: c.raised, stroke: color, strokeWidth: 2 }),
            url ? h('image', { href: url, x: x - 13, y: y - 13, width: 26, height: 26 })
              : h('text', { x, y: y + 4, fill: c.fg, textAnchor: 'middle', fontWeight: 700, fontSize: 11, children: text(p.name, 1) || '?' })
          ] }, p.observation_id);
      }),
      h('circle', { cx: 160, cy: 160, r: 7, fill: c.accent, stroke: c.bg, strokeWidth: 3 }),
      !s.center && h('text', { x: 160, y: 190, fill: c.muted, textAnchor: 'middle', fontSize: 12, children: 'Your next hunt starts here' })
    ] });
}
// What the map viewer is given: positions and labels the pane already shows. No session, profile or chat text.
export function mapState(s, { light = false, watching = false, now = Date.now() } = {}) {
  const row = p => {
    const end = typeof p.expires_at === 'string' ? Date.parse(p.expires_at) : NaN;
    return { id: p.observation_id, lat: p.lat, lon: p.lon, name: text(p.name, 40), pokemon_id: iconKey(p) ? p.pokemon_id : 0,
      form: iconKey(p)?.includes('_') ? p.form : 0, iv: number(p.iv_percent) ? p.iv_percent : null,
      tag: p.iv_percent === 100 ? 'Hundo' : p.iv_percent === 0 ? 'Nundo' : hasRankOne(p) ? 'PvP #1' : null,
      expires: Number.isFinite(end) ? end : null, verified: p.expiry_verified === true };
  };
  const live = list => (Array.isArray(list) ? list : []).filter(p => ID.test(p?.observation_id || '') && number(p.lat) && number(p.lon) && !expiry(p, now).expired);
  const forts = list => (Array.isArray(list) ? list : []).filter(f => FORT_ID.test(f?.id || '') && number(f.lat) && number(f.lon)).slice(0, 50);
  const fort = (f, extra) => ({ id: f.id, lat: f.lat, lon: f.lon, name: text(f.name, 60), ...extra });
  return { theme: light ? 'light' : 'dark', center: s.center ? { lat: s.center.lat, lon: s.center.lon } : null, radius: s.radius,
    busy: !!s.busy, watching: !!watching, selected: s.selected || null, items: live(s.observations).map(row),
    gyms: forts(s.gyms).map(f => fort(f, { team: text(f.team, 10), raid: f.raid === true })),
    stops: forts(s.stops).map(f => fort(f, { lure: f.lure === true, rocket: f.rocket === true })) };
}
// A real map in place of the drawn radar: this plugin's own viewer page inside the SDK's sandboxed frame.
// The page cannot read PokeIt, start a search or reach the app; a tap on a catch only changes the selection here.
function MapView({ ctrl, c, s, sid, watching = false }) {
  const shell = ctrl.mapDocument(), light = useTheme().resolvedMode === 'light';
  const frame = useRef(null), latest = useRef(null);
  const payload = mapState(s, { light, watching }), wire = JSON.stringify(payload);
  latest.current = { payload, wire, s };
  // A new search point rebuilds the page with that state inside it; everything after travels as messages.
  const place = s.center ? `${s.center.lat},${s.center.lon},${s.radius}` : '';
  const src = useMemo(() => shell ? 'data:text/html;charset=utf-8,' + encodeURIComponent(
    shell.document.replace(shell.state_slot, () => latest.current.wire.replace(/</g, '\\u003c'))) : null, [shell, place]);
  const send = () => frame.current?.contentWindow?.postMessage({ source: 'pokeit-host', state: latest.current.payload }, '*');
  useEffect(send, [wire]);
  useEffect(() => {
    const onMessage = e => {
      if (!frame.current || e.source !== frame.current.contentWindow || e.data?.source !== 'pokeit-map') return;
      if (e.data.type === 'ready') send();
      const now = latest.current.s, id = e.data.id;
      if (e.data.type === 'select' && typeof id === 'string' && ID.test(id) && now.observations.some(p => p.observation_id === id)) ctrl.update(sid, { selected: id });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sid]);
  if (!shell || !src) return shell === undefined
    ? h('div', { className: 'pokeit-pulse', style: { height: 340, borderRadius: 12, background: c.bg, border: `1px solid ${c.line}` } })
    : h(RadarSvg, { ctrl, c, s, sid });
  return h('div', { style: { height: 'clamp(320px, 52vh, 560px)', borderRadius: 12, overflow: 'hidden', border: `1px solid ${c.line}`, background: c.bg },
    children: h(Frame, { ref: frame, src, sandbox: 'allow-scripts', title: `Map of catches near ${named(s.label) || 'the search point'}`,
      style: { width: '100%', height: '100%', border: 0, display: 'block' } }) });
}
function ResultRow({ ctrl, c, p, center, selected, now, onSelect, isNew = false }) {
  const timer = expiry(p, now), d = distanceBearing(center, p), hl = highlight(p, c);
  return hs('button', { type: 'button', 'aria-pressed': selected, onClick: onSelect, style: { display: 'grid', gridTemplateColumns: '40px 1fr auto', alignItems: 'center', gap: 10,
    width: '100%', textAlign: 'left', color: c.fg, font: `13px ${font}`, background: selected ? c.raised : 'transparent',
    border: `1px solid ${selected ? c.accent : 'transparent'}`, borderRadius: 10, padding: '6px 8px', cursor: 'pointer' }, children: [
    h(Mon, { ctrl, c, p, size: 40 }),
    hs('span', { style: { minWidth: 0 }, children: [
      h('strong', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: text(p.name, 60) || 'Pokémon' }),
      hs('span', { style: fine(c), children: [isNew && h('b', { style: { color: c.accent }, children: 'New · ' }), [metric(p), hl?.label, d && `${amount(d.meters)} ${d.direction}`].filter(Boolean).join(' · ')] })
    ] }),
    h('span', { style: { fontVariantNumeric: 'tabular-nums', fontSize: 12, color: timer.low ? c.red : c.muted }, children: timer.seconds > 0 ? timer.label : '' })
  ] });
}
function RadarPane({ ctrl, sessionId }) {
  const c = useColors(), active = useActiveSession(), sid = sessionId || active;
  const s = useRadar(ctrl, sid), now = useValue(ctrl.clock), w = useValue(ctrl.watch.view);
  // While Hunt Watch runs on this spot, its matches join the map and the list; the ones new in the latest read are marked.
  const watching = !!(w.active && s.center && w.center && distanceBearing(s.center, w.center)?.meters < 5);
  const known = new Set(s.observations.map(p => p.observation_id));
  const shown = watching ? [...s.observations, ...w.matches.filter(p => !known.has(p.observation_id))] : s.observations;
  const view = watching ? { ...s, observations: shown } : s, fresh = new Set(watching ? w.fresh : []);
  const live = shown.filter(p => !expiry(p, now).expired).sort((a, b) => fresh.has(b.observation_id) - fresh.has(a.observation_id));
  const selected = shown.find(p => p.observation_id === s.selected), place = named(s.label);
  const last = !s.center && !s.busy ? ctrl.lastSpot() : null;
  const status = s.coverage?.scan_plan?.status;
  const age = s.queriedAt ? Math.max(0, Math.floor((now - Date.parse(s.queriedAt)) / 1000)) : null;
  const next = watching && w.lastChecked ? Math.max(0, 60 - Math.floor((now - w.lastChecked) / 1000)) : null;
  const landmarks = [s.gyms.length && `${s.gyms.length} ${s.gyms.length === 1 ? 'gym' : 'gyms'}`, s.stops.length && `${s.stops.length} Pokéstops`].filter(Boolean).join(' · ');
  return hs('section', { 'aria-label': 'PokeIt Radar', style: { background: c.surface, color: c.fg, padding: 14, overflowY: 'auto', height: '100%', fontFamily: font, boxSizing: 'border-box' }, children: [
    h(Styles, {}),
    hs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }, children: [
      hs('div', { style: { minWidth: 0 }, children: [hs('h2', { style: { fontSize: 19, fontWeight: 800, margin: 0 }, children: ['Poke', h('span', { style: { color: c.accent }, children: 'It' }), ' Radar'] }),
        h('p', { style: { ...fine(c), margin: '4px 0 0' }, children: s.center ? s.label : 'Follows your chat' })] }),
      s.center && h(Button, { c, disabled: s.busy, onClick: () => void ctrl.read(sid, s.center, s.label, s.radius), children: s.busy ? 'Reading…' : 'Refresh' })
    ] }),
    h(ErrorNote, { c, message: s.error }),
    !s.center ? hs('div', { style: { textAlign: 'center', marginTop: 8 }, children: [
      h(RadarSvg, { ctrl, c, s, sid, ghost: true }),
      h('p', { style: { margin: '6px 0 4px', fontSize: 15, fontWeight: 650 }, children: 'Ask Hermes about a place.' }),
      h('p', { style: fine(c), children: 'The map opens beside the answer and follows it. Try one of these in chat:' }),
      hs('div', { style: { display: 'grid', gap: 6, marginTop: 8 }, children: [
        ...EXAMPLES.map(spot => h(Button, { c, style: { textAlign: 'left' }, onClick: () => void draft(`What's worth catching near ${spot}?`, sid), children: `What's worth catching near ${spot}?` }, spot)),
        last && h(Button, { c, style: { textAlign: 'left' }, disabled: s.busy, onClick: () => void ctrl.read(sid, last.center, last.label, last.radius), children: `Back to ${last.label}` })
      ] })
    ] }) : hs('div', { children: [
      status === 'needs_scan' && hs('div', { style: { ...panel(c), marginTop: 10, padding: 10 }, children: [
        h('p', { style: { ...fine(c), margin: '0 0 6px' }, children: 'No recent scan here. These are existing observations.' }),
        h(Button, { c, onClick: () => void draft(`Check ${s.label} and scan if needed. Use this selected map pin: ${mapUrl(s.center, s.radius)}`, sid), children: 'Ask Hermes to scan' })
      ] }),
      status === 'in_progress' && h('p', { style: fine(c), children: 'A scan is in progress here. Refresh after it finishes.' }),
      hs('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start', marginTop: 12 }, children: [
        hs('div', { children: [
          h(MapView, { ctrl, c, s: view, sid, watching }),
          hs('div', { style: { ...rowStyle, justifyContent: 'space-between', marginTop: 8, ...fine(c) }, children: [
            h('span', { children: [`${live.length} ${live.length === 1 ? 'catch' : 'catches'}`, landmarks].filter(Boolean).join(' · ') + (s.truncated ? ' · limited sample' : '') }),
            h('span', { style: { fontVariantNumeric: 'tabular-nums', color: watching ? c.accent : c.muted }, children: next !== null ? (w.busy ? 'Reading…' : `Live · next read in ${next}s`) : age === null ? '' : `Read ${age < 60 ? age + 's' : Math.floor(age / 60) + 'm'} ago` })
          ] }),
          hs('label', { style: { ...fine(c), display: 'block', marginTop: 6 }, children: ['Ring ', h('select', { 'aria-label': 'Search radius', value: s.radius, disabled: s.busy || watching, onChange: e => void ctrl.read(sid, s.center, s.label, Number(e.target.value)),
            style: { background: c.raised, color: c.fg, border: `1px solid ${c.line}`, borderRadius: 6, padding: '3px 5px', font: `12px ${font}` }, children: RADII.map(n => h('option', { value: n, children: n < 1000 ? n + ' m' : n / 1000 + ' km' }, n)) }),
            ' around the search point']
          })
        ] }),
        hs('div', { style: { minWidth: 0 }, children: [
          s.quietPick && !watching && h('p', { style: { ...fine(c), marginTop: 0 }, children: 'No highlights in this read. This is the highest observed IV catch.' }),
          !s.busy && s.queriedAt && !live.length && h('p', { style: { ...fine(c), marginTop: 0 }, children: 'No matching catches in this read. Try nearby raids or open the live map.' }),
          selected && h('div', { style: { ...panel(c), background: c.bg }, children: h(CatchSummary, { ctrl, c, p: selected, center: s.center, sid, place, inPane: true }) }),
          live.length > 1 && h('div', { 'aria-label': watching ? 'Catches on watch' : 'Catches in this read', style: { marginTop: 10, maxHeight: 300, overflowY: 'auto', display: 'grid', gap: 2 },
            children: live.map(p => h(ResultRow, { ctrl, c, p, center: s.center, now, isNew: fresh.has(p.observation_id), selected: s.selected === p.observation_id, onSelect: () => ctrl.update(sid, { selected: p.observation_id }) }, p.observation_id)) }),
          h(Button, { c, style: { width: '100%', marginTop: 12 }, onClick: () => openMap(ctrl.ctx, mapUrl(s.center, s.radius)), children: 'Open full map ↗' })
        ] })
      ] }),
      h(FollowUps, { ctrl, c, sid }),
      h(HuntWatch, { ctrl, c, sid, center: s.center, label: s.label })
    ] }),
    h('p', { style: { ...fine(c), marginTop: 16 }, children: 'The pin is the search point, not your live GPS position. No new scans start in this pane.' }),
    h(Button, { c, style: { background: 'transparent', fontSize: 11 }, onClick: () => void ctrl.debug(), children: 'Copy debug info' })
  ] });
}
function Skeleton({ c, label }) {
  const bar = (width, height, top) => h('div', { className: 'pokeit-pulse', style: { height, width, borderRadius: height / 2, background: c.raised, marginTop: top } });
  return hs('div', { role: 'status', 'aria-label': label, style: { display: 'flex', gap: 12, alignItems: 'center' }, children: [
    h('span', { className: 'pokeit-pulse', style: { width: 64, height: 64, borderRadius: 19, background: c.raised, flexShrink: 0 } }),
    hs('div', { style: { flex: 1 }, children: [bar('45%', 14, 0), bar('70%', 10, 9), bar('55%', 10, 7)] })
  ] });
}
// The data call failed: keep the card useful with the position the agent chose, a map link and a retry.
function OfflineCatch({ ctrl, c, args, place, error, retry }) {
  const o = offlineCatch(args, place);
  return hs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
    h('strong', { style: { fontSize: 13 }, children: 'A catch the agent picked' }),
    h('span', { style: { fontSize: 13 }, children: o.where }),
    h(ErrorNote, { c, message: error }),
    hs('div', { style: rowStyle, children: [
      h(Button, { c, primary: true, onClick: () => openMap(ctrl.ctx, o.mapLink), children: 'Open map' }),
      h(Button, { c, onClick: retry, children: 'Try again' })] })
  ] });
}
function CatchCard({ ctrl, attrs, sid, streaming }) {
  const c = useColors(), args = catchAttributes(attrs), place = placeName(attrs), compact = catchVariant(attrs) === 'compact', key = args ? JSON.stringify(args) : '';
  const now = useValue(ctrl.clock), [data, setData] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  // A card that was seen streaming belongs to a new answer; cards in an old transcript do not open the map.
  const fresh = useRef(false); if (streaming) fresh.current = true;
  useEffect(() => {
    if (!key || streaming) return;
    const targetSid = sid || activeSession();
    let current = true; setData(null); setError('');
    ctrl.api('/card?' + new URLSearchParams(JSON.parse(key))).then(d => {
      if (!current) return; setData(d);
      if (d.observation && d.status === 'observed') {
        ctrl.adopt(targetSid, d.observation, d.origin, place, false);
        if (fresh.current && d.origin) openRadar(ctrl, targetSid, false);
      }
    }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [ctrl, key, place, sid, streaming, retry]);
  if (!args) return h('p', { style: { ...fine(c), margin: '8px 0' }, children: 'This catch card has an invalid location or identifier.' });
  // A catch that is gone needs a line, not a box.
  if (data && data.status !== 'observed') return h('p', { role: 'status', style: { ...fine(c), margin: '8px 0' },
    children: data.status === 'expired' ? 'This catch has expired.' : data.truncated ? 'This catch is not in the latest limited read. It may still be around.' : 'This catch is no longer in the latest read. It may have expired.' });
  // A catch that expires while the card is on screen folds down to the quiet row.
  const p = data?.observation, row = compact || (p && expiry(p, now).expired), hl = p && highlight(p, c);
  return hs('article', { 'aria-label': 'PokeIt catch', style: { ...panel(c), maxWidth: row ? 640 : 780, margin: '8px 0', padding: row ? 12 : 22,
    background: hl && !row ? `radial-gradient(circle at 105px 100px, ${hl.color}33 0, ${hl.color}00 250px), ${c.surface}` : c.surface }, children: [
    h(Styles, {}),
    !data && !error && h(Skeleton, { c, label: streaming ? 'Preparing catch card' : 'Checking this catch' }),
    error && h(OfflineCatch, { ctrl, c, args, place, error, retry: () => setRetry(v => v + 1) }),
    p && h(row ? CompactCatch : CatchSummary, { ctrl, c, p, center: data.origin, sid, place }),
    data?.truncated && h('small', { style: fine(c), children: 'The source returned a limited sample.' })
  ] });
}
function ScanCard({ ctrl, attrs, streaming }) {
  const c = useColors(), id = SCAN_ID.test(attrs?.id || '') ? attrs.id : null;
  const now = useValue(ctrl.clock), [data, setData] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!id || streaming) return;
    let current = true, cancel = () => {}; setError(''); setData(null);
    async function poll() {
      try {
        const d = await ctrl.api('/scan/' + id); if (!current) return;
        setData(d); const p = scanProgress(d);
        if (!p.terminal) cancel = ctrl.ctx.setTimeout(poll, p.delay * 1000);
      } catch (e) { if (current) setError(e.message); }
    }
    void poll(); return () => { current = false; cancel(); };
  }, [ctrl, id, streaming, retry]);
  if (!id) return h('p', { style: { ...fine(c), margin: '8px 0' }, children: 'This scan card has an invalid request identifier.' });
  const p = scanProgress(data), status = data?.status;
  const labels = { queued: 'Scouts are working', dispatch_unknown: 'Waiting for scan confirmation', data_refreshed: 'Scan complete', existing_coverage: 'Existing coverage reused', partial_unverified: 'Partial results — some points unverified', failed: 'Scan could not complete' };
  const created = number(data?.created_at) ? new Date(data.created_at * 1000) : null;
  const requested = created && !Number.isNaN(created.getTime()) ? created.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const elapsed = created ? Math.max(0, Math.floor(now / 1000 - data.created_at)) : null;
  const meta = p.terminal ? (requested ? `Requested at ${requested}` : '') : elapsed !== null ? `${mmss(elapsed)} elapsed` : '';
  const tone = status === 'failed' ? c.red : p.terminal ? (status === 'partial_unverified' ? c.accent : c.green) : c.accent;
  const done = p.terminal && (status === 'data_refreshed' || status === 'existing_coverage');
  const detail = [p.total ? `${p.done} of ${p.total} points confirmed or covered` : 'Waiting for point counts', meta,
    p.unverified > 0 && `${p.unverified} unverified`, p.failed > 0 && `${p.failed} failed`].filter(Boolean).join(' · ');
  return hs('article', { 'aria-label': 'PokeIt scan progress', style: { ...panel(c), maxWidth: 780, margin: '8px 0', padding: '14px 18px' }, children: [
    h(Styles, {}),
    hs('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }, children: [
      hs('svg', { width: 56, height: 56, viewBox: '0 0 56 56', role: 'img', 'aria-label': p.total ? `${p.done} of ${p.total} points confirmed or covered` : 'Waiting for point counts', style: { flexShrink: 0 }, children: [
        h('circle', { cx: 28, cy: 28, r: 23, fill: 'none', stroke: c.raised, strokeWidth: 6 }),
        h('circle', { cx: 28, cy: 28, r: 23, fill: 'none', stroke: tone, strokeWidth: 6, strokeLinecap: 'round', transform: 'rotate(-90 28 28)',
          strokeDasharray: `${(p.total ? p.done / p.total : 0) * 144.5} 144.5`, style: { transition: 'stroke-dasharray .6s ease' } }),
        done ? h('path', { d: 'M19 28.5l6 6 12-12', fill: 'none', stroke: tone, strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' })
          : h('text', { x: 28, y: 32, textAnchor: 'middle', fill: c.fg, fontSize: 12, fontWeight: 700, children: status === 'failed' ? '!' : number(p.done) ? String(p.done) : '–' })
      ] }),
      hs('div', { style: { flex: '1 1 220px', minWidth: 0 }, children: [
        hs('div', { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [
          h('span', { 'aria-hidden': true, className: p.terminal ? undefined : 'pokeit-pulse', style: { width: 9, height: 9, borderRadius: '50%', background: tone, flexShrink: 0 } }),
          h('strong', { style: { fontSize: 15 }, children: labels[status] || 'Checking scan status…' })
        ] }),
        h('div', { style: { ...fine(c), marginTop: 2 }, children: detail })
      ] }),
      data?.map_url && h(Button, { c, onClick: () => openMap(ctrl.ctx, data.map_url), children: 'Open live map ↗' })
    ] }),
    h(ErrorNote, { c, message: error }),
    error && h(Button, { c, onClick: () => setRetry(v => v + 1), children: 'Retry status' })
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
