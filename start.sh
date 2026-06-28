#!/usr/bin/env bash
# TuneFriend — Copyright (C) 2026 James — GPL-3.0-or-later
set -euo pipefail
cd "$(dirname "$0")"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8765}"
exec python3 server.py --host "$HOST" --port "$PORT"