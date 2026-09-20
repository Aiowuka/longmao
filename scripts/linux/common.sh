#!/usr/bin/env bash
set -euo pipefail

longmao_install_root() {
  printf '%s
' "${LONGMAO_INSTALL_ROOT:-$HOME/.local/opt/longmao}"
}

longmao_runtime_root() {
  printf '%s
' "${LONGMAO_RUNTIME_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/longmao}"
}

longmao_config_root() {
  printf '%s
' "${LONGMAO_CONFIG_ROOT:-${XDG_CONFIG_HOME:-$HOME/.config}/longmao}"
}

longmao_bin_root() {
  printf '%s
' "${LONGMAO_BIN_ROOT:-$HOME/.local/bin}"
}

# shellcheck disable=SC2034
longmao_paths() {
  LONGMAO_INSTALL_ROOT_RESOLVED="$(longmao_install_root)"
  LONGMAO_RUNTIME_ROOT_RESOLVED="$(longmao_runtime_root)"
  LONGMAO_CONFIG_ROOT_RESOLVED="$(longmao_config_root)"
  LONGMAO_BIN_ROOT_RESOLVED="$(longmao_bin_root)"
  LONGMAO_UPSTREAMS="$LONGMAO_RUNTIME_ROOT_RESOLVED/upstreams"
  LONGMAO_TOTORO="$LONGMAO_UPSTREAMS/Totoro"
  LONGMAO_WMPF="$LONGMAO_UPSTREAMS/WMPFDebugger"
  LONGMAO_LOGS="$LONGMAO_RUNTIME_ROOT_RESOLVED/logs"
  LONGMAO_PIDS="$LONGMAO_RUNTIME_ROOT_RESOLVED/pids"
  LONGMAO_NODE_ROOT="$LONGMAO_RUNTIME_ROOT_RESOLVED/node"
  LONGMAO_CONFIG_FILE="$LONGMAO_CONFIG_ROOT_RESOLVED/totoro.json"
}

longmao_paths

export PATH="$LONGMAO_NODE_ROOT/bin:$LONGMAO_BIN_ROOT_RESOLVED:$PATH"

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

port_open() {
  local port="$1"
  if command_exists python3; then
    python3 - "$port" <<'PY' >/dev/null 2>&1
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
s.settimeout(0.5)
try:
    s.connect(("127.0.0.1", port))
except OSError:
    raise SystemExit(1)
else:
    raise SystemExit(0)
finally:
    s.close()
PY
  elif command_exists bash; then
    (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
  else
    return 1
  fi
}

wait_port() {
  local port="$1" timeout="${2:-20}" start
  start="$(date +%s)"
  while (( $(date +%s) - start < timeout )); do
    if port_open "$port"; then return 0; fi
    sleep 0.35
  done
  return 1
}

pid_file() {
  printf '%s/%s.pid\n' "$LONGMAO_PIDS" "$1"
}

process_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

start_managed() {
  local name="$1" workdir="$2" command="$3"
  mkdir -p "$LONGMAO_LOGS" "$LONGMAO_PIDS"
  local pf pid
  pf="$(pid_file "$name")"
  if [[ -f "$pf" ]]; then
    pid="$(cat "$pf" 2>/dev/null || true)"
    if process_alive "$pid"; then return 0; fi
    rm -f "$pf"
  fi
  (
    cd "$workdir"
    nohup bash -c "exec $command" >>"$LONGMAO_LOGS/$name.out.log" 2>>"$LONGMAO_LOGS/$name.err.log" &
    echo $! >"$pf"
  )
}

stop_managed() {
  local name="$1" pf pid
  pf="$(pid_file "$name")"
  [[ -f "$pf" ]] || return 0
  pid="$(cat "$pf" 2>/dev/null || true)"
  if process_alive "$pid"; then
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      process_alive "$pid" || break
      sleep 0.1
    done
    if process_alive "$pid"; then kill -9 "$pid" 2>/dev/null || true; fi
  fi
  rm -f "$pf"
}

normalize_https_origin() {
  local value="$1"
  python3 - "$value" <<'PY'
import sys
from urllib.parse import urlparse
value = sys.argv[1].strip().rstrip("/")
u = urlparse(value)
if u.scheme != "https" or not u.hostname or u.username or u.password or u.params or u.query or u.fragment:
    raise SystemExit("后台必须是无凭据、无 query/fragment 的 HTTPS origin")
if u.path not in ("", "/"):
    raise SystemExit("只填写 origin，例如 https://api.example.com，不要带 /wxxcx 路径")
port = f":{u.port}" if u.port else ""
print(f"https://{u.hostname}{port}")
PY
}

ensure_x86_64() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) ;;
    *) die "当前完整 Linux 安装器只支持 x86_64；WMPFDebugger 上游当前 Linux 支持也是 x86_64。" ;;
  esac
}
