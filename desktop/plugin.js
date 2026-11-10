import { host, atom, useValue, useTheme, gatewayActivationEpoch, PANES_AREA, STATUSBAR_AREAS, TRANSCRIPT_DIRECTIVE_AREA } from '@hermes/plugin-sdk';
import * as sdk from '@hermes/plugin-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { jsx as h, jsxs as hs } from 'react/jsx-runtime';

const VERSION = '0.1.19';
const ORIGIN = 'https://pokeit.cc';
const ID = /^pid_[A-Za-z0-9_-]{1,96}$/;
const SCAN_ID = /^[A-Za-z0-9_-]{32}$/;
const ICON = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;
// The sandboxed frame arrived in a later Desktop; older hosts keep the drawn radar.
const Frame = sdk.SandboxedFrame || null;
const TERMINAL = new Set(['data_refreshed', 'existing_coverage', 'partial_unverified', 'failed']);
const RADII = [100, 250, 500, 1000, 2000];
// The agent can read at another radius (371 m after a scan). The Radar must read the same ring or its list differs from the chat's.
export const radiusOf = n => Number.isFinite(n) && n >= 50 && n <= 2000 ? Math.round(n) : 500;
const BEST_COUNT = 4;  // how many catches the chat answer lists, and so how many the Radar shows by default
// The "live now" examples sit inside ongoing coverage, so they answer at once. A "fresh scan" one needs a scan, which Hermes asks the player to approve.
const NEAR_ME = 'What Pokémon are worth catching near me?';
const EXAMPLES = [['the Georgia Aquarium in Atlanta', 'live now'], ['the Gateway Arch in St. Louis', 'live now'], ['Bethesda Terrace in Central Park, New York', 'fresh scan']];
const FORT_ID = /^[A-Za-z0-9._-]{1,80}$/;
const empty = () => ({ center: null, label: 'Choose a spot', radius: 500, observations: [], gyms: [], stops: [], selected: null,
  queriedAt: null, coverage: null, busy: false, error: '', truncated: false, generation: 0, scan: null });
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
  return light ? { dark: false, bg: '#FBF8F1', surface: '#FFFFFF', raised: '#F0EBDD', fg: '#0A1633', muted: '#4A5878',
    accent: '#B15700', ink: '#FFFFFF', line: '#D8D4CA', green: '#157148', red: '#B52F2C', blue: '#315DA6' }
    : { dark: true, bg: '#050C20', surface: '#0A1633', raised: '#14264F', fg: '#F2F6FF', muted: '#A9B6D3',
      accent: '#FFB020', ink: '#0A1633', line: '#30436A', green: '#4ADE9A', red: '#FF8174', blue: '#80A8FF' };
}
function useColors() { return palette(useTheme().resolvedMode === 'light'); }
const font = "'Segoe UI', system-ui, sans-serif";
const rowStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
const fine = c => ({ color: c.muted, fontSize: 12, lineHeight: 1.5 });
const panel = c => ({ fontFamily: font, color: c.fg, background: c.surface, border: `1px solid ${c.line}`,
  borderRadius: 12, padding: 14, overflow: 'hidden', minWidth: 0, lineHeight: 1.45 });
