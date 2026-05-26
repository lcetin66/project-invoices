#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_PATH="${REPO_ROOT}/.git/hooks/post-commit"
HOOK_LOG="${REPO_ROOT}/.git/second_brain_hook.log"

cat > "${HOOK_PATH}" <<EOF
#!/usr/bin/env bash
set -u

REPO_ROOT="${REPO_ROOT}"
SCRIPT="\${REPO_ROOT}/scripts/second_brain_log.sh"
HOOK_LOG="${HOOK_LOG}"

if [[ -x "\${SCRIPT}" ]]; then
  SHA=\$(git -C "\${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  MSG=\$(git -C "\${REPO_ROOT}" log -1 --pretty=%s 2>/dev/null || echo "commit")
  "\${SCRIPT}" auto "commit \${SHA}: \${MSG}" >> "\${HOOK_LOG}" 2>&1 || true
fi
EOF

chmod +x "${HOOK_PATH}"

echo "Kuruldu: ${HOOK_PATH}"
echo "Hook log: ${HOOK_LOG}"

