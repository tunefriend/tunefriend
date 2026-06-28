#!/usr/bin/env bash
# TuneFriend — Copyright (C) 2026 James — GPL-3.0-or-later
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${HOME}/.local/share/tunefriend"
PORT="${PORT:-8765}"
URL="http://127.0.0.1:${PORT}"
PID_FILE="${DATA_DIR}/server.pid"
LOG_FILE="${DATA_DIR}/server.log"

mkdir -p "$DATA_DIR"

server_running() {
  curl -sf "${URL}/api/health" >/dev/null 2>&1
}

start_server() {
  if server_running; then
    return 0
  fi

  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE")"
    if kill -0 "$old_pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  nohup python3 "${APP_DIR}/server.py" --host 127.0.0.1 --port "$PORT" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  for _ in $(seq 1 30); do
    if server_running; then
      return 0
    fi
    sleep 0.1
  done

  echo "TuneFriend server failed to start. See ${LOG_FILE}" >&2
  exit 1
}

open_app() {
  if command -v chromium >/dev/null 2>&1; then
    exec chromium --app="$URL" --new-window
  fi
  if command -v google-chrome >/dev/null 2>&1; then
    exec google-chrome --app="$URL" --new-window
  fi
  if command -v firefox >/dev/null 2>&1; then
    exec firefox --new-window "$URL"
  fi
  if command -v librewolf >/dev/null 2>&1; then
    exec librewolf --new-window "$URL"
  fi
  exec xdg-open "$URL"
}

start_server
open_app