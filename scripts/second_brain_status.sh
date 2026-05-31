#!/usr/bin/env bash
# Project owner: Levent Cetin

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/second_brain_common.sh
source "${SCRIPT_DIR}/second_brain_common.sh"

sb_require_dir

echo "Second brain:      ${SECOND_BRAIN_DIR}"
echo "Project wiki:      ${SECOND_BRAIN_PROJECT_DIR}"
echo "Index:             ${SECOND_BRAIN_PROJECT_DIR}/index.md"
echo "Log:               ${SECOND_BRAIN_PROJECT_DIR}/log.md"
echo "Roadmap:           ${SECOND_BRAIN_PROJECT_DIR}/features/roadmap.md"
echo

for f in \
  "${SECOND_BRAIN_PROJECT_DIR}/index.md" \
  "${SECOND_BRAIN_PROJECT_DIR}/log.md" \
  "${SECOND_BRAIN_PROJECT_DIR}/features/roadmap.md"
do
  if [[ -f "${f}" ]]; then
    printf "OK   %s\n" "${f}"
  else
    printf "MISS %s\n" "${f}"
  fi
done

