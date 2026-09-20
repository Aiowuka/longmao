#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

TOTORO_REPO='https://github.com/yuyuyudlc/Totoro.git'
TOTORO_COMMIT='c499040d52c6e1d45f06f7949419799ccc770db9'
WMPF_REPO='https://github.com/evi0s/WMPFDebugger.git'
WMPF_COMMIT='8b1359fa282981a777eea72a4851a3e96674fa9c'

ensure_x86_64

install_packages() {
  local missing=()
  command_exists git || missing+=(git)
  command_exists curl || missing+=(curl)
  command_exists xz || missing+=(xz)
  command_exists sha256sum || missing+=(coreutils)
  command_exists python3 || missing+=(python3)
  command_exists make || missing+=(build)
  command_exists g++ || missing+=(build)
  command_exists redis-server || missing+=(redis)
  (("${#missing[@]}" == 0)) && return 0

  say "安装缺失的系统依赖: ${missing[*]}"
  if command_exists apt-get; then
    sudo apt-get update
    sudo apt-get install -y git curl ca-certificates xz-utils coreutils python3 build-essential redis-server
  elif command_exists dnf; then
    sudo dnf install -y git curl ca-certificates xz coreutils python3 gcc-c++ make redis
  elif command_exists pacman; then
    sudo pacman -Sy --needed --noconfirm git curl ca-certificates xz coreutils python base-devel redis
  else
    die '未识别包管理器。当前一键依赖安装支持 apt/dnf/pacman。'
  fi
}

ensure_node22() {
  if command_exists node; then
    local major
    major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
    if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 22 )); then return 0; fi
  fi

  say '安装 Longmao 私有 Node.js 22 runtime'
  local tmp file expected actual version
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl --fail --location --retry 3 --silent --show-error     https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$tmp/SHASUMS256.txt"
  file="$(awk '/ node-v[0-9.]+-linux-x64\.tar\.xz$/ {print $2; exit}' "$tmp/SHASUMS256.txt")"
  expected="$(awk -v f="$file" '$2 == f {print $1}' "$tmp/SHASUMS256.txt")"
  [[ -n "$file" && -n "$expected" ]] || die '无法解析 Node.js latest-v22.x 校验文件。'
  curl --fail --location --retry 3 --silent --show-error     "https://nodejs.org/dist/latest-v22.x/$file" -o "$tmp/$file"
  actual="$(sha256sum "$tmp/$file" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || die 'Node.js 下载文件 SHA-256 校验失败。'

  rm -rf "$LONGMAO_NODE_ROOT"
  mkdir -p "$LONGMAO_NODE_ROOT"
  tar -xJf "$tmp/$file" --strip-components=1 -C "$LONGMAO_NODE_ROOT"
  export PATH="$LONGMAO_NODE_ROOT/bin:$PATH"
  version="$(node --version)"
  [[ "$version" == v22.* ]] || die "本地 Node 安装异常: $version"
  trap - RETURN
  rm -rf "$tmp"
}

checkout_pinned() {
  local repo="$1" commit="$2" dest="$3" name="$4"
  say "准备 $name"
  if [[ ! -d "$dest/.git" ]]; then
    rm -rf "$dest"
    git clone --filter=blob:none --no-checkout "$repo" "$dest"
  fi
  git -C "$dest" fetch origin "$commit" --depth 1
  git -C "$dest" checkout --detach --force "$commit"
  git -C "$dest" reset --hard "$commit"
  git -C "$dest" clean -fdx
}

