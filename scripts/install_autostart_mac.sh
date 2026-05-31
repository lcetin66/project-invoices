#!/usr/bin/env bash
# Project owner: Levent Cetin
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.rechnungsmanager.api.plist"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python3"
API_FILE="$ROOT_DIR/api/classifier_api.py"
LOG_OUT="/tmp/rechnungsmanager-api.out.log"
LOG_ERR="/tmp/rechnungsmanager-api.err.log"

if [ ! -x "$PYTHON_BIN" ]; then
  echo "Python bulunamadi: $PYTHON_BIN" >&2
  echo "Once sanal ortam olusturun: python3 -m venv .venv && source .venv/bin/activate" >&2
  exit 1
fi

mkdir -p "$PLIST_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.rechnungsmanager.api</string>

  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON_BIN</string>
    <string>$API_FILE</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>CLASSIFIER_API_HOST</key>
    <string>127.0.0.1</string>
    <key>CLASSIFIER_API_PORT</key>
    <string>8000</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOG_OUT</string>

  <key>StandardErrorPath</key>
  <string>$LOG_ERR</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load "$PLIST_PATH"

sleep 1

if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Autostart aktif. API 127.0.0.1:8000 uzerinde dinliyor."
else
  echo "Autostart kuruldu ama API henuz dinlemiyor. Log kontrol edin:" >&2
  echo "  tail -n 80 $LOG_ERR" >&2
  exit 1
fi

echo "Kapatmak icin: launchctl unload $PLIST_PATH"
