#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION='0.5.0'

usage() {
  cat <<'EOF'
Longmao CLI

Usage:
  longmao <command> [options]

Commands:
  start                  Start Longmao, Totoro, Worker, WMPF and local Redis if needed
  stop                   Stop Longmao-managed local processes
  restart                Stop and start the local stack
  status                 Show local service status
  configure [origin]     Configure the Totoro-compatible HTTPS backend origin
  repair                 Re-check pinned upstreams, reinstall deps and rebuild Totoro
  logs [service]         Show log directory or tail one service log
  open                   Open http://127.0.0.1:3210 in the default browser
  version                Print Longmao version
  uninstall [options]    Uninstall Longmao
  help                   Show this help

Uninstall options:
  --keep-config          Keep ~/.config/longmao
  -y, --yes              Skip confirmation

Examples:
  longmao start
  longmao status
  longmao configure https://api.example.com
  longmao logs totoro-web
  longmao uninstall --keep-config
EOF
}

command="${1:-help}"
if (($# > 0)); then shift; fi

case "$command" in
  start)
    exec "$SCRIPT_DIR/start.sh" "$@"
    ;;
  stop)
    exec "$SCRIPT_DIR/stop.sh" "$@"
    ;;
  restart)
    "$SCRIPT_DIR/stop.sh"
    exec "$SCRIPT_DIR/start.sh" "$@"
    ;;
  status)
    exec "$SCRIPT_DIR/status.sh" "$@"
    ;;
  configure|config)
    exec "$SCRIPT_DIR/configure.sh" "$@"
    ;;
  repair)
    exec "$SCRIPT_DIR/repair.sh" "$@"
    ;;
  uninstall|remove)
    exec "$SCRIPT_DIR/uninstall.sh" "$@"
    ;;
  logs)
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/common.sh"
    service="${1:-}"
    if [[ -z "$service" ]]; then
      printf '%s\n' "$LONGMAO_LOGS"
      exit 0
    fi
    case "$service" in
      redis|totoro-web|totoro-worker|wmpf-debugger|longmao-web) ;;
      *) die "未知服务: $service。可选: redis, totoro-web, totoro-worker, wmpf-debugger, longmao-web" ;;
    esac
    out="$LONGMAO_LOGS/$service.out.log"
    err="$LONGMAO_LOGS/$service.err.log"
    if [[ ! -e "$out" && ! -e "$err" ]]; then
      die "暂时没有 $service 日志。"
    fi
    printf '==> %s\n' "$out"
    [[ -f "$out" ]] && tail -n 80 "$out"
    printf '\n==> %s\n' "$err"
    [[ -f "$err" ]] && tail -n 80 "$err"
    ;;
  open)
    url='http://127.0.0.1:3210'
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$url" >/dev/null 2>&1 || true
    else
      printf '%s\n' "$url"
    fi
    ;;
  version|--version|-v)
    printf 'Longmao %s\n' "$VERSION"
    ;;
  help|--help|-h|'')
    usage
    ;;
  *)
    printf 'Unknown command: %s\n\n' "$command" >&2
    usage >&2
    exit 2
    ;;
esac
