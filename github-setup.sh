#!/usr/bin/env bash
# TuneFriend — Copyright (C) 2026 James — GPL-3.0-or-later
set -euo pipefail

export PATH="/home/james/.local/git/usr/bin:${PATH:-}"
export GIT_EXEC_PATH="/home/james/.local/git/usr/lib/git-core"
cd "$(dirname "$0")"

echo "==> TuneFriend GitHub setup"
echo ""

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git not found. Run: /home/james/tunefriend/github-setup.sh after git is installed." >&2
  exit 1
fi

# First-time git identity
if ! git config --global user.name >/dev/null 2>&1; then
  read -rp "Your name (for git commits): " GIT_NAME
  git config --global user.name "$GIT_NAME"
fi
if ! git config --global user.email >/dev/null 2>&1; then
  read -rp "Your email (for GitHub): " GIT_EMAIL
  git config --global user.email "$GIT_EMAIL"
fi

if [[ ! -d .git ]]; then
  git init -b main
fi

git add -A
git status --short | head -30
echo ""

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "TuneFriend v1.7 — Subsonic music client for Android and desktop"
fi

git tag -f v1.7 2>/dev/null || git tag v1.7

echo ""
echo "=== Next: create the repo on GitHub ==="
echo ""
echo "1. Go to https://github.com/new"
echo "2. Repository name: tunefriend"
echo "3. Description: Stream music from a friend's Subsonic server"
echo "4. Choose Public (needed for F-Droid later)"
echo "5. Do NOT add README, .gitignore, or license (we already have them)"
echo "6. Click Create repository"
echo ""
read -rp "Your GitHub username: " GH_USER

if [[ -z "$GH_USER" ]]; then
  echo "Aborted — no username entered." >&2
  exit 1
fi

REMOTE="https://github.com/${GH_USER}/tunefriend.git"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi

echo ""
echo "Pushing to $REMOTE ..."
echo "(GitHub will ask for your username + Personal Access Token as password)"
echo "Create a token at: https://github.com/settings/tokens (classic, repo scope)"
echo ""

git push -u origin main --tags

echo ""
echo "Done! Your repo: https://github.com/${GH_USER}/tunefriend"
echo ""
echo "To share the APK with friends via GitHub Releases:"
echo "  1. Go to https://github.com/${GH_USER}/tunefriend/releases/new"
echo "  2. Choose tag v1.7"
echo "  3. Upload TuneFriend-v7.apk"
echo "  4. Publish — send friends the release link"