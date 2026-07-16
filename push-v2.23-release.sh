#!/usr/bin/env bash
# Push v2.23 to GitHub and publish the release-signed APK (fixes F-Droid MR pipeline).
set -euo pipefail
cd "$(dirname "$0")"

APK="${1:-$HOME/TuneFriend-v2.23.apk}"
TAG=v2.23
VERSION=2.23

if [[ ! -f "$APK" ]]; then
  echo "APK not found: $APK" >&2
  echo "Build first: npm run build:apk" >&2
  exit 1
fi

push_git() {
  if [[ -n "${GH_TOKEN:-}" ]]; then
    git push "https://x-access-token:${GH_TOKEN}@github.com/tunefriend/tunefriend.git" main
    git push "https://x-access-token:${GH_TOKEN}@github.com/tunefriend/tunefriend.git" "$TAG"
    return
  fi
  if command -v gh >/dev/null 2>&1 && gh auth status 2>&1 | grep -q "Logged in"; then
    git push origin main
    git push origin "$TAG"
    return
  fi
  echo "GitHub auth required. Either:" >&2
  echo "  export GH_TOKEN=ghp_..." >&2
  echo "  gh auth login -h github.com -p https -s repo" >&2
  exit 1
}

echo "==> Tagging $TAG at $(git rev-parse --short HEAD)"
git tag -f "$TAG"

echo "==> Pushing main + $TAG to GitHub"
push_git

echo "==> Publishing GitHub release"
./publish-release.sh "$VERSION" "$APK"

echo "Done. Re-run the GitLab pipeline on MR !41558 — fdroid build needs commit $(git rev-parse HEAD) and $TAG APK on GitHub."