#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

TOTORO_REPO='https://github.com/yuyuyudlc/Totoro.git'
TOTORO_COMMIT='c499040d52c6e1d45f06f7949419799ccc770db9'
WMPF_REPO='https://github.com/evi0s/WMPFDebugger.git'
WMPF_COMMIT='8b1359fa282981a777eea72a4851a3e96674fa9c'

command_exists git || die 'git 不可用，请重新运行 Linux 安装器。'
command_exists node || die 'Node.js 不可用，请重新运行 Linux 安装器。'

"$SCRIPT_DIR/stop.sh" || true

checkout() {
  local repo="$1" commit="$2" dest="$3"
  if [[ ! -d "$dest/.git" ]]; then
    rm -rf "$dest"
    git clone --filter=blob:none --no-checkout "$repo" "$dest"
  fi
  git -C "$dest" fetch origin "$commit" --depth 1
  git -C "$dest" checkout --detach --force "$commit"
}

say '修复 Totoro'
checkout "$TOTORO_REPO" "$TOTORO_COMMIT" "$LONGMAO_TOTORO"
(
  cd "$LONGMAO_TOTORO"
  npx --yes pnpm@10 install --frozen-lockfile
  npx --yes pnpm@10 build
)

say '修复 WMPFDebugger'
checkout "$WMPF_REPO" "$WMPF_COMMIT" "$LONGMAO_WMPF"
(
  cd "$LONGMAO_WMPF"
  npm install
)

if [[ -f "$LONGMAO_CONFIG_FILE" ]]; then
  backend="$(python3 - "$LONGMAO_CONFIG_FILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    print(json.load(f)['capture']['origin'])
PY
)"
  "$SCRIPT_DIR/configure.sh" "$backend"
fi

printf '修复完成。运行 longmao 启动。\n'
