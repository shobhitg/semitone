#!/usr/bin/env bash
# Rasterize icons/icon.svg to the PNG sizes the manifest asks for.
# Uses ffmpeg's librsvg decoder — already a dependency of the Track Launcher.
set -euo pipefail

cd "$(dirname "$0")/../icons"

for size in 16 32 48 128; do
  ffmpeg -y -v error -i icon.svg -vf "scale=${size}:${size}" -pix_fmt rgba "icon-${size}.png"
  echo "icon-${size}.png"
done
