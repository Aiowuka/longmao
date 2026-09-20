#!/usr/bin/env bash
set -euo pipefail
INSTALL_ROOT="${LONGMAO_INSTALL_ROOT:-$HOME/.local/opt/longmao}"
if [[ -x "$INSTALL_ROOT/scripts/linux/uninstall.sh" ]]; then
  exec "$INSTALL_ROOT/scripts/linux/uninstall.sh" "$@"
fi
echo 'Longmao is not installed at the default location.' >&2
exit 1
