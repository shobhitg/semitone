import { readFileSync } from 'node:fs';

const log = [];
class El {
  className='';
  constructor(tag){ this.tagName=tag.toUpperCase(); this.dataset={}; this.children=[];
    this.shadowRoot=null; this.paused=false; this.readyState=4; this.muted=false;
    this.volume=1; this.duration=200; this.currentSrc='blob:https://www.youtube.com/abc';
    this.src=this.currentSrc; this._l={}; }
  addEventListener(t,f){ (this._l[t] ??= []).push(f); }
  removeEventListener(){}
  querySelectorAll(){ return []; }
  querySelector(){ return null; }
  getBoundingClientRect(){ return {width:1280,height:720,top:0,left:0,bottom:720,right:1280}; }
  attachShadow(){ const kids=[]; return { append(...n){ kids.push(...n); },
      querySelector:(sel)=> kids.find(k=>('.'+(k.className||''))===sel) ?? null,
      querySelectorAll:()=>kids }; }
  append(){} remove(){} getAttribute(){ return null; }
  set innerHTML(v){ this._html=v; } get innerHTML(){ return this._html||''; }
}
const video = new El('video');

const gain = () => ({ gain:{ value:1, cancelScheduledValues(){}, setTargetAtTime(){} },
                      connect(n){ return n; }, disconnect(){} });
class FakeCtx {
  constructor(){ this.state='running'; this.sampleRate=48000; this.currentTime=0;
    this.destination={}; log.push('AudioContext created'); }
  async resume(){ this.state='running'; }
  async close(){}
  createGain(){ return gain(); }
  createDelay(){ return { delayTime:{ value:0 }, connect(n){ return n; } }; }
  createMediaElementSource(el){ log.push('createMediaElementSource'); return { connect(n){ return n; } }; }
}
globalThis.AudioContext = FakeCtx;

globalThis.location = { href:'https://www.youtube.com/watch?v=abc&list=RDabc', origin:'https://www.youtube.com', hostname:'www.youtube.com', pathname:'/watch', search:'?v=abc' };
globalThis.history = { pushState(){}, replaceState(){} };
globalThis.document = {
  documentElement:{ append(){}, dataset:{} },
  createElement:(t)=>new El(t),
  querySelectorAll:(s)=> (/video|audio/.test(s) ? [video] : []),
  querySelector:()=>null,
  addEventListener(){}, removeEventListener(){},
};
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
globalThis.dispatchEvent = () => true;
globalThis.postMessage = () => {};
globalThis.addEventListener = () => {};
globalThis.MutationObserver = class { observe(){} };
globalThis.IntersectionObserver = class { observe(){} };
globalThis.requestAnimationFrame = (f)=>setTimeout(f,0);

globalThis.chrome = {
  runtime: { getURL:(p)=>new URL('../../', import.meta.url).pathname + ''+p,
             onMessage:{addListener(){}},
             sendMessage: async (m)=>{ log.push('→SW '+(m.type||m.command)); return {ok:true}; } },
  storage: { local: { get: async (d)=>({ ...d, debug:true, autoApply:true,
                        presets:{ 'yt:abc': { semitone:-3, gainDb:0, label:'Slot 3 · Sam' } } }) },
             onChanged:{addListener(){}} },
};

// Signalsmith needs a real worklet host; stub the module the content script imports.
const realImport = globalThis.__import;
const src = readFileSync(new URL('../../', import.meta.url).pathname + 'src/content.js','utf8')
  .replace(/await import\(STRETCH_URL\)/,
    "{default: async () => ({ start:()=>{}, latency: async ()=>0.043, schedule: async ()=>{}, connect:(n)=>n, disconnect(){} })}");

try {
  const fn = new Function(src);
  fn();
  await new Promise(r=>setTimeout(r,400));
  console.log('✓ content.js EVALUATED OK');
  console.log('  sequence:', log.join(' · ') || '(nothing happened)');
  console.log('  ATTACHED:', log.includes('createMediaElementSource') ? 'YES — auto-apply engaged' : 'NO');
  process.exit(0);
} catch(e) {
  console.log('✗ content.js THREW:', e.constructor.name+':', e.message);
  console.log(e.stack.split('\n').slice(1,5).join('\n'));
  process.exit(1);
}
