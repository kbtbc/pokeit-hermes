// Optional visual check using an existing Hermes source checkout's development dependencies.
// node tests/preview_desktop.mjs <hermes-source> <output-directory>
// All observations below are synthetic. This does not contact the MCP or Discord.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw Error('Pass the Hermes source directory and an output directory.');
const require = createRequire(resolve(root, 'package.json'));
const { build } = require('esbuild'), { chromium } = require('playwright');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(output, { recursive: true });
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
const center={lat:34.074612345678901,lon:-84.29221234567890}, now=Date.now();
const cardDirective=segmentTranscriptDirectives('::pokeit-catch{id="pid_fixture_a" lat="34.076000" lon="-84.290000" origin_lat="34.074612345678901" origin_lon="-84.29221234567890"}')[0].directive;
const catches=[{observation_id:'pid_fixture_a',name:'Dratini',lat:34.076,lon:-84.290,iv_percent:100,iv_attack:15,iv_defense:15,iv_stamina:15,cp:391,expires_at:new Date(now+14*60000).toISOString(),expiry_verified:true,map_url:'https://pokeit.cc/pokemon/pid_fixture_a'},
{observation_id:'pid_fixture_b',name:'Murkrow',lat:34.0733,lon:-84.2931,iv_percent:73.3,iv_attack:0,iv_defense:15,iv_stamina:15,cp:711,expires_at:new Date(now+84000).toISOString(),expiry_verified:false,map_url:'https://pokeit.cc/pokemon/pid_fixture_b',pvp_iv_rankings:{ultra:[{rank:1,ranked_species_name:'Honchkrow',same_species_as_observation:false}]}}];
let scanCalls=0;
const prefs=new Map();
const ctx={register:c=>contributions.push(c),setInterval:(f,n)=>{const t=setInterval(f,n);disposers.push(()=>clearInterval(t));return()=>clearInterval(t)},setTimeout:(f,n)=>{const t=setTimeout(f,n);return()=>clearTimeout(t)},onEvent:()=>{},onDispose:f=>disposers.push(f),
storage:{get:(k,f)=>prefs.get(k)??f,set:(k,v)=>prefs.set(k,v)},pet:{say:()=>()=>{}},
os:{notify:n=>window.syntheticNotifications.push(n.body),openExternal:async()=>true,writeClipboard:async text=>{window.clipboard=text;return true}},
rest:async path=>{calls.push(path);let data;const u=new URL(path,'https://test');
if(u.pathname==='/place')data={places:[{...center,choice_label:'Alpharetta City Hall, Georgia',requires_specific_location:false}]};
else if(u.pathname==='/nearby')data={location:center,observations:catches,queried_at:new Date().toISOString(),truncated:false};
else if(u.pathname==='/coverage')data={scan_plan:{status:'existing_coverage'}};
else if(u.pathname==='/card')data={observation:catches.find(p=>p.observation_id===u.searchParams.get('id')),origin:u.searchParams.has('origin_lat')&&u.searchParams.has('origin_lon')?{lat:Number(u.searchParams.get('origin_lat')),lon:Number(u.searchParams.get('origin_lon'))}:null,status:'observed',truncated:false};
else if(u.pathname.startsWith('/scan/')){scanCalls++;data={status:scanCalls===1?'queued':'data_refreshed',total_points:49,counts:{confirmed:scanCalls===1?17:42,existing_area:7,pending:scanCalls===1?25:0,failed:0,unverified:0},created_at:now/1000-35,poll_after_seconds:5,map_url:'https://pokeit.cc/map?lat=34.0746&lon=-84.2922'};}
else if(u.pathname==='/health')data={reachable:true,tool_count:15};
else throw Error('Unexpected route '+path);return{ok:true,data};}};
plugin.register(ctx);
function App(){const [light,setLight]=useState(false);const radar=contributions.find(c=>c.id==='radar');return h('main',{style:{maxWidth:1100,margin:'24px auto',fontFamily:'system-ui'}},
h('strong',{style:{color:'#e89c22'}},'SYNTHETIC UI TEST — NOT LIVE SIGHTINGS'),
h('button',{id:'theme',onClick:()=>{mode.set(!light?'light':'dark');setLight(!light)}},'Toggle theme'),
h('div',{style:{display:'grid',gridTemplateColumns:'1fr 360px',gap:24,marginTop:20}},
h('div',null,h('p',{style:{color:'#a9b6d3'}},'A Desktop catch and scan card from synthetic tool responses'),
contributions.find(c=>c.id==='catch').data.render({attrs:cardDirective.attrs,sessionId:'fixture',streaming:false}),
contributions.find(c=>c.id==='scan').data.render({attrs:{id:'0123456789abcdefghijklmnopqrstuv'},sessionId:'fixture',streaming:false})),
h('div',{style:{height:980}},radar.render())))}
createRoot(document.getElementById('root')).render(h(App));
`;
await writeFile(resolve(output, 'main.jsx'), main);
await build({ entryPoints: [resolve(output, 'main.jsx')], outfile: resolve(output, 'bundle.js'), bundle: true, platform: 'browser',
  alias: { '@hermes/plugin-sdk': resolve(output, 'sdk.js'), 'react': require.resolve('react'), 'react-dom/client': require.resolve('react-dom/client'), 'react/jsx-runtime': require.resolve('react/jsx-runtime') } });
const { readFile } = await import('node:fs/promises');
const js = await readFile(resolve(output, 'bundle.js'));
const server = createServer((req,res)=>{ if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(js)}else{res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>PokeIt UI test</title><body style="margin:0;background:#12151c"><div id="root"></div><script src="/bundle.js"></script>')} });
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1200,height:1160}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByText('100% IV · CP 391').first().waitFor();
  const cardQuery=new URL((await page.evaluate(()=>window.calls)).find(p=>p.startsWith('/card?')),'https://test');
  assert.equal(Number(cardQuery.searchParams.get('origin_lon')),Number('-84.29221234567890'));
  assert.equal(await page.getByText('Distance from you unknown',{exact:true}).count(),0);
  await page.getByLabel('Pick a precise spot').fill('Alpharetta City Hall');
  await page.getByRole('button',{name:'Find',exact:true}).click();
  await page.getByRole('button',{name:'Alpharetta City Hall, Georgia'}).click();
  await page.getByRole('img',{name:'North-up radar, 500 metre radius from search point'}).waitFor();
  await page.getByRole('button',{name:'Events today',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.drafts)).length,1);
  assert.ok((await page.evaluate(()=>window.drafts))[0].text.includes('active events'));
  assert.ok((await page.evaluate(()=>window.drafts))[0].text.includes('Alpharetta City Hall'));
  assert.ok((await page.evaluate(()=>window.drafts))[0].text.includes('https://pokeit.cc/map?'));
  await page.getByRole('button',{name:'Show in Radar',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.openedRadar),'pokeit:radar');
  await page.getByRole('button',{name:'Copy debug info',exact:true}).click();
  await page.waitForFunction(()=>window.clipboard);
  assert.ok(!(await page.evaluate(()=>window.clipboard)).includes('34.0746'));
  await page.getByText('Scan complete',{exact:true}).waitFor({timeout:10000});
  await page.getByText(/request age at check/).waitFor();
  await page.getByLabel('Alert me about').selectOption('iv');
  await page.getByLabel('Minimum IV %').fill('90');
  await page.getByRole('button',{name:'Watch this spot',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Found 1 match'}).waitFor();
  assert.equal((await page.evaluate(()=>window.syntheticNotifications)).length,1);
  assert.ok((await page.evaluate(()=>window.notices)).some(n=>n.message?.startsWith('Found 1 match')));
  await page.screenshot({path:resolve(output,'desktop-dark.png'),fullPage:true});
  await page.locator('#theme').click();
  await page.screenshot({path:resolve(output,'desktop-light.png'),fullPage:true});
  await page.getByRole('button',{name:'Stop watch',exact:true}).click();
  await page.getByText('Watch stopped.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  const calls=await page.evaluate(()=>window.calls);
  assert.ok(calls.some(p=>p.startsWith('/nearby?')));
  assert.equal(calls.filter(p=>p.startsWith('/scan/')).length,2);
  console.log(JSON.stringify({screenshots:['desktop-dark.png','desktop-light.png'],consoleErrors:errors,toolReads:calls.length,draftOnlyFollowUp:true,scanTerminal:true,watchStartedAndStopped:true,notifications:'mocked only'}));
} finally {await browser.close();server.close();}
