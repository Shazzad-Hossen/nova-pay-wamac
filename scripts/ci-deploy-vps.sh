#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wa-mac}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"

if [[ -z "$REPO_URL" ]]; then
  echo "REPO_URL is required"
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown -R "$USER":"$USER" "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [[ ! -f ".env.prod" ]]; then
  echo "Missing $APP_DIR/.env.prod on VPS. Create it once before CI deploy."
  exit 1
fi

chmod +x ./deploy.sh
./deploy.sh
