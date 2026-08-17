/**
 * Semitone — background service worker.
 *
 * Owns three things and nothing else:
 *   1. Keeping the content script registered for every host we have access to, and injecting
 *      it on demand for anything else the user clicks into.
 *   2. The toolbar badge, which is the at-a-glance answer to "is anything applied?"
 *   3. Forwarding keyboard commands to the tab in front of the user.
 *
 * THE STATE RULE: this worker caches the per-tab key only so the badge can render.
 * The content script is authoritative — it is the thing actually holding an audio graph,
 * and it is the thing that resets itself on a song change. If the two ever disagree, the
 * content script wins. MV3 kills this worker at will; nothing here may be load-bearing.
 */

import { trackKey } from './track-key.js';

const CACHE = new Map(); // tabId -> { semitone, cents, engaged }

/** Mirrors the popup's "Console logging" switch. Logs land in the service worker console. */
let DEBUG = true;
chrome.storage.local.get({ debug: true }).then((s) => { DEBUG = s.debug; });
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.debug) DEBUG = c.debug.newValue;
});
const log = (...args) => {
  if (DEBUG) console.log('%c[Semitone SW]', 'color:#FB923C;font-weight:600', ...args);
};

const NEUTRAL = { semitone: 0, cents: 0, engaged: false };

/**
 * Karaoke range, deliberately narrow. Beyond about three semitones a backing track stops
 * sounding like the record — and a singer who needs more than that is on the wrong track,
 * not the wrong key. Keep this in step with SEMITONE_LIMIT in popup.js and the clamp in the
 * launcher's routes/event.ts.
 */
const SEMITONE_MIN = -3;
const SEMITONE_MAX = 3;

const clampSemitone = (n) => Math.max(SEMITONE_MIN, Math.min(SEMITONE_MAX, Math.round(n)));

/** Fine trim, ±50 cents — half a semitone either way is more than any recording drifts. */
const clampCents = (n) => Math.max(-50, Math.min(50, Math.round(Number(n) || 0)));

/* ------------------------------------------------------------------ badge */

/**
 * The badge is the anti-forget mechanism at the browser level: if a key is applied
 * anywhere, the toolbar says so, in a colour you cannot mistake for chrome.
 */
const paintBadge = (tabId, state) => {
  const semitone = state?.semitone ?? 0;
  const text = semitone === 0 ? '' : (semitone > 0 ? `+${semitone}` : `${semitone}`);
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#C2410C' }).catch(() => {});
};

const remember = (tabId, state) => {
  CACHE.set(tabId, state);
  paintBadge(tabId, state);
};

const forget = (tabId) => {
  CACHE.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
};

/* -------------------------------------------------------------- injection */

/**
 * Chrome refuses to script its own pages, the Web Store, and (by default) file:// URLs.
 * These are ordinary situations — a host clicking the icon while still on
 * chrome://extensions hits the first one every time — so they are classified into a reason
 * the popup can explain, not logged as failures.
 */
const classifyInjectError = (err) => {
  const m = String(err?.message || err || '');
  if (/chrome:\/\/|edge:\/\/|about:|chrome-untrusted:/i.test(m)) return 'restricted-page';
  if (/extensions gallery|Web Store/i.test(m)) return 'web-store';
  if (/file:\/\/|file URLs/i.test(m)) return 'file-access';
  if (/Cannot access contents|must request permission/i.test(m)) return 'no-access';
  if (/No tab with id|Invalid tab ID|No frame with id/i.test(m)) return 'tab-gone';
  return 'inject-failed';
};

/** Resolves to null on success, or a reason string the popup knows how to phrase. */
const ensureInjected = async (tabId) => {
  const pong = await chrome.tabs.sendMessage(tabId, { type: 'ping' }).catch(() => null);
  if (pong?.ok) return null;
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['src/content.js'] });
    return null;
  } catch (err) {
    const reason = classifyInjectError(err);
    // Only genuinely unexpected failures are worth console noise.
    if (reason === 'inject-failed') console.warn('[Semitone] inject failed', err);
    return reason;
  }
};

const talk = async (tabId, message) => {
  const blocked = await ensureInjected(tabId);
  if (blocked) return { ok: false, error: blocked };
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) ?? { ok: false, error: 'no-response' };
  } catch (err) {
    return { ok: false, error: classifyInjectError(err) };
  }
};

/* ---------------------------------------------------------------- the API */

/**
 * Every path that changes a value funnels through here, so the badge, the cache and the
 * page can never drift apart.
 */
