/**
 * Runs the exact integration snippet from the store listing against the real content script.
 *
 * Published integration code that does not work is worse than none, and this snippet is
 * copied verbatim into the store description — so it is extracted from that file, not
 * retyped here. If someone edits the listing and breaks the example, this fails.
 */
import { readFileSync } from 'node:fs';

const listing = readFileSync(new URL('../../STORE-LISTING.md', import.meta.url).pathname, 'utf8');
const snippet = listing.slice(listing.indexOf('  let seq = 0;'), listing.indexOf('MESSAGES'));

const listeners = {};
class El {
  constructor(t){ this.tagName=t.toUpperCase(); this.dataset={}; this.className=''; }
  addEventListener(){} removeEventListener(){}
  querySelectorAll(){ return []; } querySelector(){ return null; }
  getBoundingClientRect(){ return {width:0,height:0,top:0,left:0,bottom:0,right:0}; }
  attachShadow(){ const k=[]; return { append(...n){k.push(...n);},
    querySelector:(s)=>k.find(x=>('.'+(x.className||''))===s)??null, querySelectorAll:()=>k }; }
  append(){} remove(){} getAttribute(){ return null; }
  set innerHTML(v){} get innerHTML(){ return ''; }
}

globalThis.location = { href:'http://localhost:4180/', origin:'http://localhost:4180',
                        hostname:'localhost', pathname:'/', search:'' };
globalThis.history = { pushState(){}, replaceState(){} };
globalThis.document = { documentElement:{ append(){}, dataset:{} }, createElement:(t)=>new El(t),
                        querySelectorAll:()=>[], querySelector:()=>null,
                        addEventListener(){}, removeEventListener(){} };
globalThis.window = globalThis;
globalThis.addEventListener = (t, fn) => { (listeners[t] ??= []).push(fn); };
globalThis.removeEventListener = (t, fn) => {
  if (listeners[t]) listeners[t] = listeners[t].filter((f) => f !== fn);
};
// Deliver a posted message to every registered listener, the way a browser would.
globalThis.postMessage = (data) => {
  queueMicrotask(() => [...(listeners.message ?? [])].forEach((fn) => fn({ source: globalThis, data })));
};
globalThis.CustomEvent = class { constructor(t,o){ this.type=t; Object.assign(this,o); } };
globalThis.dispatchEvent = () => true;
globalThis.MutationObserver = class { observe(){} };
globalThis.IntersectionObserver = class { observe(){} };
globalThis.requestAnimationFrame = (f)=>setTimeout(f,0);
globalThis.AudioContext = class { constructor(){ this.state='running'; this.sampleRate=48000; } };
globalThis.chrome = {
  runtime: { getManifest: () => ({ version: '1.0.0' }),
             getURL: (p) => new URL('../../', import.meta.url).pathname + p,
             onMessage: { addListener(){} },
             sendMessage: async (m) => m.type === 'page:status'
               ? { ok: true, name: 'semitone', version: '1.0.0', presetCount: 0, grantedOrigins: [] }
               : { ok: true, presetCount: (m.presets ?? []).length } },
  storage: { local: { get: async (d) => ({ ...d }) }, onChanged: { addListener(){} } },
};

new Function(readFileSync(new URL('../../src/content.js', import.meta.url).pathname, 'utf8'))();

const semitone = eval(`(() => { ${snippet} return semitone; })()`);

const status = await semitone({ type: 'status' });
const presets = await semitone({ type: 'presets', presets: [
  { key: 'yt:AzN4PKgPg-4', semitone: -2, cents: 0, label: 'Slot 7 - Ana' },
]});

console.log('snippet length      :', snippet.trim().split('\n').length, 'lines (from STORE-LISTING.md)');
console.log('detection           :', document.documentElement.dataset.semitone ?? '(unset)');
console.log('status reply        :', JSON.stringify(status));
console.log('presets reply       :', JSON.stringify(presets));

const ok = status?.ok && status.version === '1.0.0' && presets?.ok && presets.presetCount === 1;
console.log(ok ? '✓ published snippet works against the real bridge' : '✗ SNIPPET BROKEN');
process.exit(ok ? 0 : 1);
