#!/bin/bash
# Regenerate Android + fastlane PNGs from assets/icon.png (1024x1024).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICON="$ROOT/assets/icon.png"
RES="$ROOT/android/app/src/main/res"

if [ ! -f "$ICON" ]; then
  echo "Missing $ICON — add a 1024x1024 source icon first."
  exit 1
fi

for spec in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  density="${spec%%:*}"
  size="${spec##*:}"
  for name in ic_launcher ic_launcher_round ic_launcher_foreground; do
    ffmpeg -y -i "$ICON" -vf "scale=${size}:${size}" "$RES/mipmap-${density}/${name}.png" >/dev/null 2>&1
  done
done

ffmpeg -y -i "$ICON" -vf scale=512:512 "$ROOT/fastlane/metadata/android/en-US/images/icon.png" >/dev/null 2>&1
echo "Icons updated from assets/icon.png"