#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE_DIR="$DIST_DIR/rechnung-hosting-$STAMP"
ZIP_PATH="$DIST_DIR/rechnung-hosting-$STAMP.zip"

mkdir -p "$STAGE_DIR"

rsync -a \
  --exclude '.git' \
  --exclude '.idea' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.DS_Store' \
  --exclude 'dist' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude 'rechnung.pdf' \
  --exclude 'uploads/*' \
  "$ROOT_DIR/" "$STAGE_DIR/"

mkdir -p "$STAGE_DIR/uploads"

cat > "$STAGE_DIR/DEPLOY_NOTES.txt" <<NOTES
Hosting Paket Notlari
=====================

1) Bu paket Next.js + Python API uygulamasini icerir.
2) Sunucuda once:
   - scripts/hosting_bootstrap.sh
   - scripts/hosting_start.sh
3) SQL kurulumunu sql/schema.sql ile yapin.
4) uploads klasorune yazma izni verin.
5) nextjs-app/.env.local ve kok .env dosyalarini sunucuya ozel doldurun.
NOTES

(cd "$DIST_DIR" && zip -rq "$(basename "$ZIP_PATH")" "$(basename "$STAGE_DIR")")

echo "Paket hazir: $ZIP_PATH"
