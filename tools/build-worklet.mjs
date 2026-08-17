/**
 * Emit vendor/signalsmith-worklet.js.
 *
 * WHY THIS EXISTS
 * Signalsmith builds its AudioWorklet module at runtime and hands it to addModule() as a
 * blob: URL. AudioWorklet module loading is policed by the *page's* CSP — being in an
 * isolated world does not exempt us — and YouTube's script-src does not allow blob:, so
 * addModule() fails with "Unable to load a worklet's module".
 *
 * Resources served from chrome-extension:// and declared web-accessible are exempt from
 * the page's CSP, so we pre-build the exact module Signalsmith would have generated, ship
 * it as a file, and point `SignalsmithStretch.moduleUrl` at it.
 *
 * Rather than parse the bundle (fragile), this runs Signalsmith's own code path under stubs
 * and captures what it produces — so the output tracks whatever the library actually does.
 * Re-run after any bump of the signalsmith-stretch dependency.
 *
 *   node tools/build-worklet.mjs
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'vendor', 'signalsmith-worklet.js');

let captured = null;

// 1. Capture the module source as it is handed to the Blob constructor.
globalThis.Blob = class {
  constructor(parts) {
    captured = parts.join('');
  }
};

// 2. Hand back any string; the value is never used because step 3 aborts first.
globalThis.URL = globalThis.URL ?? {};
globalThis.URL.createObjectURL = () => 'stub:worklet';

// 3. Force the library down its addModule() path, then stop it going further.
globalThis.AudioWorkletNode = class {
  constructor() {
    throw new Error('stub: no AudioWorkletNode in Node');
  }
};

const { default: SignalsmithStretch } = await import('../vendor/SignalsmithStretch.mjs');

const fakeContext = { audioWorklet: { addModule: async () => {} } };

await SignalsmithStretch(fakeContext).catch(() => {});

if (!captured) {
  console.error('Failed to capture the worklet module — has signalsmith-stretch changed how it loads?');
  process.exit(1);
}

await writeFile(OUT, `${captured}\n`, 'utf8');
console.log(`vendor/signalsmith-worklet.js  ${(captured.length / 1024).toFixed(1)} KB`);
