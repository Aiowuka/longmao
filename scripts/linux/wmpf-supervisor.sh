#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

[[ -d "$LONGMAO_WMPF" ]] || die 'WMPFDebugger runtime 缺失，请运行 longmao repair。'
command_exists npx || die 'npx 不可用，请运行 longmao repair。'

retry_seconds="${LONGMAO_WMPF_RETRY_SECONDS:-2}"
child_pid=''
stopping=0
last_wait_notice=0

wechat_process_present() {
  local comm name
  for comm in /proc/[0-9]*/comm; do
    [[ -r "$comm" ]] || continue
    IFS= read -r name <"$comm" || true
    [[ "$name" == 'WeChatAppEx' ]] && return 0
  done
  return 1
}

stop_child() {
  [[ -n "$child_pid" ]] || return 0
  if process_alive "$child_pid"; then
    kill "$child_pid" 2>/dev/null || true
    for _ in {1..30}; do
      process_alive "$child_pid" || break
      sleep 0.1
    done
    if process_alive "$child_pid"; then
      kill -9 "$child_pid" 2>/dev/null || true
    fi
  fi
  wait "$child_pid" 2>/dev/null || true
  child_pid=''
}

shutdown() {
  stopping=1
  stop_child
}

trap shutdown INT TERM EXIT

while (( ! stopping )); do
  if ! wechat_process_present; then
    now="$(date +%s)"
    if (( now - last_wait_notice >= 15 )); then
      printf '[wmpf-supervisor] 等待 WeChatAppEx；打开 Linux 微信/小程序后会自动启动 WMPFDebugger。\n'
      last_wait_notice="$now"
    fi
    sleep "$retry_seconds"
    continue
  fi

  printf '[wmpf-supervisor] 检测到 WeChatAppEx，启动 WMPFDebugger。\n'
  (
    cd "$LONGMAO_WMPF"
    exec npx ts-node src/index.ts
  ) &
  child_pid=$!

  set +e
  wait "$child_pid"
  code=$?
  set -e
  child_pid=''

  (( stopping )) && break
  printf '[wmpf-supervisor] WMPFDebugger 已退出 (code=%s)，%ss 后重试。\n' "$code" "$retry_seconds" >&2
  sleep "$retry_seconds"
done
