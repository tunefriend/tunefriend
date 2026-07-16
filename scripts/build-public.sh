#!/usr/bin/env bash
# Sync web assets into public/ for Cloudflare Workers deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf public
mkdir -p public/css public/js public/icons

cp index.html manifest.json sw.js public/
cp css/app.css public/css/
cp -r js/* public/js/
cp icons/* public/icons/ 2>/dev/null || true

if [[ -f node_modules/@capacitor/core/dist/capacitor.js ]]; then
  cp node_modules/@capacitor/core/dist/capacitor.js public/capacitor.js
else
  echo '/* web no-op */' > public/capacitor.js
fi

# Prefer version from package sync script / VERSION if present
if [[ -f www/VERSION.txt ]]; then
  cp www/VERSION.txt public/VERSION.txt
else
  echo "web" > public/VERSION.txt
fi

echo "Built public/ for Cloudflare ($(find public -type f | wc -l) files)"
