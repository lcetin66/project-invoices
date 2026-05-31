#!/usr/bin/env bash
# Project owner: Levent Cetin
set -euo pipefail

ROOT_DIR="/Users/lventctn/Developer/PythonDersleri/PycharmProjects/Masterschool-Project"
API_LOG="/tmp/invoices_api.log"
WEB_LOG="/tmp/next_dev.log"
PYTHON_BIN="python3.13"
API_PORT="8000"
API_HEALTH_URL="http://127.0.0.1:${API_PORT}/api/kategorien"

echo "==> Starting presentation environment"
cd "$ROOT_DIR"

echo "==> Stopping old processes"
pkill -f classifier_api.py || true
pkill -f "python api/classifier_api.py" || true
pkill -f "next dev" || true
pm2 delete rechnung-python-api || true

# Hard-stop anything still bound to API port.
if lsof -tiTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  while IFS= read -r pid; do
    [ -n "$pid" ] && kill -9 "$pid" || true
  done < <(lsof -tiTCP:"$API_PORT" -sTCP:LISTEN)
fi

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

echo "==> Waiting for API health"
API_READY=0
for _ in {1..20}; do
  if curl -sS -m 2 "$API_HEALTH_URL" >/dev/null 2>&1; then
    API_READY=1
    break
  fi
  sleep 0.5
done

if [ "$API_READY" -ne 1 ]; then
  echo "WARN: API did not become healthy on first start. Retrying once..."
  pkill -f classifier_api.py || true
  pkill -f "python api/classifier_api.py" || true
  if lsof -tiTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    while IFS= read -r pid; do
      [ -n "$pid" ] && kill -9 "$pid" || true
    done < <(lsof -tiTCP:"$API_PORT" -sTCP:LISTEN)
  fi
  sleep 1
  nohup python api/classifier_api.py >"$API_LOG" 2>&1 &
  API_PID=$!
  echo "API PID (retry): $API_PID"
  for _ in {1..20}; do
    if curl -sS -m 2 "$API_HEALTH_URL" >/dev/null 2>&1; then
      API_READY=1
      break
    fi
    sleep 0.5
  done
fi

if [ "$API_READY" -ne 1 ]; then
  echo "ERROR: API still not healthy. Check log: $API_LOG"
  tail -n 80 "$API_LOG" || true
  exit 1
fi

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
echo "API  health: $API_HEALTH_URL"
