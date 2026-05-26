#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/second_brain_common.sh
source "${SCRIPT_DIR}/second_brain_common.sh"

sb_require_dir

INDEX_FILE="${SECOND_BRAIN_PROJECT_DIR}/index.md"
LOG_FILE="${SECOND_BRAIN_PROJECT_DIR}/log.md"
ROADMAP_FILE="${SECOND_BRAIN_PROJECT_DIR}/features/roadmap.md"
CLAUDE_FILE="${SECOND_BRAIN_PROJECT_DIR}/CLAUDE.md"

print_block() {
  local title="$1"
  local file="$2"
  local lines="$3"
  echo "===== ${title} ====="
  if [[ -f "${file}" ]]; then
    sed -n "1,${lines}p" "${file}"
  else
    echo "(dosya yok) ${file}"
  fi
  echo
}

echo "Second brain context yukleniyor: ${SECOND_BRAIN_PROJECT_DIR}"
echo "Tarih: $(sb_now)"
echo

print_block "INDEX (ilk 120 satir)" "${INDEX_FILE}" 120
print_block "ROADMAP (ilk 120 satir)" "${ROADMAP_FILE}" 120

echo "===== LOG (son 120 satir) ====="
if [[ -f "${LOG_FILE}" ]]; then
  tail -n 120 "${LOG_FILE}"
else
  echo "(dosya yok) ${LOG_FILE}"
fi
echo

print_block "CLAUDE (ilk 120 satir)" "${CLAUDE_FILE}" 120

