// Optional visual check using an existing Hermes source checkout's development dependencies.
// node tests/preview_desktop.mjs <hermes-source> <output-directory> [icon-directory]
// The icon directory holds pokemon/<id>.webp, for example a checkout of the PokeIt icon set.
// All observations below are synthetic. This does not contact the MCP or Discord.
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const [root, output, iconDir] = process.argv.slice(2);
if (!root || !output) throw Error('Pass the Hermes source directory and an output directory.');
const require = createRequire(resolve(root, 'package.json'));
const { build } = require('esbuild'), { chromium } = require('playwright');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(output, { recursive: true });
const icons = {};
for (const id of [147, 198, 498, 19, 506]) {
  try { if (iconDir) icons[id] = 'data:image/webp;base64,' + (await readFile(resolve(iconDir, 'pokemon', id + '.webp'))).toString('base64'); } catch { /* letter fallback */ }
}
const sdk = `
import { useSyncExternalStore } from 'react';
export function atom(v) { const subs = new Set(); return {get:()=>v,set:n=>{v=n;subs.forEach(f=>f(v))},subscribe:f=>{subs.add(f);return()=>subs.delete(f)}} }
export const useValue=a=>useSyncExternalStore(a.subscribe,a.get);
export const mode=atom('dark'); export const useTheme=()=>({resolvedMode:useValue(mode)});
export const gatewayActivationEpoch=()=>1;
export const PANES_AREA='panes',STATUSBAR_AREAS={right:'statusBar.right'},TRANSCRIPT_DIRECTIVE_AREA='transcript.directives';
export const host={state:{focusedStoredSessionId:atom('fixture'),focusedSessionId:atom('fixture'),profile:atom('default'),gateway:atom('open')},
composer:{insertText:async(s,text)=>{window.drafts.push({session:s,text});return true}},notify:v=>window.notices.push(v),openWorkspace:(id)=>{window.openedRadar=id}};
`;
await writeFile(resolve(output, 'sdk.js'), sdk);
const main = `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import plugin from ${JSON.stringify(resolve(project, 'desktop/plugin.js'))};
import {segmentTranscriptDirectives} from ${JSON.stringify(resolve(root, 'apps/desktop/src/lib/transcript-directives.ts'))};
import {mode} from './sdk.js';
const h=React.createElement, contributions=[], calls=[],disposers=[];window.calls=calls;window.drafts=[];window.notices=[];window.syntheticNotifications=[];
const ICONS=${JSON.stringify(icons)}, wide=location.search.includes('wide');
const center={lat:34.074612345678901,lon:-84.29221234567890}, now=Date.now(), at=m=>new Date(now+m*60000).toISOString();
const directive=attrs=>segmentTranscriptDirectives('::pokeit-catch{'+attrs+'}')[0].directive;
const origin='origin_lat="34.074612345678901" origin_lon="-84.29221234567890" place="Alpharetta City Hall"';
const cards=[directive('id="pid_fixture_a" lat="34.076000" lon="-84.290000" '+origin),directive('id="pid_fixture_c" lat="34.0714" lon="-84.2893" '+origin),
  directive('id="pid_fixture_late" lat="34.0714" lon="-84.2893" '+origin),directive('id="pid_fixture_gone" lat="34.07" lon="-84.29" '+origin),directive('id="pid_fixture_expired" lat="34.07" lon="-84.29" '+origin)];
const catches=[{observation_id:'pid_fixture_a',pokemon_id:147,form:0,name:'Dratini',lat:34.076,lon:-84.290,iv_percent:100,iv_attack:15,iv_defense:15,iv_stamina:15,cp:391,level:20,expires_at:at(14),expiry_verified:true,map_url:'https://pokeit.cc/pokemon/pid_fixture_a'},
{observation_id:'pid_fixture_b',pokemon_id:198,form:0,name:'Murkrow',lat:34.0733,lon:-84.2931,iv_percent:73.3,iv_attack:0,iv_defense:15,iv_stamina:15,cp:711,level:22,expires_at:at(1.4),expiry_verified:false,map_url:'https://pokeit.cc/pokemon/pid_fixture_b',pvp_iv_rankings:{ultra:[{rank:1,ranked_species_name:'Honchkrow',same_species_as_observation:false}]}},
{observation_id:'pid_fixture_c',pokemon_id:498,form:0,name:'Tepig',lat:34.0714,lon:-84.2893,iv_percent:95.56,iv_attack:15,iv_defense:15,iv_stamina:13,cp:307,level:10,expires_at:at(9),expiry_verified:true,map_url:'https://pokeit.cc/pokemon/pid_fixture_c'},
{observation_id:'pid_fixture_d',pokemon_id:19,form:0,name:'Rattata',lat:34.0725,lon:-84.2952,iv_percent:95.56,iv_attack:14,iv_defense:15,iv_stamina:14,cp:75,level:4,expires_at:at(22),expiry_verified:true,map_url:'https://pokeit.cc/pokemon/pid_fixture_d'},
{observation_id:'pid_fixture_e',pokemon_id:506,form:0,name:'Lillipup',lat:34.0757,lon:-84.2921,iv_percent:46.67,iv_attack:2,iv_defense:12,iv_stamina:7,cp:223,level:10,expires_at:at(16),expiry_verified:true,map_url:'https://pokeit.cc/pokemon/pid_fixture_e'}];
const late={...catches[2],observation_id:'pid_fixture_late',expires_at:at(-3)};
let scanCalls=0;
const prefs=new Map();
const ctx={register:c=>contributions.push(c),setInterval:(f,n)=>{const t=setInterval(f,n);disposers.push(()=>clearInterval(t));return()=>clearInterval(t)},setTimeout:(f,n)=>{const t=setTimeout(f,n);return()=>clearTimeout(t)},onEvent:()=>{},onDispose:f=>disposers.push(f),
storage:{get:(k,f)=>prefs.get(k)??f,set:(k,v)=>prefs.set(k,v)},pet:{say:()=>()=>{}},
os:{notify:n=>window.syntheticNotifications.push(n),openExternal:async()=>true,writeClipboard:async text=>{window.clipboard=text;return true}},
rest:async path=>{calls.push(path);let data;const u=new URL(path,'https://test');
if(u.pathname==='/place')data={places:[{...center,choice_label:'Alpharetta City Hall, Georgia',requires_specific_location:false}]};
else if(u.pathname==='/nearby')data={location:center,observations:catches,queried_at:new Date().toISOString(),truncated:false};
else if(u.pathname==='/coverage')data={scan_plan:{status:'existing_coverage'}};
else if(u.pathname==='/icon/'+u.pathname.split('/')[2])data={url:ICONS[u.pathname.split('/')[2]]||null};
else if(u.pathname==='/card'){const id=u.searchParams.get('id'),gone=id==='pid_fixture_gone',expired=id==='pid_fixture_expired';
  data={observation:gone||expired?null:[...catches,late].find(p=>p.observation_id===id),origin:u.searchParams.has('origin_lat')&&u.searchParams.has('origin_lon')?{lat:Number(u.searchParams.get('origin_lat')),lon:Number(u.searchParams.get('origin_lon'))}:null,status:gone?'not_seen':expired?'expired':'observed',truncated:false};}
else if(u.pathname.startsWith('/scan/')){scanCalls++;data={status:scanCalls===1?'queued':'data_refreshed',total_points:49,counts:{confirmed:scanCalls===1?17:42,existing_area:7,pending:scanCalls===1?25:0,failed:0,unverified:0},created_at:now/1000-35,poll_after_seconds:5,map_url:'https://pokeit.cc/map?lat=34.0746&lon=-84.2922'};}
else if(u.pathname==='/health')data={reachable:true,tool_count:15};
else throw Error('Unexpected route '+path);return{ok:true,data};}};
plugin.register(ctx);
const render=(id,props)=>contributions.find(c=>c.id===id).data.render(props);
function App(){const [light,setLight]=useState(false);const radar=contributions.find(c=>c.id==='radar');return h('main',{style:{maxWidth:1100,margin:'24px auto',fontFamily:'system-ui'}},
h('strong',{style:{color:'#e89c22'}},'SYNTHETIC UI TEST — NOT LIVE SIGHTINGS'),
h('button',{id:'theme',onClick:()=>{mode.set(!light?'light':'dark');setLight(!light)}},'Toggle theme'),
wide?h('div',{style:{height:760,marginTop:20}},radar.render()):
h('div',{style:{display:'grid',gridTemplateColumns:'1fr 360px',gap:24,marginTop:20}},
h('div',null,h('p',{style:{color:'#a9b6d3'}},'A Desktop catch and scan card from synthetic tool responses'),
cards.map((d,i)=>h('div',{key:i},render('catch',{attrs:d.attrs,sessionId:'fixture',streaming:false}))),
render('scan',{attrs:{id:'0123456789abcdefghijklmnopqrstuv'},sessionId:'fixture',streaming:false})),
h('div',{style:{height:1250}},radar.render())))}
createRoot(document.getElementById('root')).render(h(App));
`;
await writeFile(resolve(output, 'main.jsx'), main);
await build({ entryPoints: [resolve(output, 'main.jsx')], outfile: resolve(output, 'bundle.js'), bundle: true, platform: 'browser',
  alias: { '@hermes/plugin-sdk': resolve(output, 'sdk.js'), 'react': require.resolve('react'), 'react-dom/client': require.resolve('react-dom/client'), 'react/jsx-runtime': require.resolve('react/jsx-runtime') } });