const applyTo = async (tabId, patch) => {
  const current = CACHE.get(tabId) ?? { ...NEUTRAL };
  const next = { ...current, ...patch };
  if (typeof next.semitone === 'number') next.semitone = clampSemitone(next.semitone);
  if (next.cents !== undefined) next.cents = clampCents(next.cents);

  const result = await talk(tabId, { type: 'apply', ...next });
  log('apply →', next, result.ok ? 'ok' : `FAILED: ${result.error}`);
  if (result.ok) remember(tabId, { ...next, ...result.state });
  return result;
};

const nudge = async (tabId, delta) => {
  const current = CACHE.get(tabId) ?? { ...NEUTRAL };
  return applyTo(tabId, { semitone: clampSemitone((current.semitone ?? 0) + delta) });
};

/* ----------------------------------------------------------- reset on nav */

/**
 * A full page load destroys the content script, which is its own reset. This handles the
 * other case: the tab being navigated somewhere new. Dropping the cache here stops a stale
 * badge from claiming a key that is no longer applied.
 *
 * (SPA navigation — YouTube advancing to the next video without a page load — is caught
 * inside the content script, since Chrome never tells us about it. That is the case this
 * whole extension exists for.)
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') forget(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => CACHE.delete(tabId));

/* ------------------------------------------------------------- keyboard */

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === 'key-up') await nudge(tab.id, +1);
  else if (command === 'key-down') await nudge(tab.id, -1);
  else if (command === 'key-reset') await applyTo(tab.id, { ...NEUTRAL, engaged: true });
});

/* ------------------------------------------------------------- messaging */

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    // The content script reset itself (song changed). Trust it and repaint.
    if (msg?.type === 'content:reset') {
      const tabId = sender.tab?.id;
      if (tabId) remember(tabId, { ...NEUTRAL, engaged: true });
      return respond({ ok: true });
    }

    if (msg?.type === 'content:status') {
      const tabId = sender.tab?.id;
      if (tabId && msg.state) remember(tabId, { ...(CACHE.get(tabId) ?? NEUTRAL), ...msg.state });
      return respond({ ok: true });
    }

    // Relayed from a localhost page by the content script — same handler as the id-based
    // door, so the two can never drift apart.
    if (typeof msg?.type === 'string' && msg.type.startsWith('page:')) {
      return respond(await handleHostMessage({ ...msg, type: msg.type.slice(5) }));
    }

    const tabId = msg?.tabId;
    if (!tabId) return respond({ ok: false, error: 'no-tab' });

    if (msg.type === 'ui:get') {
      const live = await talk(tabId, { type: 'status' });
      if (live.ok) remember(tabId, { ...(CACHE.get(tabId) ?? NEUTRAL), ...live.state });
      return respond(live.ok ? live : { ok: false, error: live.error, state: CACHE.get(tabId) ?? NEUTRAL });
    }

    if (msg.type === 'ui:apply') return respond(await applyTo(tabId, msg.patch ?? {}));
    if (msg.type === 'ui:nudge') return respond(await nudge(tabId, msg.delta ?? 0));
    if (msg.type === 'ui:reset') return respond(await applyTo(tabId, { ...NEUTRAL, engaged: true }));

    return respond({ ok: false, error: 'unknown-message' });
  })();
  return true; // async respond
});

/* --------------------------------------------------------------- presets */

/**
 * Presets are a declared intention — "this video is always sung a tone down" — which is a
 * different thing from a key accidentally carrying over. The reset rule still holds: on a
 * new track the page looks up a preset and applies it, or goes to zero. It never keeps the
 * previous song's key.
 *
 * Stored in chrome.storage.local so a service-worker restart, an extension reload, or a
 * laptop reboot mid-event does not lose the show's settings.
 */
const AUTO_SCRIPT_ID = 'semitone-auto';

const readPresets = async () => (await chrome.storage.local.get({ presets: {} })).presets ?? {};

/**
 * Register the content script for every host we hold access to.
 *
 * There is no "off" state and no setting. A launcher-opened tab receives no click, so
 * activeTab can never fire there; automatic behaviour requires host access, which the
 * manifest declares outright. This just keeps the registration in step with reality,
 * including any extra origin granted later through optional permissions.
 */
