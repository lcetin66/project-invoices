#!/usr/bin/env bash
# Project owner: Levent Cetin
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  echo ".venv klasoru bulunamadi. Once sanal ortam olusturun." >&2
  exit 1
fi

source .venv/bin/activate
python3 api/classifier_api.py
