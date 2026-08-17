const calls = [];
const noop = () => {};
const listener = () => ({ addListener: noop, removeListener: noop });
const stub = (name) => (...a) => { calls.push(name); return Promise.resolve({}); };

globalThis.chrome = {
  runtime: { onMessage: listener(), onMessageExternal: listener(), onInstalled: listener(),
             onStartup: listener(), getManifest: () => ({ version: '0.1.0' }), id: 'x'.repeat(32),
             sendMessage: stub('runtime.sendMessage'), lastError: null },
  tabs: { onUpdated: listener(), onRemoved: listener(), onActivated: listener(),
          query: async () => [{ id: 1, url: 'https://x.test' }], get: async () => ({ id: 1 }),
          sendMessage: stub('tabs.sendMessage') },
  action: { onClicked: listener(), setBadgeText: stub('setBadgeText'),
            setBadgeBackgroundColor: stub('setBadgeBg'), setIcon: stub('setIcon'),
            setPopup: stub('setPopup'), getBadgeText: (o, cb) => cb && cb('') },
  scripting: { executeScript: stub('executeScript'),
               getRegisteredContentScripts: async () => [],
               registerContentScripts: stub('registerContentScripts'),
               updateContentScripts: stub('updateContentScripts'),
               unregisterContentScripts: stub('unregisterContentScripts') },
  storage: { local: { get: async (d) => (typeof d === 'object' ? d : {}), set: stub('storage.set'),
                      remove: stub('storage.remove') },
             session: { get: async () => ({}), set: noop },
             onChanged: listener() },
  permissions: { onAdded: listener(), onRemoved: listener(),
                 getAll: async () => ({ origins: ['*://*.youtube.com/*'], permissions: [] }),
                 contains: async () => true, request: async () => true, remove: async () => true },
  commands: { onCommand: listener() },
};

try {
  await import(new URL('../../', import.meta.url).pathname + 'src/service-worker.js');
  await new Promise(r => setTimeout(r, 200));
  console.log('✓ service-worker.js EVALUATED OK');
  console.log('  chrome calls made at load:', [...new Set(calls)].join(', ') || 'none');
} catch (e) {
  console.log('✗ service-worker.js FAILED TO LOAD');
  console.log(' ', e.constructor.name + ':', e.message);
  console.log(e.stack.split('\n').slice(1,4).join('\n'));
}
