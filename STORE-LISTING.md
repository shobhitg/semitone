# Publishing Semitone to the Chrome Web Store

Everything to paste, in the order the dashboard asks for it. Build the upload first:

```bash
./tools/package.sh        # → dist/semitone-1.0.0.zip
```

---

## 0. Before you start

**One-time $5 developer registration fee**, paid at
[chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole). It
covers the account, not the extension, and it is non-refundable. Use an account you will
still control in three years — transferring an extension later is awkward.

**Decide visibility first**, because it changes how much the listing copy matters:

| Visibility | Who can install | Fits when |
|---|---|---|
| **Unlisted** | Anyone with the link; not in search | You want to hand ~30 singers a link |
| **Public** | Anyone; appears in search | You want strangers to find it |
| **Private** | Named testers, or your Workspace domain | Testing before going wider |

**Unlisted is probably what you want**, at least at first. You are distributing to a known
group, not competing for installs. Same review process, same install experience, but nobody
lands on it expecting Auto-Tune and leaves a one-star review. You can switch to Public later
without re-reviewing from scratch.

A note on the name: the Web Store does **not** require unique names. "Semitone" being taken
would affect how easily people find yours, not whether it is accepted — and on Unlisted it
does not matter at all.

---

## 1. Store listing tab

**Name**
```
Semitone — karaoke key control
```

**Summary** (132 char limit; this is 111)
```
Change the key of any karaoke track, live. Transpose up or down by semitones on YouTube, Smule or a local file.
```