const js = await readFile(resolve(output, 'bundle.js'));
const server = createServer((req,res)=>{ if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(js)}else{res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>PokeIt UI test</title><body style="margin:0;background:#12151c"><div id="root"></div><script src="/bundle.js"></script>')} });
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const base='http://127.0.0.1:'+server.address().port;
  const page=await browser.newPage({viewport:{width:1200,height:1500}}), errors=[];
  page.on('pageerror',e=>{ errors.push(e.message); console.error('page error:',e.message); });
  page.on('console',m=>{ if(m.type()==='error') { errors.push(m.text()); console.error('console error:',m.text()); } });
  await page.goto(base);
  await page.getByText('100% IV · CP 391').first().waitFor();
  const cardQuery=new URL((await page.evaluate(()=>window.calls)).find(p=>p.startsWith('/card?')),'https://test');
  assert.equal(Number(cardQuery.searchParams.get('origin_lon')),Number('-84.29221234567890'));
  assert.equal(cardQuery.searchParams.has('place'),false);
  assert.equal(await page.getByText('Distance unknown',{exact:true}).count(),0);
  assert.ok(await page.getByText('of Alpharetta City Hall').count()>=2);
  assert.equal(await page.getByText('search point',{exact:true}).count(),0);
  assert.equal(await page.getByText('This catch has expired.',{exact:true}).count(),1);
  assert.equal(await page.getByText(/no longer in the latest read/).count(),1);
  if (iconDir) { await page.waitForFunction(()=>document.querySelectorAll('article img').length>=2); }
  await page.getByLabel('Pick a precise spot').fill('Alpharetta City Hall');
  await page.getByRole('button',{name:'Find',exact:true}).click();
  await page.waitForFunction(()=>window.calls.some(p=>p.startsWith('/nearby?')));
  await page.getByText(/\d+ shown/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Alpharetta City Hall, Georgia'}).count(),0);
  await page.getByRole('button',{name:/Tepig 95.6% IV/}).first().click();
  await page.getByRole('button',{name:'Raids nearby',exact:true}).waitFor();
  await page.getByRole('button',{name:'Events today',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.drafts)).length,1);
  assert.ok((await page.evaluate(()=>window.drafts))[0].text.includes('active events'));
  assert.ok((await page.evaluate(()=>window.drafts))[0].text.includes('Alpharetta City Hall'));
  assert.ok((await page.evaluate(()=>window.drafts))[0].text.includes('https://pokeit.cc/map?'));
  await page.getByRole('button',{name:'Show in Radar',exact:true}).first().click();
  assert.equal(await page.evaluate(()=>window.openedRadar),'pokeit:radar');
  await page.getByRole('button',{name:'Copy debug info',exact:true}).click();
  await page.waitForFunction(()=>window.clipboard);
  assert.ok(!(await page.evaluate(()=>window.clipboard)).includes('34.0746'));
  await page.getByText('Scan complete',{exact:true}).waitFor({timeout:10000});
  await page.getByText(/Requested at/).waitFor();
  assert.equal(await page.getByText(/request age at check/).count(),0);
  await page.getByLabel('Alert me about').selectOption('iv');
  await page.getByLabel('Minimum IV %').fill('99');
  await page.getByRole('button',{name:'Watch',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Found 1 match'}).waitFor();
  const alerts=await page.evaluate(()=>window.syntheticNotifications);
  assert.equal(alerts.length,1); assert.equal(alerts[0].title,'PokeIt: Dratini nearby');
  assert.ok((await page.evaluate(()=>window.notices)).some(n=>n.message?.startsWith('Found 1 match')));
  await page.waitForTimeout(300);
  await page.screenshot({path:resolve(output,'desktop-dark.png'),fullPage:true});
  await page.locator('#theme').click();
  await page.waitForTimeout(200);
  await page.screenshot({path:resolve(output,'desktop-light.png'),fullPage:true});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByText('Watch stopped.',{exact:true}).waitFor();
  const calls=await page.evaluate(()=>window.calls);
  assert.ok(calls.some(p=>p.startsWith('/nearby?')));
  assert.equal(calls.filter(p=>p.startsWith('/scan/')).length,2);
  assert.ok(calls.filter(p=>p.startsWith('/icon/')).length<=5, 'one icon request per species');
  const wideView=await browser.newPage({viewport:{width:1200,height:900}});
  wideView.on('pageerror',e=>errors.push(e.message));
  await wideView.goto(base+'/?wide=1');
  await wideView.getByRole('button',{name:'Pike Place Market'}).waitFor();
  await wideView.screenshot({path:resolve(output,'desktop-empty-dark.png')});
  await wideView.getByRole('button',{name:'Alpharetta City Hall',exact:true}).click();
  await wideView.getByText(/\d+ shown/).waitFor();
  await wideView.waitForTimeout(500);
  await wideView.screenshot({path:resolve(output,'desktop-wide-dark.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({screenshots:['desktop-empty-dark.png','desktop-dark.png','desktop-light.png','desktop-wide-dark.png'],consoleErrors:errors,toolReads:calls.length,iconRequests:calls.filter(p=>p.startsWith('/icon/')).length,draftOnlyFollowUp:true,scanTerminal:true,watchStartedAndStopped:true,notifications:'mocked only'}));
} finally {await browser.close();server.close();}
