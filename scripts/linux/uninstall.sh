#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

keep_config=0
assume_yes=0
for arg in "$@"; do
  case "$arg" in
    --keep-config) keep_config=1 ;;
    -y|--yes) assume_yes=1 ;;
    -h|--help)
      printf 'Usage: longmao-uninstall [--keep-config] [--yes]\n'
      exit 0
      ;;
    *) die "未知参数: $arg" ;;
  esac
done

if (( assume_yes == 0 )); then
  printf '将删除 Longmao、Longmao 拉取的 Totoro/WMPF、本地 Node runtime、日志和运行状态。\n'
  printf '不会卸载系统里的 Git、Redis、编译工具或微信。\n'
  if (( keep_config == 1 )); then
    printf '将保留配置目录: %s\n' "$LONGMAO_CONFIG_ROOT_RESOLVED"
  else
    printf '也将删除配置目录: %s\n' "$LONGMAO_CONFIG_ROOT_RESOLVED"
  fi
  read -r -p '确认卸载？ [y/N] ' answer
  [[ "$answer" =~ ^[Yy]$ ]] || { printf '已取消。\n'; exit 0; }
fi

"$SCRIPT_DIR/stop.sh" || true

app_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
rm -f   "$app_dir/longmao.desktop"   "$app_dir/longmao-status.desktop"   "$app_dir/longmao-uninstall.desktop"

for name in longmao longmao-stop longmao-status longmao-configure longmao-repair longmao-uninstall; do
  rm -f "$LONGMAO_BIN_ROOT_RESOLVED/$name"
done

rm -rf "$LONGMAO_RUNTIME_ROOT_RESOLVED"
if (( keep_config == 0 )); then
  rm -rf "$LONGMAO_CONFIG_ROOT_RESOLVED"
fi

# 最后删除程序目录。脚本当前已在 shell 中加载，删除后仍可正常结束。
rm -rf "$LONGMAO_INSTALL_ROOT_RESOLVED"

printf '\nLongmao 已卸载。\n'
printf '系统级依赖没有被卸载，以免影响其他软件。\n'
if (( keep_config == 1 )); then
  printf '配置已保留在: %s\n' "$LONGMAO_CONFIG_ROOT_RESOLVED"
fi