apply_wmpf_patches() {
  local patch_file="$LONGMAO_INSTALL_ROOT_RESOLVED/patches/wmpf-debugger/0001-fix-legacy-scene-pointer.patch"
  local jscontext_patcher="$LONGMAO_INSTALL_ROOT_RESOLVED/patches/wmpf-debugger/apply-jscontext-routing.mjs"
  local diagnostics_patcher="$LONGMAO_INSTALL_ROOT_RESOLVED/patches/wmpf-debugger/apply-miniapp-diagnostics.mjs"
  local result_context_patcher="$LONGMAO_INSTALL_ROOT_RESOLVED/patches/wmpf-debugger/apply-result-jscontext-inference.mjs"
  local network_only_patcher="$LONGMAO_INSTALL_ROOT_RESOLVED/patches/wmpf-debugger/apply-network-only-mode.mjs"
  local network_metadata_patcher="$LONGMAO_INSTALL_ROOT_RESOLVED/patches/wmpf-debugger/apply-network-metadata-adapter.mjs"
  [[ -f "$patch_file" ]] || die "WMPFDebugger 补丁缺失: $patch_file"
  [[ -f "$jscontext_patcher" ]] || die "WMPFDebugger JSContext 补丁器缺失: $jscontext_patcher"
  [[ -f "$diagnostics_patcher" ]] || die "WMPFDebugger 诊断补丁器缺失: $diagnostics_patcher"
  [[ -f "$result_context_patcher" ]] || die "WMPFDebugger Result JSContext 补丁器缺失: $result_context_patcher"
  [[ -f "$network_only_patcher" ]] || die "WMPFDebugger Network-only 补丁器缺失: $network_only_patcher"
  [[ -f "$network_metadata_patcher" ]] || die "WMPFDebugger 网络元数据补丁器缺失: $network_metadata_patcher"
  if grep -q 'remoteDebugParametersPtr.add(structOffsets\[5\])' "$LONGMAO_WMPF/frida/hook.js"; then
    git -C "$LONGMAO_WMPF" apply --check "$patch_file"
    git -C "$LONGMAO_WMPF" apply "$patch_file"
  elif grep -q 'remoteDebugConfigPtr.add(structOffsets\[5\])' "$LONGMAO_WMPF/frida/hook.js"; then
    :
  else
    die 'WMPFDebugger hook.js 与预期不一致，拒绝静默打补丁。'
  fi
  node "$jscontext_patcher" "$LONGMAO_WMPF/src/index.ts"
  node "$diagnostics_patcher" "$LONGMAO_WMPF/src/index.ts"
  node "$result_context_patcher" "$LONGMAO_WMPF/src/index.ts"
  node "$network_only_patcher" "$LONGMAO_WMPF/src/index.ts"
  node "$network_metadata_patcher" "$LONGMAO_WMPF/src/index.ts"
}

copy_longmao() {
  say "安装 Longmao 到 $LONGMAO_INSTALL_ROOT_RESOLVED"
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/app"
  (
    cd "$SOURCE_ROOT"
    tar       --exclude='.git'       --exclude='artifacts'       --exclude='installer/windows/output'       --exclude='installer/linux/output'       --exclude='config/totoro.json'       -cf - .
  ) | tar -xf - -C "$tmp/app"
  rm -rf "$LONGMAO_INSTALL_ROOT_RESOLVED"
  mkdir -p "$(dirname "$LONGMAO_INSTALL_ROOT_RESOLVED")"
  mv "$tmp/app" "$LONGMAO_INSTALL_ROOT_RESOLVED"
  rm -rf "$tmp"
}

