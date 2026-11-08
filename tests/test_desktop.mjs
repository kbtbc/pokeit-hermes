// Run: node --experimental-vm-modules --test tests/test_desktop.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8');
function atom(value) {
  return { get: () => value, set: next => { value = next; }, subscribe: fn => { fn(value); return () => {}; } };
}
const host = { state: { focusedStoredSessionId: atom('test'), focusedSessionId: atom('test'), profile: atom('default'), gateway: atom('open') } };
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
