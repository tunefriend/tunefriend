#!/usr/bin/env bash
# TuneFriend — Copyright (C) 2026 James — GPL-3.0-or-later
set -euo pipefail

export PATH="/home/james/.local/git/usr/bin:${PATH:-}"
export GIT_EXEC_PATH="/home/james/.local/git/usr/lib/git-core"

cd "$(dirname "$0")"

GH_USER="${1:-tunefriend}"
REMOTE="https://github.com/${GH_USER}/tunefriend.git"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi

if [[ "${USE_SSH:-}" == "1" ]]; then
  REMOTE="git@github.com:${GH_USER}/tunefriend.git"
  git remote set-url origin "$REMOTE"
fi

echo "Pushing to $REMOTE"
echo ""
echo "If HTTPS keeps failing with 403, use SSH instead:"
echo "  ./setup-github-ssh.sh"
echo ""
echo "HTTPS login:"
echo "  Username: ${GH_USER}"
echo "  Password: classic token with repo scope (ghp_...)"
echo "  Create at: https://github.com/settings/tokens/new"
echo ""

git push -u origin main --tags

echo ""
echo "Repo: https://github.com/${GH_USER}/tunefriend"
echo "Post APK: https://github.com/${GH_USER}/tunefriend/releases/new"