const CSS = '@keyframes pokeit-pulse{0%,100%{opacity:1}50%{opacity:.35}}.pokeit-pulse{animation:pokeit-pulse 1.4s ease-in-out infinite}'
  + '@keyframes pokeit-spin{to{transform:rotate(360deg)}}.pokeit-spin{animation:pokeit-spin 1.8s linear infinite;transform-origin:50% 50%;transform-box:view-box}'
  + '@media(prefers-reduced-motion:reduce){.pokeit-pulse,.pokeit-spin{animation:none}}';
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
const WATCH_LIMIT_MS = 2 * 60 * 60 * 1000;
// The toast leads with what was found, then where, and how long is left. No clock times: this PC's clock can differ from the
// place's clock that the chat uses, and time left is what the player acts on. No URL: clicking it opens the catch in the Radar.
export function watchToast(fresh, label, foundAt) {
  const first = fresh[0], end = Date.parse(first?.expires_at);
  const iv = number(first?.iv_percent) ? `${Number(first.iv_percent.toFixed(1))}%` : 'IV unknown';
  const title = `PokeIt! Nearby ${text(first?.name, 35) || 'a catch'} (${iv})${fresh.length > 1 ? ` +${fresh.length - 1} more` : ''}`;
  const minutes = Number.isFinite(end) ? Math.floor((end - foundAt) / 60000) : null;
  const left = minutes === null ? 'Time left unknown' : minutes < 1 ? 'Under a minute left'
    : `${first.expiry_verified === true ? '' : 'About '}${minutes} min left`;
  return { title, body: `Found near ${label}\n${left}\nClick to open it in the PokeIt Radar.` };
}
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
  const view = atom({ ...saved(), active: false, busy: false, error: '', lastChecked: null, matched: 0, matches: [], fresh: [], center: null, truncated: false, label: '', notice: '', notificationNote: '', scan: '', scanNote: '' });
  let current = null, alive = true, cancelTimer = null, cancelLimit = null, clearBubble = null;
  const alerts = new Map();
  const patch = changes => view.set({ ...view.get(), ...changes });
  const valid = run => alive && current === run && run.scope === watchScope() && run.epoch === gatewayActivationEpoch();
  function stop(notice = 'Watch stopped.') {
    current = null; cancelTimer?.(); cancelTimer = null; cancelLimit?.(); cancelLimit = null; clearBubble?.(); clearBubble = null;
    patch({ active: false, busy: false, notice, matches: [], fresh: [], center: null, scan: '', scanNote: '' });
  }
  // A watch is not left running for ever: it ends by itself and says so, in the app and, when the app is away, in a toast.
  function expire(run) {
    if (current !== run) return;
    stop(`Watch ended after ${WATCH_LIMIT_MS / 3600000} hours. Press Watch to keep going.`);
    host.notify({ kind: 'info', message: `PokeIt Hunt Watch near ${run.label} ended after ${WATCH_LIMIT_MS / 3600000} hours.` });
    void Promise.resolve().then(() => ctx.os?.notify?.({ title: 'PokeIt! Hunt Watch ended',
      body: `Stopped after ${WATCH_LIMIT_MS / 3600000} hours near ${run.label}. Open the PokeIt Radar to start it again.` })).catch(() => {});
  }
  // The watch only reads what scans have already found. Where no ongoing scan covers the spot it can see nothing new, so say so.
  async function checkScans(run) {
    try {
      const data = await api('/coverage?' + new URLSearchParams({ lat: run.center.lat, lon: run.center.lon }));
      if (!valid(run)) return;
      const plan = data?.scan_plan, status = plan?.status;
      if (!status || status === 'unavailable') return;
      // The plan's status is about the whole 371 m footprint and can read needs_scan for a spot inside a scanned area (points
      // near the seam between two neighbouring areas are flagged). So warn only when no point of the footprint is inside one.
      const covered = Number.isInteger(plan.counts?.existing_area) ? plan.counts.existing_area : status === 'existing_coverage' ? 1 : 0;
      const areas = Array.isArray(data.areas) ? data.areas.slice(0, 2).map(a => text(a, 40)).filter(Boolean).join(', ') : '';
      if (covered > 0 || (Array.isArray(data.areas) && data.areas.length)) { patch({ scan: 'ongoing', scanNote: `Ongoing scans cover this spot${areas ? ` (${areas})` : ''}.` }); return; }
      const note = 'Watch requires ongoing scans, which are not yet available in this area. Please reach out to PokeIt to get this area covered for watching.';
      patch({ scan: 'none', scanNote: note });
      host.notify({ kind: 'warning', message: note });
    } catch { /* the watch itself works without this check */ }
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
      const { title, body } = watchToast(fresh, run.label, now());
      const plain = `${title}. ${body.split('\n').slice(0, 2).join('. ')}`;  // in the app the catch is already on screen, so no "click to open" line
      patch({ notice: plain });
      clearBubble?.(); clearBubble = ctx.pet?.say(plain, { id: 'hunt-watch', tone: 'info', ttlMs: 10000 });
      host.notify({ kind: 'info', message: plain });
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
    patch({ active: true, busy: false, error: '', lastChecked: null, matched: 0, matches: [], fresh: [], center: { ...center }, truncated: false, label: current.label, notice: 'Checking this spot…', notificationNote: '', scan: '', scanNote: '' });
    cancelTimer = ctx.setInterval(() => { void poll(); }, 60000);
    const run = current;
    cancelLimit = ctx.setTimeout?.(() => expire(run), WATCH_LIMIT_MS) ?? null;
    void checkScans(run); void poll(); return true;
  }
  function reset() { stop(''); patch({ ...saved(), label: '', lastChecked: null, error: '', notice: '', notificationNote: '' }); }
  const subscriptions = [host.state.profile.subscribe(reset), host.state.connectionId?.subscribe(reset)].filter(Boolean);
  ctx.onEvent('gateway.ready', reset);
  ctx.onDispose(() => { stop(''); alive = false; subscriptions.forEach(unsubscribe => unsubscribe()); alerts.clear(); });
  return { view, start, stop, configure, poll };
}
export function createController(ctx) {
  const revision = atom(0), clock = atom(Date.now()), iconRev = atom(0), sessions = new Map(), scans = new Map();
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
      const old = /unexpected query parameter/i.test(e?.message || '');
      const message = old ? 'This PokeIt backend is older than the Radar. Remove every PokeIt entry under Capabilities → Plugins, restart Hermes, then install it again.'
        : e?.safeMessage ? text(e.message, 240) : 'PokeIt could not be reached. Enable the plugin for the profile you are chatting in (Capabilities, then Plugins), then try again.';
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
    return v && number(v.lat) && number(v.lon) && Math.abs(v.lat) <= 85 && Math.abs(v.lon) <= 180 && typeof v.label === 'string' && radiusOf(v.radius) === v.radius
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
  async function fillBest(highlights, center, radius) {
    if (highlights.length >= BEST_COUNT) return highlights;
    try {
      const d = await api('/nearby?' + new URLSearchParams({ lat: center.lat, lon: center.lon, radius_m: radius, limit: BEST_COUNT, selection: 'all', order: 'priority' }), true);
      const have = new Set(highlights.map(p => p.observation_id));
      const extra = (Array.isArray(d?.observations) ? d.observations : []).filter(p => p && !have.has(p.observation_id));
      return [...highlights, ...extra].slice(0, Math.max(BEST_COUNT, highlights.length));
    } catch { return highlights; }  // the highlights alone are still a true read
  }
  // A read taken while a scan was finishing says "a scan is in progress". Look at the coverage plan again (read-only)
  // until it says otherwise, so the line does not stay up after the scan is done.
  function settle(sid, center, generation, tries) {
    if (typeof ctx.setTimeout !== 'function' || tries >= 12) return;
    ctx.setTimeout(async () => {
      if (!alive || state(sid).generation !== generation) return;
      let coverage = null;
      try { coverage = await api('/coverage?' + new URLSearchParams(center), true); } catch { /* try again next time */ }
      if (!alive || state(sid).generation !== generation) return;
      if (coverage?.scan_plan?.status && coverage.scan_plan.status !== 'in_progress') update(sid, { coverage });
      else settle(sid, center, generation, tries + 1);
    }, 10000);
  }
  async function read(sid, center, label, radius) {
    const s = state(sid), generation = s.generation + 1;
    scans.delete(sid);
    update(sid, { center, label, radius, busy: true, error: '', generation, observations: [], gyms: [], stops: [], selected: null, queriedAt: null, coverage: null, scan: null });
    try {
      const params = new URLSearchParams({ lat: center.lat, lon: center.lon, radius_m: radius, limit: 50, selection: 'highlights' });
      void loadForts(sid, center, radius, generation);
      const [result, coverage] = await Promise.all([api('/nearby?' + params),
        api('/coverage?' + new URLSearchParams(center)).catch(() => null)]);
      if (!alive || state(sid).generation !== generation) return;
      const highlights = (Array.isArray(result.observations) ? result.observations : []).slice(0, 50);
      // The same list the chat answer gives: highlights first, then the best by IV until there are four.
      const observations = await fillBest(highlights, center, radius);
      if (!observations.length && result.highest_observed_iv) observations.push(result.highest_observed_iv);
      if (!alive || state(sid).generation !== generation) return;
      update(sid, { observations, coverage, queriedAt: result.queried_at, truncated: !!result.truncated,
        candidates: result.observed_candidates_in_radius, quietPick: !highlights.length && observations.length > 0,
        busy: false, selected: observations[0]?.observation_id || null });
      ctx.storage?.set('last-spot:' + watchScope(), { lat: center.lat, lon: center.lon, label: text(label, 100), radius });
      if (coverage?.scan_plan?.status === 'in_progress') settle(sid, center, generation, 0);
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
      backend: health, last_error: lastError || null, follow_hook: { ...follow }, checked_at: new Date().toISOString() };
    const ok = await ctx.os.writeClipboard(JSON.stringify(report, null, 2));
    host.notify({ kind: ok ? 'info' : 'warning', message: ok ? 'PokeIt debug info copied. No location or chat text included.' : 'Could not copy debug info.' });
  }
  const controller = { ctx, revision, clock, iconRev, state, update, api, read, adopt, icon, lastSpot, mapDocument, debug, healthy: () => healthy };
  // The map follows the chat without help from the model: when the agent's own PokeIt search finishes,
  // the pane reads the same point and opens beside the answer. Only this plugin's tool names are looked at.
  let lastPlace = null, lastFollow = 0;
  // What the hook has seen, for the debug report: counts only, never ids, places or text.
  const follow = { events: 0, replayed: 0, other_chat: 0, reads: 0, scans_tracked: 0 };
  // The event's session id can be the stored id or the runtime id of the focused chat. Either one means "this chat".
  const inFocusedChat = event => {
    const ids = [host.state.focusedSessionId.get(), host.state.focusedStoredSessionId?.get()].filter(Boolean);
    return !event.session_id || !ids.length || ids.includes(event.session_id);
  };
  const SCAN_POLL_MS = 5000, SCAN_START_GRACE_MS = 45000, SCAN_GIVE_UP_MS = 12 * 60000;
  // While the agent's scan runs the Radar shows its progress, read from the coverage plan (read-only; it never starts or renews a scan).
  // When the plan says the footprint is covered, the pane reads the spot. If no sign of a scan appears at all (the player declined
  // the approval), it stops quietly and shows what already exists.
  function trackScan(sid, center, label, radius) {
    if (typeof ctx.setTimeout !== 'function') return;
    const token = {}, startedAt = Date.now(), generation = state(sid).generation + 1;
    scans.set(sid, token); follow.scans_tracked++;
    update(sid, { generation, center, label, radius, observations: [], gyms: [], stops: [], selected: null, queriedAt: null, coverage: null, error: '', busy: false,
      scan: { done: 0, total: 49, since: startedAt, seen: false } });
    void loadForts(sid, center, radius, generation);
    const finish = () => { scans.delete(sid); void read(sid, center, label, radius); };
    const tick = async () => {
      if (!alive || scans.get(sid) !== token) return;
      let plan = null;
      try { plan = (await api('/coverage?' + new URLSearchParams(center), true))?.scan_plan; } catch { /* try again next time */ }
      if (!alive || scans.get(sid) !== token) return;
      const total = Number.isInteger(plan?.total_points) && plan.total_points > 0 ? plan.total_points : 49;
      const counts = plan?.counts || {};
      const done = Math.min(total, (Number.isInteger(counts.existing_area) ? counts.existing_area : 0) + (Number.isInteger(counts.fresh) ? counts.fresh : 0));
      const covered = plan && ['fresh', 'existing_coverage'].includes(plan.status);
      const seen = !!(state(sid).scan?.seen || (plan && plan.status !== 'needs_scan') || done > 0 && done < total);
      const age = Date.now() - startedAt;
      // The last few points can lag for a minute; 45 of 49 is enough to show the spot.
      if (covered || (seen && done >= total - 4) || age > SCAN_GIVE_UP_MS || (!seen && age > SCAN_START_GRACE_MS)) { finish(); return; }
      update(sid, { scan: { done, total, since: startedAt, seen } });
      ctx.setTimeout(tick, SCAN_POLL_MS);
    };
    ctx.setTimeout(tick, 1500);
  }
  function stopScan(sid) { scans.delete(sid); update(sid, { scan: null }); }
  controller.stopScan = stopScan;
  // The place name comes from the agent's resolve_location call. A name belongs to the first search made after it. When the
  // chat returns to an earlier place the agent reuses the point without resolving again, so names are also remembered by point;
  // otherwise the last resolved name (another city) would be shown over this one.
  const places = [];
  const labelFor = center => {
    if (lastPlace && !lastPlace.used && Date.now() - lastPlace.at < 180000 && lastPlace.label) {
      lastPlace.used = true;
      places.unshift({ center, label: lastPlace.label });
      if (places.length > 20) places.length = 20;
      return lastPlace.label;
    }
    return places.find(p => distanceBearing(p.center, center)?.meters < 60)?.label || null;
  };
  ctx.onEvent('tool.complete', event => {
    follow.events++;
    const payload = event?.payload, name = typeof payload?.name === 'string' ? payload.name : '', args = payload?.args || {};
    if (!alive || !/pokeit/i.test(name)) return;
    if (event?.replayed) { follow.replayed++; return; }
    if (!inFocusedChat(event)) { follow.other_chat++; return; }
    if (name.endsWith('resolve_location')) { lastPlace = { at: Date.now(), label: [text(args.query, 60), text(args.locality, 40)].filter(Boolean).join(', ') }; return; }
    const finds = ['find_pokemon', 'find_raids', 'find_gyms', 'find_showcases', 'find_max_battles', 'find_pokestops'].some(tool => name.endsWith(tool)),
      scanning = name.endsWith('request_scan');
    if (!(finds || scanning) || !number(args.lat) || !number(args.lon) || Math.abs(args.lat) > 85 || Math.abs(args.lon) > 180) return;
    const sid = activeSession(), s = state(sid), center = { lat: args.lat, lon: args.lon }, radius = radiusOf(args.radius_m);
    const placeLabel = labelFor(center);
    if (scanning) { trackScan(sid, center, placeLabel || 'Search point', radius); openRadar(controller, sid, false); return; }
    const same = s.center && distanceBearing(s.center, center)?.meters < 5 && s.radius === radius;
    if (!same || Date.now() - lastFollow > 30000) {
      lastFollow = Date.now(); follow.reads++;
      void read(sid, center, placeLabel || (same ? s.label : 'Search point'), radius);
    }
    openRadar(controller, sid, false);
  });
  controller.watch = createHuntWatch(ctx, { api, onFound: (sid, observation, center, label) => showInRadar(controller, activeSession(), observation, center, label) });
  return controller;
}
function useRadar(ctrl, sid) { useValue(ctrl.revision); return ctrl.state(sid); }
// A Radar button writes its question into the chat bar. The next button replaces the question the last one wrote,
// so questions never stack; anything the player typed themselves stays where it is.
const seeded = new Map();
export async function draft(textValue, sid = null) {
  const key = sid ?? '', previous = seeded.get(key)?.trim();
  let ok = false;
  if (previous && typeof host.composer.getDraft === 'function') {
    const current = ((await host.composer.getDraft(sid).catch(() => null)) ?? '').trimEnd();
    if (current.endsWith(previous)) {
      const rest = current.slice(0, current.length - previous.length).trimEnd();
      ok = await host.composer.setDraft(sid, rest ? rest + '\n\n' + textValue : textValue);
    }
  }
  if (!ok) ok = await host.composer.insertText(sid, textValue, { mode: 'block' });
  if (ok) seeded.set(key, textValue); else host.notify({ kind: 'warning', message: 'Open this chat to add the question.' });
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
  const named = !!s.label && !['Choose a spot', 'Search point'].includes(s.label);
  const place = named ? `near ${s.label}` : 'near this map pin';
  const question = kind === 'catches' ? `What's worth catching ${place} right now?`
    : kind === 'raids' ? `What raids and eggs are on ${place} right now?`
    : kind === 'gyms' ? `Which gyms ${place} have open slots?`
    : `What events are on today, and do they matter for the spawns ${place}?`;
  // A named place resolves by itself. Only a bare pin needs its link, so the agent reads the same point.
  return named ? question : `${question} Use this search area: ${mapUrl(s.center, s.radius)}`;
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
  const what = w.kind === 'iv' ? `IV ${w.minIV}% or better` : WATCH_KINDS[w.kind].toLowerCase();
  const status = w.busy ? 'Checking existing observations…'
    : w.active ? `Watching ${w.label} for ${what}, within 500 m. ${w.notice}`
      : w.notice || 'Set it and get on with your work. A desktop alert tells you when a match appears within 500 m.';
  return hs('section', { 'aria-label': 'Hunt Watch', style: { ...panel(c), marginTop: 14, padding: 12, borderColor: w.active ? c.accent : c.line }, children: [
    hs('div', { style: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 8 }, children: [
      h('strong', { style: { fontSize: 16, fontWeight: 800 }, children: 'Watch it' }),
      h('span', { style: { fontSize: 13, fontWeight: 600, color: c.accent }, children: '· Real-Time Desktop Notifications!' }),
      w.active && h('span', { style: { color: c.accent, fontSize: 11, marginLeft: 'auto' }, children: '● on' })
    ] }),
    hs('div', { style: { ...rowStyle, gap: 6 }, children: [
      h('select', { 'aria-label': 'Alert me about', value: w.kind, disabled: w.active, onChange: e => ctrl.watch.configure({ ...w, kind: e.target.value }),
        style: { ...field, flex: '1 1 120px', minWidth: 0 }, children: Object.entries(WATCH_KINDS).map(([value, name]) => h('option', { value, children: name }, value)) }),
      w.kind === 'iv' && h('input', { 'aria-label': 'Minimum IV %', type: 'number', min: 0, max: 100, step: 1, value: w.minIV, disabled: w.active,
        onChange: e => ctrl.watch.configure({ ...w, minIV: Number(e.target.value) }), style: { ...field, width: 58 } }),
      h(Button, { c, primary: !w.active, disabled: !w.active && !center, onClick: () => w.active ? ctrl.watch.stop() : ctrl.watch.start(sid, center, label), children: w.active ? 'Stop' : 'Watch' })
    ] }),
    h('p', { role: 'status', style: { ...fine(c), margin: '8px 0 0', fontSize: w.active || w.busy ? 12 : 13, color: w.active || w.busy ? c.muted : c.fg }, children: status }),
    !w.active && !w.busy && h('p', { style: { ...fine(c), margin: '3px 0 0', fontSize: 11 }, children: 'Checks once a minute for 2 hours. Never starts a scan.' }),
    w.active && w.scanNote && h('p', { style: { ...fine(c), margin: '6px 0 0', color: w.scan === 'ongoing' ? c.muted : c.accent }, children: w.scanNote }),
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
function IvBars({ c, p, tight = false }) {
  return h('div', { style: { display: 'grid', gap: tight ? 3 : 6, marginTop: tight ? 8 : 14 }, children:
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
  return hs('div', { style: { ...rowStyle, gap: inPane ? 14 : 22, alignItems: 'center', minWidth: 0 }, children: [
    h(HeroArt, { ctrl, c, p, size: inPane ? 80 : 150, dim: gone, sparkle: p.iv_percent === 100 }),
    hs('div', { style: { flex: inPane ? '1 1 150px' : '1 1 200px', minWidth: 0, opacity: gone ? .65 : 1 }, children: [
      hs('div', { style: { ...rowStyle, gap: 10 }, children: [
        h('strong', { style: { fontSize: inPane ? 20 : 28, lineHeight: 1.15 }, children: text(p.name, 80) || 'Pokémon' }),
        p.form_name && h('span', { style: fine(c), children: text(p.form_name, 60) }),
        hl && h('span', { style: { font: `700 12px ${font}`, color: c.ink, background: hl.color, borderRadius: 999, padding: '3px 11px' }, children: hl.label })
      ] }),
      h('div', { style: { fontSize: 14, marginTop: 3 }, children: [metric(p), number(p.cp) && `CP ${p.cp}`, number(p.level) && `Lv ${p.level}`].filter(Boolean).join(' · ') }),
      inPane && hs('div', { style: { ...fine(c), display: 'flex', alignItems: 'center', gap: 5 }, children: [
        d && d.meters >= 10 && h(Arrow, { c, degrees: d.bearing }), distanceLabel(center, p, place), timer.seconds > 0 && ` · ${timer.label} left`] }),
      verdict && hs('div', { style: { ...rowStyle, gap: 10, marginTop: inPane ? 8 : 12 }, children: [
        h(VerdictPill, { c, verdict }), h('span', { style: fine(c), children: verdict.detail })] }),
      !gone && h(IvBars, { c, p, tight: inPane }),
      !gone && rank && h('div', { style: { color: c.green, fontSize: 12, marginTop: inPane ? 5 : 8 }, children: rank }),
      !gone && hs('div', { style: { ...rowStyle, marginTop: inPane ? 10 : 14 }, children: [
        h(Button, { c, primary: true, style: { padding: inPane ? '7px 14px' : '10px 16px', fontSize: 13 }, disabled: !safeMapUrl(p.map_url), onClick: () => openMap(ctrl.ctx, p.map_url), children: 'Open live map ↗' }),
        !inPane && h(Button, { c, style: { padding: '10px 16px', fontSize: 13 }, onClick: () => showInRadar(ctrl, sid, p, center, place), children: 'Open Radar' })
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
// The empty Radar shows a faded piece of PokeIt's own map (downtown Atlanta, 400 px WebP, drawn from the live map) so it looks like a map before a search.
const RADAR_BG = 'data:image/webp;base64,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';
function RadarSvg({ ctrl, c, s, sid, ghost = false }) {
  const now = useValue(ctrl.clock), marks = s.observations.filter(p => !expiry(p, now).expired);
  useValue(ctrl.iconRev);
  return hs('svg', { viewBox: '0 0 320 320', role: 'img', 'aria-label': `North-up radar, ${s.radius} metre radius from search point`,
    style: { display: 'block', width: '100%', maxWidth: ghost ? 240 : undefined, maxHeight: 390, background: c.bg, borderRadius: 12, margin: ghost ? '12px auto' : 0, opacity: ghost ? .55 : 1 }, children: [
      h('style', { children: CSS }),
      !s.center && c.dark && hs('g', { 'aria-hidden': true, children: [
        hs('defs', { children: [
          hs('radialGradient', { id: 'pokeit-bg-fade', gradientUnits: 'userSpaceOnUse', cx: 160, cy: 160, r: 163, children: [
            h('stop', { offset: 0.53, stopColor: '#fff' }), h('stop', { offset: 1, stopColor: '#000' })] }),
          h('mask', { id: 'pokeit-bg-mask', children: h('rect', { width: 320, height: 320, fill: 'url(#pokeit-bg-fade)' }) })] }),
        h('image', { href: RADAR_BG, x: 0, y: 0, width: 320, height: 320, preserveAspectRatio: 'xMidYMid slice', opacity: 0.65, mask: 'url(#pokeit-bg-mask)' }),
        h('text', { x: 314, y: 317, textAnchor: 'end', fill: c.muted, fontSize: 6, children: '© OpenStreetMap contributors © CARTO' })] }),
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
    h('span', { style: { fontVariantNumeric: 'tabular-nums', fontSize: 12, color: timer.low ? c.red : c.muted }, children: timer.seconds > 0 ? timer.label + ' left' : '' })
  ] });
}
// A read this old may show catches that have despawned; the pane refreshes it when it is shown again.
const STALE_AFTER_S = 300;
export function readAgeSeconds(queriedAt, now) {
  const t = Date.parse(queriedAt || '');
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : null;
}
export function ageLabel(seconds) {
  const minutes = Math.floor(seconds / 60);
  return minutes < 120 ? `${Math.max(1, minutes)} ${minutes === 1 ? 'minute' : 'minutes'}` : `${Math.floor(minutes / 60)} hours`;
}
export function needsRefresh(s, now) {
  const age = readAgeSeconds(s?.queriedAt, now);
  return !!s?.center && !s.busy && age !== null && age >= STALE_AFTER_S;
}
// One line about the read, never two that contradict each other. Expired-everything outranks an old read,
// and an old read outranks the quiet-pick note.
export function radarNotice({ busy, queriedAt, quietPick, watching, shown, live, ageSeconds }) {
  if (busy || !queriedAt) return null;
  if (!live.length) {
    if (shown.length) return 'Every catch in this read has expired. Refresh for a new read.';
    return 'No matching catches in this read. Try nearby raids or open the live map.';
  }
  if (!watching && ageSeconds !== null && ageSeconds >= STALE_AFTER_S) return `This read is ${ageLabel(ageSeconds)} old, so some of these may be gone. Refresh for a current read.`;
  if (quietPick && !watching) return 'No hundos, nundos or PvP #1 in this read. These are the highest-IV catches.';
  return null;
}
// A scan the agent started is running: one dot per scan point, filling as points are confirmed. Compact on purpose.
const SCAN_SLOW_MS = 4 * 60000;
export function scanLine(scan, now) {
  if (!scan) return null;
  const slow = now - scan.since > SCAN_SLOW_MS && scan.done < scan.total;
  return { text: 'Scanning…', slow };
}
function ScanProgress({ c, scan, place, now, onRead }) {
  const line = scanLine(scan, now);
  // No point count: the plan's count lags the scan, so a number would look stuck. A small radar sweep says it is working.
  return hs('div', { role: 'status', 'aria-label': `Scanning ${place || 'this spot'}`, style: { ...panel(c), marginTop: 10, padding: 10, display: 'flex', gap: 12, alignItems: 'center' }, children: [
    hs('svg', { 'aria-hidden': true, width: 40, height: 40, viewBox: '0 0 40 40', style: { flexShrink: 0 }, children: [
      h('circle', { cx: 20, cy: 20, r: 18, fill: 'none', stroke: c.line }), h('circle', { cx: 20, cy: 20, r: 10, fill: 'none', stroke: c.line }),
      hs('g', { className: 'pokeit-spin', children: [
        h('path', { d: 'M20 20 L20 2 A18 18 0 0 1 35.6 11 Z', fill: c.accent, opacity: 0.28 }),
        h('line', { x1: 20, y1: 20, x2: 20, y2: 2, stroke: c.accent, strokeWidth: 2, strokeLinecap: 'round' })] }),
      h('circle', { cx: 20, cy: 20, r: 2.5, fill: c.accent })] }),
    hs('div', { style: { minWidth: 0 }, children: [
      h('strong', { style: { fontSize: 13 }, children: `Scanning ${place || 'this spot'}…` }),
      h('div', { style: fine(c), children: 'Scan in progress, this may take a minute or two.' }),
      line.slow && hs('div', { style: { ...fine(c), marginTop: 4 }, children: ['Still waiting on the last points. ',
        h('button', { type: 'button', onClick: onRead, style: { background: 'none', border: 0, padding: 0, color: c.accent, font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }, children: 'Show what is here now' })] })
    ] })
  ] });
}
function RadarPane({ ctrl, sessionId }) {
  // The pane follows the chat in front. It must not stay tied to the chat it was first opened from.
  const c = useColors(), sid = useActiveSession();
  const s = useRadar(ctrl, sid), now = useValue(ctrl.clock), w = useValue(ctrl.watch.view);
  // Coming back to an old read (the pane reopened, or the window shown again) reads the same spot once more. It is an existing-data read, never a scan.
  useEffect(() => {
    const check = () => {
      const cur = ctrl.state(sid);
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (needsRefresh(cur, Date.now()) && !(ctrl.watch.view.get().active)) void ctrl.read(sid, cur.center, cur.label, cur.radius);
    };
    check();
    if (typeof document === 'undefined') return undefined;
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [ctrl, sid]);
  // While Hunt Watch runs on this spot, its matches join the map and the list; the ones new in the latest read are marked.
  const watching = !!(w.active && s.center && w.center && distanceBearing(s.center, w.center)?.meters < 5);
  const known = new Set(s.observations.map(p => p.observation_id));
  const shown = watching ? [...s.observations, ...w.matches.filter(p => !known.has(p.observation_id))] : s.observations;
  const view = watching ? { ...s, observations: shown } : s, fresh = new Set(watching ? w.fresh : []);
  const live = shown.filter(p => !expiry(p, now).expired).sort((a, b) => fresh.has(b.observation_id) - fresh.has(a.observation_id));
  // An expired catch is not shown as if it were still there; the next live one stands in, or nothing does.
  const picked = shown.find(p => p.observation_id === s.selected);
  const selected = picked && !expiry(picked, now).expired ? picked : live[0] || null, place = named(s.label);
  const last = !s.center && !s.busy ? ctrl.lastSpot() : null;
  const status = s.coverage?.scan_plan?.status;
  const age = s.queriedAt ? Math.max(0, Math.floor((now - Date.parse(s.queriedAt)) / 1000)) : null;
  const next = watching && w.lastChecked ? Math.max(0, 60 - Math.floor((now - w.lastChecked) / 1000)) : null;
  const notice = radarNotice({ busy: s.busy, queriedAt: s.queriedAt, quietPick: s.quietPick, watching, shown, live, ageSeconds: age });
  const stale = !watching && age !== null && age >= STALE_AFTER_S;
  const landmarks = [s.gyms.length && `${s.gyms.length} ${s.gyms.length === 1 ? 'gym' : 'gyms'}`, s.stops.length && `${s.stops.length} Pokéstops`].filter(Boolean).join(' · ');
  return hs('section', { 'aria-label': 'PokeIt Radar', style: { background: c.surface, color: c.fg, padding: 14, overflowY: 'auto', height: '100%', fontFamily: font, boxSizing: 'border-box' }, children: [
    h(Styles, {}),
    hs('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }, children: [
      hs('div', { style: { minWidth: 0 }, children: [hs('h2', { style: { fontSize: 19, fontWeight: 800, margin: 0 }, children: ['Poke', h('span', { style: { color: c.accent }, children: 'It' }), ' Radar'] }),
        h('p', { style: { ...fine(c), margin: '4px 0 0' }, children: s.center ? s.label : 'Follows your chat' })] }),
      s.center && h(Button, { c, primary: stale || (!live.length && !!shown.length), disabled: s.busy, onClick: () => void ctrl.read(sid, s.center, s.label, s.radius), children: s.busy ? 'Reading…' : 'Refresh' })
    ] }),
    h(ErrorNote, { c, message: s.error }),
    !s.center ? hs('div', { style: { textAlign: 'center', marginTop: 8 }, children: [
      h(RadarSvg, { ctrl, c, s, sid, ghost: true }),
      h('p', { style: { margin: '10px 0 4px', fontSize: 24, fontWeight: 800, lineHeight: 1.15 }, children: "What's worth catching near you?" }),
      h('p', { style: { ...fine(c), fontSize: 13 }, children: 'Ask Hermes in the chat, or start with one of these:' }),
      h(Button, { c, primary: true, style: { width: '100%', marginTop: 10, padding: '13px 16px', fontSize: 15, fontWeight: 700 }, onClick: () => void draft(NEAR_ME, sid), children: NEAR_ME }),
      hs('div', { style: { display: 'grid', gap: 5, marginTop: 10 }, children: [
        ...EXAMPLES.map(([spot, kind]) => hs(Button, { c, style: { textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, fontSize: 12, padding: '6px 10px' }, onClick: () => void draft(`What's worth catching near ${spot}?`, sid), children: [
          h('span', { children: `What's worth catching near ${spot}?` }),
          h('span', { style: { font: `600 11px ${font}`, color: kind === 'live now' ? c.accent : c.muted, whiteSpace: 'nowrap' }, children: kind })] }, spot)),
        last && h(Button, { c, style: { textAlign: 'left' }, disabled: s.busy, onClick: () => void ctrl.read(sid, last.center, last.label, last.radius), children: `Back to ${last.label}` })
      ] })
    ] }) : hs('div', { children: [
      s.scan && h(ScanProgress, { c, scan: s.scan, place, now, onRead: () => { ctrl.stopScan?.(sid); void ctrl.read(sid, s.center, s.label, s.radius); } }),
      status === 'needs_scan' && !s.scan && hs('div', { style: { ...panel(c), marginTop: 10, padding: 10 }, children: [
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
            style: { background: c.raised, color: c.fg, border: `1px solid ${c.line}`, borderRadius: 6, padding: '3px 5px', font: `12px ${font}` }, children: [...new Set([...RADII, s.radius])].sort((a, b) => a - b).map(n => h('option', { value: n, children: n < 1000 ? n + ' m' : n / 1000 + ' km' }, n)) }),
            ' around the search point']
          }),
          h('button', { type: 'button', onClick: () => openMap(ctrl.ctx, mapUrl(s.center, s.radius)),
            style: { display: 'block', width: '100%', marginTop: 8, padding: '7px 10px', borderRadius: 8, border: `1px solid ${c.line}`, background: 'none', color: c.accent, font: `600 12px ${font}`, cursor: 'pointer', textAlign: 'center' },
            children: 'See this area on the PokeIt live map ↗' })
        ] }),
        hs('div', { style: { minWidth: 0 }, children: [
          notice && h('p', { role: 'status', style: { ...fine(c), marginTop: 0 }, children: notice }),
          selected && h('div', { style: { ...panel(c), background: c.bg }, children: h(CatchSummary, { ctrl, c, p: selected, center: s.center, sid, place, inPane: true }) }),
          live.length > 1 && h('div', { 'aria-label': watching ? 'Catches on watch' : 'Catches in this read', style: { marginTop: 10, maxHeight: 300, overflowY: 'auto', display: 'grid', gap: 2 },
            children: live.map(p => h(ResultRow, { ctrl, c, p, center: s.center, now, isNew: fresh.has(p.observation_id), selected: s.selected === p.observation_id, onSelect: () => ctrl.update(sid, { selected: p.observation_id }) }, p.observation_id)) })
        ] })
      ] }),
      h(HuntWatch, { ctrl, c, sid, center: s.center, label: s.label }),
      h(FollowUps, { ctrl, c, sid })
    ] }),
    hs('p', { style: { ...fine(c), fontSize: 11, marginTop: 16, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }, children: [
      h('span', { children: 'The pin is the place you asked about, not your GPS. The Radar never starts a scan.' }),
      h('button', { type: 'button', onClick: () => void ctrl.debug(), style: { background: 'none', border: 0, padding: 0, color: c.muted, font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }, children: 'Copy debug info' })] })
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
