#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
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

apply_wmpf_patches() {
  local patch_file="$LONGMAO_INSTALL_ROOT_RESOLVED/patches/wmpf-debugger/0001-fix-legacy-scene-pointer.patch"
  [[ -f "$patch_file" ]] || die "WMPFDebugger 补丁缺失: $patch_file"
  if grep -q 'remoteDebugParametersPtr.add(structOffsets\[5\])' "$LONGMAO_WMPF/frida/hook.js"; then
    git -C "$LONGMAO_WMPF" apply --check "$patch_file"
    git -C "$LONGMAO_WMPF" apply "$patch_file"
  elif grep -q 'remoteDebugConfigPtr.add(structOffsets\[5\])' "$LONGMAO_WMPF/frida/hook.js"; then
    :
  else
    die 'WMPFDebugger hook.js 与预期不一致，拒绝静默打补丁。'
  fi
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
apply_wmpf_patches
(
  cd "$LONGMAO_WMPF"
  rm -rf node_modules package-lock.json
  npx --yes yarn@1.22.22 install --frozen-lockfile
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
