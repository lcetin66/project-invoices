#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

pm2 start ecosystem.config.js
pm2 save

echo "Uygulama ayaga kalkti. Kontrol:"
echo "pm2 status"
