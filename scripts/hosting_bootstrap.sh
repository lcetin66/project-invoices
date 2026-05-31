#!/usr/bin/env bash
# Project owner: Levent Cetin
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  python3.13 -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

cd "$ROOT_DIR/nextjs-app"
npm install
npm run build

echo "Hosting bootstrap tamamlandi."
