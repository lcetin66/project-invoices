#!/usr/bin/env bash
# Project owner: Levent Cetin

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/second_brain_common.sh
source "${SCRIPT_DIR}/second_brain_common.sh"

sb_require_dir

if [[ $# -lt 2 ]]; then
  echo "Kullanim: $0 <tip> <mesaj>" >&2
  echo "Ornek:    $0 fix \"Search preview vergi satirlari hizalandi\"" >&2
  exit 1
fi

ENTRY_TYPE="$1"
shift
ENTRY_TEXT="$*"
LOG_FILE="${SECOND_BRAIN_PROJECT_DIR}/log.md"

if [[ ! -f "${LOG_FILE}" ]]; then
  if ! { echo "# Log" > "${LOG_FILE}" && echo >> "${LOG_FILE}"; }; then
    echo "Log dosyasi olusturulamadi: ${LOG_FILE}" >&2
    exit 1
  fi
fi

if [[ ! -w "${LOG_FILE}" ]]; then
  echo "Log dosyasina yazma izni yok: ${LOG_FILE}" >&2
  exit 1
fi

DATE_ONLY="$(date +"%Y-%m-%d")"
TS="$(sb_now)"
HEADER="## [${DATE_ONLY}] codex | ${ENTRY_TYPE}"

if ! rg -q "^## \\[${DATE_ONLY}\\]" "${LOG_FILE}"; then
  if ! {
    echo
    echo "${HEADER}"
  } >> "${LOG_FILE}"; then
    echo "Log basligi yazilamadi: ${LOG_FILE}" >&2
    exit 1
  fi
fi

if ! {
  echo "- [${TS}] ${ENTRY_TEXT}"
} >> "${LOG_FILE}"; then
  echo "Log satiri yazilamadi: ${LOG_FILE}" >&2
  exit 1
fi

echo "Log kaydi eklendi: ${LOG_FILE}"
