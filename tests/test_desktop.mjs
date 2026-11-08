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
const react = { useEffect: () => {}, useState: () => {}, useId: () => 'id' };
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
  assert.doesNotMatch(source, /request_scan|composer\.submit|window\.hermes|document\.(?:querySelector|getElementById)/);
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

const flush = () => new Promise(resolve => setImmediate(resolve));
function watchHarness(api) {
  const timers = [], notices = [], disposers = [], events = {}, storage = new Map();
  let time = Date.parse('2026-11-07T22:00:00Z');
  const ctx = { storage: { get: (k, fallback) => storage.get(k) ?? fallback, set: (k, v) => storage.set(k, v) },
    setInterval: (callback, ms) => { const t = { callback, ms, stopped: false }; timers.push(t); return () => { t.stopped = true; }; },
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
  const f = watchHarness(async () => { reads++; return { observations: rows, truncated: false }; });
  assert.equal(reads, 0); assert.equal(f.timers.length, 0);
  assert.equal(f.watch.start('test', watchCenter, 'City Hall'), true);
  await flush(); assert.equal(reads, 1); assert.equal(f.timers[0].ms, 60000);
  assert.equal(f.notices.filter(n => n.kind === 'os').length, 1);
  assert.match(f.notices[0].body, /Found 2 matches/);
  f.advance(60000); rows = [...rows, match('c')]; await f.watch.poll();
  assert.equal(f.notices.filter(n => n.kind === 'os').length, 1);
  f.advance(60000); await f.watch.poll();
  assert.equal(f.notices.filter(n => n.kind === 'os').length, 2);
  assert.match(f.notices.filter(n => n.kind === 'os')[1].body, /Found 1 match/);
  f.advance(120000); await f.watch.poll(); assert.equal(f.notices.filter(n => n.kind === 'os').length, 2);
  f.watch.stop(); assert.equal(f.timers[0].stopped, true);
  const before = reads; await f.watch.poll(); assert.equal(reads, before); assert.equal(f.watch.view.get().active, false);
  f.dispose();
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
  assert.match(f.watch.view.get().notice, /Found 1 match/);
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
