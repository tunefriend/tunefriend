#!/usr/bin/env bash
# TuneFriend — Copyright (C) 2026 James — GPL-3.0-or-later
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APPS_DIR="${HOME}/.local/share/applications"
ICONS_DIR="${HOME}/.local/share/icons"
DATA_DIR="${HOME}/.local/share/tunefriend"
DESKTOP_ID="com.tunefriend.TuneFriend"

echo "==> Installing TuneFriend for desktop"

mkdir -p "$APPS_DIR" "$ICONS_DIR" "$DATA_DIR"
cp "${APP_DIR}/icons/icon.svg" "${ICONS_DIR}/tunefriend.svg"
chmod +x "${APP_DIR}/tunefriend-desktop.sh" "${APP_DIR}/start.sh"

cat >"${APPS_DIR}/${DESKTOP_ID}.desktop" <<EOF
[Desktop Entry]
Name=TuneFriend
Comment=Stream music from your friend's server
Exec=${APP_DIR}/tunefriend-desktop.sh
Icon=${ICONS_DIR}/tunefriend.svg
Terminal=false
Type=Application
Categories=AudioVideo;Music;Network;
StartupNotify=true
Keywords=music;subsonic;navidrome;streaming;
EOF

chmod +x "${APPS_DIR}/${DESKTOP_ID}.desktop"

if [[ -d "${HOME}/Desktop" ]]; then
  cp "${APPS_DIR}/${DESKTOP_ID}.desktop" "${HOME}/Desktop/TuneFriend.desktop"
  chmod +x "${HOME}/Desktop/TuneFriend.desktop"
  if command -v gio >/dev/null 2>&1; then
    gio set "${HOME}/Desktop/TuneFriend.desktop" metadata::trusted true 2>/dev/null || true
  fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPS_DIR}" 2>/dev/null || true
fi

echo ""
echo "TuneFriend is installed!"
echo "  • Open your app menu and search for TuneFriend"
echo "  • Or double-click TuneFriend on your Desktop"
echo ""
echo "The app runs locally at http://127.0.0.1:8765"
echo "Logs: ${DATA_DIR}/server.log"