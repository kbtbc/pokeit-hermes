// Run: node --experimental-vm-modules --test tests/test_desktop.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8');
function atom(value) {
  const subscribers = new Set();
  return { get: () => value, set: next => { value = next; subscribers.forEach(fn => fn(value)); },
    subscribe: fn => { subscribers.add(fn); fn(value); return () => subscribers.delete(fn); } };
}
const host = { notify: () => {}, state: { focusedStoredSessionId: atom('test'), focusedSessionId: atom('test'), profile: atom('default'), connectionId: atom('fixture'), gateway: atom('open') } };
const sdk = { host, atom, useValue: a => a.get(), useTheme: () => ({ resolvedMode: 'dark' }), gatewayActivationEpoch: () => 1,
  PANES_AREA: 'panes', STATUSBAR_AREAS: { right: 'statusBar.right' }, TRANSCRIPT_DIRECTIVE_AREA: 'transcript.directives' };
const react = { useEffect: () => {}, useMemo: fn => fn(), useRef: value => ({ current: value }), useState: () => {}, useId: () => 'id' };
const context = vm.createContext({ URL, URLSearchParams, Date, console });
const mod = new vm.SourceTextModule(source, { context });
await mod.link(name => {
  const value = name === '@hermes/plugin-sdk' ? sdk : name === 'react' ? react : { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  return new vm.SyntheticModule(Object.keys(value), function () { for (const [k, v] of Object.entries(value)) this.setExport(k, v); }, { context });
});
await mod.evaluate();
const ui = mod.namespace;

test('untrusted directive IDs and coordinates are bounded', () => {
  assert.equal(ui.catchAttributes({ id: 'pid_123', lat: '34.1', lon: '-84.2' }).id, 'pid_123');
  for (const attrs of [
    { id: '../key', lat: '34', lon: '-84' }, { id: 'pid_1', lat: 'Infinity', lon: '-84' },
    { id: 'pid_1', lat: '', lon: '-84' }, { id: 'pid_1', lat: '86', lon: '1' },
    { id: 'pid_1', lat: '0', lon: '181' }, { id: 'pid_1', lat: '1e2', lon: '0' }
  ]) assert.equal(ui.catchAttributes(attrs), null);
  assert.equal(ui.catchAttributes({ id: 'pid_1', lat: '0', lon: '0' }).lat, 0);
});
test('geocoder origin precision survives catch directives without accepting unbounded numbers', () => {
  const attrs = { id: 'pid_precision', lat: '34.076000', lon: '-84.290000',
    origin_lat: '34.074612345678901', origin_lon: '-84.29221234567890' };
  const parsed = ui.catchAttributes(attrs);
  assert.equal(parsed.origin_lat, Number(attrs.origin_lat));
  assert.equal(parsed.origin_lon, Number(attrs.origin_lon));
  const query = new URLSearchParams(parsed);
  assert.equal(Number(query.get('origin_lon')), Number(attrs.origin_lon));
  assert.ok(ui.distanceBearing({ lat: parsed.origin_lat, lon: parsed.origin_lon }, parsed).meters > 0);
  assert.equal(ui.coordinate('34.12345678901234567', 85), Number('34.12345678901234567'));
  for (const value of ['34.123456789012345678', '34.' + '1'.repeat(1000), 'NaN', 'Infinity', '1e1', '34junk', ' 34', '86']) {
    assert.equal(ui.coordinate(value, 85), null);
    assert.equal(ui.catchAttributes({ ...attrs, origin_lat: value }).origin_lat, undefined);
  }
});
test('map links cannot open another site, credentials, or an unsupported path', () => {
  assert.ok(ui.safeMapUrl('https://pokeit.cc/pokemon/pid_abc'));
  assert.ok(ui.safeMapUrl('https://pokeit.cc/map?lat=34&lon=-84&view=1'));
  for (const url of ['https://pokeit.cc.evil.test/map', 'https://someone@pokeit.cc/map', 'javascript:alert(1)', 'http://pokeit.cc/map', 'https://pokeit.cc/mcp', 'https://pokeit.cc:123/map']) assert.equal(ui.safeMapUrl(url), null);
});
test('north-up radar distances and bearings are geographic, including date-line crossing', () => {
  const center = { lat: 34, lon: -84 };
  assert.equal(ui.distanceBearing(center, { lat: 34.001, lon: -84 }).direction, 'N');
  assert.equal(ui.distanceBearing(center, { lat: 34, lon: -83.999 }).direction, 'E');
  assert.equal(ui.distanceBearing(center, { lat: 33.999, lon: -84.001 }).direction, 'SW');
  assert.ok(Math.abs(ui.distanceBearing(center, { lat: 34.001, lon: -84 }).meters - 111.2) < 1);
  const cross = ui.distanceBearing({ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 });
  assert.equal(cross.direction, 'E'); assert.ok(cross.meters < 225);
  assert.equal(ui.distanceBearing(null, center), null);
});
test('only a verified expiry is definitive; approximate and missing expiry stay qualified', () => {
  const now = Date.parse('2026-11-07T22:00:00Z');
  assert.equal(ui.expiry({ expires_at: '2026-11-07T22:01:03Z', expiry_verified: true }, now).label, '1:03');
  assert.equal(ui.expiry({ expires_at: '2026-11-07T22:01:03Z', expiry_verified: false }, now).label, '~1:03');
  assert.equal(ui.expiry({ expires_at: '2026-11-07T21:59:59Z', expiry_verified: false }, now).expired, false);
  assert.equal(ui.expiry({ expires_at: '2026-11-07T21:59:59Z', expiry_verified: true }, now).expired, true);
  assert.equal(ui.expiry({}, now).seconds, null);
});
test('scan progress uses confirmed plus existing counts, never elapsed time', () => {
  const p = ui.scanProgress({ status: 'queued', total_points: 49, counts: { confirmed: 14, existing_area: 7, pending: 25, unverified: 2, failed: 1 }, poll_after_seconds: 30 });
  assert.equal(p.done, 21); assert.equal(p.total, 49); assert.equal(p.delay, 30); assert.equal(p.terminal, false);
  assert.equal(ui.scanProgress({ status: 'partial_unverified' }).terminal, true);
  assert.equal(ui.scanProgress({ status: 'dispatch_unknown' }).terminal, false);
  assert.equal(ui.scanProgress({}).total, null);
});
test('registration only mounts UI and timers; it never calls the service', () => {
  const contributions = [], disposers = [];
  ui.default.register({ register: c => contributions.push(c), setInterval: () => () => {}, onEvent: () => {}, onDispose: d => disposers.push(d), rest: () => { throw Error('unexpected request'); } });
  assert.deepEqual(contributions.map(c => c.id), ['radar', 'status', 'catch', 'scan']);
  assert.equal(contributions[0].data.placement, 'right');
  assert.equal(contributions[2].data.name, 'pokeit-catch');
  for (const dispose of disposers) dispose();
  // The plugin may watch for the agent's scan tool finishing (one exact expression, to show progress). It may never name that tool anywhere else, which would be a way to call it.
  const observed = "name.endsWith('request_scan')";
  assert.equal(source.split(observed).length - 1, 1);
  assert.doesNotMatch(source.replace(observed, ''), /request_scan|composer\.submit|window\.hermes|document\.(?:querySelector|getElementById)/);
});

test('Show in Radar selects the catch and opens the same workspace for its chat', () => {
  const calls = [];
  host.openWorkspace = (id, options) => calls.push({ id, options });
  const ctrl = { adopt: (...args) => calls.push(args) };
  const p = { observation_id: 'pid_demo', lat: 34, lon: -84 };
  ui.showInRadar(ctrl, 'chat-2', p, { lat: 34.001, lon: -84 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'chat-2');
  assert.equal(calls[1].id, 'pokeit:radar');
  const pane = calls[1].options.render();
  assert.equal(pane.props.sessionId, 'chat-2');
});

test('a late previous-area read cannot replace the selected card location', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const ctrl = ui.createController({ setInterval: () => () => {}, onEvent: () => {}, onDispose: () => {},
    rest: path => path.startsWith('/nearby') ? pending : Promise.resolve({ ok: true, data: { scan_plan: { status: 'existing_coverage' } } }) });
  const task = ctrl.read('test', { lat: 34, lon: -84 }, 'Old point', 500);
  ctrl.adopt('test', { observation_id: 'pid_new', name: 'New catch', lat: 35, lon: -85 }, { lat: 35, lon: -85 });
  finish({ ok: true, data: { observations: [{ observation_id: 'pid_old', lat: 34, lon: -84 }], queried_at: '2026-11-07T22:00:00Z' } });
  await task;
  assert.equal(ctrl.state('test').selected, 'pid_new');
  assert.equal(ctrl.state('test').center.lat, 35);
  assert.equal(ctrl.state('test').observations.length, 1);
  assert.equal(ctrl.state('test').busy, false);
});

test('standalone Radar follow-ups include the named place and precise map pin', () => {
  const s = { center: { lat: 34.0746, lon: -84.2922 }, label: 'Alpharetta City Hall', radius: 500, observations: [{ name: 'Rattata' }] };
  const raids = ui.followUpQuestion('raids', s);
  assert.match(raids, /Alpharetta City Hall/);
  assert.match(raids, /https:\/\/pokeit\.cc\/map\?lat=34.0746&lon=-84.2922/);
  assert.match(raids, /Keep eggs separate/);
  assert.match(ui.followUpQuestion('events', s), /Rattata useful today/);
  assert.equal(ui.followUpQuestion('raids', { center: null }), null);
});
test('the catches follow-up asks for cards by name, so a chat started from the Radar shows them', () => {
  const s = { center: { lat: 34.0746, lon: -84.2922 }, label: 'Alpharetta City Hall', radius: 500, observations: [] };
  const q = ui.followUpQuestion('catches', s);
  assert.match(q, /What is worth catching near Alpharetta City Hall\? Show PokeIt cards\./);
  assert.match(q, /https:\/\/pokeit\.cc\/map\?lat=34.0746&lon=-84.2922/);
  assert.equal(ui.followUpQuestion('catches', { center: null }), null);
});
test('a Radar button replaces the question the last button wrote and keeps what the player typed', async () => {
  let text = '';
  host.composer = {
    getDraft: async () => text,
    setDraft: async (sid, next) => { text = next; return true; },
    insertText: async (sid, next) => { text = text ? text + '\n\n' + next : next; return true; }
  };
  await ui.draft('Best catches near A?', 'draft-a');
  await ui.draft('Raids near A?', 'draft-a');
  await ui.draft('Gyms near A?', 'draft-a');
  assert.equal(text, 'Gyms near A?');
  text = 'my own note\n\n' + text;
  await ui.draft('Events near A?', 'draft-a');
  assert.equal(text, 'my own note\n\nEvents near A?');
  text = '';
  await ui.draft('Raids near A?', 'draft-a');
  assert.equal(text, 'Raids near A?');
  text = 'typed after\n\n' + text + ' and more';
  await ui.draft('Gyms near A?', 'draft-a');
  assert.match(text, /and more\n\nGyms near A\?$/);
  delete host.composer;
});
test('an unreachable backend still leaves a card with a place, a distance and a map link', () => {
  const args = ui.catchAttributes({ id: 'pid_offline', lat: '34.0752', lon: '-84.2900', origin_lat: '34.0746349', origin_lon: '-84.2922705' });
  const withOrigin = ui.offlineCatch(args, 'Alpharetta City Hall');
  assert.match(withOrigin.where, /^\d+ m (N|NE|E|SE|S|SW|W|NW) of Alpharetta City Hall$/);
  assert.ok(ui.safeMapUrl(withOrigin.mapLink));
  assert.equal(ui.offlineCatch({ id: 'pid_x', lat: 34, lon: -84 }, 'Alpharetta City Hall').where, 'Near Alpharetta City Hall');
  assert.equal(ui.offlineCatch({ id: 'pid_x', lat: 34, lon: -84 }, '').where, 'At the pin the agent chose');
  assert.equal(ui.offlineCatch(null, 'x'), null);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const webp = 'data:image/webp;base64,UklGRgQAAABXRUJQVlA4IA==';
function iconController(rest, storage = new Map()) {
  return ui.createController({ setInterval: () => () => {}, onEvent: () => {}, onDispose: () => {}, rest,
    storage: { get: (k, fallback) => storage.get(k) ?? fallback, set: (k, v) => storage.set(k, v) } });
}

test('place names are plain display text and stay out of service requests', () => {
  assert.equal(ui.placeName({ place: '  Alpharetta City Hall  ' }), 'Alpharetta City Hall');
  assert.equal(ui.placeName({ place: 'City\u0000Hall\n<b>x</b>' }), 'City Hall <b>x</b>');
  assert.equal(ui.placeName({ place: 'x'.repeat(200) }).length, 80);
  assert.equal(ui.placeName({}), ''); assert.equal(ui.placeName({ place: 5 }), '');
  assert.equal(ui.catchAttributes({ id: 'pid_1', lat: '1', lon: '1', place: 'Somewhere' }).place, undefined);
});

test('the walking guide is a straight line at 5 km/h against the time left, and says when it cannot tell', () => {
  const ok = ui.walkVerdict(256, 835, true);
  assert.equal(ok.tone, 'ok'); assert.equal(ok.label, 'Worth the walk');
  assert.equal(ok.detail, '3 min on foot, 10 min to spare'); assert.equal(ok.note, 'Worth it: 3 min, 13:55 left');
  assert.equal(ui.walkVerdict(256, 835, false).detail, '3 min on foot, ~10 min to spare');
  const tight = ui.walkVerdict(500, 480, true);
  assert.equal(tight.tone, 'tight'); assert.equal(tight.detail, '6 min on foot, 8:00 left');
  const far = ui.walkVerdict(167, 79, false);
  assert.equal(far.tone, 'far'); assert.equal(far.detail, '2 min on foot, only ~1:19 left'); assert.equal(far.note, 'Too far: 2 min, ~1:19 left');
  assert.equal(ui.walkVerdict(5, 600, true).detail, 'Right here, 10 min to spare');
  assert.equal(ui.walkVerdict(5, 600, true).note, 'Worth it: right here, 10:00 left');
  for (const [m, s] of [[null, 100], [100, 0], [100, -5], [NaN, 100], [100, null], [100, Infinity]]) assert.equal(ui.walkVerdict(m, s), null);
});

test('only the exact word compact asks for the compact card', () => {
  assert.equal(ui.catchVariant({ variant: 'compact' }), 'compact');
  for (const v of ['Compact', 'full', 'compact ', '', undefined, 5]) assert.equal(ui.catchVariant({ variant: v }), 'full');
  assert.equal(ui.catchVariant(undefined), 'full');
  assert.equal(ui.catchAttributes({ id: 'pid_1', lat: '1', lon: '1', variant: 'compact' }).variant, undefined);
});

test('icon keys name a species and form, and nothing else', () => {
  assert.equal(ui.iconKey({ pokemon_id: 498, form: 0 }), '498');
  assert.equal(ui.iconKey({ pokemon_id: 25, form: 1 }), '25_1');
  for (const p of [{}, { pokemon_id: 0 }, { pokemon_id: 5000 }, { pokemon_id: '25' }, { pokemon_id: 1.5 }, null]) assert.equal(ui.iconKey(p), null);
  assert.equal(ui.iconKey({ pokemon_id: 25, form: '../x' }), '25');
});

test('icons load once per species, a few at a time, and only accept inline webp images', async () => {
  const paths = []; let release;
  const gate = new Promise(r => { release = r; });
  const ctrl = iconController(async path => {
    paths.push(path); await gate;
    return { ok: true, data: { url: path.startsWith('/icon/666') ? 'data:image/svg+xml;base64,PHN2Zz4=' : webp } };
  });
  const species = [498, 19, 25, 150, 666].map(id => ({ pokemon_id: id, form: 0 }));
  assert.deepEqual(species.map(p => ctrl.icon(p)), [undefined, undefined, undefined, undefined, undefined]);
  ctrl.icon(species[0]);
  assert.equal(paths.length, 3);
  release(); await flush(); await flush();
  assert.equal(paths.length, 5); assert.equal(new Set(paths).size, 5);
  assert.equal(ctrl.icon(species[0]), webp);
  assert.equal(ctrl.icon(species[4]), null);
  assert.equal(ctrl.icon({ pokemon_id: 25, form: 1 }), undefined);
  assert.equal(paths.at(-1), '/icon/25?form=1');
  assert.equal(ctrl.icon({ name: 'No id' }), null);
});

test('a failed icon never marks the backend unhealthy and falls back to a letter', async () => {
  const ctrl = iconController(async path => path.startsWith('/icon') ? { ok: false, error: { message: 'down' } } : { ok: true, data: {} });
  await ctrl.api('/health'); assert.equal(ctrl.healthy(), true);
  ctrl.icon({ pokemon_id: 7, form: 0 }); await flush(); await flush();
  assert.equal(ctrl.icon({ pokemon_id: 7, form: 0 }), null);
  assert.equal(ctrl.healthy(), true);
});

test('the last spot is remembered locally after a read, validated on the way back, and never read on its own', async () => {
  const storage = new Map(); let reads = 0;
  const ctrl = iconController(async path => { reads++; return { ok: true, data: path.startsWith('/nearby') ? { observations: [], queried_at: '2026-11-07T22:00:00Z' } : {} }; }, storage);
  assert.equal(ctrl.lastSpot(), null); assert.equal(reads, 0);
  await ctrl.read('test', { lat: 34.07, lon: -84.29 }, 'Alpharetta City Hall', 250);
  assert.equal(JSON.stringify(ctrl.lastSpot()), '{"center":{"lat":34.07,"lon":-84.29},"label":"Alpharetta City Hall","radius":250}');
  for (const bad of [{ lat: 'x', lon: 1, label: 'a', radius: 500 }, { lat: 99, lon: 1, label: 'a', radius: 500 }, { lat: 1, lon: 1, label: 'a', radius: 7 }, { lat: 1, lon: 1, label: 5, radius: 500 }]) {
    storage.set([...storage.keys()].find(k => k.startsWith('last-spot')), bad); assert.equal(ctrl.lastSpot(), null);
  }
});

test('opening a card names the search point after the place the agent gave', () => {
  const ctrl = iconController(async () => ({ ok: true, data: {} }));
  ctrl.adopt('test', { observation_id: 'pid_1', name: 'Tepig', lat: 34.07, lon: -84.29 }, { lat: 34.07, lon: -84.3 }, 'Alpharetta City Hall');
  assert.equal(ctrl.state('test').label, 'Alpharetta City Hall');
  ctrl.adopt('other', { observation_id: 'pid_2', name: 'Rattata', lat: 34.07, lon: -84.29 }, { lat: 34.07, lon: -84.3 });
  assert.equal(ctrl.state('other').label, 'Search point');
});

function watchHarness(api) {
  const timers = [], notices = [], disposers = [], events = {}, storage = new Map();
  let time = Date.parse('2026-11-07T22:00:00Z');
  const ctx = { storage: { get: (k, fallback) => storage.get(k) ?? fallback, set: (k, v) => storage.set(k, v) },
    setInterval: (callback, ms) => { const t = { callback, ms, stopped: false }; timers.push(t); return () => { t.stopped = true; }; },
    setTimeout: (callback, ms) => { const t = { callback, ms, stopped: false, once: true }; timers.push(t); return () => { t.stopped = true; }; },
    onEvent: (name, fn) => { events[name] = fn; }, onDispose: fn => disposers.push(fn),
    os: { notify: n => notices.push({ kind: 'os', ...n }) }, pet: { say: body => { notices.push({ kind: 'pet', body }); return () => {}; } } };
  const watch = ui.createHuntWatch(ctx, { api, now: () => time, onFound: () => {} });
  return { watch, ctx, timers, notices, events, storage, advance: ms => { time += ms; }, dispose: () => disposers.forEach(f => f()) };
}
const watchCenter = { lat: 34, lon: -84 };
const match = (id, iv = 100) => ({ observation_id: 'pid_' + id, name: 'Dratini', lat: 34.001, lon: -84, iv_percent: iv,
  expires_at: '2026-11-07T23:00:00Z', expiry_verified: true });

test('watch filters match the chosen criterion, exact spot, live expiry and evolved PvP rank', () => {
  const config = { center: watchCenter, kind: 'highlights', minIV: 90 }, now = Date.parse('2026-11-07T22:00:00Z');
  assert.equal(ui.watchMatches(match('hundo'), config, now), true);
  assert.equal(ui.watchMatches(match('ordinary', 99), config, now), false);
  assert.equal(ui.watchMatches(match('nundo', 0), { ...config, kind: 'nundo' }, now), true);
  assert.equal(ui.watchMatches({ ...match('evolution', 70), pvp_iv_rankings: { ultra: [{ rank: 1, ranked_species_name: 'Dragonite' }] } }, { ...config, kind: 'pvp' }, now), true);
  assert.equal(ui.watchMatches({ ...match('far'), lat: 35 }, config, now), false);
  assert.equal(ui.watchMatches({ ...match('expired'), expires_at: '2026-11-07T21:59:59Z' }, config, now), false);
  for (const [kind, key, value] of [['hundo', 'min_iv', '100'], ['nundo', 'max_iv', '0'], ['iv', 'min_iv', '90']]) {
    const query = new URL(ui.watchQuery({ ...config, kind }), 'https://test').searchParams;
    assert.equal(query.get(key), value); assert.equal(query.get('radius_m'), '500'); assert.equal(query.get('selection'), 'all');
  }
});

test('watch starts only on request, aggregates and dedupes observations, throttles two minutes and stops polling', async () => {
  let reads = 0, rows = [match('a'), match('b')];
  const f = watchHarness(async path => { if (path.startsWith('/coverage')) return {}; reads++; return { observations: rows, truncated: false }; });
  assert.equal(reads, 0); assert.equal(f.timers.length, 0);
  assert.equal(f.watch.start('test', watchCenter, 'City Hall'), true);
  await flush(); assert.equal(reads, 1); assert.equal(f.timers[0].ms, 60000);
  assert.equal(f.notices.filter(n => n.kind === 'os').length, 1);
  assert.match(f.notices[0].body, /Nearby Dratini \(100%\) \+1 more\. Found near City Hall @ /);
  f.advance(60000); rows = [...rows, match('c')]; await f.watch.poll();
  assert.equal(f.notices.filter(n => n.kind === 'os').length, 1);
  f.advance(60000); await f.watch.poll();
  assert.equal(f.notices.filter(n => n.kind === 'os').length, 2);
  assert.match(f.notices.filter(n => n.kind === 'os')[1].title, /^PokeIt! Nearby Dratini \(100%\)$/);
  f.advance(120000); await f.watch.poll(); assert.equal(f.notices.filter(n => n.kind === 'os').length, 2);
  f.watch.stop(); assert.equal(f.timers[0].stopped, true);
  const before = reads; await f.watch.poll(); assert.equal(reads, before); assert.equal(f.watch.view.get().active, false);
  f.dispose();
});

test('the toast leads with the catch, then where and when, how long it lasts and a map link', () => {
  const found = Date.parse('2026-11-09T19:30:00');
  const one = ui.watchToast([{ ...match('toast'), name: 'Skwovet', iv_percent: 91.11, lat: 33.7601, lon: -84.3934, expires_at: '2026-11-09T19:48:00', expiry_verified: true }], 'Centennial Olympic Park, Atlanta', found);
  assert.equal(one.title, 'PokeIt! Nearby Skwovet (91.1%)');
  const lines = one.body.split(/\r?\n/);
  assert.match(lines[0], /^Found near Centennial Olympic Park, Atlanta @ 7:30/);
  assert.match(lines[1], /^Expires: 7:48/); assert.doesNotMatch(lines[1], /estimated/);
  assert.match(lines[2], /^https:\/\/pokeit\.cc\/map\?lat=33\.7601&lon=-84\.3934/);
  const many = ui.watchToast([match('a'), match('b'), match('c')], 'Park', found);
  assert.match(many.title, /\+2 more$/);
  assert.match(ui.watchToast([{ ...match('guess'), expiry_verified: false }], 'Park', found).body, /Expires: .* \(estimated\)/);
});
test('a watch ends by itself after two hours and says so', async () => {
  const f = watchHarness(async path => path.startsWith('/coverage') ? {} : { observations: [], truncated: false });
  f.watch.start('test', watchCenter, 'City Hall'); await flush();
  const limit = f.timers.find(t => t.once);
  assert.equal(limit.ms, 2 * 60 * 60 * 1000);
  limit.callback(); await flush();
  assert.equal(f.watch.view.get().active, false);
  assert.match(f.watch.view.get().notice, /ended after 2 hours/);
  assert.equal(f.timers.find(t => !t.once).stopped, true);
  assert.ok(f.notices.some(n => n.kind === 'os' && /ended/.test(n.title)));
  f.dispose();
});
test('the watch says whether ongoing scans cover the spot, and warns when none do', async () => {
  const on = watchHarness(async path => path.startsWith('/coverage') ? { areas: ['GA-Atlanta'], scan_plan: { status: 'existing_coverage' } } : { observations: [] });
  on.watch.start('test', watchCenter, 'City Hall'); await flush();
  assert.equal(on.watch.view.get().scan, 'ongoing'); assert.match(on.watch.view.get().scanNote, /Ongoing scans cover this spot \(GA-Atlanta\)/); on.dispose();
  // The edge of a scanned area: 42 of the 49 scan points inside it is still a scanned spot, although the plan says needs_scan.
  const edge = watchHarness(async path => path.startsWith('/coverage')
    ? { areas: ['GA-Alpharetta/Roswell'], scan_plan: { status: 'needs_scan', total_points: 49, counts: { existing_area: 42, needed: 7 } } } : { observations: [] });
  edge.watch.start('test', watchCenter, 'Avalon'); await flush();
  assert.equal(edge.watch.view.get().scan, 'ongoing'); edge.dispose();
  const none = watchHarness(async path => path.startsWith('/coverage')
    ? { areas: [], scan_plan: { status: 'needs_scan', total_points: 49, counts: { existing_area: 0, needed: 49 } }, nearest_areas: [{ name: 'PA-Philadelphia', distance_miles: 81.6 }] } : { observations: [] });
  none.watch.start('test', watchCenter, 'City Hall'); await flush();
  assert.equal(none.watch.view.get().scan, 'none');
  assert.match(none.watch.view.get().scanNote, /No ongoing scans cover this spot.*PA-Philadelphia, 81\.6 mi away/);
  assert.equal(none.watch.view.get().active, true); none.dispose();
  const unknown = watchHarness(async path => { if (path.startsWith('/coverage')) throw Error('down'); return { observations: [] }; });
  unknown.watch.start('test', watchCenter, 'City Hall'); await flush();
  assert.equal(unknown.watch.view.get().scan, ''); assert.equal(unknown.watch.view.get().active, true); unknown.dispose();
});
test('stopping a watch ignores in-flight results, and failed polls remain visible without notification spam', async () => {
  let resolve;
  const f = watchHarness(() => new Promise(r => { resolve = r; }));
  f.watch.start('test', watchCenter, 'City Hall'); f.watch.stop();
  resolve({ observations: [match('late')] }); await flush();
  assert.equal(f.notices.length, 0); assert.equal(f.watch.view.get().active, false); f.dispose();
  const bad = watchHarness(async () => { throw Error('Read failed'); });
  bad.watch.start('test', watchCenter, 'City Hall'); await flush();
  assert.equal(bad.watch.view.get().error, 'Read failed'); assert.equal(bad.watch.view.get().active, true);
  assert.equal(bad.notices.length, 0); bad.dispose();
});

test('a rejected OS notification does not fail the successful watch read or escape as an unhandled promise', async () => {
  const f = watchHarness(async () => ({ observations: [match('notify-failure')], truncated: false }));
  f.ctx.os.notify = () => Promise.reject(Error('OS bridge refused'));
  f.watch.start('test', watchCenter, 'City Hall'); await flush();
  assert.equal(f.watch.view.get().error, ''); assert.equal(f.watch.view.get().matched, 1);
  assert.match(f.watch.view.get().notice, /Nearby Dratini/);
  assert.match(f.watch.view.get().notificationNote, /OS alerts are unavailable/);
  assert.equal(f.watch.view.get().active, true); f.dispose();
});

test('watch preferences are profile-scoped, never persist location or autostart, and profile/disposal cancels timers', async () => {
  const f = watchHarness(async () => ({ observations: [], truncated: true }));
  f.watch.configure({ kind: 'iv', minIV: 90 });
  const stored = [...f.storage.values()][0];
  assert.equal(JSON.stringify(stored), '{"kind":"iv","minIV":90}');
  f.watch.start('test', watchCenter, 'City Hall'); await flush();
  assert.equal(f.watch.view.get().truncated, true);
  host.state.profile.set('other-profile');
  assert.equal(f.watch.view.get().active, false); assert.equal(f.timers[0].stopped, true);
  assert.equal(f.watch.view.get().kind, 'highlights');
  host.state.profile.set('default'); assert.equal(f.watch.view.get().kind, 'iv');
  f.watch.start('test', watchCenter, 'City Hall'); await flush();
  f.events['gateway.ready'](); assert.equal(f.watch.view.get().active, false);
  f.watch.start('test', watchCenter, 'City Hall'); await flush(); f.dispose();
  assert.equal(f.timers.at(-1).stopped, true);
});

// Values from the plugin's module realm are compared by content.
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
test('the map viewer is given only positions and labels, with expired and malformed rows left out', () => {
  const now = Date.now(), at = m => new Date(now + m * 60000).toISOString();
  const s = { center: { lat: 34.07, lon: -84.29 }, radius: 500, busy: false, selected: 'pid_a', label: 'City Hall',
    observations: [{ observation_id: 'pid_a', lat: 34.071, lon: -84.291, name: 'Dratini', pokemon_id: 147, form: 46, iv_percent: 100, expires_at: at(10), expiry_verified: true, encounter_id: 'secret' },
      { observation_id: 'pid_gone', lat: 34.07, lon: -84.29, name: 'Gone', pokemon_id: 1, expires_at: at(-1), expiry_verified: true },
      { observation_id: '../bad', lat: 34.07, lon: -84.29 }, { observation_id: 'pid_nowhere', lat: 'x', lon: 1 }],
    gyms: [{ id: 'abc123.12', lat: 34.072, lon: -84.292, name: 'Fountain', team: 'valor', raid: true, map_url: 'https://example.test' }, { id: 'bad id', lat: 1, lon: 1 }],
    stops: [{ id: 'def456.16', lat: 34.073, lon: -84.293, name: 'Mural', lure: false, rocket: true }, { id: 'x', lat: null, lon: 1 }] };
  const state = ui.mapState(s, { light: true, watching: true, now });
  same(state.items.map(p => p.id), ['pid_a']);
  assert.equal(state.items[0].tag, 'Hundo'); assert.equal(state.items[0].form, 46);
  same(Object.keys(state.items[0]).sort(), ['expires', 'form', 'id', 'iv', 'lat', 'lon', 'name', 'pokemon_id', 'tag', 'verified']);
  same(state.gyms, [{ id: 'abc123.12', lat: 34.072, lon: -84.292, name: 'Fountain', team: 'valor', raid: true }]);
  same(state.stops, [{ id: 'def456.16', lat: 34.073, lon: -84.293, name: 'Mural', lure: false, rocket: true }]);
  assert.equal(state.theme, 'light'); assert.equal(state.watching, true); assert.equal(state.selected, 'pid_a');
  assert.equal(JSON.stringify(state).includes('City Hall'), false);
  assert.equal(ui.mapState({ center: null, radius: 500, observations: [], gyms: undefined, stops: undefined }).center, null);
});

test('a running watch keeps its matches for the map and marks only later arrivals as new', async () => {
  let rows = [match('first')];
  const f = watchHarness(async () => ({ observations: rows, truncated: false }));
  f.watch.start('test', watchCenter, 'City Hall'); await flush();
  same(f.watch.view.get().matches.map(p => p.observation_id), [rows[0].observation_id]);
  same(f.watch.view.get().fresh, []); same(f.watch.view.get().center, watchCenter);
  rows = [match('first'), match('second')];
  await f.watch.poll(); await flush();
  assert.equal(f.watch.view.get().matches.length, 2);
  same(f.watch.view.get().fresh, [rows[1].observation_id]);
  f.watch.stop(); same(f.watch.view.get().matches, []); assert.equal(f.watch.view.get().center, null); f.dispose();
});

test('the pane says one true thing about the read, never two that contradict each other', () => {
  const live = [{ observation_id: 'pid_a' }], gone = [{ observation_id: 'pid_b' }];
  const base = { busy: false, queriedAt: '2026-11-09T19:00:00Z', quietPick: false, watching: false, shown: live, live, ageSeconds: 30 };
  assert.equal(ui.radarNotice(base), null);
  // The single quiet pick has expired: only the expired line shows, not "no highlights" plus "no matching catches".
  assert.match(ui.radarNotice({ ...base, quietPick: true, shown: gone, live: [] }), /has expired/);
  assert.match(ui.radarNotice({ ...base, shown: [], live: [] }), /No matching catches/);
  assert.match(ui.radarNotice({ ...base, quietPick: true }), /No hundos, nundos or PvP/);
  // An old read outranks the quiet-pick note, and says how old it is.
  assert.match(ui.radarNotice({ ...base, quietPick: true, ageSeconds: 63 * 60 }), /63 minutes old/);
  assert.equal(ui.radarNotice({ ...base, busy: true }), null);
  assert.equal(ui.radarNotice({ ...base, queriedAt: null }), null);
  // A running watch keeps its own freshness, so the old-read line stays out of its way.
  assert.equal(ui.radarNotice({ ...base, watching: true, ageSeconds: 63 * 60 }), null);
});
test('an old read is refreshed once when the pane is shown again, and a fresh or failed one is left alone', () => {
  const now = Date.parse('2026-11-09T20:00:00Z');
  const center = { lat: 34, lon: -84 };
  assert.equal(ui.needsRefresh({ center, busy: false, queriedAt: '2026-11-09T18:57:00Z' }, now), true);
  assert.equal(ui.needsRefresh({ center, busy: false, queriedAt: '2026-11-09T19:58:00Z' }, now), false);
  assert.equal(ui.needsRefresh({ center, busy: true, queriedAt: '2026-11-09T18:57:00Z' }, now), false);
  assert.equal(ui.needsRefresh({ center: null, busy: false, queriedAt: '2026-11-09T18:57:00Z' }, now), false);
  assert.equal(ui.needsRefresh({ center, busy: false, queriedAt: null }, now), false);     // a read that failed has no time and cannot loop
  assert.equal(ui.readAgeSeconds('not a date', now), null);
  assert.equal(ui.ageLabel(60), '1 minute');
  assert.equal(ui.ageLabel(63 * 60), '63 minutes');
  assert.equal(ui.ageLabel(3 * 3600), '3 hours');
});

test('the Radar shows the same best-four list as the chat: highlights first, filled by IV, no duplicates, and a failed fill keeps the highlights', async () => {
  const row = (id, extra = {}) => ({ observation_id: id, lat: 34, lon: -84, ...extra });
  const make = fill => ui.createController({ setInterval: () => () => {}, onEvent: () => {}, onDispose: () => {},
    rest: path => path.startsWith('/nearby?') && path.includes('selection=all') ? fill(path)
      : path.startsWith('/nearby?') ? Promise.resolve({ ok: true, data: { observations: [row('pid_hl', { highlight: 'pvp_rank_1' })], queried_at: '2026-11-09T20:00:00Z' } })
      : Promise.resolve({ ok: true, data: {} }) });
  const fills = [];
  const ok = make(path => { fills.push(path); return Promise.resolve({ ok: true, data: { observations: [row('pid_hl'), row('pid_a'), row('pid_b'), row('pid_c'), row('pid_d')] } }); });
  await ok.read('t', { lat: 34, lon: -84 }, 'Spot', 500);
  assert.equal(JSON.stringify(ok.state('t').observations.map(p => p.observation_id)), JSON.stringify(['pid_hl', 'pid_a', 'pid_b', 'pid_c']));
  assert.equal(ok.state('t').quietPick, false);                         // there was a highlight, so no "no highlights" note
  assert.match(fills[0], /order=priority/); assert.match(fills[0], /limit=4/);
  const broken = make(() => Promise.reject(new Error('down')));
  await broken.read('t', { lat: 34, lon: -84 }, 'Spot', 500);
  assert.equal(JSON.stringify(broken.state('t').observations.map(p => p.observation_id)), JSON.stringify(['pid_hl']));
  assert.equal(broken.state('t').error, '');
});

function followHarness(rest) {
  const events = {}, timeouts = [];
  const ctrl = ui.createController({ setInterval: () => () => {}, setTimeout: (cb, ms) => { timeouts.push({ cb, ms }); return () => {}; },
    onEvent: (name, fn) => { events[name] = fn; }, onDispose: () => {}, rest,
    storage: { get: (k, fallback) => fallback, set: () => {} } });
  return { ctrl, events, timeouts };
}
const finds = (id, lat) => ({ session_id: id, payload: { name: 'mcp__pokeit__find_pokemon', args: { lat, lon: -84.29, radius_m: 500 } } });

test('the follow hook accepts the stored or the runtime id of the focused chat, and ignores another chat and replays', async () => {
  host.openWorkspace = () => {};
  host.state.focusedStoredSessionId.set('stored-1'); host.state.focusedSessionId.set('runtime-1');
  const paths = [];
  const f = followHarness(async path => { paths.push(path); return { ok: true, data: path.startsWith('/nearby') ? { observations: [], queried_at: '2026-11-09T21:00:00Z' } : {} }; });
  const reads = () => paths.filter(p => p.startsWith('/nearby')).length;
  f.events['tool.complete'](finds('stored-1', 34.01)); await flush(); assert.equal(reads() > 0, true);
  const before = reads();
  f.events['tool.complete'](finds('runtime-1', 34.02)); await flush(); assert.equal(reads() > before, true);
  const mid = reads();
  f.events['tool.complete'](finds('some-other-chat', 34.03)); await flush(); assert.equal(reads(), mid);
  f.events['tool.complete']({ ...finds('stored-1', 34.04), replayed: true }); await flush(); assert.equal(reads(), mid);
  host.state.focusedStoredSessionId.set('test'); host.state.focusedSessionId.set('test');
});

test('the Radar reads the ring the agent read, including 371 m after a scan, and a stale in-progress line clears', async () => {
  host.openWorkspace = () => {};
  assert.equal(ui.radiusOf(371), 371); assert.equal(ui.radiusOf(20), 500); assert.equal(ui.radiusOf('x'), 500); assert.equal(ui.radiusOf(5000), 500);
  const paths = []; let status = 'in_progress';
  const f = followHarness(async path => { paths.push(path); return { ok: true, data: path.startsWith('/nearby') ? { observations: [], queried_at: '2026-11-09T21:00:00Z' }
    : path.startsWith('/coverage') ? { scan_plan: { status } } : {} }; });
  f.events['tool.complete']({ session_id: 'test', payload: { name: 'mcp__pokeit__find_pokemon', args: { lat: 40.7055, lon: -74.0134, radius_m: 371 } } });
  await flush();
  assert.equal(paths.filter(p => p.startsWith('/nearby')).every(p => /radius_m=371/.test(p)), true);
  assert.equal(f.ctrl.state('test').radius, 371);
  assert.equal(f.ctrl.state('test').coverage.scan_plan.status, 'in_progress');
  status = 'fresh';
  const again = f.timeouts.find(t => t.ms === 10000); assert.ok(again);
  await again.cb(); await flush();
  assert.equal(f.ctrl.state('test').coverage.scan_plan.status, 'fresh');
});

test('a scan the agent starts shows its progress in the Radar and the spot is read when the plan is covered', async () => {
  host.openWorkspace = () => {};
  host.state.focusedStoredSessionId.set('stored-2'); host.state.focusedSessionId.set('runtime-2');
  let plan = { status: 'in_progress', total_points: 49, counts: { existing_area: 0, fresh: 10, pending: 39, needed: 0 } };
  const paths = [];
  const f = followHarness(async path => { paths.push(path); if (path.startsWith('/coverage')) return { ok: true, data: { scan_plan: plan } };
    return { ok: true, data: path.startsWith('/nearby') ? { observations: [], queried_at: '2026-11-09T21:00:00Z' } : {} }; });
  f.events['tool.complete']({ session_id: 'stored-2', payload: { name: 'mcp__pokeit__request_scan', args: { lat: 40.774, lon: -73.971 } } });
  assert.equal(f.ctrl.state('stored-2').scan.done, 0);
  await f.timeouts.shift().cb();
  assert.equal(f.ctrl.state('stored-2').scan.done, 10); assert.equal(f.ctrl.state('stored-2').center.lat, 40.774);
  assert.equal(paths.filter(p => p.startsWith('/nearby')).length, 0);
  plan = { status: 'fresh', total_points: 49, counts: { existing_area: 0, fresh: 49, pending: 0, needed: 0 } };
  await f.timeouts.shift().cb(); await flush();
  assert.equal(f.ctrl.state('stored-2').scan, null); assert.equal(paths.some(p => p.startsWith('/nearby')), true);
  host.state.focusedStoredSessionId.set('test'); host.state.focusedSessionId.set('test');
});

test('a scan that never shows up (the player declined) stops quietly and the spot is read as it is', async () => {
  host.openWorkspace = () => {};
  host.state.focusedStoredSessionId.set('stored-3'); host.state.focusedSessionId.set('runtime-3');
  const paths = [];
  const f = followHarness(async path => { paths.push(path); if (path.startsWith('/coverage')) return { ok: true, data: { scan_plan: { status: 'needs_scan', total_points: 49, counts: { existing_area: 0, fresh: 0, pending: 0, needed: 49 } } } };
    return { ok: true, data: path.startsWith('/nearby') ? { observations: [], queried_at: '2026-11-09T21:00:00Z' } : {} }; });
  f.events['tool.complete']({ session_id: 'stored-3', payload: { name: 'mcp__pokeit__request_scan', args: { lat: 40.7, lon: -73.9 } } });
  await f.timeouts.shift().cb();
  assert.equal(f.ctrl.state('stored-3').scan.seen, false);
  const real = Date.now; Date.now = () => real() + 60000;
  try { await f.timeouts.shift().cb(); await flush(); } finally { Date.now = real; }
  assert.equal(f.ctrl.state('stored-3').scan, null); assert.equal(paths.some(p => p.startsWith('/nearby')), true);
  host.state.focusedStoredSessionId.set('test'); host.state.focusedSessionId.set('test');
});

test('the scan line counts points and offers the partial read only after four minutes', () => {
  assert.equal(ui.scanLine(null, 0), null);
  assert.equal(ui.scanLine({ done: 46, total: 49, since: 0 }, 60000).text, '46 of 49 points');
  assert.equal(ui.scanLine({ done: 46, total: 49, since: 0 }, 60000).slow, false);
  assert.equal(ui.scanLine({ done: 46, total: 49, since: 0 }, 5 * 60000).slow, true);
  assert.equal(ui.scanLine({ done: 49, total: 49, since: 0 }, 5 * 60000).slow, false);
});

test('an older PokeIt backend gets a plain instruction instead of "Unexpected query parameter"', async () => {
  const ctrl = iconController(async () => ({ ok: false, error: { message: 'Unexpected query parameter.' } }));
  await ctrl.read('t', { lat: 34, lon: -84 }, 'Spot', 500);
  assert.match(ctrl.state('t').error, /older than the Radar/);
  assert.doesNotMatch(ctrl.state('t').error, /Unexpected query parameter/);
});
