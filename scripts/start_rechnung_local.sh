#!/usr/bin/env bash
# Project owner: Levent Cetin
set -euo pipefail

PROJECT_DIR="/Users/lventctn/Developer/PythonDersleri/PycharmProjects/Masterschool-Project"

cd "$PROJECT_DIR"

# 1) API (autostart varsa tekrar baslatmaya gerek yok, ama yoksa kaldir)
if ! curl -sS -m 2 http://127.0.0.1:8000/api/kategorien >/dev/null 2>&1; then
  if [ -x "$PROJECT_DIR/.venv/bin/python3" ]; then
    nohup "$PROJECT_DIR/.venv/bin/python3" "$PROJECT_DIR/api/classifier_api.py" >/tmp/invoices_api.log 2>&1 &
    sleep 2
  fi
fi

# 2) XAMPP hedef klasore senkron (sudo gerekebilir)
sudo "$PROJECT_DIR/scripts/deploy_local.sh"

# 3) Bilgi
echo "Hazir:"
echo "  Frontend: http://localhost/rechnung"
echo "  API:      http://127.0.0.1:8000/api/kategorien"