**Description**
```
Semitone changes the key of a karaoke track while it plays, so a singer can perform in a key
that suits their voice.

It does one job and has no account, no sign-in, and no telemetry.


WHAT IT DOES

• Transposes up or down by whole semitones, up to three either way
• Fine tunes by cents, for older recordings that were not cut at concert pitch
• Works on YouTube, Smule, and local audio or video files opened in a tab
• Shows the current key on the page itself, readable from across a room
• Clears the key whenever the track changes, so nothing carries into the next song


HOW TO USE IT

Open the karaoke track, start it playing, then click the Semitone icon in the toolbar.

  Key down / up          the − and + buttons, or Alt+Shift+Down / Alt+Shift+Up
  Back to original key   the Reset button, or Alt+Shift+0
  Fine tune              Fine tune & display → the cents slider

The keyboard shortcuts work with the popup closed, which is the point — you can change key
from across the room without looking at the screen. They can be rebound at
chrome://extensions/shortcuts if they clash with something else.

The toolbar badge shows the current key whenever one is applied, so a stray transposition is
visible even when the popup is shut.


WHY ONLY THREE SEMITONES

Because past that a backing track stops sounding like the record. Three semitones is a
minor third — a large move for a singer already. If someone needs more, they usually need a
different backing track rather than a different key.


SEMITONES VERSUS CENTS

They answer different questions, which is why they are separate controls.

  Semitones (±3, whole steps)   Which key the singer performs in. Changes every song.
  Cents (±50, 5-cent steps)     Whether the recording itself is at concert pitch.

A cent is one hundredth of a semitone. Older recordings — anything cut to tape, and plenty of
film music from the 1950s and 60s — often sit tens of cents away from A=440, because tape
machines did not run at exactly the same speed everywhere. A singer with a good ear, or one
tuning against a harmonium or a keyboard, will feel that even when the semitone is right.

Fine tune fixes the recording. Semitones choose the key. If you have never needed the fine
tune slider, leave it at zero.


THE KEY CLEARS ITSELF BETWEEN SONGS

This is the reason Semitone exists.

You drop a song two semitones for one singer, and the next singer gets the same two semitones
because nobody remembered to undo it. That is a bad moment in front of a room.

Semitone resets whenever the track changes. Not only on a page reload — also when YouTube
advances to the next video without reloading, when a playlist moves on, and when a player
swaps its source underneath you. All three are detected. A key belongs to one performance and
never carries into the next.

The on-screen readout flashes "Reset — new track" when this happens, so you can see it work.


THE ON-SCREEN READOUT

Because the projector shows the karaoke tab, not your laptop, Semitone can paint the current
key onto the page itself.

  Fine tune & display → On-screen readout
    Only when a key is applied   (default) appears when there is something to report
    Always (stage mode)          always visible, including a plain 0
    Off                          never

Stage mode always shows a number, including zero, so "nothing is applied" is something you
can read rather than something you have to infer. Position it in any corner.


REMEMBERING KEYS

Off by default. A key belongs to a performance, not to a URL, so opening the same video
tomorrow plays it as recorded.

Turn on "Remember keys per video" and a key you set by hand comes back the next time you open
that video. Turning it back off clears everything it kept, because a stale key you have
forgotten about is exactly the surprise this extension exists to prevent.


WHERE IT WORKS

Automatically, with no clicking: YouTube, youtu.be, Smule, and pages served from localhost.

Anywhere else: click the Semitone icon on that tab and it works there too, for that tab, for
as long as it stays open. Nothing is granted permanently.

For local files opened with a file:// address, switch on "Allow access to file URLs" on the
Semitone card in chrome://extensions first — Chrome blocks all extensions from local files
until you do.


IT TRANSPOSES THE TRACK, NOT YOUR VOICE

There is no vocal correction here and none is planned. Semitone never touches your
microphone. If you are looking for Auto-Tune, this is not that.


WHY IT ASKS FOR THESE PERMISSIONS

Chrome will say Semitone can read and change your data on YouTube, youtu.be, Smule and
localhost. Here is exactly what that is for.

To change the key before the first note, Semitone has to attach to the audio while the page
is loading. A tab opened by a setlist app receives no click, so there is no other moment to
act on. Chrome offers no narrower permission for this.

What it actually does with that access: finds the audio or video element on the page and
routes its sound through a pitch shifter. It does not read page content, does not track what
you watch, and sends nothing anywhere.


WHEN IT WILL NOT WORK

Stated plainly, because discovering these mid-show is worse than reading them now.

• Some sites serve audio in a way browsers refuse to let extensions process. Semitone tells
  you instead of silently muting the track.
• Copy-protected streams — Netflix, Spotify and similar — cannot be processed at all.
• If a page swaps its media player after Semitone has attached, reload the tab.
• Chrome sometimes refuses to start audio processing until you have clicked the page. Click
  the video once and try again.
• There is no tempo or speed control. Karaoke tracks are played at written tempo.


IF SOMETHING SEEMS WRONG

Right-click the Semitone icon and choose Options. That page lists exactly what the extension
believes: which sites it can reach, whether it is watching, and every key it holds. It is
read-only and answers "why did my key not apply" faster than guessing.


FOR EVENT HOSTS AND DEVELOPERS

A web app running on localhost can set a key per song in advance, and Semitone applies it the
moment that tab opens. Useful if you run karaoke nights from a setlist app: the host sets the
key while preparing, and nobody touches the extension during the show.

Integration needs no extension ID and no build step. Post a window message; Semitone replies.

DETECTING IT

  const version = document.documentElement.dataset.semitone;   // e.g. "1.0.0", or undefined
  window.addEventListener("semitone-ready", e => console.log(e.detail.version));

TALKING TO IT

  let seq = 0;
  const semitone = (message) => new Promise((resolve) => {
    const id = ++seq;
    const onReply = (e) => {
      if (e.source !== window || !e.data?.__semitoneReply || e.data.id !== id) return;
      window.removeEventListener("message", onReply);
      resolve(e.data.result);
    };
    window.addEventListener("message", onReply);
    window.postMessage({ __semitone: true, id, ...message }, location.origin);
    setTimeout(() => { window.removeEventListener("message", onReply); resolve(null); }, 1500);
  });

MESSAGES

  { type: "status" }
      → { ok, name, version, presetCount, grantedOrigins }

  { type: "presets", presets: [ ... ] }
      → { ok, presetCount }
      Replaces the ENTIRE set. Not a merge — removing a key in your app removes it here,
      which is what stops a song transposing after you thought you had cleared it.

  { type: "arm", semitone, cents, label }
      → { ok }
      Applies once to the active tab. For "set the key on what is already playing".

A PRESET

  { key: "yt:AzN4PKgPg-4", semitone: -2, cents: 0, label: "Slot 7 - Ana" }

  key       identifies the track (below). Required.
  semitone  whole semitones, clamped to -3..+3.
  cents     fine trim, clamped to -50..+50. Use for a recording not cut at concert pitch.
  label     up to 80 chars, shown in the on-screen readout. Optional.

TRACK KEYS

  YouTube      "yt:" + video ID       yt:AzN4PKgPg-4
  Anything else "url:" + origin + pathname, no query, no trailing slash
                                      url:https://www.smule.com/song/abc

  Use the video ID, not the watch URL. YouTube appends &list=, &start_radio= and &t= as a
  session goes on, so full-URL matching silently stops matching.

EXAMPLE — arm a key, then open the tab

  await semitone({ type: "presets", presets: [
    { key: "yt:AzN4PKgPg-4", semitone: -2, cents: 0, label: "Slot 7 - Ana" },
  ]});
  window.open("https://www.youtube.com/watch?v=AzN4PKgPg-4", "_blank");

PRECEDENCE

  A preset from your app wins. Then a key the user set by hand, if they have turned on
  "Remember keys per video". Otherwise the track plays in its original key. A key never
  carries from one track to the next.

SCOPE

  The bridge exists only on localhost, 127.0.0.1, [::1] and *.localhost, because any script
  on a page can post these messages. On youtube.com there is no bridge, so no website can
  change what a singer hears. Only the four message types above are relayed; anything else
  is ignored.

  If you would rather use an extension ID, chrome.runtime.sendMessage(EXTENSION_ID, message)
  accepts the same messages from any localhost page.

PRIVACY

Semitone collects nothing, sends nothing, and has no account or server. Settings and keys are
stored on your own machine using Chrome's local storage. The audio never leaves your computer
— all processing happens in the browser tab.


CREDITS

Pitch shifting by Signalsmith Stretch (MIT licence), running as a WebAssembly audio worklet.
All code ships inside the extension; nothing is downloaded at runtime.
```