write_wrappers() {
  mkdir -p "$LONGMAO_BIN_ROOT_RESOLVED" "${XDG_DATA_HOME:-$HOME/.local/share}/applications"

  cat >"$LONGMAO_BIN_ROOT_RESOLVED/longmao" <<EOF
#!/usr/bin/env bash
exec "$LONGMAO_INSTALL_ROOT_RESOLVED/scripts/linux/longmao.sh" "\$@"
EOF
  chmod +x "$LONGMAO_BIN_ROOT_RESOLVED/longmao"

  local action
  for action in stop status configure repair uninstall; do
    cat >"$LONGMAO_BIN_ROOT_RESOLVED/longmao-$action" <<EOF
#!/usr/bin/env bash
exec "$LONGMAO_BIN_ROOT_RESOLVED/longmao" "$action" "\$@"
EOF
    chmod +x "$LONGMAO_BIN_ROOT_RESOLVED/longmao-$action"
  done

  cat >"${XDG_DATA_HOME:-$HOME/.local/share}/applications/longmao.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Longmao
Comment=Start Longmao local orchestrator
Exec=$LONGMAO_BIN_ROOT_RESOLVED/longmao start
Terminal=false
Categories=Development;
EOF

  cat >"${XDG_DATA_HOME:-$HOME/.local/share}/applications/longmao-status.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Longmao Status
Exec=$LONGMAO_BIN_ROOT_RESOLVED/longmao status
Terminal=true
Categories=Development;
EOF

  cat >"${XDG_DATA_HOME:-$HOME/.local/share}/applications/longmao-uninstall.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Longmao Uninstall
Exec=$LONGMAO_BIN_ROOT_RESOLVED/longmao uninstall
Terminal=true
Categories=Development;
EOF
}

say '检查 Linux 运行环境'
install_packages
ensure_node22

mkdir -p "$LONGMAO_UPSTREAMS" "$LONGMAO_LOGS" "$LONGMAO_CONFIG_ROOT_RESOLVED"
copy_longmao

# shellcheck disable=SC1091
source "$LONGMAO_INSTALL_ROOT_RESOLVED/scripts/linux/common.sh"
export PATH="$LONGMAO_NODE_ROOT/bin:$LONGMAO_BIN_ROOT_RESOLVED:$PATH"

checkout_pinned "$TOTORO_REPO" "$TOTORO_COMMIT" "$LONGMAO_TOTORO" 'Totoro'
checkout_pinned "$WMPF_REPO" "$WMPF_COMMIT" "$LONGMAO_WMPF" 'WMPFDebugger'
apply_wmpf_patches

say '安装 Totoro 依赖'
(
  cd "$LONGMAO_TOTORO"
  npx --yes pnpm@10 install --frozen-lockfile
)

say '安装 WMPFDebugger 依赖'
(
  cd "$LONGMAO_WMPF"
  rm -rf node_modules package-lock.json
  npx --yes yarn@1.22.22 install --frozen-lockfile
)

if [[ ! -f "$LONGMAO_CONFIG_FILE" ]]; then
  "$LONGMAO_INSTALL_ROOT_RESOLVED/scripts/linux/configure.sh"
else
  backend="$(python3 - "$LONGMAO_CONFIG_FILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    print(json.load(f)['capture']['origin'])
PY
)"
  "$LONGMAO_INSTALL_ROOT_RESOLVED/scripts/linux/configure.sh" "$backend"
fi

say '构建 Totoro'
(
  cd "$LONGMAO_TOTORO"
  npx --yes pnpm@10 build
)

write_wrappers

cat >"$LONGMAO_RUNTIME_ROOT_RESOLVED/runtime.json" <<JSON
{
  "schemaVersion": 1,
  "installedAt": "$(date --iso-8601=seconds)",
  "installRoot": "$LONGMAO_INSTALL_ROOT_RESOLVED",
  "totoro": {"repo":"$TOTORO_REPO","commit":"$TOTORO_COMMIT","path":"$LONGMAO_TOTORO"},
  "wmpf": {"repo":"$WMPF_REPO","commit":"$WMPF_COMMIT","path":"$LONGMAO_WMPF"},
  "redis": {"url":"redis://127.0.0.1:6379","mode":"managed-or-existing"},
  "node": {"path":"$LONGMAO_NODE_ROOT"}
}
JSON

say '安装完成'
printf 'Longmao: %s\nRuntime: %s\nConfig: %s\n'   "$LONGMAO_INSTALL_ROOT_RESOLVED" "$LONGMAO_RUNTIME_ROOT_RESOLVED" "$LONGMAO_CONFIG_FILE"
printf '\n以后运行： longmao start\n查看帮助： longmao help\n卸载： longmao uninstall\n'

"$LONGMAO_INSTALL_ROOT_RESOLVED/scripts/linux/longmao.sh" start
