/**
 * The id-free host-app bridge: a localhost page posts a window message, the content script
 * relays it to the service worker, and a reply comes back. Also asserts the relay does NOT
 * exist off localhost, which is the security boundary.
 */
import { readFileSync } from 'node:fs';

const run = (hostname) => {
  const relayed = [];
  const replies = [];
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

  globalThis.location = { href:`http://${hostname}:4180/`, origin:`http://${hostname}:4180`,
                          hostname, pathname:'/', search:'' };
  globalThis.history = { pushState(){}, replaceState(){} };
  globalThis.document = {
    documentElement: { append(){}, dataset:{} },
    createElement:(t)=>new El(t), querySelectorAll:()=>[], querySelector:()=>null,
    addEventListener(){}, removeEventListener(){},
  };
  globalThis.window = globalThis;
  globalThis.addEventListener = (type, fn) => { (listeners[type] ??= []).push(fn); };
  globalThis.removeEventListener = () => {};
  globalThis.postMessage = (msg) => replies.push(msg);
  globalThis.CustomEvent = class { constructor(t,o){ this.type=t; Object.assign(this,o); } };
  globalThis.dispatchEvent = () => true;
  globalThis.MutationObserver = class { observe(){} };
  globalThis.IntersectionObserver = class { observe(){} };
  globalThis.requestAnimationFrame = (f)=>setTimeout(f,0);
  globalThis.AudioContext = class { constructor(){ this.state='running'; this.sampleRate=48000; } };

  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (p) => new URL('../../', import.meta.url).pathname + p,
      onMessage: { addListener(){} },
      sendMessage: async (m) => { relayed.push(m); return { ok: true, presetCount: 2 }; },
    },
    storage: { local: { get: async (d) => ({ ...d }) }, onChanged: { addListener(){} } },
  };

  const src = readFileSync(new URL('../../src/content.js', import.meta.url).pathname, 'utf8');
  new Function(src)();
  return { relayed, replies, listeners };
};

// --- on localhost: the bridge must exist and relay ---
let { relayed, replies, listeners } = run('localhost');
const hasBridge = !!listeners.message?.length;
console.log('localhost · bridge installed :', hasBridge ? 'YES' : 'NO');

if (hasBridge) {
  const fire = (data) => listeners.message.forEach((fn) => fn({ source: globalThis, data }));
  fire({ __semitone: true, id: 7, type: 'presets', presets: [{ key: 'yt:abc', semitone: -2 }] });
  fire({ __semitone: true, id: 8, type: 'status' });
  fire({ __semitone: true, id: 9, type: 'evil-eval' });   // not in the allow-list
  fire({ type: 'presets', presets: [] });                    // missing the marker
  await new Promise((r) => setTimeout(r, 60));

  console.log('  relayed types            :', relayed.map((m) => m.type).join(', ') || '(none)');
  console.log('  ignored unlisted type    :', relayed.some((m) => m.type === 'page:evil-eval') ? 'NO — LEAK' : 'yes');
  console.log('  ignored unmarked message :', relayed.length === 2 ? 'yes' : 'NO — LEAK');
  console.log('  replies posted           :', replies.length, replies.map((r) => `id=${r.id}`).join(' '));
  console.log('  presence marker          :', document.documentElement.dataset.semitone ?? '(unset)');
}

// --- off localhost: the bridge must NOT exist ---
delete globalThis.__semitone__;
({ listeners } = run('www.youtube.com'));
const leaked = !!listeners.message?.length;
console.log('youtube   · bridge installed :', leaked ? 'YES — SECURITY LEAK' : 'no (correct)');

process.exit(hasBridge && !leaked ? 0 : 1);
