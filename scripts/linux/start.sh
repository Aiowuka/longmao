#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

[[ -d "$LONGMAO_INSTALL_ROOT_RESOLVED" ]] || die 'Longmao 尚未安装。'
[[ -f "$LONGMAO_CONFIG_FILE" ]] || die 'Longmao 尚未配置，请运行 longmao configure。'
[[ -d "$LONGMAO_TOTORO" ]] || die 'Totoro runtime 缺失，请运行 longmao repair。'
[[ -d "$LONGMAO_WMPF" ]] || die 'WMPFDebugger runtime 缺失，请运行 longmao repair。'
command_exists node || die 'Node.js runtime 不可用，请运行 longmao repair。'
command_exists redis-server || die 'redis-server 不可用，请运行 longmao repair。'

mkdir -p "$LONGMAO_LOGS" "$LONGMAO_PIDS" "$LONGMAO_RUNTIME_ROOT_RESOLVED/redis"

if ! port_open 6379; then
  say '启动本地 Redis'
  start_managed redis "$LONGMAO_RUNTIME_ROOT_RESOLVED/redis"     "redis-server --bind 127.0.0.1 --port 6379 --save '' --appendonly no --daemonize no"
  wait_port 6379 12 || die "Redis 启动失败，请查看 $LONGMAO_LOGS/redis.err.log"
fi

say '启动 Totoro'
start_managed totoro-web "$LONGMAO_TOTORO" "PORT=3000 NODE_ENV=production npx --yes pnpm@10 start"
wait_port 3000 30 || die "Totoro 启动失败，请查看 $LONGMAO_LOGS/totoro-web.err.log"

say '启动 Totoro Worker'
start_managed totoro-worker "$LONGMAO_TOTORO" "NODE_ENV=production npx --yes pnpm@10 worker:run"

say '启动 WMPFDebugger'
if [[ -r /proc/sys/kernel/yama/ptrace_scope ]]; then
  ptrace_scope="$(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || true)"
  if [[ "$ptrace_scope" != "0" ]]; then
    warn "Linux ptrace_scope=$ptrace_scope；Frida 可能无法附加 WeChatAppEx。可临时执行: sudo sysctl -w kernel.yama.ptrace_scope=0"
  fi
fi
start_managed wmpf-debugger "$LONGMAO_INSTALL_ROOT_RESOLVED" "bash '$SCRIPT_DIR/wmpf-supervisor.sh'"
if ! wait_port 62000 2; then
  warn 'WMPF supervisor 已启动；CDP 62000 会在检测到 WeChatAppEx 后自动就绪。'
fi

say '启动 Longmao'
start_managed longmao-web "$LONGMAO_INSTALL_ROOT_RESOLVED"   "LONGMAO_TOTORO_CONFIG='$LONGMAO_CONFIG_FILE' node src/web.mjs"
wait_port 3210 15 || die "Longmao 启动失败，请查看 $LONGMAO_LOGS/longmao-web.err.log"

printf '\nLongmao 已启动。\n'
printf '1. 打开 Linux 微信。\n'
printf '2. 打开连接到你自有后台的小程序。\n'
printf '3. 浏览器进入 http://127.0.0.1:3210\n'
printf '4. Longmao 会自动连接 CDP；正常登录/刷新后同步 Totoro。\n'

if command_exists xdg-open; then
  xdg-open http://127.0.0.1:3210 >/dev/null 2>&1 || true
fi
