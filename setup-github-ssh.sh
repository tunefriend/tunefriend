#!/usr/bin/env bash
# TuneFriend — Copyright (C) 2026 James — GPL-3.0-or-later
set -euo pipefail

export PATH="/home/james/.local/git/usr/bin:${PATH:-}"
export GIT_EXEC_PATH="/home/james/.local/git/usr/lib/git-core"

cd "$(dirname "$0")"

GH_USER="${1:-tunefriend}"
KEY_FILE="${HOME}/.ssh/id_ed25519"
PUB_FILE="${KEY_FILE}.pub"

if [[ ! -f "$PUB_FILE" ]]; then
  ssh-keygen -t ed25519 -C "${GH_USER}@github" -f "$KEY_FILE" -N ""
fi

mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"
chmod 600 "$KEY_FILE" "$PUB_FILE"

cat > "${HOME}/.ssh/config" <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile ${KEY_FILE}
  IdentitiesOnly yes
EOF
chmod 600 "${HOME}/.ssh/config"

git remote set-url origin "git@github.com:${GH_USER}/tunefriend.git"

echo ""
echo "=== Step 1: Add this SSH key to GitHub ==="
echo ""
cat "$PUB_FILE"
echo ""
echo "1. Open https://github.com/settings/ssh/new"
echo "2. Title: debian-tunefriend"
echo "3. Key type: Authentication Key"
echo "4. Paste the key above"
echo "5. Click Add SSH key"
echo ""
read -rp "Press Enter after you have added the key on GitHub..."

echo ""
echo "=== Step 2: Test GitHub SSH login ==="
ssh -T "git@github.com" || true

echo ""
echo "=== Step 3: Push code ==="
git push -u origin main --tags

echo ""
echo "Done! Repo: https://github.com/${GH_USER}/tunefriend"
echo "Post APK: https://github.com/${GH_USER}/tunefriend/releases/new"