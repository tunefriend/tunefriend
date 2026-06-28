#!/usr/bin/env bash
# TuneFriend — Copyright (C) 2026 James — GPL-3.0-or-later
set -euo pipefail
cd "$(dirname "$0")"

export PATH="/home/james/.local/node/bin:$PATH"
export JAVA_HOME="/home/james/.local/jdk21"
export ANDROID_HOME="/home/james/.local/android-sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

npm run build:apk

APK="android/app/build/outputs/apk/debug/app-debug.apk"
cp "$APK" TuneFriend.apk
echo ""
echo "APK ready: $(pwd)/TuneFriend.apk"
echo ""
if adb devices 2>/dev/null | grep -q 'device$'; then
  echo "Phone detected — installing..."
  adb install -r TuneFriend.apk
  echo "Installed! Open TuneFriend on your phone."
else
  echo "To install on your phone:"
  echo "  1. Copy TuneFriend.apk to your Pixel (USB, cloud, etc.)"
  echo "  2. Tap the file and allow install from this source"
  echo "  Or connect USB debugging and run: adb install -r TuneFriend.apk"
fi