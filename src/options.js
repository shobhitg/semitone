/**
 * Semitone — diagnostics.
 *
 * Read-only. Every setting lives in the popup; this page exists because "the key did not
 * apply" has several possible causes that all look identical from the outside, and listing
 * the actual state is faster than guessing.
 */

const diag = document.getElementById('diag');

const paint = async () => {
  const store = await chrome.storage.local.get({
    presets: {}, remembered: {}, rememberKeys: false, runtimeLog: [],
  });
  const perms = await chrome.permissions.getAll().catch(() => ({ origins: [], permissions: [] }));
  const scripts = await chrome.scripting.getRegisteredContentScripts().catch(() => []);

  const lines = [
    `version              ${chrome.runtime.getManifest().version}`,
    `extension id         ${chrome.runtime.id}`,
    '',
    `host access          ${(perms.origins ?? []).join(', ') || '(none — automatic apply cannot work)'}`,
    `content script       ${scripts.length ? scripts.map((s) => s.id).join(', ') : '(not registered)'}`,
    `watching             ${scripts.flatMap((s) => s.matches ?? []).join(', ') || '(nothing)'}`,
    '',
    `remember keys        ${store.rememberKeys ? 'on' : 'off (default)'}`,
    `launcher presets     ${Object.keys(store.presets).length}`,
    ...Object.entries(store.presets).map(
      ([key, p]) => `  ${key.padEnd(20)} ${p.semitone > 0 ? '+' : ''}${p.semitone}  ${p.label || ''}`,
    ),
    `remembered by hand   ${Object.keys(store.remembered).length}`,
    ...Object.entries(store.remembered).map(
      ([key, p]) => `  ${key.padEnd(20)} ${p.semitone > 0 ? '+' : ''}${p.semitone}`,
    ),
  ];

  diag.textContent = lines.join('\n');
};

chrome.permissions.onAdded.addListener(() => void paint());
chrome.permissions.onRemoved.addListener(() => void paint());
chrome.storage.onChanged.addListener(() => void paint());

void paint();
