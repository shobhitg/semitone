/**
 * Semitone — popup controller.
 *
 * Holds no state of its own. Every read and write goes through the service worker, which
 * talks to the page; the popup just renders whatever comes back. That is what keeps the
 * popup honest after a soft navigation reset it did not initiate.
 */

const $ = (id) => document.getElementById(id);

const els = {
  status: $('status'),
  key: $('key'),
  keyLabel: $('keyLabel'),
  up: $('up'),
  down: $('down'),
  reset: $('reset'),
  cents: $('cents'),
  centsOut: $('centsOut'),
  hudMode: $('hudMode'),
  hudCorner: $('hudCorner'),
  debug: $('debug'),
  latency: $('latency'),
  autoSummary: $('autoSummary'),
  autoToggle: $('autoToggle'),
  autoRow: $('autoRow'),
  autoDot: $('autoDot'),
  launcherLine: $('launcherLine'),
};

/** Must match SEMITONE_MIN/MAX in service-worker.js. */
const SEMITONE_LIMIT = 3;

let tabId = null;

/* ------------------------------------------------------------------ render */

const ERRORS = {
  'no-media': 'No audio or video playing on this page. Start the track, then try again.',
  'cors': 'This site blocks audio processing (cross-origin media). The key cannot be changed here.',
  'restricted-page': 'This is a browser page. Chrome blocks all extensions here — switch to the tab with your track.',
  'web-store': 'Chrome blocks extensions on the Web Store. Switch to the tab with your track.',
  'file-access': 'To use local files, turn on “Allow access to file URLs” on this extension’s card in chrome://extensions.',
  'no-access': 'No access to this page yet. Click the Semitone icon again on the tab with your track.',
  'tab-gone': 'That tab has closed.',
  'inject-failed': 'Could not attach to this page. Reload the tab and try again.',
  'element-changed': 'The page swapped players. Reload the tab to transpose the new one.',
  'no-response': 'Lost contact with the page. Reload the tab.',
  'context-suspended': 'Chrome won’t start audio processing until you interact with the page. Click anywhere on the video, then try again.',
};

/** Errors where nothing on this page will ever work, so the controls should not look live. */
const FATAL = new Set(['restricted-page', 'web-store', 'file-access', 'tab-gone', 'cors']);

const centsLabel = (cents) => `${cents > 0 ? '+' : ''}${cents} cents`;

const describe = (semitone, cents) => {
  const parts = [];
  if (semitone !== 0) {
    const n = Math.abs(semitone);
    parts.push(`${n} semitone${n === 1 ? '' : 's'} ${semitone > 0 ? 'up' : 'down'}`);
  }
  if (cents) parts.push(centsLabel(cents));
  return parts.length ? parts.join(' · ') : 'Original key';
};

const render = (state, error) => {
  const semitone = state?.semitone ?? 0;
  const cents = state?.cents ?? 0;

  // The big readout stays whole semitones. Cents are a tuning correction, not a key, and
  // showing "-2.3" where a singer expects "-2" would only confuse the thing they read fastest.
  els.key.textContent = semitone === 0 ? '0' : semitone > 0 ? `+${semitone}` : `${semitone}`;
  els.key.dataset.neutral = semitone === 0 && cents === 0 ? '1' : '0';
  els.keyLabel.textContent = describe(semitone, cents);

  els.cents.value = String(cents);
  els.centsOut.textContent = centsLabel(cents);

  const dead = FATAL.has(error);
  els.up.disabled = dead || semitone >= SEMITONE_LIMIT;
  els.down.disabled = dead || semitone <= -SEMITONE_LIMIT;
  els.reset.disabled = dead;
  els.cents.disabled = dead;

  els.latency.textContent = state?.latencyMs ? `Processing delay: ${state.latencyMs} ms` : '';

  const message = ERRORS[error] ?? (error ? `Something went wrong: ${error}` : '');
  els.status.hidden = !message;
  els.status.textContent = message;
  // "Not here" is information; "it broke" is an error. Only the second should look alarming.
  els.status.dataset.tone = error === 'no-media' || dead ? 'info' : 'error';
};

/* --------------------------------------------------------------- messaging */

const send = async (type, payload = {}) => {
  const reply = await chrome.runtime.sendMessage({ type, tabId, ...payload }).catch((e) => ({
    ok: false,
    error: String(e?.message || e),
  }));
  render(reply?.state, reply?.ok ? '' : reply?.error);
  return reply;
};

/* ------------------------------------------------------------------- wiring */

els.up.addEventListener('click', () => send('ui:nudge', { delta: +1 }));
els.down.addEventListener('click', () => send('ui:nudge', { delta: -1 }));
els.reset.addEventListener('click', () => send('ui:reset'));

els.cents.addEventListener('input', () => {
  els.centsOut.textContent = centsLabel(Number(els.cents.value));
});
els.cents.addEventListener('change', () => send('ui:apply', { patch: { cents: Number(els.cents.value) } }));

for (const key of ['hudMode', 'hudCorner']) {
  els[key].addEventListener('change', () => chrome.storage.local.set({ [key]: els[key].value }));
}

els.debug.addEventListener('change', () => chrome.storage.local.set({ debug: els.debug.checked }));

/* ---------------------------------------------------------- remember keys */

/**
 * The only behavioural setting, and it is off by default.
 *
 * Off: a key lasts for this performance. The same video opened later plays in its original
 * key, which is what you want at an event — a key belongs to a singer, not to a URL.
 * On: a key you set by hand comes back next time you open that video.
 *
 * Launcher presets are unaffected either way. They are pushed, not remembered, and they win.
 */
const paintAuto = async () => {
  const { rememberKeys = false, presets = {}, remembered = {} } =
    await chrome.storage.local.get({ rememberKeys: false, presets: {}, remembered: {} });
  const kept = Object.keys(remembered).length;
  const count = Object.keys(presets).length;

  els.autoRow.dataset.on = rememberKeys ? '1' : '0';
  els.autoSummary.textContent = rememberKeys
    ? `On · ${kept} video${kept === 1 ? '' : 's'} remembered`
    : 'Off · every video starts in its original key';
  els.autoToggle.textContent = rememberKeys ? 'Turn off' : 'Turn on';

  els.launcherLine.textContent = count
    ? `${count} song${count === 1 ? '' : 's'} set by the Track Launcher — those apply on their own.`
    : 'No songs set by the Track Launcher yet.';
};

els.autoToggle.addEventListener('click', async () => {
  const { rememberKeys = false } = await chrome.storage.local.get({ rememberKeys: false });
  // Turning it off clears what was kept — leaving stale keys behind is the surprise this
  // setting exists to avoid.
  await chrome.storage.local.set(
    rememberKeys ? { rememberKeys: false, remembered: {} } : { rememberKeys: true },
  );
  await paintAuto();
});

// Arrow keys work while the popup is focused, matching the global shortcuts.
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, summary')) return;
  if (e.key === 'ArrowUp') { e.preventDefault(); send('ui:nudge', { delta: +1 }); }
  if (e.key === 'ArrowDown') { e.preventDefault(); send('ui:nudge', { delta: -1 }); }
  if (e.key === '0') { e.preventDefault(); send('ui:reset'); }
});

/* --------------------------------------------------------------------- boot */

(async () => {
  const settings = await chrome.storage.local.get({ hudMode: 'auto', hudCorner: 'tr', debug: true });
  els.hudMode.value = settings.hudMode;
  els.hudCorner.value = settings.hudCorner;
  els.debug.checked = settings.debug;

  void paintAuto();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return render(null, 'unsupported-page');
  tabId = tab.id;

  await send('ui:get');
})();
