/**
 * Semitone — page-side actuator.
 *
 * Runs in the isolated content-script world (not MAIN). That is a deliberate difference
 * from tools like Transpose: they patch the page's own AudioContext so they can intercept
 * players that route audio through Web Audio themselves. We don't need that. YouTube and
 * Smule both play a plain <video>/<audio> element, and an isolated-world AudioContext can
 * call createMediaElementSource on that same element. Staying out of MAIN means we never
 * touch page globals and never fight the page's CSP.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────────────────────
 * A key applies to ONE performance and must never survive into the next. A full page load
 * destroys this script, which resets us for free. The dangerous case is a soft navigation:
 * YouTube advancing to the next video without a page load. resetWatcher() below is the
 * whole reason this extension exists — everything else is a volume knob.
 * ──────────────────────────────────────────────────────────────────────────────────────
 */

(() => {
  if (window.__semitone__) return; // executeScript may fire more than once
  window.__semitone__ = true;

  const STRETCH_URL = chrome.runtime.getURL('vendor/SignalsmithStretch.mjs');
  const WORKLET_URL = chrome.runtime.getURL('vendor/signalsmith-worklet.js');
  const RAMP = 0.03;          // seconds — crossfade/gain ramp, short enough to feel instant

  /**
   * Formant compensation, permanently on. It corrects the vocal-tract resonances that make a
   * shifted voice sound chipmunky or growly — so it matters on a guide vocal and does almost
   * nothing on an instrumental backing track, which is what most karaoke videos are. That is
   * why it was not worth a switch: inaudible in the common case, and the right choice in the
   * rare one. Costs a little CPU; irrelevant for a single stereo stream.
   */
  const FORMANT_COMPENSATION = true;

  /**
   * Fine trim, in cents (100 cents = 1 semitone).
   *
   * A separate control from the key on purpose. The key is which key the singer sings in and
   * changes every slot; this is whether the recording itself is at concert pitch, which is a
   * property of the track. 1950s–60s film recordings were cut on variable-speed tape and a
   * fair number sit tens of cents off A=440 — audible to a singer referencing a harmonium
   * even when the semitone is right. Folding both into one control would mean fifteen presses
   * to move a whole tone, which is useless with someone waiting on stage.
   */
  const CENTS_LIMIT = 50;
  const FLASH_MS = 2600;      // how long the big HUD readout stays up after a change

  /** Everything the page currently has applied. The service worker mirrors this for its badge. */
  const state = {
    semitone: 0,   // whole semitones — which key the singer sings in
    cents: 0,      // fine trim — whether the RECORDING is at A=440. See CENTS_LIMIT.
    engaged: false,      // has an audio graph been built at all
    label: '',           // optional caption from the host app
    latencyMs: 0,
    error: '',
  };

  let settings = { hudMode: 'auto', hudCorner: 'tr', debug: true, rememberKeys: false };

  /* ────────────────────────────────────────────────────────────────── logging */

  /**
   * Errors are returned to the popup rather than thrown, which means the console stays
   * silent unless we put something in it. These make a failure traceable to the exact
   * step that produced it. Turn off in the popup once things are stable.
   */
  const log = (...args) => {
    if (settings.debug) console.log('%c[Semitone]', 'color:#FB923C;font-weight:600', ...args);
  };
  const fail = (...args) => console.error('[Semitone]', ...args);

  const tag = (el) => {
    if (!el) return '<none>';
    const src = (el.currentSrc || el.src || '').slice(0, 70);
    return `<${el.tagName.toLowerCase()} ${el.paused ? 'paused' : 'playing'} rs=${el.readyState} src="${src}">`;
  };

  /** Live audio graph. Once built it stays built — see the note in buildGraph(). */
  let ctx = null;
  let element = null;
  let source = null;
  let stretch = null;
  let dryDelay = null;
  let dryGain = null;
  let wetGain = null;
  let outGain = null;

  /* ────────────────────────────────────────────────────────────────── presets */

  /**
   * Kept in sync with src/track-key.js and the launcher's TypeScript copy. A YouTube watch
   * URL collects `&list=`, `&start_radio=`, `&t=` as you use it, so only the video id is
   * stable enough to file a preset under.
   */
  const trackKey = (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') {
        const id = url.pathname.slice(1).split('/')[0];
        return id ? `yt:${id}` : '';
      }
      if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
        const v = url.searchParams.get('v');
        if (v) return `yt:${v}`;
        const match = url.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/);
        if (match) return `yt:${match[1]}`;
      }
      return `url:${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return '';
    }
  };

  /** Pushed by the host app. Authoritative for the show. */
  let presets = {};

  /**
   * Keys you set by hand, kept only when "Remember keys" is on. Off by default, so the same
   * video opened in a fresh tab plays in its original key — a key belongs to a performance,
   * not to a URL.
   */
  let remembered = {};

  /**
   * Precedence: the launcher wins, then a remembered key, then original. The launcher is
   * authoritative because it knows who is singing; a remembered key is only a convenience.
   */
  const keyForCurrentTrack = () => {
    const key = trackKey(location.href);
    if (!key) return null;
    if (presets[key]) return { ...presets[key], source: 'launcher' };
    if (settings.rememberKeys && remembered[key]) return { ...remembered[key], source: 'remembered' };
    return null;
  };

  /** Only called for hand-made changes, and only when remembering is switched on. */
  const rememberCurrentKey = () => {
    if (!settings.rememberKeys) return;
    const key = trackKey(location.href);
    if (!key) return;
    // A launcher preset owns this track; do not shadow it with a local memory.
    if (presets[key]) return;

    if (state.semitone === 0 && state.cents === 0) delete remembered[key];
    else remembered[key] = { semitone: state.semitone, cents: state.cents };

    chrome.storage.local.set({ remembered }).catch(() => {});
    log('remembered', key, state.semitone);
  };

  /* ───────────────────────────────────────────────────────── media discovery */

  /** Collect <video>/<audio> across the document and any open shadow roots. */
  const collectMedia = (root, out = [], depth = 0) => {
    if (depth > 8) return out;
    for (const el of root.querySelectorAll('video, audio')) out.push(el);
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) collectMedia(el.shadowRoot, out, depth + 1);
    }
    return out;
  };

  /**
   * Deliberately simpler than a general-purpose tool's heuristic. A karaoke page has one
   * track playing and we are invoked by a human who is looking at it, so "playing and
   * audible" settles almost every case; size only breaks ties.
   */
  const scoreMedia = (el) => {
    if (!el) return -1;
    let score = 0;
    if (!el.paused) score += 100;
    if (!el.muted && el.volume > 0.05) score += 40;
    if (Number.isFinite(el.duration) && el.duration > 1) score += 20;
    if (el.readyState >= 2) score += 10;
    if (el.currentSrc || el.src) score += 10;
    try {
      const r = el.getBoundingClientRect();
      score += Math.min((r.width * r.height) / 20000, 20);
    } catch { /* detached */ }
    return score;
  };

  const findMedia = () => {
    const all = collectMedia(document);
    if (!all.length) return null;
    return all.reduce((best, el) => (scoreMedia(el) > scoreMedia(best) ? el : best), all[0]);
  };

  /**
   * Cross-origin media without a crossorigin attribute is "tainted": routing it through
   * Web Audio yields silence. Detect it up front so the popup can say so instead of the
   * host discovering it on stage.
   */
  const isTainted = (el) => {
    try {
      const src = el.currentSrc || el.src || '';
      if (!src || src.startsWith('blob:') || src.startsWith('data:')) return false;
      if (new URL(src, location.href).origin === location.origin) return false;
      const co = (el.getAttribute('crossorigin') || el.crossOrigin || '').toLowerCase();
      return !(co === 'anonymous' || co === 'use-credentials');
    } catch {
      return false;
    }
  };

  /* ─────────────────────────────────────────────────────────── the audio graph */

  /**
   *   element ─→ source ─┬─→ dryDelay ─→ dryGain ─┐
   *                      └─→ stretch  ─→ wetGain ─┴─→ mix ─→ destination
   *
   * `mix` is a plain summing node held at unity. There is no volume control here on purpose:
   * a mixer fader or the system volume does that job better, and duplicating it in software
   * only adds a thing to get wrong mid-show.
   *
   * Both paths stay connected permanently and we crossfade between them, rather than
   * connect/disconnect, which clicks. dryDelay matches the stretcher's latency so the
   * crossfade is time-aligned and A/V sync does not jump when you return to original key.
   *
   * NOTE: createMediaElementSource is irreversible — once called, that element's audio
   * flows through us forever. So "off" is a bypass, never a teardown. Building the graph
   * lazily, only when the user first asks for a key, is what keeps an idle install
   * genuinely inert.
   */
  /** Guard every AudioParam write — one NaN takes down the whole graph with a vague error. */
  const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

  const buildGraph = async () => {
    if (ctx && stretch) return true;

    let step = 'find-media';
    let localCtx = null;
    try {
      const target = findMedia();
      log('candidate media:', tag(target));
      if (!target) throw new Error('no-media');
      if (isTainted(target)) throw new Error('cors');

      // Build into locals and publish only on full success. A half-built graph that had
      // already assigned `ctx` would make every later attempt short-circuit on the guard
      // above and wedge the tab until reload.
      step = 'audio-context';
      localCtx = new AudioContext();
      if (localCtx.state === 'suspended') await localCtx.resume().catch(() => {});
      log('AudioContext', localCtx.state, `${localCtx.sampleRate} Hz`);

      // FAIL OPEN. createMediaElementSource on a suspended context silences the element,
      // and it cannot be undone. A tab opened by the launcher has no user activation, so
      // this is a real possibility — and a silent track on stage is far worse than an
      // untransposed one. Refuse rather than risk it.
      if (localCtx.state !== 'running') {
        throw new Error('context-suspended');
      }

      step = 'import-worklet';
      log('importing', STRETCH_URL);
      const { default: SignalsmithStretch } = await import(STRETCH_URL);

      // Signalsmith would otherwise build its worklet as a blob: URL. AudioWorklet module
      // loading is policed by the PAGE's CSP — the isolated world does not exempt us — and
      // YouTube's script-src forbids blob:, which fails as "Unable to load a worklet's
      // module". chrome-extension:// resources declared web-accessible are exempt, so we
      // point the library's own escape hatch at a pre-built copy.
      // Regenerate with: node tools/build-worklet.mjs
      SignalsmithStretch.moduleUrl = WORKLET_URL;

      step = 'create-worklet';
      const localStretch = await SignalsmithStretch(localCtx, { outputChannelCount: [2] });
      log('worklet node ready');

      // EVERY method on this node is an async remote call over the message port — including
      // latency(). Treating the returned Promise as a number is what produced the
      // "non-finite float" AudioParam error.
      step = 'read-latency';
      let latency = 0;
      try {
        const reported = await localStretch.latency();
        if (Number.isFinite(reported)) latency = reported;
        log('reported latency', reported, '→ using', latency, 's');
      } catch (err) {
        log('latency() unavailable, assuming 0', err);
      }

      step = 'create-source';
      // Irreversible — see the note above. Do it late, so an earlier failure leaves the
      // element's audio untouched and the page still plays normally.
      const localSource = localCtx.createMediaElementSource(target);
      const localDelay = localCtx.createDelay(1.0);
      const localDry = localCtx.createGain();
      const localWet = localCtx.createGain();
      const localOut = localCtx.createGain();

      step = 'connect';
      localDelay.delayTime.value = Math.min(Math.max(finite(latency), 0), 1);
      localDry.gain.value = 1;
      localWet.gain.value = 0;
      localOut.gain.value = 1;

      localSource.connect(localDelay).connect(localDry).connect(localOut);
      localSource.connect(localStretch).connect(localWet).connect(localOut);
      localOut.connect(localCtx.destination);

      step = 'start';
      await Promise.resolve(localStretch.start()).catch((err) => log('start() rejected', err));

      ctx = localCtx;
      element = target;
      source = localSource;
      stretch = localStretch;
      dryDelay = localDelay;
      dryGain = localDry;
      wetGain = localWet;
      outGain = localOut;
      state.latencyMs = Math.round(finite(latency) * 1000);
      state.engaged = true;

      watchElement(target);
      log('graph live · latency', state.latencyMs, 'ms · element', tag(target));
      return true;
    } catch (err) {
      fail(`buildGraph failed at step "${step}":`, err);
      await localCtx?.close().catch(() => {});
      throw err;
    }
  };

  /** Push `state` into the graph. Safe to call before the graph exists. */
  const render = () => {
    if (!ctx || !stretch) return;
    const now = ctx.currentTime;
    const semitone = finite(state.semitone);
    const cents = finite(state.cents);
    // Signalsmith takes semitones as a float, so the trim costs nothing to apply.
    const shift = semitone + cents / 100;
    const wet = shift !== 0;

    // schedule() is an async remote call like everything else on this node; an unhandled
    // rejection here would be invisible.
    Promise.resolve(
      stretch.schedule({
        semitones: shift,
        formantCompensation: FORMANT_COMPENSATION,
        formantBaseHz: 0, // 0 = track the pitch rather than assume a voice range
        active: true,
      }),
    ).catch((err) => fail('schedule() rejected', err));

    dryGain.gain.cancelScheduledValues(now);
    wetGain.gain.cancelScheduledValues(now);
    dryGain.gain.setTargetAtTime(wet ? 0 : 1, now, RAMP);
    wetGain.gain.setTargetAtTime(wet ? 1 : 0, now, RAMP);

    log('render · semitone', semitone, '· cents', cents, '· shift', shift.toFixed(2), '· path', wet ? 'wet' : 'dry');
  };

  /* ─────────────────────────────────────────── reset on song change (the point) */

  /**
   * The track changed. Never carry the old key over: either the new track has a preset of
   * its own, or it plays in its original key. Those are the only two outcomes.
   */
  const resetForNewTrack = (reason) => {
    const wasApplied = state.semitone !== 0 || state.cents !== 0;
    const preset = keyForCurrentTrack();

    state.semitone = preset?.semitone ?? 0;
    state.cents = preset?.cents ?? 0;
    state.label = preset?.label ?? '';

    log(`reset (${reason})`,
        wasApplied ? '— a key was applied' : '— was neutral',
        preset ? `→ preset ${state.semitone}` : '→ original key');

    // Same ordering rule as init: touch the audio before the readout.
    render();
    if (preset) waitForPlaybackThenEngage();
    if (wasApplied) chrome.runtime.sendMessage({ type: 'content:reset', reason }).catch(() => {});
    drawHud({ flash: wasApplied || !!preset, reason });
  };

  let lastHref = location.href;
  let lastSrc = '';

  /**
   * Three independent signals, because no single one catches every player:
   *   • the URL changing        — YouTube "next video", playlist advance
   *   • the element's source changing — Smule track change, any MSE re-attach
   *   • a different element winning   — a page swapping players entirely
   */
  const watchElement = (el) => {
    lastSrc = el.currentSrc || el.src || '';
    const onLoadStart = () => {
      const src = el.currentSrc || el.src || '';
      if (src && src !== lastSrc) {
        lastSrc = src;
        resetForNewTrack('new-source');
      }
    };
    el.addEventListener('loadstart', onLoadStart);
    el.addEventListener('emptied', onLoadStart);
  };

  const onLocationChange = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    resetForNewTrack('navigation');
    // The new page may use a different element.
    const next = findMedia();
    if (next && next !== element && ctx) {
      // We cannot re-source a new element into an existing context safely; tell the user.
      state.error = 'element-changed';
      drawHud({ flash: true });
    }
  };

  const installNavigationWatchers = () => {
    addEventListener('popstate', onLocationChange);
    addEventListener('hashchange', onLocationChange);
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        queueMicrotask(onLocationChange);
        return result;
      };
    }
    // Belt and braces: some players change the URL by routes we cannot hook.
    setInterval(onLocationChange, 1000);
  };

  /* ─────────────────────────────────────────────────────────────────────── HUD */

  let hudHost = null;
  let hudRoot = null;
  let flashTimer = null;

  const HUD_CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed; z-index: 2147483647; pointer-events: none;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      transition: opacity .25s ease, transform .25s ease;
      opacity: 0; transform: translateY(-6px);
    }
    .wrap[data-show="1"] { opacity: 1; transform: none; }
    .wrap[data-corner="tr"] { top: 18px; right: 18px; }
    .wrap[data-corner="tl"] { top: 18px; left: 18px; }
    .wrap[data-corner="br"] { bottom: 18px; right: 18px; }
    .wrap[data-corner="bl"] { bottom: 18px; left: 18px; }

    .card {
      display: flex; align-items: center; gap: 12px;
      background: rgba(12, 14, 20, .88);
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 12px;
      padding: 10px 16px;
      color: #fff;
      box-shadow: 0 8px 28px rgba(0, 0, 0, .45);
      backdrop-filter: blur(8px);
    }
    .card[data-size="big"] { padding: 18px 28px; gap: 18px; }

    .key {
      font-variant-numeric: tabular-nums;
      font-weight: 700; letter-spacing: -.02em;
      font-size: 30px; line-height: 1;
      color: #FDBA74;
    }
    .card[data-size="big"] .key { font-size: 56px; }
    .key[data-neutral="1"] { color: #9CA3AF; }

    .meta { display: flex; flex-direction: column; gap: 2px; }
    .title { font-size: 13px; font-weight: 600; line-height: 1.2; }
    .card[data-size="big"] .title { font-size: 18px; }
    .sub { font-size: 11px; opacity: .62; line-height: 1.2; }
    .card[data-size="big"] .sub { font-size: 13px; }
  `;

  const ensureHud = () => {
    if (hudRoot) return;
    hudHost = document.createElement('div');
    hudHost.id = '__semitone_hud';
    hudRoot = hudHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    hudRoot.append(style, wrap);
    // documentElement, not body — survives frameworks that replace <body>.
    document.documentElement.append(hudHost);
  };

  const semitoneLabel = (n) => (n === 0 ? '0' : n > 0 ? `+${n}` : `${n}`);

  const describe = () => {
    const parts = [];
    if (state.semitone !== 0) {
      const n = Math.abs(state.semitone);
      parts.push(`${n} semitone${n === 1 ? '' : 's'} ${state.semitone > 0 ? 'up' : 'down'}`);
    }
    if (state.cents !== 0) parts.push(`${state.cents > 0 ? '+' : ''}${state.cents}\u00A0cents`);
    return parts.length ? parts.join(' · ') : 'Original key';
  };

  /**
   * The readout is cosmetic; the audio is not. An exception in here must never be able to
   * stop a key being applied — that coupling cost real debugging time, because a throw in
   * paintHud() aborted the init chain before it reached waitForPlaybackThenEngage().
   */
  const drawHud = (options) => {
    try {
      paintHud(options);
    } catch (err) {
      fail('on-screen readout failed to render (audio is unaffected)', err);
    }
  };

  const paintHud = ({ flash = false, reason = '' } = {}) => {
    if (settings.hudMode === 'off') {
      if (hudHost) {
        hudHost.remove();
        hudHost = null;
        hudRoot = null;
      }
      return;
    }
    ensureHud();
    const wrap = hudRoot.querySelector('.wrap');
    const applied = state.semitone !== 0 || state.cents !== 0;
    const show = settings.hudMode === 'always' || applied || flash;

    // The sub-line is where "is this thing armed?" gets answered on the page itself, since
    // the projector shows the karaoke tab and not the popup.
    let sub;
    if (reason === 'navigation' || reason === 'new-source') sub = 'Reset — new track';
    else if (reason === 'armed') sub = 'Semitone ready · no preset for this track';
    else if (state.label) sub = describe();
    else sub = 'Semitone';

    wrap.dataset.corner = settings.hudCorner;
    wrap.dataset.show = show ? '1' : '0';
    wrap.innerHTML = `
      <div class="card" data-size="${flash ? 'big' : 'small'}">
        <div class="key" data-neutral="${applied ? '0' : '1'}">${semitoneLabel(state.semitone)}</div>
        <div class="meta">
          <div class="title">${state.label ? escapeHtml(state.label) : describe()}</div>
          <div class="sub">${sub}</div>
        </div>
      </div>`;

    clearTimeout(flashTimer);
    if (flash) flashTimer = setTimeout(() => drawHud(), FLASH_MS);
  };

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ────────────────────────────────────────────────────── automatic engagement */

  /**
   * Build the graph and apply whatever `state` already holds. Used by the preset path,
   * where there is no user click to hang the work off.
   */
  let engaging = null;

  const engage = async (why) => {
    if (engaging) return engaging;
    engaging = (async () => {
      try {
        await buildGraph();
        state.error = '';
        render();
        drawHud({ flash: true });
        chrome.runtime.sendMessage({ type: 'content:status', state: publicState() }).catch(() => {});
        log(`engaged (${why})`);
      } catch (err) {
        state.error = String(err?.message || err);
        fail(`engage (${why}) failed:`, state.error);
      } finally {
        engaging = null;
      }
    })();
    return engaging;
  };

  /**
   * A launcher-opened tab has no click to react to, and at document_idle the player usually
   * has not started yet. Wait for audible playback before attaching, then give up quietly —
   * a preset that silently does nothing is a bad day; a preset that waits forever holding a
   * timer is worse.
   */
  const AUTO_TIMEOUT_MS = 60000;

  let autoWatcher = null;

  const waitForPlaybackThenEngage = () => {
    if (autoWatcher || (ctx && stretch)) return;

    const started = Date.now();
    let timer = null;

    const stop = () => {
      autoWatcher = null;
      if (timer) clearInterval(timer);
      for (const type of ['play', 'playing', 'pointerdown', 'keydown']) {
        document.removeEventListener(type, kick, true);
      }
    };

    /**
     * Retries until the graph is genuinely live. The earlier version stopped as soon as it
     * *started* an attempt, so a single failure — a not-yet-playing video, or a context
     * Chrome would not start without user activation — meant the preset never applied and
     * nothing ever tried again.
     */
    const attempt = async () => {
      if (!autoWatcher) return;
      if (ctx && stretch) return stop();

      const candidate = findMedia();
      if (!candidate || candidate.paused || candidate.readyState < 2) return;

      await engage('preset');

      if (ctx && stretch) return stop();
      if (state.error === 'context-suspended') {
        log('audio blocked until the page is interacted with — will retry on the next click or keypress');
      }
    };

    const kick = () => void attempt();

    autoWatcher = true;
    timer = setInterval(() => {
      if (Date.now() - started > AUTO_TIMEOUT_MS) {
        log('auto-apply gave up — no playable media after 60s');
        return stop();
      }
      void attempt();
    }, 600);

    // Playback events make it feel instant; input events are the retry that matters when
    // Chrome is withholding audio until the user touches the page.
    for (const type of ['play', 'playing', 'pointerdown', 'keydown']) {
      document.addEventListener(type, kick, { capture: true, passive: true });
    }

    void attempt();
  };

  /* ─────────────────────────────────────────────────────────────────── plumbing */

  const publicState = () => ({ ...state, hasMedia: !!element || !!findMedia() });

  /**
   * Settings and presets, loaded before we answer anything. Declared above the message
   * listener on purpose: the listener awaits it, and a message can in principle arrive
   * before a later declaration is initialised.
   */
  const ready = chrome.storage.local
    .get({ hudMode: 'auto', hudCorner: 'tr', debug: true, rememberKeys: false, presets: {}, remembered: {} })
    .then((stored) => {
      settings = {
        hudMode: stored.hudMode,
        hudCorner: stored.hudCorner,
        debug: stored.debug,
        rememberKeys: !!stored.rememberKeys,
      };
      presets = stored.presets ?? {};
      remembered = stored.remembered ?? {};

      const preset = keyForCurrentTrack();
      log('ready ·', trackKey(location.href) || location.href,
          `· ${Object.keys(presets).length} preset(s) from launcher`,
          `· remember ${settings.rememberKeys ? 'on' : 'off'}`,
          preset ? `· APPLYING ${preset.semitone} from ${preset.source}` : '· original key');

      if (preset) {
        state.semitone = preset.semitone;
        state.cents = preset.cents ?? 0;
        state.label = preset.label ?? '';
        // Audio first, cosmetics second — deliberate ordering, so nothing about the readout
        // can delay or prevent the key being applied.
        waitForPlaybackThenEngage();
        drawHud({ flash: true });
      } else {
        // Flash even with nothing to apply. "The extension is here and watching, this song
        // just has no key" is a different fact from "the extension is not running", and from
        // the projector those two look identical otherwise.
        drawHud({ flash: true, reason: 'armed' });
      }
    })
    .catch((err) => fail('init failed', err));

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    (async () => {
      if (msg?.type === 'ping') return respond({ ok: true });

      // Settings and presets load asynchronously, and the popup asks for status the
      // instant it injects us. Without this await it reads state before the preset has
      // been adopted and reports 0 for a track that is about to be transposed.
      await ready;

      if (msg?.type === 'status') {
        return respond({
          ok: true,
          state: publicState(),
          diagnostics: {
            trackKey: trackKey(location.href),
            presetCount: Object.keys(presets).length,
            hasPresetForTrack: !!keyForCurrentTrack(),
            rememberKeys: settings.rememberKeys,
          },
        });
      }

      if (msg?.type === 'apply') {
        try {
          log('apply', msg);
          await buildGraph();
          state.error = '';
          if (Number.isFinite(msg.semitone)) state.semitone = msg.semitone;
          if (Number.isFinite(msg.cents)) state.cents = msg.cents;
          if (typeof msg.label === 'string') state.label = msg.label;
          render();
          // A launcher push carries a label; anything else is a hand-made change and is what
          // "Remember keys" is about.
          if (!msg.label) rememberCurrentKey();
          drawHud({ flash: true });
          return respond({ ok: true, state: publicState() });
        } catch (err) {
          state.error = String(err?.message || err);
          fail('apply failed:', state.error, err);
          return respond({ ok: false, error: state.error, state: publicState() });
        }
      }

      return respond({ ok: false, error: 'unknown-message' });
    })();
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.hudMode) settings.hudMode = changes.hudMode.newValue;
    if (changes.hudCorner) settings.hudCorner = changes.hudCorner.newValue;
    if (changes.debug) settings.debug = changes.debug.newValue;
    if (changes.rememberKeys) settings.rememberKeys = !!changes.rememberKeys.newValue;
    if (changes.remembered) remembered = changes.remembered.newValue ?? {};
    if (changes.presets) {
      presets = changes.presets.newValue ?? {};
      log('presets updated —', Object.keys(presets).length, 'entries');
      // A key set while the tab is already open should take effect without a reload.
      const preset = keyForCurrentTrack();
      if (preset && preset.semitone !== state.semitone) {
        state.semitone = preset.semitone;
        state.cents = preset.cents ?? 0;
        state.label = preset.label ?? '';
        if (ctx && stretch) {
          render();
          drawHud({ flash: true });
        } else {
          drawHud({ flash: true });
          waitForPlaybackThenEngage();
        }
        return;
      }
    }
    drawHud();
  });

  /* ──────────────────────────────────────────── host-app bridge (no id needed) */

  /**
   * Lets a local web app drive the extension without knowing its id.
   *
   * The id-based door (`chrome.runtime.sendMessage(id, ...)`) works too, but it means every
   * integrator has to find and paste a 32-character string. Posting a window message needs
   * nothing, so integrating is copy-paste.
   *
   * SCOPED TO LOCALHOST ON PURPOSE. Any script on the page can post these, so this is only
   * installed where the page is already trusted — a loopback address. On youtube.com the
   * relay does not exist, and no site can change what a singer hears.
   */
  const isLocalHost = () => {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
  };

  const RELAYED = new Set(['status', 'ping', 'presets', 'arm']);

  const installHostBridge = () => {
    if (!isLocalHost()) return;

    // Presence marker, so a page can detect the extension synchronously.
    try {
      document.documentElement.dataset.semitone = chrome.runtime.getManifest().version;
      window.dispatchEvent(new CustomEvent('semitone-ready', {
        detail: { version: chrome.runtime.getManifest().version },
      }));
    } catch { /* documentElement always exists at document_idle, but never break on it */ }

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__semitone !== true || !RELAYED.has(data.type)) return;

      chrome.runtime
        .sendMessage({ ...data, type: `page:${data.type}` })
        .then((result) => {
          window.postMessage({ __semitoneReply: true, id: data.id ?? null, result }, location.origin);
        })
        .catch((err) => {
          window.postMessage(
            { __semitoneReply: true, id: data.id ?? null, result: { ok: false, error: String(err?.message || err) } },
            location.origin,
          );
        });
    }, { passive: true });

    log('host bridge available on', location.origin);
  };

  installNavigationWatchers();
  installHostBridge();
})();
