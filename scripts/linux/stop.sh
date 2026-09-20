#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

for name in longmao-web wmpf-debugger totoro-worker totoro-web redis; do
  printf '停止 %s\n' "$name"
  stop_managed "$name"
done
printf 'Longmao/Totoro/WMPF 受管进程已停止。\n'