**Category:** `Productivity` — Chrome has no music category, and this is a tool used while
working through a setlist. (`Entertainment` is defensible; Productivity attracts fewer
"this isn't a game" complaints.)

**Language:** English

---

## 2. Graphics

**Store icon** — a **separate upload**; the dashboard does not take it from the ZIP. Two
prepared by `tools/package.sh`:

- `dist/store-icon-128-fullbleed.png` — try this first
- `dist/store-icon-128-padded.png` — 96×96 artwork inset in a 128 canvas, if the full-bleed
  version looks cramped next to neighbouring tiles

**Screenshots** — at least one, 1280×800 or 640×400 PNG. Three suggested, in this order:

1. **The popup over a real karaoke video**, key showing `−2`. This is the one that sells it.
2. **The on-screen readout** in stage mode, over a lyrics frame — shows the feature nothing
   else has.
3. **The reset moment** — the readout showing `0` with "Reset — new track", which is the
   whole pitch of the extension.

Capture at exactly 1280×800 (`Cmd+Shift+4`, then resize, or set the browser window to that
size). Avoid showing anything identifying: your event sheet, singer names, tab bar with
personal bookmarks.

**Promotional tiles** are optional and only used for Public listings that get featured. Skip.

---

## 3. Privacy tab — the part that gets extensions rejected

### Single purpose

```
Semitone changes the musical key of audio playing in a browser tab, so a karaoke singer can
perform a song in a key that suits their voice.
```

### Permission justifications

Reviewers reject vague justifications. Each of these says what the permission does *and* why
the feature cannot work without it.

