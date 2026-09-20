#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

printf 'Longmao local stack status\n\n'
for spec in   'Redis 6379'   'Totoro 3000'   'Longmao 3210'   'WMPF-debug 9421'   'WMPF-CDP 62000'
do
  name="${spec% *}"
  port="${spec##* }"
  if port_open "$port"; then state='UP  '; else state='DOWN'; fi
  printf '%s  %-12s  127.0.0.1:%s\n' "$state" "$name" "$port"
done
printf '\nInstall: %s\nRuntime: %s\nConfig:  %s\nLogs:    %s\n'   "$LONGMAO_INSTALL_ROOT_RESOLVED" "$LONGMAO_RUNTIME_ROOT_RESOLVED" "$LONGMAO_CONFIG_FILE" "$LONGMAO_LOGS"
