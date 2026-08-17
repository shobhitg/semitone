#!/usr/bin/env bash
# Generate the test-page audio fixtures. Not committed — 2.8 MB of content that one ffmpeg
# command reproduces exactly. Two arpeggios a fourth apart, so "track A" and "track B" are
# audibly different songs when testing the reset watcher.
set -euo pipefail
cd "$(dirname "$0")"

tone() { # tone <out> <f1> <f2> <f3> <f4>
  ffmpeg -y -v error \
    -f lavfi -i "sine=frequency=$2:duration=2" -f lavfi -i "sine=frequency=$3:duration=2" \
    -f lavfi -i "sine=frequency=$4:duration=2" -f lavfi -i "sine=frequency=$5:duration=2" \
    -filter_complex "[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1[a];\
[a]afade=t=in:d=0.05,afade=t=out:st=7.9:d=0.1,volume=0.5[out]" \
    -map "[out]" -ac 2 -ar 44100 "$1"
  echo "  $1"
}

tone tone-a.wav 261.63 329.63 392.00 523.25   # C major arpeggio
tone tone-b.wav 349.23 440.00 523.25 698.46   # F major, a fourth up