**`activeTab`**
```
When the user clicks the Semitone toolbar icon or presses its keyboard shortcut, the
extension attaches an audio processing node to the media element playing in that tab. This
grants access only to the tab the user acted on, at the moment they acted, and is how the
extension works on sites outside its declared host list.
```

**`scripting`**
```
Used to inject the content script that finds the playing media element and builds the Web
Audio graph that shifts its pitch. Injection happens on the tab the user clicked, or on a
site in the declared host list when a key has been set in advance for that video.
```

**`storage`**
```
Stores the user's own settings on their machine: the on-screen readout position, whether to
remember a key per video, and any keys sent by a local companion app. Nothing is transmitted
anywhere. There is no account and no server.
```

**Host permissions — `*://*.youtube.com/*`, `*://*.youtu.be/*`, `*://*.smule.com/*`**
```
These are the karaoke sources the extension supports. It must attach to the media element
before playback begins so the correct key is applied from the first note — a tab that a
companion app opens receives no user click, so activeTab cannot apply there. The extension
reads only the audio element on the page; it does not read, collect or transmit page content.
```

**Host permission — `http://localhost/*`**
```
Lets a companion app running on the user's own machine set a key per song in advance. This
is loopback only and cannot reach any remote site. Users who do not run such an app are
unaffected.
```

**Remote code: answer NO.** Getting this wrong is the single easiest way to send yourself
into a deep review. All code, including the WebAssembly, ships inside the package —
`vendor/signalsmith-worklet.js` is pre-built precisely so nothing is fetched or generated at
runtime. Answering Yes here means "this extension loads JS or Wasm from outside the package",
which Semitone does not. `vendor/signalsmith-worklet.js` is pre-built precisely so nothing is fetched or
generated at runtime — worth saying if a reviewer asks about the WASM.

### Data use disclosure

Tick **nothing**. Semitone collects none of the listed categories — no PII, health, financial,
authentication, personal communications, location, web history, user activity, or website
content. Settings stay in `chrome.storage.local` on the user's machine.

Then certify all three:
- Not being sold to third parties ✓
- Not being used for purposes unrelated to the single purpose ✓
- Not being used to determine creditworthiness or for lending ✓

**Privacy policy URL:** REQUIRED, even with zero data collection — the field is marked with
an asterisk regardless of what you tick above. `PRIVACY.md` in this repo is the text; publish
it somewhere reachable and paste that URL. Fastest route is a public GitHub Gist.

---

## 4. Submit

Upload the ZIP, fill the three tabs, **Submit for review**.

Expect **a few hours to a few days**. Extensions with declared host permissions get more
scrutiny than those without, which is the price of the automatic behaviour. First submissions
are also slower than updates.

### Where this one could get pushed back

- **Host permissions vs. single purpose.** The justifications above address this directly:
  each host is a karaoke source, and the permission exists because a launcher-opened tab has
  no click for `activeTab` to hang on.
- **`externally_connectable` to localhost.** Unusual enough to draw a question. The answer is
  that it accepts messages only from loopback addresses, and the content-script bridge is
  installed only on `localhost`, `127.0.0.1` and `*.localhost` — never on a public site.
- **Bundled WebAssembly.** Point at `tools/build-worklet.mjs`, which shows the worklet is
  generated at build time from the MIT-licensed `signalsmith-stretch` npm package, and that
  nothing is downloaded at runtime.

If it is rejected, the notice names the policy. Fix, bump the version, re-upload — the
version must increase on every upload, which is why `tools/package.sh` reads it from the
manifest rather than taking an argument.

---

## 5. After it is live

- **Test the published build**, not just the unpacked one. The store install has a different
  extension ID, which matters if a companion app uses the ID-based messaging door. The
  `postMessage` bridge does not care.
- **Pin the ID before your first upload** if you want it stable across the unpacked and
  published copies — add a `key` field to the manifest. Once published, the store assigns the
  ID permanently, so this is a decision you make once.
- **Updates** are the same flow with a higher version number. Review is usually faster.
