#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="/Applications/XAMPP/xamppfiles/htdocs/rechnung"

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync bulunamadı. Lütfen macOS'ta rsync kurulu olduğundan emin olun." >&2
  exit 1
fi

echo "[1/3] Proje XAMPP klasorune senkronlaniyor..."
sudo mkdir -p "$TARGET_DIR"
sudo rsync -a --delete \
  --exclude '.git' \
  --exclude '.idea' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.DS_Store' \
  "$SRC_DIR/" "$TARGET_DIR/"

echo "[2/3] Senkron tamamlandi."
echo "[3/3] Tarayicida su adresi ac: http://localhost/rechnung"
echo "Not: API icin ayri terminalde su komutu acik tut:"
echo "  cd $SRC_DIR && source .venv/bin/activate && python3 api/classifier_api.py"
