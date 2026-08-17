#!/usr/bin/env bash
# Load-test every script against a stubbed Chrome. Catches what reading the code does not:
# throws at evaluation time, TDZ errors, and — the one that mattered — a cosmetic failure
# that aborts the chain before the audio is applied.
set -uo pipefail
cd "$(dirname "$0")"
fail=0
for h in service-worker popup content bridge integration; do
  echo "── $h"
  node "$h.mjs" || fail=1
done
exit $fail
