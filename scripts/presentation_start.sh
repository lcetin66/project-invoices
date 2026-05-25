#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/lventctn/Developer/PythonDersleri/PycharmProjects/Masterschool-Project"
API_LOG="/tmp/invoices_api.log"
WEB_LOG="/tmp/next_dev.log"
PYTHON_BIN="python3.13"

echo "==> Starting presentation environment"
cd "$ROOT_DIR"

echo "==> Stopping old processes"
pkill -f classifier_api.py || true
pkill -f "python api/classifier_api.py" || true
pkill -f "next dev" || true
pm2 delete rechnung-python-api || true

echo "==> Cleaning caches"
find "$ROOT_DIR" -type d -name "__pycache__" -prune -exec rm -rf {} + || true
find "$ROOT_DIR" -type f -name "*.pyc" -delete || true
rm -rf "$ROOT_DIR/nextjs-app/.next" || true
rm -rf "$ROOT_DIR/nextjs-app/node_modules/.cache" || true
rm -rf "$ROOT_DIR/.pytest_cache" || true
rm -f /tmp/invoices_api.log /tmp/next_dev.log /tmp/presentation_pip_install.log /tmp/presentation_npm_install.log || true

echo "==> Preparing Python backend"
if [ ! -d ".venv" ]; then
  "$PYTHON_BIN" -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt >/tmp/presentation_pip_install.log 2>&1

echo "==> Starting backend API"
nohup python api/classifier_api.py >"$API_LOG" 2>&1 &
API_PID=$!
echo "API PID: $API_PID"

echo "==> Preparing Next.js frontend"
cd "$ROOT_DIR/nextjs-app"
npm install >/tmp/presentation_npm_install.log 2>&1
rm -rf .next

echo "==> Starting Next.js dev server"
nohup npm run dev >"$WEB_LOG" 2>&1 &
WEB_PID=$!
echo "WEB PID: $WEB_PID"

echo "==> Opening browser"
sleep 2
open "http://localhost:3000" || true

echo ""
echo "Done."
echo "API  log: $API_LOG"
echo "WEB  log: $WEB_LOG"
echo "Open: http://localhost:3000"
