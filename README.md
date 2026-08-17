# Semitone

A Chrome extension that shifts a karaoke track up or down by semitones, in real time, on any
page — YouTube, Smule, or a local file open in a tab.

It does one job. No history, no loop editor, no EQ, no account, no telemetry. A singer and a
host install the same extension and get the same result.

Named for the unit it works in: whole semitones for choosing a key, cents for correcting a
recording that is not at concert pitch.

**It transposes the track, not your voice.** Nothing touches the microphone — there is no
vocal correction here, and none is planned. Worth stating plainly wherever this is listed,
because "pitch" in a karaoke context is widely read as Auto-Tune, and a user expecting that
will be disappointed by a tool that is working perfectly.

Any local web app can drive it — set a key per song and it applies itself the moment that tab
opens. See **[Integrating your own app](#integrating-your-own-app)**.

**The one rule:** a key applies to one performance and never survives into the next. A page
load clears it for free; a soft navigation (YouTube advancing to the next video without a
page load) is caught explicitly. That reset is the reason this exists — everything else is
a volume knob.

---

## Install

Not on the Web Store yet. Load it unpacked:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder (`semitone/`)
3. Pin it to the toolbar

Chrome will say it can read and change your data on YouTube, youtu.be, Smule and localhost.
That is exactly what it does, and it is what makes a key apply on its own — see *Why host
permissions are declared* below. Everywhere else it stays inert until you click the icon.

## Use

| Action | How |
|---|---|
| Key up / down | `Alt+Shift+↑` / `Alt+Shift+↓`, or the popup's **+** / **−** |
| Back to original key | `Alt+Shift+0`, or **Reset** |
| On-screen readout | Popup → *Display & shortcuts* |
| Keep a key for a video | Popup → *Remember keys per video* (off by default) |
| Fine tune the recording | Popup → *Fine tune & display* → ±50 cents |

Range is **±3 semitones**, deliberately narrow. Past that a backing track stops sounding like
the record, and a singer who needs more than three is on the wrong track rather than the wrong
key. The limit is one constant — `SEMITONE_MIN`/`MAX` in `src/service-worker.js`, mirrored by
`SEMITONE_LIMIT` in `src/popup.js` and `SEMITONE_RANGE` in the launcher's `shared/types.ts`.

### Two units, two jobs

**Semitones** (±3, whole steps) are *which key the singer sings in*. Standard 12-tone equal
temperament, one press per semitone, changes every slot.

**Cents** (±50, 20-cent steps) are *whether the recording is at concert pitch* — a property
of the track, not the singer. 1950s–60s film recordings were cut on variable-speed tape and a
fair number sit tens of cents off A=440, which a singer referencing a harmonium will feel even
when the semitone is right.

They are separate controls because folding them into one would mean fifteen presses to move a
whole tone, which is useless with someone waiting on stage. It is also how real gear splits it:
a keyboard has Transpose in semitones and Master Tune in cents. Internally they sum into one
float — Signalsmith takes fractional semitones — so the DSP does not care.

The big readout stays whole semitones. Showing `−2.3` where a singer expects `−2` would only
confuse the thing that gets read fastest.

### Two controls that aren't there

**Formant compensation** is permanently on, with no switch. It corrects the vocal-tract
resonances that make a shifted voice sound chipmunky or growly — which matters on a guide
vocal and does close to nothing on an instrumental backing track, i.e. most karaoke videos.
A switch nobody can hear the effect of is worse than no switch.

**No volume control.** A mixer fader or the system volume does that job better and faster
than anything in a popup, and duplicating it only adds something to get wrong mid-show. The
`presets` message still accepts `gainDb` so the launcher needs no change if per-slot loudness
ever turns out to matter; the extension currently ignores it.

### Stage mode

Set the on-screen readout to **Always** and the extension paints a badge on the page itself
— which matters, because the projector is showing the karaoke tab, not your laptop UI. It
always shows a number, including `0`, so "nothing is applied" is something you can read
rather than infer.

The toolbar badge shows the current key too, so a stray transposition is visible from the
browser chrome even with the popup closed.

---

## How it works

```
<video> ─→ MediaElementSource ─┬─→ delay ──────→ dry ─┐
                               └─→ Signalsmith ─→ wet ─┴─→ mix ─→ speakers
```

Pitch shifting is [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/)
(MIT), running as a WASM AudioWorklet. It's vendored unmodified in `vendor/` — the WASM is
embedded in the JS, so there's no separate binary and no build step for this repo.

Both paths stay connected and we crossfade, rather than connecting and disconnecting, which
clicks. The dry path is delayed to match the stretcher's latency so returning to the
original key doesn't shift audio against video.

The content script runs in the **isolated world**, not MAIN. Tools like Transpose patch the
page's own `AudioContext` so they can intercept players that use Web Audio directly. We
don't need that: YouTube and Smule play a plain media element, and an isolated-world
`AudioContext` can source that same element. Staying out of MAIN means never touching page
globals and never fighting the page's CSP.

### Layout

```
manifest.json           MV3; host access declared for YouTube / Smule / localhost
src/service-worker.js   injection · toolbar badge · keyboard commands
src/content.js          media discovery · audio graph · reset watcher · on-screen HUD
src/popup.*             the controls
vendor/                 Signalsmith Stretch (MIT, unmodified)
icons/                  icon.svg is the source; PNGs rasterized by tools/make-icons.sh
```

---

## Status — read this before an event

Pitch shifting, media discovery and the launcher link are confirmed working on a real
YouTube watch page. Still worth checking in this order after any change:

1. **YouTube, a normal video.** Click the icon, press `+`. If you hear a shift, the whole
   architecture is good.
2. **YouTube Premium offline download.** Your launcher's README documents that downloads
   need a moment of network to authorize and break if a window is reused. Adding an
   `AudioContext` to that page is a new variable in a setup you had to fight for — verify
   it before it matters on stage.
3. **A soft navigation.** Set a key, then click through to the next video *without*
   reloading. It must snap back to `0` and flash "Reset — new track". This is the feature.
4. **Smule**, and a local file opened via `file://` (needs "Allow access to file URLs" in
   `chrome://extensions`).

### The worklet is pre-built — don't skip this after a dependency bump

Signalsmith normally builds its AudioWorklet module at runtime and loads it from a `blob:`
URL. **AudioWorklet module loading is policed by the page's CSP** — running in the isolated
world does not exempt you — and YouTube's `script-src` forbids `blob:`, so `addModule()`
fails with *"Unable to load a worklet's module"*. (Confirmed on
`youtube.com/watch`, Aug 2026.)

Resources served from `chrome-extension://` and declared web-accessible are exempt, so
`vendor/signalsmith-worklet.js` is a pre-built copy of exactly what the library would have
generated, and `content.js` points `SignalsmithStretch.moduleUrl` at it.

```bash
node tools/build-worklet.mjs     # re-run after bumping signalsmith-stretch
```

The build runs the library's own code path under stubs and captures its output rather than
parsing the bundle, so it tracks whatever Signalsmith actually does. It fails loudly if the
library changes how it loads.

Known gaps:

- **Cross-origin media is unprocessable.** Media served from another origin without a
  `crossorigin` attribute taints the graph and yields silence, so the extension refuses and
  says so rather than muting your track. Offline rendering (Phase 2) is the answer there.
- **One player per tab.** If a page swaps its media element after we've attached, the popup
  asks you to reload. `createMediaElementSource` can't be undone.
- **No tempo control.** Deliberate: Signalsmith's rate control only applies to buffered
  audio, not live input, and karaoke tracks are played at written tempo.

---

## Publishing

`./tools/package.sh` builds `dist/semitone-<version>.zip` from an explicit allow-list, so a
new development file can never ship by accident. It fails rather than warns if the manifest
references a path the zip does not contain.

Full walkthrough, with the listing copy and permission justifications to paste:
**[STORE-LISTING.md](STORE-LISTING.md)**.

## Integrating your own app

A local web app can set a key per song, and the extension applies it when that tab opens.
Nothing to switch on, and **no extension id required**.

### Detect it

The extension stamps its version on any localhost page it runs on:

```js
const version = document.documentElement.dataset.semitone;
// or, if your app loads first:
window.addEventListener('semitone-ready', (e) => console.log(e.detail.version));
```

### Talk to it

Post a window message. The content script relays it and posts a reply back:

```js
let seq = 0;
const semitone = (message) => new Promise((resolve) => {
  const id = ++seq;
  const onReply = (e) => {
    if (e.source !== window || !e.data?.__semitoneReply || e.data.id !== id) return;
    window.removeEventListener('message', onReply);
    resolve(e.data.result);
  };
  window.addEventListener('message', onReply);
  window.postMessage({ __semitone: true, id, ...message }, location.origin);
  setTimeout(() => { window.removeEventListener('message', onReply); resolve(null); }, 1500);
});
```

| Message | Does |
|---|---|
| `{type: 'status'}` | Returns `{ok, version, presetCount, grantedOrigins}` |
| `{type: 'presets', presets: [...]}` | **Replaces** the whole preset set |
| `{type: 'arm', semitone, cents, label}` | Applies once to the active tab |

A preset is `{key, semitone, cents, label}`. The `key` identifies the track:

- **YouTube** — `yt:<videoId>`. Use the id, not the URL: YouTube appends `&list=`,
  `&start_radio=` and `&t=` as you use it, and full-URL matching misses.
- **Anything else** — `url:<origin><pathname>`, no query, no trailing slash.
  e.g. `url:https://www.smule.com/song/abc`

`src/track-key.js` is the reference implementation; copy it rather than reimplementing.

Set a preset before opening the tab and the key is on before the first note:

```js
await semitone({ type: 'presets', presets: [
  { key: 'yt:AzN4PKgPg-4', semitone: -2, cents: 0, label: 'Slot 7 · Ana' },
]});
window.open('https://www.youtube.com/watch?v=AzN4PKgPg-4', '_blank');
```

The set is **replaced, never merged** — clearing a key in your app clears it here too, or a
song would keep transposing after you thought you had removed it.

### Scope and trust

The bridge is installed **only on `localhost`, `127.0.0.1` and `*.localhost`**. Any script on
a page can post these messages, so it exists only where the page is already trusted. On
youtube.com there is no bridge, and no website can change what a singer hears.

If you would rather use the id-based door, `externally_connectable` accepts
`chrome.runtime.sendMessage(EXTENSION_ID, message)` from any localhost page with the same
message types. Chrome match patterns ignore ports, so any localhost port qualifies.

## How a key is chosen

In order:

1. **A launcher preset** for this video — authoritative, because the launcher knows who is
   singing.
2. **A key you set by hand**, but only if *Remember keys per video* is on.
3. **Original key.**

`Remember keys per video` is the extension's only behavioural setting and it is **off by
default**: a key belongs to a performance, not to a URL. Open the same video in a fresh tab
tomorrow and it plays as recorded. Turning the setting off also clears whatever it had kept,
because a stale key is exactly the surprise it exists to prevent.

## Why host permissions are declared, not optional

Automatic behaviour on a tab nobody clicked requires host access — Chrome offers no way
around it, and `activeTab` only fires on a click. So `host_permissions` names YouTube,
youtu.be, Smule and localhost outright: granted at install, nothing to switch on, and the
install prompt says so honestly. `*://*/*` stays optional for transposing automatically
somewhere not on that list; manual use anywhere is already covered by `activeTab`.

## Diagnostics

Right-click the icon → **Options** (or `chrome://extensions` → Details → Extension options).
Read-only: host access, whether the content script is registered and what it watches, every
preset and every remembered key. When a key does not apply, that page says why faster than
guessing.

Development harnesses live in `tools/harness/` — `./tools/harness/run.sh` executes the
worker, popup and content script against a stubbed Chrome, and the content one asserts that
a matching preset actually attaches an audio graph. It has caught two real bugs that reading
the code did not.

## Licence

MIT — see [LICENSE](LICENSE).

Bundled [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) is also MIT,
vendored unmodified from npm `signalsmith-stretch@1.3.2`; see
[vendor/LICENSE-signalsmith.txt](vendor/LICENSE-signalsmith.txt).

## Contributing

`./tools/harness/run.sh` runs every script against a stubbed Chrome — including a test that
extracts the integration snippet from this README's sibling doc and runs it against the real
bridge. Run it before opening a PR; it has caught bugs that reading the code did not.