const syncAutoScript = async () => {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter((o) => /^\*:\/\/|^https?:\/\//.test(o));
  const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  const registered = existing.some((s) => s.id === AUTO_SCRIPT_ID);

  if (!matches.length) {
    // Should not happen with declared host_permissions; if it does, say so loudly rather
    // than degrading into a silently manual-only extension.
    console.warn('[Semitone] no host access at all — check manifest host_permissions');
    if (registered) await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] }).catch(() => {});
    return;
  }

  const definition = {
    id: AUTO_SCRIPT_ID,
    matches,
    js: ['src/content.js'],
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true,
  };

  try {
    if (registered) await chrome.scripting.updateContentScripts([definition]);
    else await chrome.scripting.registerContentScripts([definition]);
    log('watching', matches.join(', '));
  } catch (err) {
    console.warn('[Semitone] could not register content script', err);
  }
};

chrome.permissions.onAdded.addListener(syncAutoScript);
chrome.permissions.onRemoved.addListener(syncAutoScript);
chrome.runtime.onInstalled.addListener(syncAutoScript);
chrome.runtime.onStartup.addListener(syncAutoScript);

// Also on every worker wake. MV3 re-evaluates this file constantly, which makes it the one
// reliable place to reconcile: a permission granted while the worker was asleep, or granted
// by a build that did not yet mirror it to storage, is corrected here.
void syncAutoScript();

/**
 * Second path to the same outcome, deliberately redundant.
 *
 * A registered content script only attaches to loads that happen after registration, and it
 * is easy for that registration to be missing or stale — a permission granted a moment ago,
 * a service worker that was asleep. So the worker also watches for a tab finishing on a URL
 * it has a preset for and makes sure the script is there.
 *
 * It injects rather than applying the key itself: the content script owns preset lookup and
 * the wait-for-playback logic, and having one code path for that is worth more than saving a
 * round trip.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = tab?.url;
  if (!url) return;

  const key = trackKey(url);
  if (!key) return;

  const presets = await readPresets();
  if (!presets[key]) return;

  log('tab finished loading with a preset —', key, presets[key].semitone);
  const blocked = await ensureInjected(tabId);
  if (blocked) log('could not inject for preset:', blocked);
});

/* ------------------------------------------------- host app hook */

/**
 * Optional and entirely inert unless the host app is running on this
 * machine. It lets the launcher arm a key for the slot it is about to open, so the host
 * never types a number on show night. Everything above works identically without it.
 */
/**
 * One implementation, two front doors.
 *
 * A host app can reach the extension either by knowing its id
 * (`chrome.runtime.sendMessage(id, ...)`, which needs `externally_connectable`) or by posting
 * a window message on a localhost page, which the content script relays. The second path
 * needs no id at all, so integrating is copy-paste — see README, "Integrating your own app".
 * Both land here.
 */
const handleHostMessage = async (msg) => {
  if (msg?.type === 'ping' || msg?.type === 'status') {
    const { origins = [] } = await chrome.permissions.getAll();
    const presets = await readPresets();
    return {
      ok: true,
      name: 'semitone',
      version: chrome.runtime.getManifest().version,
      presetCount: Object.keys(presets).length,
      grantedOrigins: origins,
    };
  }

  /**
   * Replace the whole preset set. Whole-set replacement, not merge, so deleting a key in the
   * host app actually deletes it here — a merge would leave orphans that quietly transpose a
   * song nobody asked for.
   */
  if (msg?.type === 'presets') {
    const incoming = Array.isArray(msg.presets) ? msg.presets : [];
    const presets = {};
    for (const p of incoming) {
      if (!p?.key || typeof p.key !== 'string') continue;
      presets[p.key] = {
        semitone: clampSemitone(Number(p.semitone) || 0),
        cents: clampCents(p.cents),
        label: typeof p.label === 'string' ? p.label.slice(0, 80) : '',
      };
    }
    await chrome.storage.local.set({ presets });
    log('presets replaced —', Object.keys(presets).length, 'entries');
    return { ok: true, presetCount: Object.keys(presets).length };
  }

  if (msg?.type === 'arm') {
    // One-shot: apply to the active tab now.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { ok: false, error: 'no-active-tab' };
    return applyTo(tab.id, {
      semitone: clampSemitone(msg.semitone ?? 0),
      cents: clampCents(msg.cents),
      label: typeof msg.label === 'string' ? msg.label.slice(0, 80) : undefined,
      engaged: true,
    });
  }

  return { ok: false, error: 'unknown-message' };
};

chrome.runtime.onMessageExternal.addListener((msg, _sender, respond) => {
  handleHostMessage(msg).then(respond);
  return true;
});
