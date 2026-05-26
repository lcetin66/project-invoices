#!/usr/bin/env bash

set -euo pipefail

SECOND_BRAIN_DIR_DEFAULT="/Users/lventctn/Documents/ikinci-beyin"
SECOND_BRAIN_PROJECT_DEFAULT="masterschool-wiki"

SECOND_BRAIN_DIR="${SECOND_BRAIN_DIR:-$SECOND_BRAIN_DIR_DEFAULT}"
SECOND_BRAIN_PROJECT="${SECOND_BRAIN_PROJECT:-$SECOND_BRAIN_PROJECT_DEFAULT}"
SECOND_BRAIN_PROJECT_DIR="${SECOND_BRAIN_DIR}/${SECOND_BRAIN_PROJECT}"

sb_require_dir() {
  if [[ ! -d "${SECOND_BRAIN_DIR}" ]]; then
    echo "Second brain dizini bulunamadi: ${SECOND_BRAIN_DIR}" >&2
    echo "SECOND_BRAIN_DIR env ile yolu guncelleyebilirsin." >&2
    return 1
  fi
  if [[ ! -d "${SECOND_BRAIN_PROJECT_DIR}" ]]; then
    echo "Proje wiki dizini bulunamadi: ${SECOND_BRAIN_PROJECT_DIR}" >&2
    echo "SECOND_BRAIN_PROJECT env ile wiki adini guncelleyebilirsin." >&2
    return 1
  fi
}

sb_now() {
  date +"%Y-%m-%d %H:%M:%S"
}

