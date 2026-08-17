import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../', import.meta.url).pathname + 'src/popup.html','utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const made = new Map();
const mk = (id) => ({ id, dataset:{}, style:{}, textContent:'', value:'', checked:false, hidden:false,
  disabled:false, classList:{add(){},remove(){}}, addEventListener(){}, matches:()=>false });
for (const id of ids) made.set(id, mk(id));

globalThis.document = {
  getElementById: (id) => made.get(id) ?? null,
  addEventListener(){}, querySelector: () => null,
};
globalThis.window = globalThis;
globalThis.chrome = {
  runtime: { sendMessage: async () => ({ ok:true, state:{ semitone:0, gainDb:0, formant:true } }), lastError:null },
  tabs: { query: async () => [{ id: 1 }] },
  storage: { local: { get: async (d) => ({ ...d, presets: { 'yt:abc': { semitone:-3 } } }), set: async()=>{} } },
  permissions: { contains: async () => false, request: async () => true, remove: async () => true },
};

const missing = ids.filter(id => !made.has(id));
try {
  await import(new URL('../../', import.meta.url).pathname + 'src/popup.js');
  await new Promise(r => setTimeout(r, 120));
  console.log('✓ popup.js EVALUATED OK');
  const row = made.get('autoRow');
  console.log('  remember row      :', row.dataset.on === '1' ? 'ON' : 'OFF (correct default)');
  console.log('  autoSummary       :', JSON.stringify(made.get('autoSummary').textContent));
  console.log('  autoToggle label  :', JSON.stringify(made.get('autoToggle').textContent));
  console.log('  launcherLine      :', JSON.stringify(made.get('launcherLine').textContent));
  process.exit(0);
} catch (e) {
  console.log('✗ popup.js THREW:', e.constructor.name + ':', e.message);
  console.log(e.stack.split('\n').slice(1,4).join('\n'));
}
