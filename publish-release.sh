#!/usr/bin/env bash
# Publish a GitHub release with APK. Requires GH_TOKEN or: gh auth login -s repo
set -euo pipefail

cd "$(dirname "$0")"

VERSION="${1:-2.13}"
TAG="v${VERSION}"
APK="${2:-/home/james/TuneFriend-v${VERSION}.apk}"
NOTES="RELEASE_v${VERSION}.md"
REPO="tunefriend/tunefriend"

GH_BIN="${GH_BIN:-}"
for c in /home/james/.local/bin/gh gh; do
  if [[ -x "$c" ]] || command -v "$c" >/dev/null 2>&1; then
    GH_BIN="$c"
    break
  fi
done

if [[ ! -f "$APK" ]]; then
  echo "APK not found: $APK" >&2
  echo "Build first: npm run build:apk && cp android/app/build/outputs/apk/release/app-release.apk ~/TuneFriend-v${VERSION}.apk" >&2
  exit 1
fi

if [[ ! -f "$NOTES" ]]; then
  echo "Release notes not found: $NOTES" >&2
  exit 1
fi

publish_gh() {
  "$GH_BIN" release view "$TAG" --repo "$REPO" >/dev/null 2>&1 && \
    "$GH_BIN" release upload "$TAG" "$APK" --repo "$REPO" --clobber && \
    "$GH_BIN" release edit "$TAG" --repo "$REPO" --notes-file "$NOTES" && \
    echo "Updated existing release $TAG" || \
    "$GH_BIN" release create "$TAG" "$APK" --repo "$REPO" --title "TuneFriend ${TAG}" --notes-file "$NOTES" --latest
}

publish_api() {
  local api="https://api.github.com/repos/${REPO}/releases"
  local code payload
  code=$(curl -sS -o /tmp/tf-release.json -w "%{http_code}" \
    -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
    "$api/tags/${TAG}")
  if [[ "$code" == "200" ]]; then
    local id
    id=$(python3 -c "import json; print(json.load(open('/tmp/tf-release.json'))['id'])")
    curl -sS -X PATCH -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
      -d "$(python3 -c "import json; print(json.dumps({'body': open('${NOTES}').read()}))")" \
      "$api/${id}" >/dev/null
    curl -sS -X POST -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"${APK}" \
      "$api/${id}/assets?name=TuneFriend-v${VERSION}.apk" >/dev/null
    echo "Updated release $TAG via API"
  else
    payload=$(python3 -c "import json; print(json.dumps({'tag_name':'${TAG}','name':'TuneFriend ${TAG}','body':open('${NOTES}').read(),'draft':False,'make_latest':'true'}))")
    curl -sS -X POST -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
      -d "$payload" "$api" >/tmp/tf-release.json
    local id
    id=$(python3 -c "import json; print(json.load(open('/tmp/tf-release.json'))['id'])")
    curl -sS -X POST -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"${APK}" \
      "$api/${id}/assets?name=TuneFriend-v${VERSION}.apk" >/dev/null
    echo "Created release $TAG via API"
  fi
}

if [[ -n "${GH_TOKEN:-}" ]]; then
  publish_api
elif [[ -n "$GH_BIN" ]] && "$GH_BIN" auth status 2>&1 | grep -q "Token scopes:.*repo"; then
  publish_gh
else
  echo "GitHub auth required. Either:" >&2
  echo "  export GH_TOKEN=ghp_...   # token with repo scope" >&2
  echo "  ./publish-release.sh" >&2
  echo "Or: /home/james/.local/bin/gh auth login -h github.com -p https -s repo -w" >&2
  exit 1
fi

echo "https://github.com/${REPO}/releases/tag/${TAG}"