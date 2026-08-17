#!/usr/bin/env bash
#
# Build the ZIP to upload to the Chrome Web Store.
#
# Ships only what the extension needs at runtime. Development files are excluded on purpose:
# tools/ carries a 2.8 MB test-page with WAV fixtures, and a reviewer reading harness code
# that stubs `chrome` is a distraction at best.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUT="$ROOT/dist/semitone-$VERSION.zip"

mkdir -p "$ROOT/dist"
rm -f "$OUT"

# Explicit allow-list, not an exclude-list: a new dev file should never silently ship.
zip -qr "$OUT" \
  manifest.json \
  src \
  vendor/SignalsmithStretch.mjs \
  vendor/signalsmith-worklet.js \
  vendor/LICENSE-signalsmith.txt \
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png \
  -x '*.DS_Store'

python3 - "$OUT" <<'PYEOF'
import sys, zipfile, json, os

path = sys.argv[1]
z = zipfile.ZipFile(path)
names = set(z.namelist())

print(path)
print()
print('contents:')
for info in sorted(z.infolist(), key=lambda i: i.filename):
    print(f'  {info.file_size:8,d}  {info.filename}')

total = sum(i.file_size for i in z.infolist())
print()
print(f'  {len(names)} files · {total/1024:.0f} KB uncompressed · {os.path.getsize(path)/1024:.0f} KB zipped')
print()

problems = []

required = {'manifest.json', 'src/content.js', 'src/service-worker.js', 'src/popup.html',
            'vendor/signalsmith-worklet.js', 'icons/icon-128.png'}
problems += [f'missing required file: {n}' for n in sorted(required - names)]

# Every path the manifest names must actually be in the zip, or the extension breaks only
# once installed from the store — the worst place to find out.
m = json.loads(z.read('manifest.json'))
referenced = [m['background']['service_worker'], m['action']['default_popup'],
              *m['icons'].values(), *m['action']['default_icon'].values(),
              *[r for w in m['web_accessible_resources'] for r in w['resources']]]
if 'options_ui' in m:
    referenced.append(m['options_ui']['page'])
problems += [f'manifest references {p}, not in zip' for p in sorted(set(referenced)) if p not in names]

# Anything that looks like development scaffolding.
problems += [f'dev file shipped: {n}' for n in sorted(names)
             if n.startswith('tools/') or n.endswith(('.wav', '.md')) and 'LICENSE' not in n]

if problems:
    print('PROBLEMS')
    for p in problems:
        print('  ✗', p)
    sys.exit(1)

print(f"✓ ready to upload — version {m['version']}")
PYEOF
